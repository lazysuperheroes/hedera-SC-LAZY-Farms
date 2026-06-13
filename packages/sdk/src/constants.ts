/**
 * SDK Constants
 * Named constants for gas limits, delays, and common values
 */

/**
 * Gas limits for contract operations
 */
export const GAS = {
  /** Default gas for simple queries */
  QUERY: 100_000,

  /** Standard gas for simple calls */
  STANDARD: 200_000,

  /** Mission entry */
  MISSION_ENTER: 2_000_000,

  /** Mission exit */
  MISSION_LEAVE: 1_500_000,

  /** Mission claim */
  MISSION_CLAIM: 1_500_000,

  /** Base gas for staking */
  STAKE_BASE: 400_000,

  /** Additional gas per token when staking */
  STAKE_PER_TOKEN: 400_000,

  /** NFT transfer operations */
  NFT_TRANSFER: 300_000,

  /** Admin operations */
  ADMIN_CALL: 300_000,

  /** Boost activation */
  BOOST_ACTIVATE: 500_000,

  /** Mission deployment */
  MISSION_DEPLOY: 5_000_000,
} as const;

/**
 * Calculate gas for staking operations
 * @param tokenCount - Number of tokens being staked
 * @returns Calculated gas limit
 */
export function calculateStakeGas(tokenCount: number): number {
  return GAS.STAKE_BASE + tokenCount * GAS.STAKE_PER_TOKEN;
}

/**
 * Delay times in milliseconds
 */
export const DELAYS = {
  /** Mirror node propagation delay */
  MIRROR_NODE: 5000,

  /** Short polling interval */
  SHORT_POLL: 1000,

  /** Long polling interval */
  LONG_POLL: 10000,
} as const;

/**
 * Token decimals
 */
export const DECIMALS = {
  /** $LAZY has 1 decimal */
  LAZY: 1,

  /** HBAR has 8 decimals (tinybars) */
  HBAR: 8,

  /** NFTs have 0 decimals */
  NFT: 0,
} as const;

/**
 * Percentage bases
 */
export const PERCENTAGE = {
  /** Basis points (100% = 10000) */
  BASIS_POINTS: 10000,

  /** Simple percentage (100% = 100) */
  SIMPLE: 100,
} as const;

/**
 * Time constants in seconds
 */
export const TIME = {
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  WEEK: 604800,
} as const;

/**
 * Mainnet contract addresses
 */
export const MAINNET_CONTRACTS = {
  /** $LAZY Token */
  LAZY_TOKEN: '0.0.1311037',

  /** LAZYTokenCreator (SCT) */
  LAZY_SCT: '0.0.1311003',

  /** LazyGasStation */
  GAS_STATION: '0.0.7221483',

  /** LazyDelegateRegistry */
  DELEGATE_REGISTRY: '0.0.7221486',

  /** LazyNFTStaking */
  NFT_STAKING: '0.0.7221488',

  /** MissionFactory */
  MISSION_FACTORY: '0.0.8257122',

  /** Mission Template */
  MISSION_TEMPLATE: '0.0.8257118',

  /** BoostManager */
  BOOST_MANAGER: '0.0.8257105',

  /** PRNG (redeployed 2026-06-13 with inclusive-max fix; factory repointed via updatePrngContract) */
  PRNG: '0.0.10583667',

  /** Gems boost NFT collection — single serial-locked token; serial -> level via BoostManager.getBoostLevel */
  GEM_TOKEN: '0.0.10580248',
} as const;

/**
 * Gem level mappings
 */
export const GEM_LEVELS = {
  C: 0,
  R: 1,
  SR: 2,
  UR: 3,
  LR: 4,
  SPE: 5,
} as const;

export const GEM_LEVEL_NAMES = ['C', 'R', 'SR', 'UR', 'LR', 'SPE'] as const;

/**
 * Convert gem rank number to level name
 */
export function lookupGemLevel(rank: number): string {
  return GEM_LEVEL_NAMES[rank] ?? String(rank);
}

/**
 * Convert gem level name to rank number
 */
export function getGemLevel(levelName: string): number {
  const upper = levelName.toUpperCase();
  const level = GEM_LEVELS[upper as keyof typeof GEM_LEVELS];
  return level ?? parseInt(levelName, 10);
}

/**
 * Mirror node REST base URLs by environment
 */
export const MIRROR_NODE_URLS = {
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
  local: 'http://127.0.0.1:5551',
} as const;

/**
 * Boost % reduction by gem level index (C, R, SR, UR, LR, SPE)
 */
export const GEM_LEVEL_REDUCTIONS = [5, 10, 15, 25, 40, 20] as const;

/**
 * Gem serial -> boost level ranges (inclusive). Mirrors the on-chain BoostManager
 * config for GEM_TOKEN; for authoritative checks call BoostManager.getBoostLevel.
 */
export const GEM_SERIAL_RANGES: Record<number, ReadonlyArray<readonly [number, number]>> = {
  0: [[421, 1170], [1531, 2280], [2431, 2920], [3481, 3490]], // C
  1: [[1231, 1530], [2281, 2430], [3071, 3370]],              // R
  2: [[61, 210], [271, 420], [2921, 3070]],                   // SR
  3: [[1, 60], [211, 270], [1171, 1230]],                     // UR
  4: [[3371, 3380]],                                          // LR
  5: [[3381, 3480]],                                          // SPE
};

/**
 * Resolve a gem serial to its boost level index (0-5), or -1 if not in any range.
 */
export function gemLevelForSerial(serial: number): number {
  for (let lvl = 0; lvl < 6; lvl++) {
    for (const [a, b] of GEM_SERIAL_RANGES[lvl]) {
      if (serial >= a && serial <= b) return lvl;
    }
  }
  return -1;
}
