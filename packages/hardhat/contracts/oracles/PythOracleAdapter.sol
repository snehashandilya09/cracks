// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title PythOracleAdapter
/// @notice Fetches price data from Pyth Network (high-frequency oracle)
/// @dev Official Sepolia testnet address from https://docs.pyth.network/price-feeds/contract-addresses/evm
contract PythOracleAdapter {

    IPyth public pyth;

    // Pyth contract address (Ethereum Sepolia testnet)
    // Source: https://docs.pyth.network/price-feeds/contract-addresses/evm
    address public constant PYTH_ADDRESS = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21;

    // Price feed IDs (Pyth identifiers)
    // Source: https://pyth.network/developers/price-feed-ids
    bytes32 public constant ETH_USD_FEED_ID =
        0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public constant BTC_USD_FEED_ID =
        0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

    mapping(bytes32 => bytes32) public feedIds; // pairId => Pyth feed ID

    event PriceFeedRegistered(bytes32 indexed pairId, bytes32 indexed feedId);
    event PriceFetched(bytes32 indexed pairId, uint256 price, uint256 timestamp, uint64 conf);

    constructor() {
        pyth = IPyth(PYTH_ADDRESS);

        // Register ETH/USD
        feedIds[keccak256("ETH/USD")] = ETH_USD_FEED_ID;
        emit PriceFeedRegistered(keccak256("ETH/USD"), ETH_USD_FEED_ID);

        // Register BTC/USD
        feedIds[keccak256("BTC/USD")] = BTC_USD_FEED_ID;
        emit PriceFeedRegistered(keccak256("BTC/USD"), BTC_USD_FEED_ID);
    }

    /// @notice Get latest price from Pyth (normalized to 18 decimals)
    /// @param pairId Asset pair identifier (e.g., keccak256("ETH/USD"))
    /// @return price Normalized price (18 decimals)
    /// @return timestamp Publish time
    /// @return conf Confidence interval
    function getLatestPrice(bytes32 pairId)
        external
        view
        returns (
            uint256 price,
            uint256 timestamp,
            uint64 conf
        )
    {
        bytes32 feedId = feedIds[pairId];
        require(feedId != bytes32(0), "PythAdapter: Feed not registered");

        PythStructs.Price memory priceData = pyth.getPriceUnsafe(feedId);

        // Validation
        require(priceData.price > 0, "PythAdapter: Invalid price");
        require(priceData.publishTime > 0, "PythAdapter: Invalid timestamp");

        // Staleness check (Pyth updates every 400ms, allow 60s max)
        require(
            block.timestamp - priceData.publishTime <= 60,
            "PythAdapter: Pyth price too stale"
        );

        // Normalize to 18 decimals
        uint256 normalizedPrice = _normalizePrice(
            uint64(priceData.price),
            priceData.expo
        );

        return (normalizedPrice, priceData.publishTime, priceData.conf);
    }

    /// @notice Normalize Pyth price to 18 decimals
    /// @dev Pyth prices come with exponent (e.g., price=3000, expo=-8 means $30.00)
    /// @param price Raw price value
    /// @param expo Exponent (negative for decimal places)
    /// @return Normalized price with 18 decimals
    function _normalizePrice(uint64 price, int32 expo) internal pure returns (uint256) {
        // Pyth prices: price * 10^expo
        // Target: 18 decimals

        if (expo < 0) {
            uint32 absExpo = uint32(-expo);
            if (absExpo < 18) {
                // Scale up to 18 decimals
                return uint256(price) * (10 ** (18 - absExpo));
            } else {
                // Already more than 18 decimals, scale down
                return uint256(price) / (10 ** (absExpo - 18));
            }
        } else {
            // Positive exponent (rare)
            return uint256(price) * (10 ** (18 + uint32(expo)));
        }
    }

    /// @notice Update Pyth price with off-chain data
    /// @dev Pyth requires price update data from Hermes API
    /// @param priceUpdateData Price update data from Pyth Hermes
    function updatePrice(bytes[] calldata priceUpdateData)
        external
        payable
    {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "PythAdapter: Insufficient update fee");

        pyth.updatePriceFeeds{value: fee}(priceUpdateData);
    }

    /// @notice Get Pyth price without safety checks (unsafe - use with caution)
    /// @dev Only use this if you need raw data and handle validation yourself
    /// @param pairId Asset pair identifier
    /// @return priceData Raw Pyth price struct
    function getPriceUnsafe(bytes32 pairId)
        external
        view
        returns (PythStructs.Price memory priceData)
    {
        bytes32 feedId = feedIds[pairId];
        require(feedId != bytes32(0), "PythAdapter: Feed not registered");

        return pyth.getPriceUnsafe(feedId);
    }

    /// @notice Get the current update fee for Pyth
    /// @param updateDataSize Number of price updates
    /// @return fee Required fee in wei
    function getUpdateFee(uint256 updateDataSize) external view returns (uint256) {
        bytes[] memory dummyData = new bytes[](updateDataSize);
        return pyth.getUpdateFee(dummyData);
    }

    /// @notice Check if feed is registered
    /// @param pairId Asset pair to check
    /// @return True if feed registered
    function isFeedRegistered(bytes32 pairId) external view returns (bool) {
        return feedIds[pairId] != bytes32(0);
    }
}
