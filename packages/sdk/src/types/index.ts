/**
 * TypeScript types for the Lazy Farming SDK
 */

import type { Client, AccountId, ContractId, TokenId, PrivateKey } from '@hashgraph/sdk';

// ============================================================
// Environment & Configuration Types
// ============================================================

export type NetworkEnvironment = 'mainnet' | 'testnet' | 'previewnet' | 'local';

export interface SDKConfig {
  /** Hedera network environment */
  environment: NetworkEnvironment;
  /** Operator account ID */
  operatorId: AccountId | string;
  /** Operator private key (ED25519) */
  operatorKey: PrivateKey | string;
  /** Optional signing key for staking operations (ECDSA) */
  signingKey?: PrivateKey | string;
}

export interface ContractAddresses {
  /** $LAZY fungible token */
  lazyToken?: TokenId | string;
  /** LazyNFTStaking contract */
  lazyNftStaking?: ContractId | string;
  /** MissionFactory contract */
  missionFactory?: ContractId | string;
  /** BoostManager contract */
  boostManager?: ContractId | string;
  /** LazyGasStation contract */
  lazyGasStation?: ContractId | string;
  /** LazyDelegateRegistry contract */
  delegateRegistry?: ContractId | string;
}

// ============================================================
// Staking Types
// ============================================================

export interface Stake {
  /** Token collection address (EVM format with 0x prefix) */
  collection: string;
  /** Serial numbers to stake */
  serials: number[];
  /** Reward rates for each serial (must match serials length) */
  rewards: number[];
}

export interface RewardProof {
  /** Boost rate multiplier */
  boostRate: number;
  /** Unix timestamp after which proof is invalid */
  validityTimestamp: number;
  /** ECDSA signature of the proof */
  signature: string;
}

export interface StakedNFT {
  /** Token collection ID */
  collection: string;
  /** Serial number */
  serial: number;
  /** Staker address */
  staker: string;
  /** Stake timestamp */
  stakedAt: number;
  /** Base reward rate */
  rewardRate: number;
  /** Current boost rate */
  boostRate: number;
}

export interface StakeableCollection {
  /** Collection token ID */
  tokenId: string;
  /** Maximum base reward rate allowed */
  maxRewardRate: number;
  /** Whether collection is currently active */
  isActive: boolean;
}

export interface StakingInfo {
  /** Total NFTs currently staked */
  totalStaked: number;
  /** Total $LAZY distributed */
  totalDistributed: bigint;
  /** Current distribution period (seconds) */
  distributionPeriod: number;
  /** Burn percentage on claims (basis points) */
  burnPercentage: number;
  /** HODL bonus rate */
  hodlBonusRate: number;
  /** Period required for HODL bonus (days) */
  periodForBonus: number;
  /** Maximum bonus periods */
  maxBonusPeriods: number;
  /** Boost rate cap */
  boostRateCap: number;
}

// ============================================================
// Mission/Farming Types
// ============================================================

export type MissionStatus = 'pending' | 'active' | 'completed' | 'closed';

export interface MissionRequirement {
  /** Required collection token ID */
  collection: string;
  /** Specific serials required (empty = any serial) */
  requiredSerials: number[];
  /** Minimum number of NFTs required */
  minCount: number;
}

export interface MissionReward {
  /** Reward collection token ID */
  collection: string;
  /** Available reward serials */
  availableSerials: number[];
  /** Probability weight */
  weight: number;
}

export interface MissionInfo {
  /** Mission contract address */
  address: string;
  /** Mission name */
  name: string;
  /** Mission description */
  description: string;
  /** Current status */
  status: MissionStatus;
  /** Mission duration in seconds */
  duration: number;
  /** Start timestamp */
  startTime: number;
  /** End timestamp (0 = no end) */
  endTime: number;
  /** Entry fee in $LAZY (0 = free) */
  entryFee: bigint;
  /** Maximum participants */
  maxParticipants: number;
  /** Current participant count */
  currentParticipants: number;
  /** Available slots */
  slotsAvailable: number;
  /** Requirements to enter */
  requirements: MissionRequirement[];
  /** Available rewards */
  rewards: MissionReward[];
  /** Whether mission is paused */
  isPaused: boolean;
}

export interface UserMissionState {
  /** Whether user is in the mission */
  isParticipating: boolean;
  /** Entry timestamp */
  entryTime: number;
  /** Expected completion timestamp */
  completionTime: number;
  /** Whether user can claim rewards */
  canClaim: boolean;
  /** Active boost percentage (0-100) */
  boostPercentage: number;
  /** NFTs committed to mission */
  committedNFTs: { collection: string; serial: number }[];
}

// ============================================================
// Boost Types
// ============================================================

export type BoostType = 'gem' | 'lazy';

export interface GemBoostConfig {
  /** Gem level (0-5) */
  level: number;
  /** Level name (C, R, SR, UR, LR, SPE) */
  levelName: string;
  /** Boost percentage */
  boostPercentage: number;
  /** Eligible collections for this level */
  eligibleCollections: string[];
}

