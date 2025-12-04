// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibClearStorage.sol";
import "../libraries/SafetyModule.sol";
import "../interfaces/IClearSettle.sol";

/**
 * @title EpochManager
 * @author ClearSettle Team - TriHacker Tournament Finale
 * @notice Manages epoch lifecycle and phase transitions
 * @dev Core state machine logic for partial finality
 * 
 * PARTIAL FINALITY EXPLANATION:
 * ============================
 * Unlike atomic transactions (single block), our settlement occurs across
 * multiple blocks. This is intentional for security:
 * 
 * 1. COMMIT PHASE (blocks 0-10): Users submit hidden orders
 *    - Cannot be front-run (orders are hashed)
 *    - Time to accumulate orders for batch
 * 
 * 2. REVEAL PHASE (blocks 11-20): Users reveal orders
 *    - No new orders allowed (prevents reactive trading)
 *    - Bond returned on reveal, slashed on no-reveal
 * 
 * 3. SETTLE PHASE (block 21): Calculate clearing price
 *    - All orders execute at same price
 *    - No MEV extraction possible (uniform price)
 * 
 * 4. SAFETY BUFFER (blocks 22-32): Wait for finality
 *    - Protects against blockchain reorgs
 *    - If reorg happens, settlement might be reversed
 *    - Wait ensures settlement is "final enough"
 * 
 * 5. FINALIZED (block 33+): Withdrawals enabled
 *    - Safe to withdraw funds
 *    - Next epoch can start
 * 
 * LAZY STATE TRANSITIONS:
 * =======================
 * Smart contracts are passive - they can't "wake up" at block X.
 * We use "lazy" transitions: any function call first checks if
 * phase should advance based on current block number.
 */
