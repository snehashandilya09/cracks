// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ChainlinkOracleAdapter.sol";
import "./PythOracleAdapter.sol";
import "./UniswapV3TWAPAdapter.sol";

/// @title OracleAggregator
/// @notice Aggregates 3 oracle sources with Byzantine fault tolerance
/// @dev Handles: conflicting values, staleness, 30% manipulation, missing updates
/// @dev Byzantine-resistant: 2/3 honest oracles ensure correct median price
contract OracleAggregator {

    ChainlinkOracleAdapter public chainlink;
    PythOracleAdapter public pyth;
    UniswapV3TWAPAdapter public uniswapTWAP;

    struct AggregatedPrice {
        uint256 price;           // Median price from all sources
        uint256 timestamp;       // Earliest timestamp among sources
        uint256 confidence;      // Confidence score (0-100)
        uint256 deviation;       // Max deviation between sources (basis points)
        uint8 sourceCount;       // Number of oracles that responded
        bool isHealthy;          // True if passes all checks
        string[] activeSources;  // Which oracles contributed
    }

    struct OracleReading {
        uint256 price;
        uint256 timestamp;
        bool success;
        string source;
    }

    // Thresholds (from adversarial conditions)
    uint256 public constant MAX_ACCEPTABLE_DEVIATION = 3000; // 30% (handles adversarial condition #1)
    uint256 public constant MIN_SOURCES_REQUIRED = 2;        // Need at least 2 oracles (Byzantine tolerance)
    uint256 public constant MAX_PRICE_AGE = 3600;            // 1 hour staleness limit (handles condition #2)

    event OraclePriceFetched(string source, uint256 price, uint256 timestamp);
    event OracleFetchFailed(string source, string reason);
    event PriceAggregated(
        bytes32 indexed pairId,
        uint256 medianPrice,
        uint8 sourceCount,
        uint256 deviation,
        bool isHealthy
    );

    constructor(
        address _chainlink,
        address _pyth,
        address _uniswapTWAP
    ) {
        require(_chainlink != address(0), "OracleAggregator: Invalid Chainlink address");
        require(_pyth != address(0), "OracleAggregator: Invalid Pyth address");
        require(_uniswapTWAP != address(0), "OracleAggregator: Invalid Uniswap address");

        chainlink = ChainlinkOracleAdapter(_chainlink);
        pyth = PythOracleAdapter(_pyth);
        uniswapTWAP = UniswapV3TWAPAdapter(_uniswapTWAP);
    }

    /// @notice Get aggregated price from all oracle sources
    /// @dev Handles all 4 adversarial conditions from hackathon spec
    /// @param pairId Asset pair (e.g., keccak256("ETH/USD"))
    /// @return Aggregated price data with health metrics
    function getAggregatedPrice(bytes32 pairId)
        public
        returns (AggregatedPrice memory)
    {
        OracleReading[] memory readings = new OracleReading[](3);
        uint8 successCount = 0;

        // 1. Fetch from Chainlink (most decentralized, slowest updates)
        try chainlink.getLatestPrice(pairId) returns (
            uint256 price,
            uint256 timestamp,
            uint80 /* roundId */
        ) {
            readings[successCount++] = OracleReading({
                price: price,
                timestamp: timestamp,
                success: true,
                source: "Chainlink"
            });
            emit OraclePriceFetched("Chainlink", price, timestamp);
        } catch Error(string memory reason) {
            emit OracleFetchFailed("Chainlink", reason);
        } catch {
            emit OracleFetchFailed("Chainlink", "Unknown error");
        }

        // 2. Fetch from Pyth (high-frequency, sub-second updates)
        try pyth.getLatestPrice(pairId) returns (
            uint256 price,
            uint256 timestamp,
            uint64 /* conf */
        ) {
            readings[successCount++] = OracleReading({
                price: price,
                timestamp: timestamp,
                success: true,
                source: "Pyth"
            });
            emit OraclePriceFetched("Pyth", price, timestamp);
        } catch Error(string memory reason) {
            emit OracleFetchFailed("Pyth", reason);
        } catch {
            emit OracleFetchFailed("Pyth", "Unknown error");
        }

        // 3. Fetch from Uniswap V3 TWAP (on-chain, manipulation-resistant)
        try uniswapTWAP.getLatestPrice(pairId) returns (
            uint256 price,
            uint256 timestamp
        ) {
            readings[successCount++] = OracleReading({
                price: price,
                timestamp: timestamp,
                success: true,
                source: "Uniswap TWAP"
            });
            emit OraclePriceFetched("Uniswap TWAP", price, timestamp);
        } catch Error(string memory reason) {
            emit OracleFetchFailed("Uniswap TWAP", reason);
        } catch {
            emit OracleFetchFailed("Uniswap TWAP", "Unknown error");
        }

        // ADVERSARIAL CONDITION #3: Handle missing updates
        // Require at least 2 oracles working (can tolerate 1 failure)
        require(successCount >= MIN_SOURCES_REQUIRED, "OracleAggregator: Insufficient oracle sources");

        // Aggregate results
        AggregatedPrice memory result = _aggregateReadings(readings, successCount);

        emit PriceAggregated(
            pairId,
            result.price,
            result.sourceCount,
            result.deviation,
            result.isHealthy
        );

        return result;
    }

    /// @notice Aggregate multiple oracle readings into single price
    /// @dev Uses median for Byzantine fault tolerance (resistant to 1 malicious oracle)
    /// @param readings Array of oracle readings
    /// @param count Number of successful readings
    /// @return Aggregated price with health metrics
    function _aggregateReadings(
        OracleReading[] memory readings,
        uint8 count
    ) internal view returns (AggregatedPrice memory) {
        require(count >= MIN_SOURCES_REQUIRED, "OracleAggregator: Too few sources");

        // Extract successful readings
        uint256[] memory prices = new uint256[](count);
        uint256[] memory timestamps = new uint256[](count);
        string[] memory sources = new string[](count);

        for (uint8 i = 0; i < count; i++) {
            prices[i] = readings[i].price;
            timestamps[i] = readings[i].timestamp;
            sources[i] = readings[i].source;
        }

        // Sort prices for median calculation
        if (count > 1) {
            _quickSort(prices, 0, int256(uint256(count - 1)));
        }

        // Calculate median (Byzantine-resistant: correct if 2/3 honest)
        // ADVERSARIAL CONDITION #1: Even if 1 oracle reports 30%+ wrong price, median is correct
        uint256 medianPrice;
        if (count % 2 == 0) {
            // Even number: average of middle two
            medianPrice = (prices[count / 2 - 1] + prices[count / 2]) / 2;
        } else {
            // Odd number: middle value
            medianPrice = prices[count / 2];
        }

        // Calculate deviation (detect conflicting values)
        // ADVERSARIAL CONDITION #4: Detect when oracles provide conflicting values
        uint256 minPrice = prices[0];
        uint256 maxPrice = prices[count - 1];
        uint256 deviation = ((maxPrice - minPrice) * 10000) / medianPrice;

        // Calculate confidence (inverse of deviation, scaled 0-100)
        uint256 confidence = deviation < 10000 ? 10000 - deviation : 0;
        confidence = (confidence * 100) / 10000;

        // Find earliest timestamp (conservative staleness check)
        // ADVERSARIAL CONDITION #2: Use most conservative timestamp
        uint256 earliestTimestamp = timestamps[0];
        for (uint8 i = 1; i < count; i++) {
            if (timestamps[i] < earliestTimestamp) {
                earliestTimestamp = timestamps[i];
            }
        }

        // Health checks
        bool isHealthy = true;

        // Check 1: Deviation within acceptable range (30%)
        if (deviation > MAX_ACCEPTABLE_DEVIATION) {
            isHealthy = false; // Conflicting values detected (CONDITION #4)
        }

        // Check 2: Not too stale
        if (block.timestamp - earliestTimestamp > MAX_PRICE_AGE) {
            isHealthy = false; // Outdated data (CONDITION #2)
        }

        // Check 3: Minimum confidence threshold
        if (confidence < 50) {
            isHealthy = false; // Low confidence
        }

        return AggregatedPrice({
            price: medianPrice,
            timestamp: earliestTimestamp,
            confidence: confidence,
            deviation: deviation,
            sourceCount: count,
            isHealthy: isHealthy,
            activeSources: sources
        });
    }

    /// @notice Quick sort for median calculation (ascending order)
    /// @dev O(n log n) average case, used for sorting prices
    /// @param arr Array to sort (modified in-place)
    /// @param left Left boundary
    /// @param right Right boundary
    function _quickSort(uint256[] memory arr, int256 left, int256 right) internal pure {
        if (left >= right) return;

        int256 i = left;
        int256 j = right;
        uint256 pivot = arr[uint256(left + (right - left) / 2)];

        while (i <= j) {
            while (arr[uint256(i)] < pivot) i++;
            while (pivot < arr[uint256(j)]) j--;
            if (i <= j) {
                (arr[uint256(i)], arr[uint256(j)]) = (arr[uint256(j)], arr[uint256(i)]);
                i++;
                j--;
            }
        }

        if (left < j) _quickSort(arr, left, j);
        if (i < right) _quickSort(arr, i, right);
    }

    /// @notice Verify if a claimed price is reasonable given current oracle state
    /// @dev Used in dispute resolution - checks against all 4 adversarial conditions
    /// @param pairId Asset pair
    /// @param claimedPrice Price submitted by prover
    /// @param claimTimestamp When price was claimed
    /// @return isValid True if claim passes verification
    /// @return reason Explanation of result
    function verifyClaimedPrice(
        bytes32 pairId,
        uint256 claimedPrice,
        uint256 claimTimestamp
    ) external returns (bool isValid, string memory reason) {
        AggregatedPrice memory agg = getAggregatedPrice(pairId);

        // Check 1: Claimed price within 30% of aggregated median (CONDITION #1)
        uint256 priceDeviation = claimedPrice > agg.price
            ? ((claimedPrice - agg.price) * 10000) / agg.price
            : ((agg.price - claimedPrice) * 10000) / agg.price;

        if (priceDeviation > MAX_ACCEPTABLE_DEVIATION) {
            return (false, "Claimed price deviates >30% from oracle consensus");
        }

        // Check 2: Oracle data is healthy (CONDITION #2, #4)
        if (!agg.isHealthy) {
            return (false, "Oracle data unhealthy - conflicting or stale");
        }

        // Check 3: Timestamp reasonable (CONDITION #2)
        if (claimTimestamp > block.timestamp) {
            return (false, "Claimed timestamp in future");
        }

        if (block.timestamp - claimTimestamp > MAX_PRICE_AGE) {
            return (false, "Claimed price too old");
        }

        return (true, "Price verified by oracle consensus");
    }

    /// @notice Get individual oracle prices for transparency
    /// @dev Useful for debugging and showing which oracle is outlier
    /// @param pairId Asset pair
    /// @return chainlinkPrice Price from Chainlink
    /// @return pythPrice Price from Pyth
    /// @return uniswapPrice Price from Uniswap TWAP
    /// @return chainlinkSuccess True if Chainlink succeeded
    /// @return pythSuccess True if Pyth succeeded
    /// @return uniswapSuccess True if Uniswap succeeded
    function getIndividualPrices(bytes32 pairId)
        external
        view
        returns (
            uint256 chainlinkPrice,
            uint256 pythPrice,
            uint256 uniswapPrice,
            bool chainlinkSuccess,
            bool pythSuccess,
            bool uniswapSuccess
        )
    {
        // Fetch Chainlink
        try chainlink.getLatestPrice(pairId) returns (
            uint256 price,
            uint256,
            uint80
        ) {
            chainlinkPrice = price;
            chainlinkSuccess = true;
        } catch {
            chainlinkSuccess = false;
        }

        // Fetch Pyth
        try pyth.getLatestPrice(pairId) returns (
            uint256 price,
            uint256,
            uint64
        ) {
            pythPrice = price;
            pythSuccess = true;
        } catch {
            pythSuccess = false;
        }

        // Fetch Uniswap TWAP
        try uniswapTWAP.getLatestPrice(pairId) returns (
            uint256 price,
            uint256
        ) {
            uniswapPrice = price;
            uniswapSuccess = true;
        } catch {
            uniswapSuccess = false;
        }
    }

    /// @notice Emergency: Get price even if unhealthy (with explicit warnings)
    /// @dev Only use when system must proceed despite oracle issues
    /// @param pairId Asset pair
    /// @return price Median price (may be unreliable)
    /// @return warning Explicit warning message
    function getEmergencyPrice(bytes32 pairId)
        external
        returns (uint256 price, string memory warning)
    {
        AggregatedPrice memory agg = getAggregatedPrice(pairId);

        if (!agg.isHealthy) {
            if (agg.deviation > MAX_ACCEPTABLE_DEVIATION) {
                warning = "WARNING: Oracle sources conflict >30% - using median with HIGH UNCERTAINTY";
            } else if (block.timestamp - agg.timestamp > MAX_PRICE_AGE) {
                warning = "WARNING: Oracle data stale - price may not reflect current market";
            } else {
                warning = "WARNING: Low confidence in oracle data";
            }
        } else {
            warning = "";
        }

        return (agg.price, warning);
    }
}
