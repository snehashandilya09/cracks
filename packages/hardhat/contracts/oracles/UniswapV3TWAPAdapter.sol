// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

/// @title UniswapV3TWAPAdapter
/// @notice Fetches time-weighted average price from Uniswap V3 pools
/// @dev Provides on-chain price oracle resistant to flash loan manipulation
/// @dev Pool addresses from https://www.geckoterminal.com/sepolia-testnet
contract UniswapV3TWAPAdapter {

    struct PoolConfig {
        address pool;
        address baseToken;  // Token being priced (e.g., WETH)
        address quoteToken; // Token price is quoted in (e.g., USDC)
        uint8 baseDecimals;
        uint8 quoteDecimals;
        uint32 twapPeriod;  // Time window for TWAP (seconds)
        bool isToken0Base;  // True if baseToken is token0 in the pool
    }

    mapping(bytes32 => PoolConfig) public pools;

    // Uniswap V3 pool addresses (Sepolia testnet)
    // Source: https://www.geckoterminal.com/sepolia-testnet/pools/0x9799b5edc1aa7d3fad350309b08df3f64914e244
    address public constant USDC_WETH_POOL_03 = 0x9799b5EDC1aA7D3FAd350309B08df3F64914E244; // 0.3% fee

    // Token addresses on Sepolia (need to verify these)
    address public constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14; // WETH on Sepolia
    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // USDC on Sepolia

    event PoolRegistered(bytes32 indexed pairId, address poolAddress, uint32 twapPeriod);
    event TWAPCalculated(bytes32 indexed pairId, uint256 price, uint256 timestamp);

    constructor() {
        // Register WETH/USDC pool
        // Note: This gives price of WETH in USDC, we map it to ETH/USD
        pools[keccak256("ETH/USD")] = PoolConfig({
            pool: USDC_WETH_POOL_03,
            baseToken: WETH,
            quoteToken: USDC,
            baseDecimals: 18,  // WETH has 18 decimals
            quoteDecimals: 6,  // USDC has 6 decimals
            twapPeriod: 1800,  // 30 minute TWAP (balance between freshness and security)
            isToken0Base: false // WETH is typically token1, USDC is token0 (lower address)
        });

        emit PoolRegistered(keccak256("ETH/USD"), USDC_WETH_POOL_03, 1800);
    }

    /// @notice Get time-weighted average price from Uniswap V3
    /// @param pairId Asset pair identifier (e.g., keccak256("ETH/USD"))
    /// @return price TWAP price (normalized to 18 decimals)
    /// @return timestamp Current block timestamp (TWAP is current)
    function getLatestPrice(bytes32 pairId)
        external
        view
        returns (
            uint256 price,
            uint256 timestamp
        )
    {
        PoolConfig memory config = pools[pairId];
        require(config.pool != address(0), "UniswapAdapter: Pool not configured");

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);

        // Get TWAP tick (arithmetic mean over the period)
        int24 arithmeticMeanTick = _getTWAPTick(pool, config.twapPeriod);

        // Convert tick to price
        uint256 quoteAmount = _getQuoteAtTick(
            arithmeticMeanTick,
            uint128(10 ** config.baseDecimals), // 1 unit of base token (e.g., 1 WETH)
            config.isToken0Base
        );

        // Normalize to 18 decimals
        uint256 normalizedPrice;
        if (config.quoteDecimals < 18) {
            // Scale up (e.g., USDC has 6 decimals, multiply by 10^12)
            normalizedPrice = quoteAmount * (10 ** (18 - config.quoteDecimals));
        } else {
            // Scale down (rare case)
            normalizedPrice = quoteAmount / (10 ** (config.quoteDecimals - 18));
        }

        return (normalizedPrice, block.timestamp);
    }

    /// @notice Calculate TWAP tick from Uniswap V3 pool observations
    /// @dev Queries pool's oracle observations and calculates arithmetic mean tick
    /// @param pool Uniswap V3 pool contract
    /// @param period TWAP period in seconds
    /// @return arithmeticMeanTick The time-weighted average tick
    function _getTWAPTick(IUniswapV3Pool pool, uint32 period)
        internal
        view
        returns (int24 arithmeticMeanTick)
    {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = period; // Start of TWAP window
        secondsAgos[1] = 0;      // Current time

        // Get cumulative tick data from pool
        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);

        // Calculate arithmetic mean tick over the period
        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(period)));

        // Round down for negative ticks
        if (tickCumulativesDelta < 0 && (tickCumulativesDelta % int56(uint56(period)) != 0)) {
            arithmeticMeanTick--;
        }
    }

    /// @notice Convert Uniswap V3 tick to quote amount
    /// @dev Simplified version of OracleLibrary.getQuoteAtTick for Solidity 0.8
    /// @param tick The tick to convert
    /// @param baseAmount Amount of base token (with decimals)
    /// @param isToken0Base True if base token is token0
    /// @return quoteAmount The corresponding amount of quote token
    function _getQuoteAtTick(
        int24 tick,
        uint128 baseAmount,
        bool isToken0Base
    ) internal pure returns (uint256 quoteAmount) {
        // Get sqrtPrice from tick
        uint160 sqrtPriceX96 = _getSqrtRatioAtTick(tick);

        // Calculate price from sqrtPriceX96
        // sqrtPriceX96 = sqrt(token1/token0) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2

        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 priceX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            quoteAmount = isToken0Base
                ? _mulDiv(priceX192, baseAmount, 1 << 192)
                : _mulDiv(1 << 192, baseAmount, priceX192);
        } else {
            uint256 priceX128 = _mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            quoteAmount = isToken0Base
                ? _mulDiv(priceX128, baseAmount, 1 << 128)
                : _mulDiv(1 << 128, baseAmount, priceX128);
        }
    }

    /// @notice Get sqrtPriceX96 from tick
    /// @dev Simplified implementation for common tick ranges
    /// @param tick The tick to convert
    /// @return sqrtPriceX96 The sqrt price encoded as a Q64.96
    function _getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(absTick <= uint256(int256(type(int24).max)), "T");

        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;

        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }

    /// @notice Full precision multiplication
    /// @dev Calculates floor(a×b÷denominator) with full precision
    /// @param a The multiplicand
    /// @param b The multiplier
    /// @param denominator The divisor
    /// @return result The 256-bit result
    function _mulDiv(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        if (prod1 == 0) {
            require(denominator > 0);
            assembly {
                result := div(prod0, denominator)
            }
            return result;
        }

        require(denominator > prod1);

        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, denominator)
        }
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }

        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
        }

        assembly {
            prod0 := div(prod0, twos)
        }
        assembly {
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;

        uint256 inv = (3 * denominator) ^ 2;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;

        result = prod0 * inv;
        return result;
    }

    /// @notice Check if pool has sufficient history for TWAP
    /// @dev Verifies pool has observations covering the TWAP period
    /// @param pairId Asset pair to check
    /// @return True if pool is healthy and has sufficient data
    function isPoolHealthy(bytes32 pairId) external view returns (bool) {
        PoolConfig memory config = pools[pairId];
        if (config.pool == address(0)) return false;

        IUniswapV3Pool pool = IUniswapV3Pool(config.pool);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = config.twapPeriod;
        secondsAgos[1] = 0;

        // Check if pool has observations for TWAP period
        try pool.observe(secondsAgos) returns (
            int56[] memory,
            uint160[] memory
        ) {
            return true;
        } catch {
            return false;
        }
    }

    /// @notice Get pool configuration
    /// @param pairId Asset pair to query
    /// @return config Pool configuration struct
    function getPoolConfig(bytes32 pairId) external view returns (PoolConfig memory) {
        return pools[pairId];
    }

    /// @notice Check if pool is registered
    /// @param pairId Asset pair to check
    /// @return True if pool registered
    function isPoolRegistered(bytes32 pairId) external view returns (bool) {
        return pools[pairId].pool != address(0);
    }
}
