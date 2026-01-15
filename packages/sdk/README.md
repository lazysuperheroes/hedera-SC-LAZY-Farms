# @lazysuperheroes/farming-sdk

TypeScript SDK for interacting with the Lazy Superheroes NFT farming and staking system on Hedera.

## Installation

```bash
npm install @lazysuperheroes/farming-sdk
# or
yarn add @lazysuperheroes/farming-sdk
```

### Peer Dependencies

This SDK requires the following peer dependencies:

```bash
npm install @hashgraph/sdk ethers
```

## Quick Start

```typescript
import { createMainnetClient, MAINNET_CONTRACTS } from '@lazysuperheroes/farming-sdk';

// Create a client for mainnet
const client = createMainnetClient(
  '0.0.123456',        // Your operator account ID
  'your-private-key',   // ED25519 private key
  'signing-key'         // Optional: ECDSA key for staking signatures
);

// Get staking info
const stakingInfo = await client.getStakingInfo();
console.log(`Total NFTs staked: ${stakingInfo.totalStaked}`);
console.log(`Total $LAZY distributed: ${stakingInfo.totalDistributed}`);

// Get mission info
const mission = await client.getMissionInfo('0.0.789012');
console.log(`Mission: ${mission.name}`);
console.log(`Duration: ${mission.duration} seconds`);
console.log(`Slots available: ${mission.slotsAvailable}`);
```

## Configuration

### Network Environments

```typescript
import { createClient } from '@lazysuperheroes/farming-sdk';

// Mainnet
const mainnetClient = createClient({
  environment: 'mainnet',
  operatorId: '0.0.123456',
  operatorKey: 'your-private-key',
});

// Testnet
const testnetClient = createClient({
  environment: 'testnet',
  operatorId: '0.0.123456',
  operatorKey: 'your-private-key',
});

// Custom contract addresses (for testnet)
testnetClient.setContracts({
  lazyNftStaking: '0.0.TESTNET_STAKING',
  missionFactory: '0.0.TESTNET_FACTORY',
});
```

### Mainnet Contract Addresses

The SDK includes mainnet addresses by default:

```typescript
import { MAINNET_CONTRACTS } from '@lazysuperheroes/farming-sdk';

console.log(MAINNET_CONTRACTS.LAZY_TOKEN);      // 0.0.1311037
console.log(MAINNET_CONTRACTS.NFT_STAKING);     // 0.0.7221488
console.log(MAINNET_CONTRACTS.MISSION_FACTORY); // 0.0.8257122
console.log(MAINNET_CONTRACTS.BOOST_MANAGER);   // 0.0.8257105
```

## Staking Operations

### Get Staking Info

```typescript
const info = await client.getStakingInfo();

console.log({
  totalStaked: info.totalStaked,
  totalDistributed: info.totalDistributed.toString(),
  distributionPeriod: info.distributionPeriod,
  burnPercentage: info.burnPercentage,
  hodlBonusRate: info.hodlBonusRate,
  maxBonusPeriods: info.maxBonusPeriods,
});
```

### Get Stakeable Collections

```typescript
const collections = await client.getStakeableCollections();

for (const collection of collections) {
  console.log(`Collection: ${collection.tokenId}`);
  console.log(`Max reward rate: ${collection.maxRewardRate}`);
}
```

### Stake NFTs

```typescript
import { createStake } from '@lazysuperheroes/farming-sdk';

// Create stake objects (collection must be in EVM address format)
const stakes = [
  createStake(
    '0x0000000000000000000000000000000000123456', // Collection EVM address
    [1, 2, 3],      // Serial numbers
    [100, 100, 100] // Reward rates
  ),
];

// Generate reward proof (requires ECDSA signing key)
const rewardProof = await client.generateRewardProof(0, stakes);

// Execute stake
const result = await client.stake(stakes, rewardProof);

if (result.success) {
  console.log(`Staked successfully! TX: ${result.transactionId}`);
} else {
  console.error(`Stake failed: ${result.error}`);
}
```

### Unstake NFTs

```typescript
const result = await client.unstake(stakes, rewardProof);
```

## Mission Operations

### Get Mission Info

