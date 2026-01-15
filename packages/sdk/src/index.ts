/**
 * @lazysuperheroes/farming-sdk
 *
 * TypeScript SDK for Lazy Superheroes NFT farming and staking on Hedera
 *
 * @example
 * ```typescript
 * import { createMainnetClient } from '@lazysuperheroes/farming-sdk';
 *
 * const client = createMainnetClient(
 *   '0.0.123456',  // operator account
 *   'your-private-key'
 * );
 *
 * // Get staking info
 * const info = await client.getStakingInfo();
 * console.log(`Total staked: ${info.totalStaked}`);
 *
 * // Get mission info
 * const mission = await client.getMissionInfo('0.0.789012');
 * console.log(`Mission: ${mission.name}`);
 * ```
 */

// Main client
export { createClient, createMainnetClient, LazyFarmingSDK } from './client';

// Types
export type {
  // Config types
  SDKConfig,
  NetworkEnvironment,
  ContractAddresses,

  // Staking types
  Stake,
  RewardProof,
  StakedNFT,
  StakeableCollection,
  StakingInfo,

  // Mission types
  MissionStatus,
  MissionRequirement,
  MissionReward,
  MissionInfo,
  UserMissionState,

  // Boost types
  BoostType,
  GemBoostConfig,
  LazyBoostConfig,
  ActiveBoost,

  // Delegation types
  Delegation,

  // Result types
  TransactionResult,
} from './types';

// Constants
export {
  GAS,
  calculateStakeGas,
  DELAYS,
  DECIMALS,
  PERCENTAGE,
  TIME,
  MAINNET_CONTRACTS,
  GEM_LEVELS,
  GEM_LEVEL_NAMES,
  lookupGemLevel,
  getGemLevel,
} from './constants';

// Helper functions
export {
  // Staking helpers
  createStake,
  generateStakingRewardProof,
  validateStake,
  countTotalNFTs,

  // Farming helpers
  lookupLevel,
  getLevel,
  determineMissionStatus,
  calculateTimeRemaining,
  canClaimRewards,
  formatDuration,
  calculateBoostCost,
  calculateBoostedDuration,
} from './helpers';
