# UX Implementation Guide

Complete guide for building user interfaces and admin consoles for the Lazy Superheroes farming system.

## Table of Contents

1. [Overview](#overview)
2. [Contract Addresses](#contract-addresses)
3. [User Operations](#user-operations)
   - [Querying Data](#querying-data-read-operations)
   - [Mission Farming](#mission-farming)
   - [NFT Staking](#nft-staking)
   - [Boosting Missions](#boosting-missions)
   - [NFT Delegation](#nft-delegation)
4. [Allowance Patterns](#allowance-patterns)
5. [Admin Console Guide](#admin-console-guide)
6. [Error Reference](#error-reference)
7. [Event Reference](#event-reference)
8. [ABI Decoding Guide](#abi-decoding-guide)

---

## Overview

The Lazy Superheroes system consists of two primary earning mechanisms:

1. **Mission Farming** - Stake NFTs in time-limited missions to earn randomized NFT rewards
2. **NFT Staking** - Stake NFTs from approved collections to earn $LAZY tokens over time

### Architecture Summary

```
                                  +------------------+
                                  |  LazyGasStation  |
                                  | (Fee Management) |
                                  +--------+---------+
                                           |
        +----------------------------------+----------------------------------+
        |                                  |                                  |
+-------v--------+              +----------v---------+             +----------v---------+
| MissionFactory |              |   LazyNFTStaking   |             |    BoostManager    |
| (Deploy/Track) |              | ($LAZY Rewards)    |             | (Time Reduction)   |
+-------+--------+              +--------------------+             +----------+---------+
        |                                                                     |
        | creates (clone)                                                     |
        v                                                                     |
+-------+--------+                                                            |
|    Mission     |<-----------------------------------------------------------+
| (NFT Farming)  |                  boost integration
+----------------+

+--------------------+
|LazyDelegateRegistry|  (Optional: stake without transferring ownership)
+--------------------+
```

---

## Contract Addresses

### Mainnet Deployment

| Contract | Contract ID | EVM Address |
|----------|-------------|-------------|
| $LAZY Token | 0.0.1093180 | `0x000000000000000000000000000000000010adcc` |
| MissionFactory | 0.0.4751098 | `0x000000000000000000000000000000000048797a` |
| LazyNFTStaking | 0.0.3586706 | `0x00000000000000000000000000000000003aba92` |
| BoostManager | 0.0.4703588 | `0x00000000000000000000000000000000047c0d64` |
| LazyGasStation | 0.0.3586705 | `0x00000000000000000000000000000000003aba91` |
| LazyDelegateRegistry | 0.0.3586704 | `0x00000000000000000000000000000000003aba90` |
| Mission Template | 0.0.4751097 | `0x0000000000000000000000000000000000487979` |
| PRNG Generator | 0.0.4703589 | `0x00000000000000000000000000000000047c0d65` |

See `deployments/mainnet.json` for complete deployment manifest.

---

## User Operations

### Querying Data (Read Operations)

All read operations use Hedera Mirror Node for gas-free queries. Encode function calls using ethers.js and query via the mirror node REST API.

#### Query Pattern

```javascript
import { ethers } from 'ethers';

// Load ABI
const missionAbi = require('./abi/Mission.json');
const iface = new ethers.Interface(missionAbi);

// Encode function call
const callData = iface.encodeFunctionData('getMissionInfo', []);

// Query via mirror node
const response = await fetch(
  `https://mainnet.mirrornode.hedera.com/api/v1/contracts/call`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: callData,
      to: missionEvmAddress,
      estimate: false
    })
  }
);

// Decode response
const result = await response.json();
const decoded = iface.decodeFunctionResult('getMissionInfo', result.result);
```

#### Key Query Functions

**Mission Queries**
| Function | Contract | Returns |
|----------|----------|---------|
| `getMissionInfo()` | Mission | Full mission state snapshot |
| `isPaused()` | Mission | Whether mission accepts entries |
| `getSlotsRemaining()` | Mission | Available participation slots |
| `entryFee()` | Mission | Entry fee in $LAZY (with decimals) |
| `getDecrementDetails()` | Mission | Dutch auction fee parameters |
| `getUsersOnMission()` | Mission | List of active participants |
| `getRewards()` | Mission | Available reward NFT collections |
| `getRequirements()` | Mission | Required NFT collections |
| `missionState()` | Mission | Duration, deadlines, counts |
| `getUserEndAndBoost(address)` | Mission | User's end time and boost status |

**Staking Queries**
| Function | Contract | Returns |
|----------|----------|---------|
| `getStakedNFTs(address)` | LazyNFTStaking | User's staked NFTs by collection |
| `calculateRewards(address)` | LazyNFTStaking | Pending $LAZY rewards |
| `getBaseRewardRate(address)` | LazyNFTStaking | User's base earning rate |
| `getActiveBoostRate(address)` | LazyNFTStaking | User's active boost rate |
| `getStakeableCollections()` | LazyNFTStaking | Approved NFT collections |
| `distributionPeriod()` | LazyNFTStaking | Reward period in seconds |
| `burnPercentage()` | LazyNFTStaking | % burned on reward claims |
| `hodlBonusRate()` | LazyNFTStaking | HODL bonus multiplier |

**Factory Queries**
| Function | Contract | Returns |
|----------|----------|---------|
| `getLiveMissions()` | MissionFactory | All active mission addresses |
| `isAdmin(address)` | MissionFactory | Admin role check |
| `isDeployer(address)` | MissionFactory | Deployer role check |
| `getUsersMissionParticipation(address)` | MissionFactory | User's active missions |

**Boost Queries**
| Function | Contract | Returns |
|----------|----------|---------|
| `getBoostLevel(token, serial)` | BoostManager | Gem NFT's boost level (0-5) |
| `getBoostData(level)` | BoostManager | Reduction % for level |
| `lazyBoostCost()` | BoostManager | $LAZY cost for token boost |
| `lazyBoostReduction()` | BoostManager | Reduction % for $LAZY boost |

---

### Mission Farming

#### Enter Mission Flow

```
User wants to enter mission
         |
         v
+--------+--------+
| 1. Query Mission |  getMissionInfo(), entryFee(), isPaused()
+---------+-------+
          |
          v
+--------+--------+
| 2. Check Status  |  - Not paused
+---------+-------+   - Slots available
          |           - Within entry window
          v           - User not already in mission
+--------+--------+
| 3. Check $LAZY   |  User has entry fee amount
|    Balance       |
+---------+-------+
          |
          v
+--------+--------+
| 4. Set $LAZY     |  Allowance to LazyGasStation >= entryFee
|    Allowance     |  (NOT to Mission contract!)
+---------+-------+
          |
          v
+--------+--------+
| 5. Set NFT       |  Approve Mission contract for all serials
|    Allowances    |  of requirement collections
+---------+-------+
          |
          v
+--------+--------+
| 6. Call          |  mission.enterMission(collections[], serials[][])
|    enterMission  |
+---------+-------+
          |
          v
      SUCCESS
   Mission joined!
```

**Contract Call:**
```javascript
// Parameters
const requirementTokens = ['0.0.111111', '0.0.222222'];  // NFT collections
const serials = [[1, 5, 10], [3, 7]];  // Serials per collection

// Encode call
const callData = iface.encodeFunctionData('enterMission', [
  requirementTokens.map(t => tokenToEvmAddress(t)),
  serials
]);

// Execute via ContractExecuteTransaction
const tx = new ContractExecuteTransaction()
  .setContractId(missionContractId)
  .setGas(1_500_000)
  .setFunctionParameters(callData);
```

#### Leave Mission (Early Exit)

Users can exit a mission early but forfeit rewards. Their staked requirement NFTs are returned.

**Pre-requisites:**
- 10 tinybar HBAR allowance to Mission contract
- If boosted with gem: 1 tinybar HBAR allowance to BoostManager

```javascript
// Check if user is in mission
const [endTime, hasBoosted] = await query('getUserEndAndBoost', [userAddress]);

if (endTime === 0n) {
  throw new Error('User not in this mission');
}

// Leave mission
const callData = iface.encodeFunctionData('leaveMission', []);
```

#### Claim Farming Rewards

After mission duration completes, users claim randomized NFT rewards.

**Pre-requisites:**
- Mission end time has passed
- 10 tinybar HBAR allowance to Mission contract
- If boosted with gem: 1 tinybar HBAR allowance to BoostManager (gem returned)

```javascript
// Verify mission complete
const [endTime, hasBoosted] = await query('getUserEndAndBoost', [userAddress]);

if (Date.now() / 1000 < Number(endTime)) {
  throw new Error('Mission not yet complete');
}

// Claim rewards
const callData = iface.encodeFunctionData('claimRewards', []);
```

---

### NFT Staking

NFT staking uses a signature-based system where reward rates are signed by a trusted backend wallet.

#### Stake NFTs Flow

```
User wants to stake NFTs
         |
         v
+--------+--------+
| 1. Check         |  getStakeableCollections()
|    Eligibility   |  Verify NFTs are from approved collections
+---------+-------+
          |
          v
+--------+--------+
| 2. Build Stake   |  Array of { collection, serials[], rewards[] }
|    Objects       |  rewards = earning rate per NFT per period
+---------+-------+
          |
          v
+--------+--------+
| 3. Generate      |  Backend signs: { user, stakes, boostRate, timestamp }
|    Reward Proof  |  Signature valid for 120 seconds
+---------+-------+
          |
          v
+--------+--------+
| 4. Set NFT       |  Approve LazyNFTStaking for all serials
|    Allowances    |
+---------+-------+
          |
          v
+--------+--------+
| 5. Call stake()  |  staking.stake(stakes[], rewardProof)
+---------+-------+
          |
          v
      SUCCESS
   NFTs staked!
```

**Stake Object Structure:**
```javascript
const stakes = [
  {
    collection: '0x...', // EVM address of NFT collection
    serials: [1n, 5n, 10n],
    rewards: [100000000n, 100000000n, 100000000n] // Rate per NFT
  }
];

const rewardProof = {
  user: userEvmAddress,
  boostRate: 50n, // Overall boost multiplier
  validityTimestamp: Math.floor(Date.now() / 1000),
  signature: '0x...' // Backend signature
};
```

#### Unstake NFTs

Similar to staking but also triggers reward calculation.

**Pre-requisites:**
- 10 tinybar HBAR allowance to LazyNFTStaking
- Fresh reward proof signature (within 120 seconds)

```javascript
// Same structure as staking
const callData = iface.encodeFunctionData('unstake', [stakes, rewardProof]);
```

#### Claim Staking Rewards

Claim accumulated $LAZY without unstaking NFTs.

**Warning:** Claiming resets the HODL bonus timer!

```javascript
// Check pending rewards first
const pendingRewards = await query('calculateRewards', [userAddress]);
const burnPct = await query('burnPercentage', []);

const netRewards = pendingRewards * (100n - burnPct) / 100n;

// Claim
const callData = iface.encodeFunctionData('claimRewards', []);
```

---

### Boosting Missions

Users can reduce mission duration via boosts. Two methods available:

#### Boost with Gem NFT

Stake a gem NFT to reduce mission time. Gem is returned when mission completes/exits.

**Gem Levels:**
| Level | Name | Typical Reduction |
|-------|------|-------------------|
| 0 | Common (C) | 10% |
| 1 | Rare (R) | 20% |
| 2 | Super Rare (SR) | 35% |
| 3 | Ultra Rare (UR) | 50% |
| 4 | Legend Rare (LR) | 65% |
| 5 | Special (SPE) | 80% |

```javascript
// Check gem level
const level = await query('getBoostLevel', [gemToken, serial], boostManagerAbi);
const boostData = await query('getBoostData', [level], boostManagerAbi);

// Approve gem NFT
await setNFTAllowance(gemToken, boostManagerAddress);

// Activate boost
const callData = iface.encodeFunctionData('boostWithGemCards', [
  missionAddress,
  gemTokenAddress,
  serial
]);
```

#### Boost with $LAZY

Purchase a boost with $LAZY tokens. Tokens are consumed (partially burned).

```javascript
// Get cost
const cost = await query('lazyBoostCost', [], boostManagerAbi);
const reduction = await query('lazyBoostReduction', [], boostManagerAbi);

// Approve $LAZY to BoostManager
await setFTAllowance(lazyToken, boostManagerAddress, cost);

// Activate boost
const callData = iface.encodeFunctionData('boostWithLazy', [missionAddress]);
```

---

### NFT Delegation

Allow another wallet to use your NFTs for staking/farming without transferring ownership.

```javascript
// Delegate specific NFTs
const callData = iface.encodeFunctionData('delegateNFT', [
  delegateAddress,  // Who can use the NFTs
  tokenAddress,     // NFT collection
  serials           // Array of serial numbers
]);

// Check delegation
const isDelegated = await query('checkDelegateForToken', [
  delegateAddress,
  tokenAddress,
  serial,
  ownerAddress
], delegateRegistryAbi);

// Revoke delegation
const revokeData = iface.encodeFunctionData('revokeDelegateNFT', [
  delegateAddress,
  tokenAddress,
  serials
]);
```

---

## Allowance Patterns

### Summary Table

| Operation | Token Type | Spender Contract | Amount |
|-----------|------------|------------------|--------|
| Enter Mission | $LAZY (FT) | LazyGasStation | Entry fee |
| Enter Mission | NFTs | Mission | All serials (approve all) |
| Leave Mission | HBAR | Mission | 10 tinybar |
| Leave Mission (boosted) | HBAR | BoostManager | 1 tinybar |
| Claim Farming Rewards | HBAR | Mission | 10 tinybar |
| Claim Farming Rewards (boosted) | HBAR | BoostManager | 1 tinybar |
| Unstake NFT | HBAR | LazyNFTStaking | 10 tinybar |
| Boost with Gem | NFT | BoostManager | Specific gem serial |
| Boost with $LAZY | $LAZY (FT) | BoostManager | Boost cost |

### Setting Allowances

**Fungible Token (FT) Allowance:**
```javascript
import { AccountAllowanceApproveTransaction } from '@hashgraph/sdk';

const tx = new AccountAllowanceApproveTransaction()
  .approveTokenAllowance(tokenId, ownerId, spenderId, amount);
```

**NFT Allowance (All Serials):**
```javascript
const tx = new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(tokenId, ownerId, spenderId);
```

**HBAR Allowance:**
```javascript
const tx = new AccountAllowanceApproveTransaction()
  .approveHbarAllowance(ownerId, spenderId, Hbar.fromTinybars(amount));
```

### Checking Allowances

Query via Mirror Node:
```javascript
// FT allowances
const ftAllowances = await fetch(
  `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/allowances/tokens`
);

// NFT allowances
const nftAllowances = await fetch(
  `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/allowances/nfts`
);

// HBAR allowances
const hbarAllowances = await fetch(
  `https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}/allowances/crypto`
);
```

---

## Admin Console Guide

### Mission Lifecycle

#### 1. Deploy New Mission

```javascript
// MissionFactory.deployMission()
const params = {
  duration: 86400,           // 24 hours in seconds
  fee: 100_00000000n,        // 100 $LAZY (8 decimals)
  requirements: [req1, req2], // NFT collection addresses
  rewards: [rew1, rew2],     // NFT collection addresses
  burnPercentage: 25,        // 25% of fees burned
  lastEntry: futureTimestamp, // Entry deadline
  numRequirements: 2,        // NFTs needed to enter
  numRewards: 1              // NFTs given on completion
};

const callData = factoryIface.encodeFunctionData('deployMission', [
  params.duration,
  params.fee,
  params.requirements,
  params.rewards,
  params.burnPercentage,
  params.lastEntry,
  params.numRequirements,
  params.numRewards
]);
```

#### 2. Add Reward NFTs to Mission

After deployment, transfer reward NFTs to the mission:

```javascript
// First: Approve Mission contract for NFT transfers
await setNFTAllowanceAll(rewardToken, missionAddress);

// Then: Add specific serials
const callData = missionIface.encodeFunctionData('addRewardSerials', [
  rewardTokenAddress,
  serialNumbers  // [1, 2, 3, 4, 5]
]);
```

#### 3. Configure Mission Parameters

```javascript
// Set start time (delay mission availability)
const startData = missionIface.encodeFunctionData('setStartTimestamp', [timestamp]);

// Set decreasing fees (Dutch auction)
const feeData = missionIface.encodeFunctionData('setDecreasingEntryFee', [
  startTimestamp,    // When to start decreasing
  minimumFee,        // Floor price
  decrementAmount,   // Amount per interval
  decrementInterval  // Seconds between decrements
]);

// Pause/unpause
const pauseData = missionIface.encodeFunctionData('updatePauseStatus', [true]);
```

#### 4. Close Mission

Permanently close a mission (returns unclaimed rewards):

```javascript
// Via MissionFactory (requires factory admin)
const closeData = factoryIface.encodeFunctionData('closeMission', [missionAddress]);
```

### Staking Configuration

#### Add Stakeable Collections

```javascript
const collections = [collection1, collection2, collection3];
const maxRates = [1_00000000n, 2_00000000n, 3_00000000n]; // Max $LAZY per period

const callData = stakingIface.encodeFunctionData('setStakeableCollection', [
  collections,
  maxRates
]);
```

#### Configure Staking Parameters

```javascript
// Distribution period (how often rewards accrue)
setDistributionPeriod(86400); // Daily

// Burn percentage on claims
setBurnPercentage(10); // 10% burned

// HODL bonus
setHodlBonusRate(50);        // 50% bonus
setPeriodForHodlBonus(7);    // After 7 periods
setMaxHodlBonusPeriods(30);  // Cap at 30 periods
```

### Boost Configuration

#### Configure Gem Boost Levels

```javascript
// Set reduction percentage for each gem level
for (let level = 0; level <= 5; level++) {
  const reduction = [10, 20, 35, 50, 65, 80][level];
  await boostManager.setGemBoostReduction(level, reduction);
}

// Register gem collections at levels
await boostManager.addCollectionToBoostLevel(2, [srGemCollection]); // SR gems
await boostManager.addCollectionToBoostLevel(4, [lrGemCollection]); // LR gems
```

#### Configure $LAZY Boost

```javascript
await boostManager.setLazyBoostCost(50_00000000n);  // 50 $LAZY
await boostManager.setLazyBoostReduction(25);       // 25% reduction
await boostManager.setLazyBurnPercentage(50);       // 50% of cost burned
```

### Role Management

#### MissionFactory Roles

```javascript
// Add admin
factoryIface.encodeFunctionData('addAdmin', [newAdminAddress]);

// Remove admin (must have >1 admin)
factoryIface.encodeFunctionData('removeAdmin', [adminAddress]);

// Add deployers (can create missions)
factoryIface.encodeFunctionData('updateDeployers', [
  [deployer1, deployer2],
  true  // add=true, remove=false
]);
```

### Fund Management

#### Withdraw Funds from Contracts

```javascript
// From Mission
missionIface.encodeFunctionData('transferHbar', [receiver, amount]);
missionIface.encodeFunctionData('retrieveLazy', [receiver, amount]);

// From BoostManager
boostIface.encodeFunctionData('transferHbar', [receiver, amount]);
boostIface.encodeFunctionData('retieveLazy', [receiver, amount]); // Note: typo in deployed contract

// From MissionFactory
factoryIface.encodeFunctionData('transferHbar', [receiver, amount]);
factoryIface.encodeFunctionData('retrieveLazy', [receiver, amount]);
```

**Important:** Contracts with active participants require minimum 10 HBAR balance for rent.

---

## Error Reference

### Mission.sol Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `"Already initialized"` | Mission.initialize() called twice | Only initialize once per clone |
| `"Mission paused"` | Attempting to enter paused mission | Wait for admin to unpause |
| `"No more slots available"` | Mission at capacity | Wait for space or choose another mission |
| `"Mission not open yet"` | Before mission start time | Wait until start time |
| `"Mission closed"` | Past entry deadline | Mission no longer accepting entries |
| `"Already joined"` | User already in this mission | Complete/leave current participation first |
| `"Collection not included"` | NFT collection not in requirements | Use approved requirement collections |
| `"Serials not authorized"` | Serial not in allowed list | Use authorized serial numbers |
| `"Invalid requirement number"` | Wrong NFT count | Stake exact number of required NFTs |
| `"Mission not finished"` | Claiming before completion | Wait until mission end time |
| `"No mission active"` | User not participating | Must be in mission to leave/claim |
| `"Tfr fail"` | Token transfer failed | Check balances and allowances |

### LazyNFTStaking.sol Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `"Invalid signature"` | Signature verification failed | Get fresh signature from backend |
| `"Signature has expired"` | Signature > 120 seconds old | Generate new signature |
| `"Invalid Collection"` | NFT collection not stakeable | Use approved collections only |
| `RateCapExceeded(value, cap)` | Reward rate exceeds maximum | Reduce reward rate per NFT |
| `"Boost rate > cap"` | Boost rate too high | Reduce boost rate in proof |
| `"User not staking"` | User has no staked NFTs | Must have staked NFTs to unstake |
| `"NFT not staked"` | Attempting to unstake non-staked NFT | Only unstake your staked NFTs |

### BoostManager.sol Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `"Not active"` | User not in mission | Must be active participant |
| `"Boost already active"` | Already boosted this mission | One boost per mission |
| `InvalidArguments()` | NFT not approved or invalid args | Set NFT allowance first |
| `"Collection not authorized"` | Gem collection not registered | Use registered gem collections |
| `"already added"` | Collection already in boost level | Use addCollectionToBoostLevelWithLockedSerials |

### LazyGasStation.sol Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Empty(required, available)` | Insufficient contract balance | Fund the gas station |
| `BadInput()` | Invalid parameters | Check amounts > 0, percentages <= 100 |
| `PayoutFailed()` | Token transfer to user failed | Check token associations |
| `InsufficientAllowance()` | User hasn't approved enough $LAZY | Set allowance >= amount |
| `LastAdmin()` | Removing last admin | Keep at least one admin |

### Hedera Response Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 10 | INSUFFICIENT_PAYER_BALANCE | Fund account with HBAR |
| 165 | ACCOUNT_FROZEN_FOR_TOKEN | Unfreeze token account |
| 166 | TOKENS_PER_ACCOUNT_LIMIT_EXCEEDED | Dissociate unused tokens |
| 167 | INVALID_TOKEN_ID | Verify token ID exists |
| 178 | INSUFFICIENT_TOKEN_BALANCE | Fund token balance |
| 184 | TOKEN_NOT_ASSOCIATED_TO_ACCOUNT | Associate token first |

---

## Event Reference

### Mission Events

| Event | Parameters | Trigger |
|-------|------------|---------|
| `MissionJoined(user, entryTime, endTime)` | User address, timestamps | User enters mission |
| `MissionCompleted(wallet, timestamp)` | User address, time | User claims rewards |
| `SlotsRemaining(slots, timestamp)` | Available slots, time | Any slot change |

### MissionFactory Events (Aggregated)

| Event | Parameters | Trigger |
|-------|------------|---------|
| `MissionCreatedFactory(mission, duration, fee, burnPct, deadline)` | Mission details | Mission deployed |
| `MissionJoinedFactory(mission, user, entryTime, endTime)` | Participation | User joins any mission |
| `MissionCompletedFactory(mission, wallet, timestamp)` | Completion | User completes any mission |
| `BoostActivatedFactory(mission, user, reduction, newEnd, newDuration, boostType)` | Boost details | Boost activated |
| `SlotsRemainingFactory(mission, slots, timestamp)` | Capacity | Slot change on any mission |

### LazyNFTStaking Events

| Event | Parameters | Trigger |
|-------|------------|---------|
| `StakedNFT(user, collection, serials[], rewards[])` | Stake details | NFTs staked |
| `UnstakedNFT(user, collection, serials[], rewards[])` | Unstake details | NFTs unstaked |
| `ClaimedRewards(user, amount, burnPct)` | Claim details | Rewards claimed |
| `StakingMessage(function, sender, amount, message)` | Config info | Admin changes |

### BoostManager Events

| Event | Parameters | Trigger |
|-------|------------|---------|
| `BoostActivated(mission, user, reduction, newEnd, newDuration, type)` | Boost details | Any boost activated |

### LazyGasStation Events

| Event | Parameters | Trigger |
|-------|------------|---------|
| `GasStationFunding(contract, user, amount, burnPct, fromUser)` | Fund flow | Fee collection or payout |
| `GasStationAccessControlEvent(executor, address, added, role)` | Role change | Admin/role changes |

### LazyDelegateRegistry Events

| Event | Parameters | Trigger |
|-------|------------|---------|
| `TokenDelegated(token, serial, delegate, owner, delegated)` | Delegation | NFT delegated/revoked |
| `WalletDelegated(wallet, delegate, delegated)` | Wallet delegation | Wallet delegated/revoked |

### Event Indexing Recommendations

**Primary Feed (MissionFactory):**
- Subscribe to MissionFactory for aggregated mission activity
- Single endpoint for all mission joins, completions, boosts

**Staking Feed (LazyNFTStaking):**
- Track StakedNFT/UnstakedNFT for portfolio changes
- Track ClaimedRewards for earnings history

**Financial Feed (LazyGasStation):**
- GasStationFunding with fromUser=true: fee payments
- GasStationFunding with fromUser=false: reward payouts

---

## ABI Decoding Guide

### Which ABI to Use

| Contract Type | ABI File | When to Use |
|---------------|----------|-------------|
| Mission | `abi/Mission.json` | Individual mission operations |
| MissionFactory | `abi/MissionFactory.json` | Deploy missions, factory queries |
| LazyNFTStaking | `abi/LazyNFTStaking.json` | Staking operations |
| BoostManager | `abi/BoostManager.json` | Boost operations |
| LazyGasStation | `abi/LazyGasStation.json` | Fee-related operations |
| LazyDelegateRegistry | `abi/LazyDelegateRegistry.json` | Delegation operations |

### Decoding Errors

```javascript
import { ethers } from 'ethers';

// Load all ABIs
const abis = {
  Mission: require('./abi/Mission.json'),
  MissionFactory: require('./abi/MissionFactory.json'),
  LazyNFTStaking: require('./abi/LazyNFTStaking.json'),
  BoostManager: require('./abi/BoostManager.json'),
  LazyGasStation: require('./abi/LazyGasStation.json'),
};

function decodeError(errorData) {
  for (const [name, abi] of Object.entries(abis)) {
    try {
      const iface = new ethers.Interface(abi);
      const decoded = iface.parseError(errorData);
      return { contract: name, error: decoded };
    } catch {}
  }
  return null;
}
```

### Decoding Events

```javascript
function decodeEvent(topics, data) {
  for (const [name, abi] of Object.entries(abis)) {
    try {
      const iface = new ethers.Interface(abi);
      const decoded = iface.parseLog({ topics, data });
      return { contract: name, event: decoded };
    } catch {}
  }
  return null;
}
```

### Common Gotchas

1. **Address Format**: Hedera uses `0.0.XXXXX` format, contracts use EVM addresses
   ```javascript
   // Convert Hedera ID to EVM address
   const evmAddress = AccountId.fromString('0.0.123456').toSolidityAddress();
   ```

2. **$LAZY Decimals**: 8 decimals (like HBAR)
   ```javascript
   const lazyAmount = 100_00000000n; // 100 $LAZY
   ```

3. **Timestamps**: Contracts use seconds, JavaScript uses milliseconds
   ```javascript
   const contractTime = Math.floor(Date.now() / 1000);
   ```

4. **Gas Limits**:
   - Simple queries: 100,000
   - Mission entry: 1,500,000
   - Staking: 800,000 + (100,000 per NFT)
   - Boost: 900,000

---

## Quick Reference

### User Journey: Enter Mission

1. `getMissionInfo()` - Check mission details
2. `checkLiveFTAllowance()` - Check $LAZY allowance to LazyGasStation
3. `setFTAllowance()` - Set allowance if needed
4. `setNFTAllowanceAll()` - Approve requirement NFTs
5. `enterMission()` - Join the mission

### User Journey: Stake NFTs

1. `getStakeableCollections()` - Check eligible collections
2. Generate reward proof from backend
3. `setNFTAllowanceAll()` - Approve NFTs to staking contract
4. `stake()` - Stake NFTs with proof

### User Journey: Claim Rewards

**Farming:**
1. `getUserEndAndBoost()` - Check mission complete
2. `setHbarAllowance()` - Set HBAR allowance (10 tinybar)
3. `claimRewards()` - Claim NFT rewards

**Staking:**
1. `calculateRewards()` - Check pending rewards
2. `claimRewards()` - Claim $LAZY (resets HODL bonus!)

---

*Last Updated: 2026-01-15*
