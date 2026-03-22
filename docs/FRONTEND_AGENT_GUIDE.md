# Frontend Agent Guide: Lazy Superheroes Farming & Staking dApp

This guide provides everything an AI agent (or frontend developer) needs to build and maintain the Lazy Superheroes dApp UI. It covers contract addresses, ABIs, allowance flows, event monitoring, state queries, user flows, and edge cases.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Contract Addresses & ABIs](#2-contract-addresses--abis)
3. [Allowance Model (Who Approves What to Whom)](#3-allowance-model-who-approves-what-to-whom)
4. [Mission Discovery via the Factory](#4-mission-discovery-via-the-factory)
5. [Event Monitoring & Indexing](#5-event-monitoring--indexing)
6. [Mission Slots & Participant Counts](#6-mission-slots--participant-counts)
7. [Mission Entry Flow & Countdown Timer](#7-mission-entry-flow--countdown-timer)
8. [Mission Completion & Reward Claiming](#8-mission-completion--reward-claiming)
9. [Leaving a Mission Early](#9-leaving-a-mission-early)
10. [Boost System](#10-boost-system)
11. [NFT Staking for $LAZY Rewards](#11-nft-staking-for-lazy-rewards)
12. [NFT Delegation](#12-nft-delegation)
13. [Dutch Auction (Decreasing Entry Fee)](#13-dutch-auction-decreasing-entry-fee)
14. [Error Reference](#14-error-reference)
15. [Complete Allowance Quick-Reference Table](#15-complete-allowance-quick-reference-table)
16. [Mirror Node Queries](#16-mirror-node-queries)
17. [UX State Machine Summary](#17-ux-state-machine-summary)

---

## 1. System Overview

The system has two independent features that share infrastructure:

**A. NFT Staking** — Users stake NFTs from approved collections into `LazyNFTStaking` to earn $LAZY token rewards over time. Rewards accrue daily, have HODL bonuses, boost multipliers, and halvening epochs.

**B. Mission Farming** — Users stake requirement NFTs into time-limited "missions" deployed by `MissionFactory`. After the mission duration expires, they claim randomized reward NFTs. Missions have entry fees, optional boosts to reduce duration, and slot limits.

**Shared Infrastructure:**
- `LazyGasStation` — Central hub for all $LAZY fee collection, burns, and payouts
- `LazyDelegateRegistry` — NFT delegation (cold wallet → hot wallet usage)
- `$LAZY Token` — Fungible token (1 decimal place) used for fees, rewards, and boosts

### Contract Dependency Graph

```
User Wallet
 ├── approves $LAZY to ──────────── LazyGasStation
 ├── approves NFTs to ──────────── Mission (for entry requirements)
 ├── approves NFTs to ──────────── LazyNFTStaking (for staking)
 ├── approves Gem NFTs to ──────── BoostManager (for gem boosts)
 │
 ├── calls ──────────────────────── Mission.enterMission()
 │    └── internally calls ──────── LazyGasStation.drawLazyFrom(user)
 │
 ├── calls ──────────────────────── Mission.claimRewards()
 │    └── internally calls ──────── BoostManager.endMissionBoost()
 │
 ├── calls ──────────────────────── BoostManager.boostWithLazy()
 │    └── internally calls ──────── LazyGasStation.drawLazyFrom(user)
 │    └── internally calls ──────── Mission.reduceStakingPeriod()
 │
 ├── calls ──────────────────────── BoostManager.boostWithGemCards()
 │    └── internally calls ──────── Mission.reduceStakingPeriod()
 │
 ├── calls ──────────────────────── LazyNFTStaking.stake()
 ├── calls ──────────────────────── LazyNFTStaking.unstake()
 └── calls ──────────────────────── LazyNFTStaking.claimRewards()
      └── internally calls ──────── LazyGasStation.payoutLazy(user)
```

---

## 2. Contract Addresses & ABIs

### Mainnet Contracts

| Contract | Hedera ID | EVM Address | ABI File |
|----------|-----------|-------------|----------|
| $LAZY Token | `0.0.1311037` | `0x000000000000000000000000000000000013ffed` | N/A (ERC-20) |
| LAZY Token Creator (SCT) | `0.0.1311003` | `0x000000000000000000000000000000000013ffab` | N/A |
| LazyGasStation | `0.0.7221483` | `0x00000000000000000000000000000000006e376b` | `abi/LazyGasStation.json` |
| LazyDelegateRegistry | `0.0.7221486` | `0x00000000000000000000000000000000006e376e` | `abi/LazyDelegateRegistry.json` |
| LazyNFTStaking | `0.0.7221488` | `0x00000000000000000000000000000000006e3770` | `abi/LazyNFTStaking.json` |
| BoostManager | `0.0.8257105` | `0x00000000000000000000000000000000007e0a51` | `abi/BoostManager.json` |
| PRNG | `0.0.8257116` | `0x00000000000000000000000000000000007e0a5c` | `abi/PrngSystemContract.json` |
| Mission Template | `0.0.8257118` | `0x00000000000000000000000000000000007e0a5e` | `abi/Mission.json` |
| MissionFactory | `0.0.8257122` | `0x00000000000000000000000000000000007e0a62` | `abi/MissionFactory.json` |

### Token Details

- **Symbol:** LAZY
- **Decimals:** 1 (i.e., 10 = 1.0 LAZY; all on-chain amounts use 1 decimal)
- **Max Supply:** 2,500,000,000 (250M with 1 decimal)

### ABI Usage

- **Mission clones**: All mission instances (deployed via factory) use the same ABI as `abi/Mission.json`. The MissionTemplate address is the implementation — never call it directly. Call the clone addresses returned by `MissionFactory.getDeployedMissions()`.
- **ERC-20 queries** for $LAZY (balance, allowance, approve) use standard ERC-20 ABI against the token address.
- **ERC-721 queries** for NFT collections use standard ERC-721 ABI (`ownerOf`, `isApprovedForAll`, `setApprovalForAll`).

---

## 3. Allowance Model (Who Approves What to Whom)

This is the most critical section for the frontend. **Getting allowances wrong causes transactions to revert silently on Hedera.**

### Rule 1: $LAZY Token Allowance → LazyGasStation

Every operation that costs $LAZY requires the **user to approve the LazyGasStation** (not the mission, not the BoostManager). The LazyGasStation is the single contract that pulls $LAZY from users.

```
User approves $LAZY → LazyGasStation (0x...6e376b)
```

**When needed:**
- Entering a mission (entry fee)
- Boosting with $LAZY tokens (boost cost)

**How to check:**
```js
const allowance = await lazyToken.allowance(userAddress, lazyGasStationAddress);
const entryFee = await mission.entryFee(); // current fee (may decrease in Dutch auction)
if (allowance < entryFee) {
  // prompt user to approve
  await lazyToken.approve(lazyGasStationAddress, desiredAmount);
}
```

**Best practice:** Approve a large amount once (e.g., `MaxUint256` or a generous amount like 100,000 LAZY) rather than exact amounts each time. The LazyGasStation only draws what it needs.

### Rule 2: NFT Allowance → The Contract That Holds Them

NFTs are always transferred by the **receiving contract**, so the user must approve that specific contract.

| Operation | User Approves NFT Collection To | Method |
|-----------|--------------------------------|--------|
| Enter Mission | Mission clone address | `setApprovalForAll(missionAddress, true)` |
| Stake NFTs | LazyNFTStaking address | `setApprovalForAll(stakingAddress, true)` |
| Boost with Gem | BoostManager address | `setApprovalForAll(boostManagerAddress, true)` |

**How to check (ERC-721):**
```js
const isApproved = await nftCollection.isApprovedForAll(userAddress, missionAddress);
if (!isApproved) {
  await nftCollection.setApprovalForAll(missionAddress, true);
}
```

### Rule 3: Token Association (Hedera-specific)

Before a Hedera account can receive any HTS token (fungible or NFT), the account must be **associated** with that token. The contracts handle their own associations internally. The **user's wallet** must be associated with:

- $LAZY token (to receive rewards)
- Any reward NFT collections (to receive mission rewards)
- Any gem NFT collections (to receive returned gems after boost)

The frontend should check association status via the Hedera Mirror Node and prompt the user to associate if needed.

---

## 4. Mission Discovery via the Factory

The MissionFactory is the single entry point for discovering all active missions.

### Getting All Active Missions

```js
// Returns array of mission clone addresses
const missions = await missionFactory.getDeployedMissions();
```

This returns every mission that has NOT been closed via `closeMission()`. Closed missions are removed from this set.

### Getting Slots and Fees for All Missions at Once

```js
// Returns 3 parallel arrays: [missionAddresses[], slotsRemaining[], entryFees[]]
const [addresses, slots, fees] = await missionFactory.getAvailableSlots();
```

This is the most efficient call for rendering a mission list view. One call gets addresses, slot counts, and current entry fees.

### Getting User's Active Missions

```js
// Returns missions user is currently on + their end timestamps + boost status
const [missionAddresses, endTimestamps, boosted] = await missionFactory.getLiveMissions(userAddress);
```

### Getting Full Participation Details

```js
// For a specific user on a specific mission
const [stakedCollections, stakedSerials, entryTimestamp, endTimestamp, isBoosted] =
  await missionFactory.getUsersMissionParticipation(userAddress, missionAddress);
```

### Getting Mission Configuration

Each mission clone exposes its own configuration. Query the mission address directly using the Mission ABI:

```js
const mission = new ethers.Contract(missionAddress, MissionABI, provider);

// Core configuration
const slotsRemaining = await mission.getSlotsRemaining();
const fee = await mission.entryFee();           // current fee (Dutch auction adjusted)
const users = await mission.getUsersOnMission(); // array of participant addresses

// Requirements: what NFTs do users need?
const [reqCollections, limitedSerials, reqSerials] = await mission.getRequirements();

// Rewards: what NFTs are in the prize pool?
const [rewardCollections, rewardSerials] = await mission.getRewards();

// Time windows
const startTimestamp = await mission.missionState().startTimestamp; // or read from events
const lastEntryTimestamp = await mission.missionState().lastEntryTimestamp;
const missionDuration = await mission.missionState().missionDuration;
```

> **Note:** `missionState` is a public struct, but Solidity auto-generates a getter that returns all fields as a tuple. Alternatively, read these from the `MissionCreatedFactory` event.

---

## 5. Event Monitoring & Indexing

### Why Monitor MissionFactory (Not Individual Missions)

Every mission clone broadcasts its lifecycle events up to MissionFactory. This means you only need to subscribe to **one contract** (MissionFactory) to track all activity across all missions.

### Factory Events

| Event | Emitted When | Indexed Fields | Data Fields |
|-------|-------------|----------------|-------------|
| `MissionCreatedFactory` | New mission deployed | `mission` | `missionDuration`, `entryFee`, `feeBurnPercentage`, `lastEntryTimestamp` |
| `MissionJoinedFactory` | User enters mission | `mission` | `user`, `entryTimestamp`, `endOfMissionTimestamp` |
| `MissionCompletedFactory` | User claims rewards | `mission`, `wallet` | `timestamp` |
| `BoostActivatedFactory` | Boost applied | — | `mission`, `missionParticipant`, `boostReduction`, `newEndTimestamp`, `newMissionDuration`, `boostType` |
| `SlotsRemainingFactory` | Slot count changes | `mission` | `slotsRemaining`, `timestamp` |

### Staking Events (on LazyNFTStaking)

| Event | Emitted When | Data |
|-------|-------------|------|
| `StakedNFT` | NFTs staked | `user`, `collection`, `serials[]`, `rewards[]` |
| `UnstakedNFT` | NFTs unstaked | `user`, `collection`, `serials[]`, `rewards[]` |
| `ClaimedRewards` | Rewards claimed | `user`, `rewardAmount`, `burnPercentage` |

### Delegation Events (on LazyDelegateRegistry)

| Event | Emitted When | Data |
|-------|-------------|------|
| `WalletDelegated` | Wallet delegation set/revoked | `wallet`, `delegate`, `delegated` (bool) |
| `TokenDelegated` | NFT delegation set/revoked | `token`, `serial`, `delegate`, `owner`, `delegated` (bool) |

### Boost Events (on BoostManager)

| Event | Emitted When | Data |
|-------|-------------|------|
| `BoostActivated` | Boost applied (also broadcast to factory) | `mission`, `participant`, `boostReduction`, `newEndTimestamp`, `newMissionDuration`, `boostType` |

### How to Subscribe

On Hedera, use the Mirror Node REST API or a websocket-based event listener. Events are queryable by contract ID and topic:

```
GET /api/v1/contracts/{contractId}/results/logs?topic0={eventSignature}&order=desc
```

For real-time updates, poll the `SlotsRemainingFactory` and `MissionJoinedFactory` events on MissionFactory.

---

## 6. Mission Slots & Participant Counts

### How Slots Work

Slots are determined by the reward pool:

```
totalSlots = totalRewardNFTs / rewardsPerParticipant
openSlots = totalSlots - activeParticipants
```

Example: 30 reward NFTs, 3 rewards per participant = 10 total slots.

### Reading Slot State

```js
// Quick check
const openSlots = await mission.getSlotsRemaining();

// Bulk check (all missions at once)
const [missions, slots, fees] = await missionFactory.getAvailableSlots();

// Who is on the mission?
const participants = await mission.getUsersOnMission(); // returns address[]
const participantCount = participants.length;
```

### When Slots Change

Slots decrease when:
- A user enters the mission (`enterMission`)
- Admin withdraws reward NFTs (`withdrawRewards`)

Slots increase when:
- A user claims rewards (`claimRewards` — consumes slot but also takes rewards)
- Admin adds more reward NFTs (`addRewardSerials`)
- A user leaves early without claiming (`leaveMission`)

Every slot change emits `SlotsRemainingFactory` on MissionFactory.

### UX Consideration: Slot Blocking

When a user calls `enterMission()`, the slot is blocked **immediately** (before NFT transfers happen). If the transaction reverts mid-way, the slot is freed. This means:
- Don't show "1 slot remaining" and let two users try simultaneously — one will fail
- Poll `getSlotsRemaining()` right before presenting the "Enter" button
- After a successful entry, the `SlotsRemainingFactory` event confirms the new count

---

## 7. Mission Entry Flow & Countdown Timer

### Pre-Entry Checks (Frontend Must Validate)

Before showing the "Enter Mission" button, check:

1. **Mission not paused:** `isPaused` is false
2. **Mission is open:** `block.timestamp > startTimestamp` (or `startTimestamp == 0`)
3. **Entry deadline not passed:** `block.timestamp < lastEntryTimestamp`
4. **Slots available:** `getSlotsRemaining() > 0`
5. **User not already in:** `isParticipant(userAddress) == false`
6. **User has required NFTs:** Check ownership of requirement collections
7. **User has $LAZY allowance to LazyGasStation:** `allowance >= entryFee()`
8. **User has approved NFTs to Mission:** `isApprovedForAll(userAddress, missionAddress)`

### Entry Transaction

```js
// _collectionAddress: array of NFT collections being staked
// _serials: 2D array — serials[i] contains serial numbers for collectionAddress[i]
// Total serials across all arrays must equal mission's nbOfRequirements
await mission.enterMission(collectionAddresses, serials);
```

### Countdown Timer

After entry, the user's personal mission timer starts:

```js
const [collections, serials, entryTimestamp, endTimestamp, boosted] =
  await mission.getMissionParticipation(userAddress);

const now = Math.floor(Date.now() / 1000);
const remainingSeconds = endTimestamp - now;

if (remainingSeconds <= 0) {
  // Show "Claim Rewards" button
} else {
  // Show countdown timer: remainingSeconds
}
```

**Key nuances:**
- `endTimestamp` is set at entry: `entryTimestamp + missionDuration`
- If user activates a boost, `endTimestamp` is recalculated and reduced
- Each user has their own independent timer (not a global mission clock)
- The timer is based on Hedera consensus timestamps, not client-side time. There may be slight drift.

### Time Windows

Display these prominently:
- **Opens at:** `startTimestamp` (0 means already open)
- **Closes at:** `lastEntryTimestamp` (after this, no new entries)
- **Duration:** `missionDuration` seconds (per participant)

---

## 8. Mission Completion & Reward Claiming

### When Can a User Claim?

```js
const [, , , endTimestamp, ] = await mission.getMissionParticipation(userAddress);
const canClaim = endTimestamp > 0 && Math.floor(Date.now() / 1000) >= endTimestamp;
```

### Claiming Rewards

```js
// No parameters — contract knows what the user is owed
await mission.claimRewards();
```

**What happens internally:**
1. PRNG selects `nbOfRewards` random NFTs from the reward pool
2. Each reward: random collection → random serial from that collection
3. NFTs transferred to user
4. Staked requirement NFTs returned to user
5. If user had a gem boost, gem NFT returned via BoostManager
6. Slot freed, participant count decremented
7. `MissionCompletedFactory` event emitted

### Important: Token Association for Rewards

The user's wallet must be associated with ALL reward NFT collections before claiming. If any association is missing, the HTS transfer will fail and the entire claim reverts.

**Check before allowing claim:**
```js
// For each reward collection in the mission
const [rewardCollections] = await mission.getRewards();
// Check user is associated with each via Mirror Node
for (const collection of rewardCollections) {
  const associated = await checkTokenAssociation(userAddress, collection);
  if (!associated) {
    // Prompt user to associate with this token
  }
}
```

### Reward Pool Visibility

Show users what they might win:

```js
const [rewardCollections, rewardSerials] = await mission.getRewards();
// rewardCollections[i] = collection address
// rewardSerials[i] = array of available serial numbers in that collection
```

The reward selection is random — users cannot choose which rewards they get.

---

## 9. Leaving a Mission Early

Users can leave a mission at any time (emergency exit), but they **forfeit all rewards**.

```js
await mission.leaveMission();
```

**What happens:**
1. Active boost ended (gem returned if applicable)
2. All staked requirement NFTs returned to user
3. Participant record deleted
4. Slot freed
5. **No rewards given**
6. **Entry fee NOT refunded**

Show a clear confirmation dialog: "You will lose your entry fee and receive no rewards. Your staked NFTs will be returned."

---

## 10. Boost System

Boosts reduce a participant's remaining mission duration. There are two types with fundamentally different mechanics.

### Boost Type 1: $LAZY Boost (Consumable)

- **Cost:** Configurable (check `lazyBoostCost` on BoostManager)
- **Effect:** Reduces remaining duration by `lazyBoostReduction`% (default 10%)
- **Burn:** A percentage of the cost is burned (check `feeBurnPercentage`)
- **Token returned?** NO — $LAZY is consumed/burned
- **Prerequisite:** User must have $LAZY allowance to LazyGasStation

```js
// Check cost
const boostCost = await boostManager.lazyBoostCost();
const boostReduction = await boostManager.lazyBoostReduction();

// Ensure allowance
const allowance = await lazyToken.allowance(userAddress, lazyGasStationAddress);
if (allowance < boostCost) {
  await lazyToken.approve(lazyGasStationAddress, boostCost);
}

// Activate boost
const newEndTimestamp = await boostManager.boostWithLazy(missionAddress);
```

### Boost Type 2: Gem Boost (Long-term / Staked)

- **Cost:** Free (no $LAZY cost)
- **Effect:** Varies by gem level (see table below)
- **Mechanism:** Gem NFT is staked (transferred to BoostManager) during the mission
- **Token returned?** YES — gem is automatically returned when mission ends or user leaves
- **Delegation:** While staked, the gem is delegated back to the user via LazyDelegateRegistry (user retains visual ownership)
- **Prerequisite:** User must approve gem NFT collection to BoostManager

```js
// Check gem level and reduction
const boostLevel = await boostManager.getBoostLevel(gemCollection, gemSerial);
const [collections, serialLocked, serials, reduction] =
  await boostManager.getBoostData(boostLevel);

// Ensure NFT approval
const approved = await gemNFT.isApprovedForAll(userAddress, boostManagerAddress);
if (!approved) {
  await gemNFT.setApprovalForAll(boostManagerAddress, true);
}

// Activate boost
const newEndTimestamp = await boostManager.boostWithGemCards(
  missionAddress, gemCollection, gemSerial
);
```

### Gem Levels & Default Reduction Rates

| Level | Name | Default Reduction |
|-------|------|-------------------|
| C | Common | 5% |
| R | Rare | 10% |
| SR | Super Rare | 15% |
| UR | Ultra Rare | 25% |
| LR | Legend Rare | 40% |
| SPE | Special | 20% |

> These are configurable by admins. Always query `getBoostData(level)` for current values.

### How Duration Reduction Works

The boost reduces only the **remaining** duration, not the total mission duration.

```
Example: 1-hour mission (3600s)
- User enters at T=0, endTime = T+3600
- At T+1800 (30 min in), user activates 25% boost
- Remaining before boost: 1800s
- After 25% reduction: 1800 * 0.75 = 1350s
- New endTime: T + 1800 + 1350 = T + 3150 (52.5 min total instead of 60)
```

### Boost Constraints

- **One boost per mission per user.** Cannot stack boosts.
- **Must be an active participant** to boost. Cannot boost before entering.
- **Boost is permanent** for that mission run. Cannot cancel or change boost type.
- A user who leaves early still gets their gem back (if gem boost).

### Checking Boost Status

```js
// Simple check
const hasBoosted = await boostManager.hasBoost(userAddress, missionAddress);

// Detailed info
const [boostType, gemCollection, gemSerial] =
  await boostManager.getBoostItem(missionAddress, userAddress);
// boostType: 0=NONE, 1=LAZY, 2=GEM

// Via mission (also returns end timestamp)
const [endTimestamp, isBoosted] = await mission.getUserEndAndBoost(userAddress);
```

### Available Gem Collections

```js
// All gem collections across all levels
const gemCollections = await boostManager.getGemCollections();

// Per-level data
for (let level = 0; level <= 5; level++) {
  const [collections, serialLocked, serials, reduction] =
    await boostManager.getBoostData(level);
  // level 0=C, 1=R, 2=SR, 3=UR, 4=LR, 5=SPE
}
```

### UX: Boost Decision Flow

Show the user:
1. Current remaining time on mission
2. Two boost options side-by-side:
   - **$LAZY Boost:** "{cost} $LAZY → saves {reduction}% of remaining time ({X} minutes)"
   - **Gem Boost:** "Stake {gem name} → saves {reduction}% ({Y} minutes). Gem returned after mission."
3. If user has eligible gems, show them with their levels and reduction percentages
4. After boosting, update the countdown timer to reflect the new `endTimestamp`

---

## 11. NFT Staking for $LAZY Rewards

This is entirely separate from missions. Users stake NFTs to passively earn $LAZY tokens.

### Staking Flow

1. **Backend generates a signed proof** containing:
   - User address
   - Boost rate (percentage bonus, e.g., 25 = 25%)
   - Stake details: which collections, serials, and reward rates per NFT
   - Nonce/validity timestamp (signature expires after 120 seconds)

2. **User calls `stake()`:**
   ```js
   await stakingContract.stake(stakesArray, rewardProof);
   ```

3. **NFTs transferred to LazyNFTStaking contract.** Each NFT earns rewards at a rate specified in the signed proof, capped by `maxBaseRate` per collection.

### Prerequisite: Signing Wallet

The staking contract requires a backend service that signs reward proofs. The signing wallet address is stored on-chain as `systemWallet`. **Without a valid signature, staking and unstaking revert.**

The frontend must:
1. Request a signature from the backend (passing desired stakes, user address)
2. Backend signs with the system wallet's private key
3. Frontend submits the signed proof to the contract
4. Signature is valid for **120 seconds** from the `validityTimestamp`

### Reward Calculation

Rewards accrue per **distribution period** (default: 86,400 seconds = 1 day):

```
dailyReward = (baseRewardRate * (100 + boostRate) * (100 + hodlBonus)) / 1,000,000
```

Where:
- `baseRewardRate` = sum of all staked NFTs' individual reward rates
- `boostRate` = percentage from signed proof (0-500, capped at `boostRateCap`)
- `hodlBonus` = increases the longer you go without claiming

### HODL Bonus

The HODL bonus rewards users for NOT claiming. It accumulates over time:

- **Period for bonus:** 30 distribution periods (default 30 days)
- **Bonus rate:** 25% per period (default)
- **Max bonus periods:** 8 (caps at 200% bonus)

```
Example progression:
- Day 0-29: 0% bonus
- Day 30-59: 25% bonus
- Day 60-89: 50% bonus
- Day 90-119: 75% bonus
...
- Day 210+: 200% bonus (capped at 8 * 25%)
```

**Critical UX point:** Claiming rewards **resets the HODL bonus to 0**. Show users their current bonus percentage and warn them before claiming: "Claiming now resets your HODL bonus from {X}% to 0%."

### Halvening / Epochs

$LAZY rewards halve as more tokens are distributed (similar to Bitcoin halvening):

- Epoch 0: Full reward rate
- Epoch 1: Half reward rate (÷2)
- Epoch 2: Quarter reward rate (÷4)

Epoch boundaries are determined by how much $LAZY has been distributed from the supply. The frontend should display the current epoch and reward rate.

### Claiming Staking Rewards

```js
const [lazyEarnt, rewardRate, asOfTimestamp, userLastClaim] =
  await stakingContract.calculateRewards(userAddress);

// lazyEarnt is in $LAZY with 1 decimal (divide by 10 for display)
// rewardRate is the current per-period rate

await stakingContract.claimRewards();
// Burns burnPercentage, pays remainder to user
```

### Unstaking

```js
// Requires new signed proof (reward rates may have changed)
await stakingContract.unstake(stakesArray, rewardProof);
// Auto-claims pending rewards, then returns NFTs
```

### Staking View Functions

```js
// What collections can be staked?
const collections = await stakingContract.getStakeableCollections();

// What has user staked?
const [stakedCollections, stakedSerials] = await stakingContract.getStakedNFTs(userAddress);

// Current reward rate
const baseRate = await stakingContract.getBaseRewardRate(userAddress);
const boostRate = await stakingContract.getActiveBoostRate(userAddress);

// Pending rewards
const [earnt, rate, timestamp, lastClaim] = await stakingContract.calculateRewards(userAddress);

// Global state
const allStakers = await stakingContract.getStakingUsers();
const stakedFromCollection = await stakingContract.getNumStakedNFTs(collectionAddress);
```

### Burn Percentage on Claims

A percentage of claimed rewards is burned (reducing $LAZY supply). The current rate is configurable:

```js
const burnPct = await stakingContract.burnPercentage();
// If burnPct = 10, user receives 90% of calculated rewards
```

Show this clearly: "You earned 100 $LAZY. After 10% burn, you'll receive 90 $LAZY."

---

## 12. NFT Delegation

Delegation allows a user (typically with a cold wallet) to let another wallet (hot wallet) use their NFTs for staking and missions without transferring ownership.

### Two Levels of Delegation

**Wallet-Level:** Delegate all NFTs from one wallet to another.
```js
await delegateRegistry.delegateWalletTo(hotWalletAddress);
// Now hotWallet can use all of coldWallet's NFTs
```

**Token-Level:** Delegate specific NFT serials.
```js
await delegateRegistry.delegateNFT(delegateAddress, collectionAddress, serialNumbers);
// Only these specific serials are delegated
```

### Checking Delegation

```js
// Wallet-level
const delegate = await delegateRegistry.getDelegateWallet(coldWalletAddress);
const isDelegate = await delegateRegistry.checkDelegateWallet(coldWallet, hotWallet);

// Token-level
const nftDelegate = await delegateRegistry.getNFTDelegatedTo(collection, serial);
const isValid = await delegateRegistry.checkNFTDelegationIsValid(collection, serial);

// All NFTs delegated to a specific wallet
const [tokens, serials] = await delegateRegistry.getNFTsDelegatedTo(hotWalletAddress);
```

### UX for Delegation

- Show a "Delegation" section in user profile
- If user has a delegate set, show which wallet
- Allow setting/revoking wallet-level delegation
- For power users, show token-level delegation management
- When entering missions or staking, check if user owns NFTs directly OR has delegated NFTs available

---

## 13. Dutch Auction (Decreasing Entry Fee)

Some missions use a Dutch auction pricing model where the entry fee starts high and decreases over time.

### How It Works

```
currentFee = max(baseFee - (elapsed / decrementInterval) * decrementAmount, minFee)
```

- `baseFee`: Initial entry fee
- `decrementInterval`: Time in seconds between each price drop
- `decrementAmount`: How much the fee drops each interval
- `minFee`: Floor price (fee never goes below this)

### Reading Auction State

```js
const currentFee = await mission.entryFee(); // already accounts for Dutch auction
const [decrementInterval, startTimestamp] = await mission.getDecrementDetails();
```

### UX for Dutch Auction

If `decrementInterval > 0`, show:
1. Current fee (updates in real-time as price drops)
2. Next price drop countdown: `decrementInterval - (now - startTimestamp) % decrementInterval`
3. Floor price: "Minimum entry fee: {minFee} $LAZY"
4. Visual price curve showing remaining drops

---

## 14. Error Reference

### Mission Errors

| Error/Require | Cause | UX Response |
|---------------|-------|-------------|
| `"Mission paused"` | Mission is paused by admin | Show "Mission temporarily paused" |
| `"No more slots available"` | All slots taken | Show "Mission full" |
| `"Mission not open yet"` | Before `startTimestamp` | Show countdown to open |
| `"Mission closed"` | After `lastEntryTimestamp` | Show "Entry period ended" |
| `"Already joined"` | User already in mission | Show current participation |
| `"Collection not included"` | Wrong NFT collection | Show required collections |
| `"Serials not authorized"` | Wrong serial numbers | Show allowed serials |
| `"Invalid requirement number"` | Wrong number of NFTs staked | Show required count |
| `UsersOnMission()` | Admin action blocked by active users | Show participant count |

### Token/Transfer Errors

| Error | Cause | UX Response |
|-------|-------|-------------|
| `InsufficientAllowance()` | $LAZY not approved to LazyGasStation | Prompt approve |
| `NFTTransferFailed(direction)` | NFT not approved or not owned | Check ownership & approval |
| `AssociationFailed()` | HTS token not associated | Prompt token association |
| `Empty(required, available)` | LazyGasStation has insufficient balance | System issue — notify admin |

### Boost Errors

| Error | Cause | UX Response |
|-------|-------|-------------|
| `InvalidArguments()` | Bad boost parameters | Check gem ownership |
| `"Collection not authorized"` | Gem not registered | Show valid gem collections |
| Active boost already exists | One boost per mission | Show current boost status |
| User not on mission | Must enter first | Show "Enter mission first" |

### Staking Errors

| Error | Cause | UX Response |
|-------|-------|-------------|
| `RateCapExceeded(value, cap)` | Reward rate too high | Backend error — contact support |
| Signature expired (120s) | Proof too old | Re-request signature |
| Invalid signer | Wrong system wallet | Backend configuration error |

---

## 15. Complete Allowance Quick-Reference Table

| User Action | Token Type | Approved To | Amount | Check Function |
|-------------|-----------|-------------|--------|----------------|
| Enter Mission | $LAZY (FT) | LazyGasStation | `mission.entryFee()` | `lazyToken.allowance(user, LGS)` |
| Enter Mission | Requirement NFTs | Mission clone | N/A (all serials) | `nft.isApprovedForAll(user, mission)` |
| Boost with $LAZY | $LAZY (FT) | LazyGasStation | `boostManager.lazyBoostCost()` | `lazyToken.allowance(user, LGS)` |
| Boost with Gem | Gem NFT | BoostManager | N/A (specific serial) | `nft.isApprovedForAll(user, BM)` |
| Stake NFTs | Staking NFTs | LazyNFTStaking | N/A (all serials) | `nft.isApprovedForAll(user, staking)` |

---

## 16. Mirror Node Queries

On Hedera, the Mirror Node REST API is the primary way to read historical data, token balances, associations, and NFT ownership without making EVM calls.

### Base URLs
- Mainnet: `https://mainnet.mirrornode.hedera.com`
- Testnet: `https://testnet.mirrornode.hedera.com`

### Common Queries

**Check token association:**
```
GET /api/v1/accounts/{accountId}/tokens?token.id={tokenId}
```
Returns empty if not associated.

**Get NFTs owned by account:**
```
GET /api/v1/accounts/{accountId}/nfts?token.id={collectionId}
```

**Get token balance:**
```
GET /api/v1/accounts/{accountId}/tokens?token.id={lazyTokenId}
```

**Get contract events/logs:**
```
GET /api/v1/contracts/{contractId}/results/logs?order=desc&limit=100
```

**Get NFT metadata:**
```
GET /api/v1/tokens/{tokenId}/nfts/{serial}
```

---

## 17. UX State Machine Summary

### Mission Participant States

```
[NOT PARTICIPATING]
    │
    ├── enterMission() ──→ [ON MISSION - ACTIVE]
    │                           │
    │                           ├── (timer expires) ──→ [READY TO CLAIM]
    │                           │                           │
    │                           │                           └── claimRewards() ──→ [NOT PARTICIPATING]
    │                           │
    │                           ├── boostWithLazy() ──→ [ON MISSION - BOOSTED]
    │                           │                           │
    │                           │                           ├── (timer expires) ──→ [READY TO CLAIM]
    │                           │                           │
    │                           │                           └── leaveMission() ──→ [NOT PARTICIPATING]
    │                           │
    │                           ├── boostWithGemCards() ──→ [ON MISSION - BOOSTED]
    │                           │
    │                           └── leaveMission() ──→ [NOT PARTICIPATING]
    │
    └── (mission full / paused / closed) ──→ [CANNOT ENTER]
```

### Mission Lifecycle States

```
[DEPLOYED]
    │
    ├── (before startTimestamp) ──→ [NOT YET OPEN]
    │
    ├── (after startTimestamp, before lastEntryTimestamp) ──→ [OPEN FOR ENTRIES]
    │       │
    │       ├── (slots > 0) ──→ [ACCEPTING ENTRIES]
    │       └── (slots == 0) ──→ [FULL]
    │
    ├── (after lastEntryTimestamp) ──→ [ENTRY CLOSED]
    │       └── (existing participants still complete normally)
    │
    └── closeMission() ──→ [CLOSED] (removed from factory)
```

### NFT Staking States

```
[NOT STAKING]
    │
    ├── stake() ──→ [STAKING]
    │                 │
    │                 ├── (rewards accrue daily)
    │                 │
    │                 ├── claimRewards() ──→ [STAKING] (HODL bonus resets)
    │                 │
    │                 ├── stake() ──→ [STAKING] (add more NFTs, auto-claims)
    │                 │
    │                 └── unstake() ──→ [STAKING or NOT STAKING] (auto-claims, returns NFTs)
```

---

## Appendix: Key Numeric Constants

| Constant | Value | Context |
|----------|-------|---------|
| $LAZY decimals | 1 | Divide raw amounts by 10 for display |
| Max NFTs per HTS tx | 8 | Contract batches automatically, but UI should be aware |
| Signature validity | 120 seconds | Backend proof expiry window |
| Distribution period | 86,400 seconds | 1 day for staking rewards |
| HODL bonus rate | 25% | Per 30-day period |
| Max HODL periods | 8 | 200% max bonus |
| Boost rate cap | 500 | Max boost in staking proofs |
| Default gem reductions | C:5%, R:10%, SR:15%, UR:25%, LR:40%, SPE:20% | Configurable |
| BoostManager burn % | 25% | Of $LAZY boost cost |