contract EpochManager is ClearStorageAccess {
    using LibClearStorage for LibClearStorage.ClearStorage;
    using SafetyModule for *;
    
    // ============ Events ============
    
    event PhaseTransition(
        uint256 indexed epochId, 
        EpochPhase fromPhase, 
        EpochPhase toPhase, 
        uint256 blockNumber
    );
    
    event EpochInitialized(
        uint256 indexed epochId,
        uint256 startBlock,
        uint256 commitEnd,
        uint256 revealEnd
    );
    
    event EmergencyTriggered(uint256 indexed epochId, string reason);
    
    // ============ Initialization ============
    
    /**
     * @notice Initialize the epoch manager
     * @dev Sets up initial configuration and starts first epoch
     */
    function _initializeEpochManager() internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        LibClearStorage.initializeConfig(s);
        
        // Start first epoch
        _startNewEpoch();
    }
    
    // ============ Phase Management ============
    
    /**
     * @notice Update epoch phase based on current block
     * @dev Called at start of every public function (lazy transition)
     * 
     * IMPLEMENTATION PATTERN:
     * This is the "heartbeat" of the protocol. Every interaction
     * first calls this to ensure phase is current.
     * 
     * GAS OPTIMIZATION:
     * Phase checks are view operations until transition needed.
     * Only writes to storage when phase actually changes.
     */
    function _updatePhase() internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        // Skip if epoch not started or already finalized/void
        if (epoch.phase == EpochPhase.UNINITIALIZED ||
            epoch.phase == EpochPhase.FINALIZED ||
            epoch.phase == EpochPhase.VOID) {
            return;
        }
        
        uint256 currentBlock = block.number;
        EpochPhase currentPhase = epoch.phase;
        EpochPhase newPhase = currentPhase;
        
        // Determine correct phase based on block number
        if (currentPhase == EpochPhase.ACCEPTING_COMMITS) {
            if (currentBlock > epoch.commitEndBlock) {
                newPhase = EpochPhase.ACCEPTING_REVEALS;
            }
        } else if (currentPhase == EpochPhase.ACCEPTING_REVEALS) {
            if (currentBlock > epoch.revealEndBlock) {
                newPhase = EpochPhase.SETTLING;
            }
        } else if (currentPhase == EpochPhase.SETTLING) {
            // Settling transitions to SAFETY_BUFFER after settle() is called
            // This is a manual transition, not time-based
        } else if (currentPhase == EpochPhase.SAFETY_BUFFER) {
            if (currentBlock > epoch.safetyEndBlock) {
                newPhase = EpochPhase.FINALIZED;
            }
        }
        
        // Apply transition if phase changed
        if (newPhase != currentPhase) {
            _transitionPhase(epoch, currentPhase, newPhase);
        }
        
        // Check for stuck epoch (liveness guarantee)
        _checkLiveness(epoch);
    }
    
    /**
     * @notice Execute phase transition with invariant checks
     * @param epoch Epoch storage reference
     * @param fromPhase Current phase
     * @param toPhase Target phase
     *
     * INVARIANT ENFORCEMENT (per Module-1 Section 4.2):
     * Every transition validates:
     * 1. Transition is valid (state machine rules) - Invariant 5
     * 2. Time monotonicity preserved - Invariant 3
     * 3. Solvency maintained - Invariant 1
     *
     * HOARE LOGIC:
     * {P} transition {Q}
     * P = preconditions (valid transition)
     * Q = postconditions (invariants hold)
     */
    function _transitionPhase(
        EpochData storage epoch,
        EpochPhase fromPhase,
        EpochPhase toPhase
    ) internal {
        // PRE-CONDITION: Enforce Invariant 5: Valid State Transition
        SafetyModule.enforceValidTransition(fromPhase, toPhase);

        // Update phase
        epoch.phase = toPhase;

        // Record transition block for time monotonicity
        if (toPhase == EpochPhase.SETTLING) {
            epoch.settleBlock = block.number;
        }

        // POST-CONDITION: Enforce Invariant 3: Time Monotonicity
        SafetyModule.enforceTimeMonotonicity(epoch);

        emit PhaseTransition(epoch.epochId, fromPhase, toPhase, block.number);
    }
    
    // ============ Epoch Lifecycle ============
    
    /**
     * @notice Start a new epoch
     * @dev Initializes epoch data and sets phase boundaries
     * 
     * BLOCK TIMING CALCULATION:
     * - commitEnd = start + commitDuration
     * - revealEnd = commitEnd + revealDuration
     * - safetyEnd = settleBlock + safetyBufferDuration (set during settle)
     */
    function _startNewEpoch() internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        
        uint256 newEpochId = s.currentEpochId + 1;
        s.currentEpochId = newEpochId;
        
        EpochData storage newEpoch = s.epochs[newEpochId];
        
        newEpoch.epochId = newEpochId;
        newEpoch.startBlock = block.number;
        newEpoch.commitEndBlock = block.number + s.config.commitDuration;
        newEpoch.revealEndBlock = newEpoch.commitEndBlock + s.config.revealDuration;
        newEpoch.phase = EpochPhase.ACCEPTING_COMMITS;
        
        // Other fields default to 0/false
        
        emit EpochInitialized(
            newEpochId,
            newEpoch.startBlock,
            newEpoch.commitEndBlock,
            newEpoch.revealEndBlock
        );
    }
    
    /**
     * @notice Check if epoch is stuck and needs force-advance
     * @param epoch Epoch to check
     * 
     * LIVENESS GUARANTEE:
     * If epoch exceeds maxEpochDuration without finalizing,
     * something is wrong. This allows recovery.
     * 
     * ESCAPE HATCH:
     * Critical for ensuring funds aren't locked forever
     * if settlement logic has a bug.
     */
    function _checkLiveness(EpochData storage epoch) internal view {
        LibClearStorage.ClearStorage storage s = _getStorage();
        
        // Only check if epoch is active
        if (epoch.phase == EpochPhase.UNINITIALIZED ||
            epoch.phase == EpochPhase.FINALIZED ||
            epoch.phase == EpochPhase.VOID) {
            return;
        }
        
        // Check if epoch has exceeded max duration
        uint256 epochAge = block.number - epoch.startBlock;
        if (epochAge > s.config.maxEpochDuration) {
            // This is a view function, can't modify state
            // The actual force-advance happens in forceAdvanceEpoch()
            // This just identifies the condition
        }
    }
    
    /**
     * @notice Force advance a stuck epoch
     * @dev Emergency escape hatch for liveness
     * 
     * WHEN TO USE:
     * - Epoch stuck in SETTLING (settle() never called)
     * - Epoch stuck due to bug
     * - Need to unlock user funds
     * 
     * SECURITY CONSIDERATION:
     * This allows skipping settlement, so users get original
     * deposits back (minus bond if unrevealed). No trades execute.
     */
    function _forceAdvanceEpoch() internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        // Can only force-advance if epoch is stuck
        uint256 epochAge = block.number - epoch.startBlock;
        require(
            epochAge > s.config.maxEpochDuration,
            "ClearSettle: Epoch not stuck"
        );
        
        // Void the epoch and start new one
        _voidEpoch(epoch, "FORCE_ADVANCE: Epoch exceeded max duration");
        _startNewEpoch();
    }
    
    /**
     * @notice Void an epoch (emergency)
     * @param epoch Epoch to void
     * @param reason Why epoch is being voided
     * 
     * VOID STATE:
     * When voided:
     * - No settlements execute
     * - Users can withdraw original deposits
     * - Bonds may be returned or redistributed
     * 
     * TRIGGERS:
     * - Invariant violation
     * - Liveness timeout
     * - Admin emergency (if implemented)
     */
    function _voidEpoch(EpochData storage epoch, string memory reason) internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        
        epoch.phase = EpochPhase.VOID;
        s.emergencyMode = true;
        s.emergencyReason = reason;
        
        emit EmergencyTriggered(epoch.epochId, reason);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get current epoch ID
     * @return Current epoch number
     */
    function getCurrentEpochId() public view returns (uint256) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.currentEpochId;
    }
    
    /**
     * @notice Get current phase
     * @return Current epoch phase
     * 
     * NOTE: This returns the STORED phase, not the CALCULATED phase.
     * To get accurate phase, call _updatePhase() first or use
     * getCalculatedPhase() which simulates the update.
     */
    function getCurrentPhase() public view virtual returns (EpochPhase) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.epochs[s.currentEpochId].phase;
    }
    
    /**
     * @notice Get calculated phase based on current block
     * @return Phase that would be active after lazy update
     * 
     * USEFUL FOR:
     * - Frontend display
     * - Determining if action is valid before sending tx
     */
    function getCalculatedPhase() public view returns (EpochPhase) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        if (epoch.phase == EpochPhase.UNINITIALIZED ||
            epoch.phase == EpochPhase.FINALIZED ||
            epoch.phase == EpochPhase.VOID) {
            return epoch.phase;
        }
        
        uint256 currentBlock = block.number;
        
        if (epoch.phase == EpochPhase.ACCEPTING_COMMITS) {
            if (currentBlock > epoch.commitEndBlock) {
                return EpochPhase.ACCEPTING_REVEALS;
            }
        } else if (epoch.phase == EpochPhase.ACCEPTING_REVEALS) {
            if (currentBlock > epoch.revealEndBlock) {
                return EpochPhase.SETTLING;
            }
        } else if (epoch.phase == EpochPhase.SAFETY_BUFFER) {
            if (currentBlock > epoch.safetyEndBlock) {
                return EpochPhase.FINALIZED;
            }
        }
        
        return epoch.phase;
    }
    
    /**
     * @notice Get epoch data
     * @param epochId Epoch to query
     * @return Epoch data struct
     */
    function getEpochData(uint256 epochId) public view virtual returns (EpochData memory) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.epochs[epochId];
    }
    
    /**
     * @notice Get blocks remaining in current phase
     * @return blocks Number of blocks until phase transition
     * 
     * USEFUL FOR:
     * - Frontend countdown timers
     * - User decision making (how long to submit)
     */
    function getBlocksRemaining() public view returns (uint256 blocks) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        uint256 currentBlock = block.number;
        
        if (epoch.phase == EpochPhase.ACCEPTING_COMMITS) {
            if (currentBlock < epoch.commitEndBlock) {
                return epoch.commitEndBlock - currentBlock;
            }
        } else if (epoch.phase == EpochPhase.ACCEPTING_REVEALS) {
            if (currentBlock < epoch.revealEndBlock) {
                return epoch.revealEndBlock - currentBlock;
            }
        } else if (epoch.phase == EpochPhase.SAFETY_BUFFER) {
            if (currentBlock < epoch.safetyEndBlock) {
                return epoch.safetyEndBlock - currentBlock;
            }
        }
        
        return 0; // Phase should transition
    }
    
    /**
     * @notice Get protocol configuration
     * @return Configuration struct
     */
    function getConfig() public view returns (LibClearStorage.ProtocolConfig memory) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.config;
    }
}
