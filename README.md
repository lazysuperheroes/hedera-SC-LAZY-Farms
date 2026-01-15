# Lazy Superheroes Farming & Staking

A production-grade NFT farming and staking system on Hedera, enabling $LAZY token rewards for NFT holders through missions and staking pools.

## Features

- **NFT Farming Missions** - Stake NFTs in time-limited missions to earn randomized NFT rewards
- **NFT Staking** - Stake approved collections to earn $LAZY tokens with HODL bonuses
- **Boost System** - Reduce mission duration using gem NFTs or $LAZY payments
- **Delegation** - Stake NFTs without transferring ownership via delegation registry
- **Multi-signature Support** - All admin operations support M-of-N multisig workflows

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LAZY FARMS SYSTEM                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │  MissionFactory  │────>│     Mission      │ (Clones)             │
│  │  (Deploy/Manage) │     │  (NFT Farming)   │                      │
│  └────────┬─────────┘     └──────────────────┘                      │
│           │                                                          │
│           │  ┌──────────────────┐                                   │
│           └─>│   BoostManager   │                                   │
│              │ (Duration Reduce)│                                   │
│              └──────────────────┘                                   │
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │  LazyNFTStaking  │     │  LazyGasStation  │                      │
│  │ ($LAZY Rewards)  │     │   (Fee Handler)  │                      │
│  └──────────────────┘     └──────────────────┘                      │
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │LazyDelegateReg.  │     │   TokenStaker    │                      │
│  │ (NFT Delegation) │     │  (HTS Helpers)   │                      │
│  └──────────────────┘     └──────────────────┘                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Mainnet Contracts

| Contract | Address | Description |
|----------|---------|-------------|
| $LAZY Token | `0.0.1311037` | The $LAZY fungible token |
| LAZYTokenCreator | `0.0.1311003` | Token minting contract |
| LazyGasStation | `0.0.7221483` | Fee handling for operations |
| LazyDelegateRegistry | `0.0.7221486` | NFT delegation without transfer |
| LazyNFTStaking | `0.0.7221488` | NFT staking for $LAZY rewards |
| MissionFactory | `0.0.8257122` | Mission deployment and management |
| Mission (Template) | `0.0.8257118` | Clone template for missions |
| BoostManager | `0.0.8257105` | Mission duration boost system |
| PRNG | `0.0.8257116` | Random number generation |

## Quick Start

### Prerequisites

- Node.js 18+
- Yarn
- Hedera testnet/mainnet account

### Installation

```bash
# Clone repository
git clone https://github.com/LazySuperheroesNFT/hedera-SC-LAZY-Farms.git
cd hedera-SC-LAZY-Farms

# Install dependencies
yarn

# Configure environment
cp .env.example .env
# Edit .env with your ACCOUNT_ID and PRIVATE_KEY

# Compile contracts
npx hardhat compile

# Extract ABIs
node scripts/deployments/extractABI.js
```

### Basic Usage

```bash
# Check staking info
node scripts/interactions/getLazyNFTStakingInfo.js 0.0.7221488

# Stake NFTs
node scripts/interactions/stakeNFT.js 0.0.STAKING 0.0.COLLECTION 1,2,3 100,100,100 0

# Check mission info
node scripts/interactions/getMissionInfo.js 0.0.MISSION

# Enter a mission
node scripts/interactions/enterMission.js 0.0.MISSION 0.0.COLLECTION 1,2,3
```

## CLI Reference

### Read-Only Scripts (No State Change)

| Script | Description |
|--------|-------------|
| `getLazyNFTStakingInfo` | Get staking contract configuration |
| `getLazyStakingEconomy` | Get staking economy metrics |
| `getMissionInfo` | Get mission details and status |
| `getMissionFactoryInfo` | Get factory configuration |
| `getBoostManagerInfo` | Get boost configuration |
| `getStakedNFTs` | List NFTs staked by an address |
| `getStakedSerials` | Get staked serials for a collection |
| `getStakeableCollections` | List approved staking collections |
| `checkUserStateViaMission` | Check user's mission participation |
| `checkBoostLevelConfig` | View boost tier configuration |
| `checkLiveFTAllowance` | Check fungible token allowance |
| `checkNFTAllowanceAllSerials` | Check NFT allowances |

### Staking Operations

| Script | Description |
|--------|-------------|
| `stakeNFT` | Stake NFTs to earn $LAZY |
| `unstakeNFT` | Unstake NFTs and claim rewards |
| `claimStakingRewards` | Claim accumulated $LAZY rewards |
| `delegateToken` | Delegate NFT for staking |
| `revokeTokenDelegation` | Revoke NFT delegation |