```typescript
const mission = await client.getMissionInfo('0.0.789012');

console.log({
  name: mission.name,
  duration: mission.duration,
  entryFee: mission.entryFee.toString(),
  currentParticipants: mission.currentParticipants,
  slotsAvailable: mission.slotsAvailable,
  isPaused: mission.isPaused,
});
```

### Enter a Mission

```typescript
const result = await client.enterMission(
  '0.0.789012',      // Mission contract
  '0.0.COLLECTION',  // NFT collection
  [1, 2, 3]          // Serial numbers to commit
);

if (result.success) {
  console.log('Entered mission!');
}
```

### Leave a Mission

```typescript
const result = await client.leaveMission('0.0.789012');
```

### Claim Mission Rewards

```typescript
const result = await client.claimMissionRewards('0.0.789012');
```

## Boost Operations

### Boost with Gem NFT

```typescript
const result = await client.boostWithGem(
  '0.0.MISSION',     // Mission to boost
  '0.0.GEM_COLLECTION',  // Gem NFT collection
  42                     // Gem serial number
);
```

### Boost with $LAZY

```typescript
const result = await client.boostWithLazy(
  '0.0.MISSION',
  BigInt(1000)  // $LAZY amount
);
```

## Delegation Operations

### Delegate an NFT

```typescript
const result = await client.delegate(
  '0.0.COLLECTION',  // NFT collection
  42,                // Serial number
  '0.0.DELEGATE'     // Delegate to this account
);
```

### Revoke Delegation

```typescript
const result = await client.revokeDelegation(
  '0.0.COLLECTION',
  42
);
```

## Helper Functions

### Staking Helpers

```typescript
import {
  createStake,
  validateStake,
  countTotalNFTs,
  generateStakingRewardProof,
} from '@lazysuperheroes/farming-sdk';

// Create a stake object
const stake = createStake(evmAddress, serials, rewards);

// Validate stake data
validateStake(stake); // Throws if invalid

// Count total NFTs across multiple stakes
const total = countTotalNFTs([stake1, stake2]);
```

### Farming Helpers

```typescript
import {
  formatDuration,
  calculateTimeRemaining,
  canClaimRewards,
  calculateBoostedDuration,
  lookupLevel,
} from '@lazysuperheroes/farming-sdk';

// Format duration for display
formatDuration(3600);  // "1h"
formatDuration(90000); // "1d 1h"

// Calculate remaining time
const remaining = calculateTimeRemaining(entryTime, duration);

// Check if rewards can be claimed
const canClaim = canClaimRewards(entryTime, duration, boostPercent);

// Calculate boosted duration
const boosted = calculateBoostedDuration(86400, 25); // 75% of original

// Gem level helpers
lookupLevel(3); // "UR"
getLevel("SR"); // 2
```

### Constants

```typescript
import { GAS, DELAYS, TIME, DECIMALS } from '@lazysuperheroes/farming-sdk';

// Gas limits
GAS.MISSION_ENTER;  // 2_000_000
GAS.STAKE_BASE;     // 400_000

// Calculate stake gas
calculateStakeGas(5); // 2_400_000

// Time constants
TIME.DAY;   // 86400
TIME.WEEK;  // 604800

// Token decimals
DECIMALS.LAZY; // 1
DECIMALS.HBAR; // 8
```

## TypeScript Types

All types are exported for TypeScript users:

```typescript
import type {
  SDKConfig,
  StakingInfo,
  MissionInfo,
  Stake,
  RewardProof,
  TransactionResult,
} from '@lazysuperheroes/farming-sdk';
```

## Error Handling

```typescript
const result = await client.stake(stakes, proof);

if (!result.success) {
  console.error(`Transaction failed: ${result.error}`);
  return;
}

console.log(`Success! TX ID: ${result.transactionId}`);
console.log(`Gas used: ${result.gasUsed}`);
```

## License

MIT

## Links

- [Main Repository](https://github.com/lazysuperheroes/hedera-SC-LAZY-Farms)
- [Lazy Superheroes](https://lazysuperheroes.com)
- [Hedera Developer Docs](https://docs.hedera.com)
