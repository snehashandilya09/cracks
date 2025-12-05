# 🚀 TriHacker Tournament - Deployment Guide

## Overview
This guide covers deploying the project from **local development** to **online production**.

**Target:** Deploy to **Public Testnet** (required) with optional **Mainnet** deployment (bonus).

---

## 📋 Pre-Deployment Checklist

### Required Accounts & API Keys

| Service | Purpose | Get It From | Required |
|---------|---------|-------------|----------|
| Alchemy API Key | Blockchain RPC provider | https://dashboard.alchemy.com | ✅ Yes |
| WalletConnect Project ID | Wallet connection | https://cloud.walletconnect.com | ✅ Yes |
| Etherscan API Key | Contract verification | https://etherscan.io/apis | ✅ Yes |
| Deployer Wallet | Deploy contracts | MetaMask or `yarn generate` | ✅ Yes |
| Testnet ETH | Gas for deployment | Faucets (see below) | ✅ Yes |
| Vercel Account | Frontend hosting | https://vercel.com | ✅ Yes |

### Testnet Faucets (Get Free Test ETH)
- **Sepolia:** https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia
- **Arbitrum Sepolia:** https://www.alchemy.com/faucets/arbitrum-sepolia
- **Optimism Sepolia:** https://www.alchemy.com/faucets/optimism-sepolia

---

## 🔧 Step 1: Setup Environment Variables

### 1.1 Create Hardhat Environment File

Create file: `packages/hardhat/.env`

```env
# Alchemy API Key - Get from https://dashboard.alchemy.com
ALCHEMY_API_KEY=your_alchemy_api_key_here

# Etherscan API Key - Get from https://etherscan.io/apis
ETHERSCAN_V2_API_KEY=your_etherscan_api_key_here

# Deployer Private Key (DO NOT SHARE!)
# Option 1: Generate new account with `yarn generate`
# Option 2: Import existing with `yarn account:import`
DEPLOYER_PRIVATE_KEY_ENCRYPTED=
```

### 1.2 Create NextJS Environment File

Create file: `packages/nextjs/.env.local`

```env
# Alchemy API Key - Same as hardhat
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key_here

# WalletConnect Project ID - Get from https://cloud.walletconnect.com
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_walletconnect_project_id_here
```

---

## 🔑 Step 2: Generate or Import Deployer Account

### Option A: Generate New Account (Recommended for Testnet)
```bash
yarn generate
```
This creates a new wallet and saves encrypted private key to `.env`

### Option B: Import Existing Account
```bash
yarn account:import
```
Follow prompts to import your existing private key.

### View Account Address
```bash
yarn account
```

### Fund the Account
Send testnet ETH to the displayed address from a faucet.

---

## ⚙️ Step 3: Update Network Configuration

### 3.1 Update scaffold.config.ts

Change target network from `hardhat` to your chosen testnet.

File: `packages/nextjs/scaffold.config.ts`

```typescript
// Change this line:
targetNetworks: [chains.hardhat],

// To (for Sepolia):
targetNetworks: [chains.sepolia],

// Or for Arbitrum Sepolia:
targetNetworks: [chains.arbitrumSepolia],
```

### 3.2 Network Options

| Network | Chain ID | Type | Gas Cost |
|---------|----------|------|----------|
| `chains.sepolia` | 11155111 | Testnet | Free (faucet) |
| `chains.arbitrumSepolia` | 421614 | L2 Testnet | Free (faucet) |
| `chains.optimismSepolia` | 11155420 | L2 Testnet | Free (faucet) |
| `chains.mainnet` | 1 | Mainnet | Real ETH |
| `chains.arbitrum` | 42161 | L2 Mainnet | Real ETH |

---

## 📦 Step 4: Deploy Smart Contracts to Testnet

### 4.1 Deploy to Sepolia
```bash
yarn deploy --network sepolia
```

### 4.2 Deploy to Other Networks
```bash
# Arbitrum Sepolia
yarn deploy --network arbitrumSepolia

# Optimism Sepolia  
yarn deploy --network optimismSepolia

# Mainnet (requires real ETH - CAREFUL!)
yarn deploy --network mainnet
```