### Mission Operations

| Script | Description |
|--------|-------------|
| `deployMission` | Deploy a new mission (deployer role) |
| `enterMission` | Enter a mission with NFTs |
| `leaveMission` | Exit a mission (forfeit rewards) |
| `claimFarmingRewards` | Claim mission completion rewards |
| `boostMissionWithGem` | Boost mission with gem NFT |
| `boostMissionWithLazy` | Boost mission with $LAZY |

### Admin Operations

| Script | Description |
|--------|-------------|
| `manageAdminAtMissionFactory` | Add/remove factory admins |
| `manageDeployersAtMissionFactory` | Add/remove deployers |
| `updateMissionFactorySettings` | Update factory parameters |
| `addStakableCollection` | Approve collection for staking |
| `removeStakableCollection` | Remove staking approval |
| `configureGemBoost` | Configure gem boost tiers |
| `configureLazyBoost` | Configure $LAZY boost pricing |
| `setStakingBurnPercentage` | Set reward burn rate |
| `setStakingDistributionPeriod` | Set distribution period |
| `pauseMission` / `unpauseMission` | Pause/resume mission |
| `closeMission` | Close mission permanently |

## Multi-Signature Support

All state-changing operations support multi-signature execution using [@lazysuperheroes/hedera-multisig](https://github.com/lazysuperheroes/hedera-multisig).

### Usage

```bash
# Default 2-of-2 multisig
node scripts/interactions/manageAdminAtMissionFactory.js 0.0.FACTORY 0.0.ADMIN add --multisig

# Custom threshold (2-of-3)
node scripts/interactions/updateMissionFactorySettings.js 0.0.FACTORY ... \
  --multisig --threshold 2 --signers "Alice,Bob,Charlie"
```

### Workflow

1. Transaction is built and frozen
2. Each signer is prompted for their private key
3. Signatures are collected and validated
4. Transaction executes when threshold is met

## Contract Security

### Immutability

The smart contracts are deployed and **immutable** on Hedera. There are no proxy patterns or upgrade mechanisms. What you see is what you get.

### Access Control

- **Admins**: Can modify contract parameters, add/remove collections
- **Deployers**: Can create new missions via factory
- **Users**: Can stake, enter missions, claim rewards

### Audit Status

Security review completed. No critical vulnerabilities requiring redeployment identified.

### Known Limitations

- `retieveLazy()` typo in BoostManager.sol (deployed, cannot fix)
- Unbounded loops in reward distribution (acceptable for per-project model)

## Development

### Run Tests

```bash
# All tests
npx hardhat test

# Specific test suites
npx hardhat test test/MissionFactory.test.js
npx hardhat test test/LazyNFTStaking.test.js
```

### Project Structure

```
├── contracts/           # Solidity smart contracts
│   ├── Mission.sol      # Individual farming mission
│   ├── MissionFactory.sol # Mission deployment factory
│   ├── LazyNFTStaking.sol # NFT staking for $LAZY
│   ├── BoostManager.sol # Mission boost system
│   └── ...
├── scripts/
│   ├── deployments/     # Contract deployment scripts
│   └── interactions/    # CLI interaction scripts
├── utils/
│   ├── clientFactory.js # Hedera client initialization
│   ├── abiLoader.js     # ABI loading with caching
│   ├── scriptHelpers.js # Common script utilities
│   ├── multisigHelpers.js # Multi-signature support
│   └── ...
├── test/                # Hardhat test suites
└── abi/                 # Extracted contract ABIs
```

### Shared Utilities

Scripts use centralized utilities for consistency:

```javascript
const { createHederaClient } = require('./utils/clientFactory');
const { loadInterface } = require('./utils/abiLoader');
const { parseArgs, confirmOrExit, logResult } = require('./utils/scriptHelpers');
```

## Environment Variables

```env
# Required
ENVIRONMENT=test|main|preview|local
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302e...

# Optional - Contract IDs for reuse
LAZY_TOKEN_ID=0.0.xxxxx
MISSION_FACTORY_CONTRACT_ID=0.0.xxxxx
LAZY_STAKING_CONTRACT_ID=0.0.xxxxx
```

## Contributing

This is a production system with deployed, immutable contracts. Contributions welcome for:

- Script improvements
- Documentation
- SDK development
- Tooling

## License

MIT

## Links

- [Lazy Superheroes](https://lazysuperheroes.com)
- [Hedera Multisig Package](https://github.com/lazysuperheroes/hedera-multisig)
- [Hedera Developer Docs](https://docs.hedera.com)
