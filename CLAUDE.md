# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hedera-based smart contract system for "Lazy Superheroes" ($LAZY) NFT farming and staking. It enables NFT holders to stake their assets in "missions" and earn $LAZY token rewards.

## Build Commands

```bash
# Install dependencies
yarn

# Compile contracts
npx hardhat compile

# Extract ABIs to abi/ folder
node scripts/deployments/extractABI.js

# Run all tests
npx hardhat test

# Run specific test suites
npx hardhat test test/MissionFactory.test.js    # Farming missions
npx hardhat test test/LAZYTokenCreator.test.js  # Token creation
npx hardhat test test/LazyNFTStaking.test.js    # NFT staking
npx hardhat test test/LazyDelegateRegistry.test.js  # Delegation
```

## Environment Setup

Copy `.env.example` to `.env` and configure:
- `ENVIRONMENT`: test, main, preview, or local
- `ACCOUNT_ID`: Your Hedera account ID
- `PRIVATE_KEY`: ED25519 private key

Contract IDs can be saved in .env for reuse across deployment sessions.

## Architecture

### Core Contracts

**MissionFactory** (`contracts/MissionFactory.sol`)
- Factory pattern for deploying Mission contracts using OpenZeppelin Clones (minimal proxy)
- Manages admins, deployers, and deployed missions
- Emits aggregated events for mission lifecycle (created, joined, completed, boost activated)

**Mission** (`contracts/Mission.sol`)
- Individual farming mission instance (deployed via clone)
- Users stake NFTs to enter a mission for a set duration
- On completion, users claim randomized NFT rewards from the mission's reward pool
- Supports entry fees (with burn percentage), time-limited entry, and decreasing entry fees

**LazyNFTStaking** (`contracts/LazyNFTStaking.sol`)
- Stake NFTs from approved collections to earn $LAZY tokens
- Features: distribution periods, HODL bonus multipliers, burn percentage on claims, boost rates
- Uses signature verification for secure operations

**BoostManager** (`contracts/BoostManager.sol`)
- Reduces mission duration via boosts
- Two boost types: NFT gems (tiered by level) or $LAZY token payment
- Tracks active boosts per user/mission

**LazyGasStation** (`contracts/LazyGasStation.sol`)
- Handles gas/fee payments for contract operations

**LazyDelegateRegistry** (`contracts/LazyDelegateRegistry.sol`)
- Allows NFT delegation for staking without transferring ownership

**TokenStaker** (`contracts/TokenStaker.sol`)
- Base contract providing HTS (Hedera Token Service) staking primitives
- Handles token associations, transfers, and NFT ownership verification

### Hedera Integration

All contracts inherit from `HederaTokenService` for native HTS integration:
- Token associations via `associateToken()`
- Transfers via `transferToken()` and `transferNFTs()`
- Response codes from `HederaResponseCodes.sol`
- PRNG via `PrngSystemContract.sol` for random reward selection

### Scripts Structure

- `scripts/deployments/` - Contract deployment scripts
- `scripts/interactions/` - Contract interaction scripts (enter/leave mission, stake/unstake, claim rewards, etc.)
- `scripts/debug/` - Debugging utilities (decode errors, fetch logs)
- `scripts/testing/` - Test helpers (create accounts, mint test NFTs)

### Utility Helpers

- `utils/solidityHelpers.js` - Contract deployment and execution via Hedera SDK
- `utils/hederaHelpers.js` - Account/token creation, allowances, transfers
- `utils/hederaMirrorHelpers.js` - Mirror node queries for events and balances
- `utils/LazyFarmingHelper.js` / `LazyNFTStakingHelper.js` - Domain-specific helpers

## Solidity Version

Contracts use Solidity `0.8.18` with optimizer enabled (200 runs).

## Key Patterns

- **Minimal Proxy (Clone)**: Missions are deployed as clones of a template for gas efficiency
- **Role-based Access**: Admins, Deployers, Mission roles managed via EnumerableSet
- **Event Aggregation**: MissionFactory broadcasts events from child missions for easier indexing
- **HTS Native**: Direct integration with Hedera Token Service, not ERC-20/721 wrappers
