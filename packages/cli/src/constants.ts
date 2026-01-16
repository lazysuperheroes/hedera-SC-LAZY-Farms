/**
 * CLI Constants
 */

/**
 * Mirror node base URLs
 */
export const MIRROR_URLS = {
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
} as const;

export type Network = keyof typeof MIRROR_URLS;

/**
 * Mainnet contract addresses
 */
export const MAINNET_CONTRACTS = {
  LAZY_TOKEN: '0.0.1311037',
  LAZY_SCT: '0.0.1311003',
  GAS_STATION: '0.0.7221483',
  DELEGATE_REGISTRY: '0.0.7221486',
  NFT_STAKING: '0.0.7221488',
  MISSION_FACTORY: '0.0.8257122',
  MISSION_TEMPLATE: '0.0.8257118',
  BOOST_MANAGER: '0.0.8257105',
  PRNG: '0.0.8257116',
} as const;

/**
 * Testnet contract addresses (placeholder - update when deployed)
 */
export const TESTNET_CONTRACTS = {
  LAZY_TOKEN: '',
  LAZY_SCT: '',
  GAS_STATION: '',
  DELEGATE_REGISTRY: '',
  NFT_STAKING: '',
  MISSION_FACTORY: '',
  MISSION_TEMPLATE: '',
  BOOST_MANAGER: '',
  PRNG: '',
} as const;

export function getContracts(network: Network) {
  return network === 'mainnet' ? MAINNET_CONTRACTS : TESTNET_CONTRACTS;
}

/**
 * Token decimals
 */
export const DECIMALS = {
  LAZY: 1,
  HBAR: 8,
} as const;

/**
 * Gem level names
 */
export const GEM_LEVEL_NAMES = ['C', 'R', 'SR', 'UR', 'LR', 'SPE'] as const;

/**
 * Convert gem rank number to level name
 */
export function lookupGemLevel(rank: number): string {
  return GEM_LEVEL_NAMES[rank] ?? String(rank);
}
