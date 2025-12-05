// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkOracleAdapter
/// @notice Fetches price data from Chainlink decentralized oracle network
/// @dev Official Sepolia testnet addresses from https://docs.chain.link/data-feeds/price-feeds/addresses
contract ChainlinkOracleAdapter {

    struct PriceFeed {
        AggregatorV3Interface feed;
        uint8 decimals;
        string description;
        uint256 heartbeat; // Max acceptable staleness (seconds)
    }

    // Feed registry: asset pair => Chainlink aggregator
    mapping(bytes32 => PriceFeed) public priceFeeds;

    // Chainlink aggregator addresses (Sepolia testnet)
    // Source: https://docs.chain.link/data-feeds/price-feeds/addresses
    address public constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address public constant BTC_USD_FEED = 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43;
    address public constant LINK_USD_FEED = 0xc59E3633BAAC79493d908e63626716e204A45EdF;

    event PriceFeedRegistered(bytes32 indexed pairId, address feedAddress, string description);
    event PriceFetched(bytes32 indexed pairId, uint256 price, uint256 timestamp, uint80 roundId);

    constructor() {
        // Register ETH/USD feed
        _registerFeed(
            keccak256("ETH/USD"),
            ETH_USD_FEED,
            8,
            "ETH/USD Chainlink",
            3600 // 1 hour max staleness
        );

        // Register BTC/USD feed
        _registerFeed(
            keccak256("BTC/USD"),
            BTC_USD_FEED,
            8,
            "BTC/USD Chainlink",
            3600
        );

        // Register LINK/USD feed
        _registerFeed(
            keccak256("LINK/USD"),
            LINK_USD_FEED,
            8,
            "LINK/USD Chainlink",
            3600
        );
    }

    /// @notice Register a new price feed
    /// @param pairId Identifier for the trading pair
    /// @param feedAddress Chainlink aggregator address
    /// @param decimals Number of decimals in the feed
    /// @param description Human-readable description
    /// @param heartbeat Maximum acceptable staleness in seconds
    function _registerFeed(
        bytes32 pairId,
        address feedAddress,
        uint8 decimals,
        string memory description,
        uint256 heartbeat
    ) internal {
        priceFeeds[pairId] = PriceFeed({
            feed: AggregatorV3Interface(feedAddress),
            decimals: decimals,
            description: description,
            heartbeat: heartbeat
        });

        emit PriceFeedRegistered(pairId, feedAddress, description);
    }

    /// @notice Fetch latest price from Chainlink
    /// @param pairId Asset pair identifier (e.g., keccak256("ETH/USD"))
    /// @return price Latest price (normalized to 18 decimals)
    /// @return timestamp When price was last updated
    /// @return roundId Chainlink round ID for verification
    function getLatestPrice(bytes32 pairId)
        external
        view
        returns (
            uint256 price,
            uint256 timestamp,
            uint80 roundId
        )
    {
        PriceFeed memory feed = priceFeeds[pairId];
        require(address(feed.feed) != address(0), "ChainlinkAdapter: Feed not registered");

        (
            uint80 _roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.feed.latestRoundData();

        // Validation checks
        require(answer > 0, "ChainlinkAdapter: Invalid price (non-positive)");
        require(updatedAt > 0, "ChainlinkAdapter: Invalid timestamp");
        require(answeredInRound >= _roundId, "ChainlinkAdapter: Stale price (round mismatch)");

        // Staleness check
        require(
            block.timestamp - updatedAt <= feed.heartbeat,
            "ChainlinkAdapter: Price too stale"
        );

        // Normalize to 18 decimals (Chainlink uses 8)
        uint256 normalizedPrice = uint256(answer) * 1e10;

        return (normalizedPrice, updatedAt, _roundId);
    }

    /// @notice Get price from specific historical round
    /// @dev Used for dispute resolution (verify historical claim)
    /// @param pairId Asset pair identifier
    /// @param roundId Historical round ID to query
    /// @return price Historical price (normalized to 18 decimals)
    /// @return timestamp When that round was finalized
    function getHistoricalPrice(bytes32 pairId, uint80 roundId)
        external
        view
        returns (
            uint256 price,
            uint256 timestamp
        )
    {
        PriceFeed memory feed = priceFeeds[pairId];
        require(address(feed.feed) != address(0), "ChainlinkAdapter: Feed not registered");

        (
            ,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.feed.getRoundData(roundId);

        require(answer > 0, "ChainlinkAdapter: Invalid historical price");
        require(answeredInRound == roundId, "ChainlinkAdapter: Round not finalized");

        uint256 normalizedPrice = uint256(answer) * 1e10;
        return (normalizedPrice, updatedAt);
    }

    /// @notice Check if a feed is registered
    /// @param pairId Asset pair to check
    /// @return True if feed exists
    function isFeedRegistered(bytes32 pairId) external view returns (bool) {
        return address(priceFeeds[pairId].feed) != address(0);
    }

    /// @notice Get feed information
    /// @param pairId Asset pair to query
    /// @return feedAddress Chainlink aggregator address
    /// @return decimals Feed decimals
    /// @return description Feed description
    /// @return heartbeat Max staleness in seconds
    function getFeedInfo(bytes32 pairId)
        external
        view
        returns (
            address feedAddress,
            uint8 decimals,
            string memory description,
            uint256 heartbeat
        )
    {
        PriceFeed memory feed = priceFeeds[pairId];
        return (
            address(feed.feed),
            feed.decimals,
            feed.description,
            feed.heartbeat
        );
    }
}