### 4.3 Verify Contracts on Etherscan
```bash
yarn hardhat-verify --network sepolia
```

---

## ✅ Step 5: Test Deployment Locally

Before deploying frontend, test that everything works:

```bash
yarn start
```

Visit http://localhost:3000 and verify:
- [ ] Wallet connects properly
- [ ] Contracts load on the correct network
- [ ] Transactions work on testnet

---

## 🌐 Step 6: Deploy Frontend to Vercel

### 6.1 Login to Vercel
```bash
yarn vercel:login
```

### 6.2 Deploy to Vercel
```bash
yarn vercel
```

### 6.3 Set Environment Variables in Vercel Dashboard

Go to your Vercel project → Settings → Environment Variables

Add these variables:
- `NEXT_PUBLIC_ALCHEMY_API_KEY` = your_alchemy_key
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` = your_walletconnect_id

### 6.4 Redeploy with Environment Variables
```bash
yarn vercel --prod
```

---

## 🎯 Step 7: Mainnet Deployment (Bonus)

**⚠️ WARNING: Mainnet uses real money!**

### 7.1 Preparation
1. Ensure contracts are thoroughly tested
2. Have real ETH in deployer wallet
3. Double-check all contract parameters

### 7.2 Update for Mainnet
File: `packages/nextjs/scaffold.config.ts`
```typescript
targetNetworks: [chains.mainnet],
// Or for L2 (cheaper):
targetNetworks: [chains.arbitrum],
```

### 7.3 Deploy to Mainnet
```bash
# Ethereum Mainnet
yarn deploy --network mainnet

# Arbitrum (L2 - Much Cheaper!)
yarn deploy --network arbitrum

# Optimism (L2 - Much Cheaper!)
yarn deploy --network optimism
```

### 7.4 Verify on Mainnet
```bash
yarn hardhat-verify --network mainnet
```

---

## 📊 Deployment Summary Checklist

### Testnet Deployment (Required)
- [ ] Created Alchemy account and API key
- [ ] Created WalletConnect project ID
- [ ] Created Etherscan API key
- [ ] Generated/imported deployer wallet
- [ ] Funded wallet with testnet ETH
- [ ] Created `.env` files with API keys
- [ ] Updated `scaffold.config.ts` to target testnet
- [ ] Deployed contracts to testnet
- [ ] Verified contracts on Etherscan
- [ ] Tested locally with testnet
- [ ] Deployed frontend to Vercel
- [ ] Set Vercel environment variables
- [ ] Final testing on live URL

### Mainnet Deployment (Bonus)
- [ ] All testnet steps completed and tested
- [ ] Real ETH in deployer wallet
- [ ] Updated `scaffold.config.ts` to mainnet
- [ ] Deployed contracts to mainnet
- [ ] Verified contracts on Etherscan
- [ ] Updated Vercel deployment
- [ ] Final testing on mainnet

---

## 🔗 Important Links

- **Alchemy Dashboard:** https://dashboard.alchemy.com
- **WalletConnect Cloud:** https://cloud.walletconnect.com
- **Etherscan API:** https://etherscan.io/apis
- **Sepolia Faucet:** https://sepoliafaucet.com
- **Vercel:** https://vercel.com
- **Scaffold-ETH 2 Docs:** https://docs.scaffoldeth.io

---

## 🆘 Troubleshooting

### "Insufficient funds" error
- Ensure deployer wallet has enough testnet/mainnet ETH
- Check `yarn account` to see balance

### Contract verification fails
- Ensure `ETHERSCAN_V2_API_KEY` is set correctly
- Wait a few minutes after deployment before verifying

### Frontend can't connect to contracts
- Ensure `scaffold.config.ts` targets the same network as deployed contracts
- Check that `deployedContracts.ts` has the correct network chain ID

### Wallet won't connect
- Check `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` is set
- Ensure wallet is on the correct network

---

## 📝 Current Deployment Status

| Component | Status | Network | URL/Address |
|-----------|--------|---------|-------------|
| Smart Contracts | ⏳ Pending | - | - |
| Frontend | ⏳ Pending | - | - |
| Contract Verification | ⏳ Pending | - | - |

---

*Last Updated: December 5, 2025*