export interface LazyBoostConfig {
  /** $LAZY cost per boost percentage point */
  costPerPercent: bigint;
  /** Maximum boost percentage */
  maxBoostPercent: number;
  /** Burn percentage of $LAZY spent */
  burnPercent: number;
}

export interface ActiveBoost {
  /** Boost type */
  type: BoostType;
  /** Mission address */
  mission: string;
  /** User address */
  user: string;
  /** Boost percentage */
  percentage: number;
  /** Activation timestamp */
  activatedAt: number;
}

// ============================================================
// Delegation Types
// ============================================================

export interface Delegation {
  /** Token collection */
  collection: string;
  /** Serial number */
  serial: number;
  /** Owner address */
  owner: string;
  /** Delegate address */
  delegate: string;
  /** Delegation timestamp */
  delegatedAt: number;
}

// ============================================================
// Transaction Result Types
// ============================================================

export interface TransactionResult<T = unknown> {
  /** Whether transaction succeeded */
  success: boolean;
  /** Transaction ID */
  transactionId: string;
  /** Decoded result data */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Gas used */
  gasUsed?: number;
}

// ============================================================
// Client Types
// ============================================================

export interface LazyFarmingClient {
  /** Underlying Hedera client */
  readonly client: Client;
  /** Operator account ID */
  readonly operatorId: AccountId;
  /** Network environment */
  readonly environment: NetworkEnvironment;

  // Staking operations
  staking: StakingOperations;

  // Mission operations
  missions: MissionOperations;

  // Boost operations
  boosts: BoostOperations;

  // Delegation operations
  delegation: DelegationOperations;
}

export interface StakingOperations {
  /** Get staking contract info */
  getInfo(contractId: ContractId | string): Promise<StakingInfo>;

  /** Get stakeable collections */
  getStakeableCollections(contractId: ContractId | string): Promise<StakeableCollection[]>;

  /** Get staked NFTs for a user */
  getStakedNFTs(contractId: ContractId | string, user: AccountId | string): Promise<StakedNFT[]>;

  /** Stake NFTs */
  stake(
    contractId: ContractId | string,
    stakes: Stake[],
    rewardProof: RewardProof
  ): Promise<TransactionResult>;

  /** Unstake NFTs */
  unstake(
    contractId: ContractId | string,
    stakes: Stake[],
    rewardProof: RewardProof
  ): Promise<TransactionResult>;

  /** Claim staking rewards */
  claimRewards(contractId: ContractId | string): Promise<TransactionResult<bigint>>;

  /** Generate reward proof for staking */
  generateRewardProof(
    sender: AccountId | string,
    boostRate: number,
    signingKey: PrivateKey,
    stakes: Stake[]
  ): Promise<RewardProof>;
}

export interface MissionOperations {
  /** Get mission info */
  getInfo(missionId: ContractId | string): Promise<MissionInfo>;

  /** Get user's state in a mission */
  getUserState(
    missionId: ContractId | string,
    user: AccountId | string
  ): Promise<UserMissionState>;

  /** Enter a mission */
  enter(
    missionId: ContractId | string,
    collection: TokenId | string,
    serials: number[]
  ): Promise<TransactionResult>;

  /** Leave a mission (forfeit rewards) */
  leave(missionId: ContractId | string): Promise<TransactionResult>;

  /** Claim mission rewards */
  claim(missionId: ContractId | string): Promise<TransactionResult>;
}

export interface BoostOperations {
  /** Get boost manager info */
  getInfo(boostManagerId: ContractId | string): Promise<{
    gemConfig: GemBoostConfig[];
    lazyConfig: LazyBoostConfig;
  }>;

  /** Boost mission with gem NFT */
  boostWithGem(
    boostManagerId: ContractId | string,
    missionId: ContractId | string,
    gemCollection: TokenId | string,
    gemSerial: number
  ): Promise<TransactionResult>;

  /** Boost mission with $LAZY */
  boostWithLazy(
    boostManagerId: ContractId | string,
    missionId: ContractId | string,
    lazyAmount: bigint
  ): Promise<TransactionResult>;

  /** Get user's active boosts */
  getActiveBoosts(
    boostManagerId: ContractId | string,
    user: AccountId | string
  ): Promise<ActiveBoost[]>;
}

export interface DelegationOperations {
  /** Delegate an NFT */
  delegate(
    registryId: ContractId | string,
    collection: TokenId | string,
    serial: number,
    delegateTo: AccountId | string
  ): Promise<TransactionResult>;

  /** Revoke delegation */
  revoke(
    registryId: ContractId | string,
    collection: TokenId | string,
    serial: number
  ): Promise<TransactionResult>;

  /** Check delegation status */
  getDelegation(
    registryId: ContractId | string,
    collection: TokenId | string,
    serial: number
  ): Promise<Delegation | null>;
}
