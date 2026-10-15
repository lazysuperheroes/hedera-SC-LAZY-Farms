/**
 * Staking Helper Functions
 * Handles stake object creation and reward proof generation
 */

import { solidityPackedKeccak256, getBytes, Wallet } from 'ethers';
import type { AccountId, PrivateKey } from '@hashgraph/sdk';
import type { Stake, RewardProof } from '../types';

/**
 * Create a Stake object for staking operations
 * @param collection - Token collection address (Hedera or EVM format)
 * @param serials - Serial numbers to stake
 * @param rewards - Reward rates for each serial
 * @returns Stake object with normalized collection address
 */
export function createStake(
  collection: string,
  serials: number[],
  rewards: number[]
): Stake {
  // Normalize collection address to EVM format with 0x prefix
  let normalizedCollection = collection;

  // If it's a Hedera ID (0.0.xxxxx), we need to convert it
  if (collection.includes('.')) {
    // This would need the actual conversion - for now assume EVM format
    throw new Error(
      'Collection must be in EVM address format. Use toSolidityAddress() to convert from Hedera ID.'
    );
  }

  // Ensure 0x prefix
  if (!normalizedCollection.startsWith('0x')) {
    normalizedCollection = '0x' + normalizedCollection;
  }

  if (serials.length !== rewards.length) {
    throw new Error(
      `Serials length (${serials.length}) must match rewards length (${rewards.length})`
    );
  }

  return {
    collection: normalizedCollection,
    serials,
    rewards,
  };
}

/** Per-collection on-chain rate caps (`getMaxBaseRate`), keyed by collection EVM address. */
export type MaxBaseRates = Record<string, number>;

const capFor = (maxBaseRates: MaxBaseRates | undefined, collection: string): number | undefined => {
  if (!maxBaseRates) return undefined;
  const key = Object.keys(maxBaseRates).find((k) => k.toLowerCase() === collection.toLowerCase());
  return key === undefined ? undefined : maxBaseRates[key];
};

/**
 * Throws unless every entry is in canonical signing layout: in each entry,
 * every serial after the first must be greater than
 * max(the collection's on-chain maxBaseRate, every rate in the entry).
 * Single-serial entries always qualify. Multi-serial entries need the cap.
 * Build compliant entries with `layoutStakesForSigning`.
 */
export function assertStakesSigningLayout(stakes: Stake[], maxBaseRates?: MaxBaseRates): void {
  for (const stake of stakes) {
    if (stake.serials.length <= 1) continue;
    const cap = capFor(maxBaseRates, stake.collection);
    if (cap === undefined) {
      throw new Error(
        `Stake entry for ${stake.collection} has ${stake.serials.length} serials but no maxBaseRate was supplied. ` +
          'Lay stakes out with layoutStakesForSigning() before signing.'
      );
    }
    const threshold = Math.max(cap, ...stake.rewards);
    for (let i = 1; i < stake.serials.length; i++) {
      if (!(stake.serials[i] > threshold)) {
        throw new Error(
          `Stake entry for ${stake.collection} is not in signing layout (serial ${stake.serials[i]} at position ${i} ` +
            `must exceed ${threshold}). Lay stakes out with layoutStakesForSigning() before signing.`
        );
      }
    }
  }
}

/**
 * Lay stakes out for signing. Serials are merged per collection; serials at or
 * below max(maxBaseRate, rates) each lead their own entry, and larger serials
 * follow the first entry. Without a cap for a collection, every serial gets
 * its own entry. Submit the returned array to stake()/unstake() exactly as
 * signed.
 *
 * @param stakes - requested stakes (any grouping)
 * @param maxBaseRates - on-chain `getMaxBaseRate(collection)` per collection
 */
export function layoutStakesForSigning(stakes: Stake[], maxBaseRates?: MaxBaseRates): Stake[] {
  const byCollection = new Map<string, { collection: string; pairs: { serial: number; reward: number }[] }>();
  for (const stake of stakes) {
    validateStake(stake);
    const key = stake.collection.toLowerCase();
    const group = byCollection.get(key) ?? { collection: stake.collection, pairs: [] };
    stake.serials.forEach((serial, i) => {
      if (group.pairs.some((p) => p.serial === serial)) {
        throw new Error(`Duplicate serial ${serial} for ${stake.collection}`);
      }
      group.pairs.push({ serial, reward: stake.rewards[i] });
    });
    byCollection.set(key, group);
  }

  const result: Stake[] = [];
  for (const { collection, pairs } of byCollection.values()) {
    const cap = capFor(maxBaseRates, collection);
    if (cap === undefined) {
      pairs.forEach((p) => result.push({ collection, serials: [p.serial], rewards: [p.reward] }));
      continue;
    }
    const threshold = Math.max(cap, ...pairs.map((p) => p.reward));
    const small = pairs.filter((p) => p.serial <= threshold);
    const big = pairs.filter((p) => p.serial > threshold);
    const groups = small.length > 0 ? small.map((p) => [p]) : [[] as { serial: number; reward: number }[]];
    groups[0].push(...big);
    groups.forEach((g) =>
      result.push({ collection, serials: g.map((p) => p.serial), rewards: g.map((p) => p.reward) })
    );
  }
  assertStakesSigningLayout(result, maxBaseRates);
  return result;
}

export interface StakingProofOptions {
  /** On-chain caps, needed to sign multi-serial entries */
  maxBaseRates?: MaxBaseRates;
  /**
   * Skip the layout check. Only for signing for your own account (e.g. tests);
   * never when signing on behalf of other users.
   */
  allowUnsafeLayout?: boolean;
}

/**
 * Generate a staking reward proof
 * Signs the staking parameters to create a valid proof for the contract
 *
 * The stakes must be in signing layout (see `layoutStakesForSigning`) and must
 * be submitted to stake()/unstake() exactly as signed.
 *
 * @param sender - The account performing the stake (AccountId or EVM address).
 *   For an ECDSA account with an EVM alias, pass the alias address: the
 *   contract binds msg.sender, which for those accounts is the alias.
 * @param boostRate - Boost rate multiplier
 * @param signingKey - ECDSA private key for signing
 * @param stakes - Array of stake objects, in signing layout
 * @param options - caps for multi-serial entries; see StakingProofOptions
 * @returns Signed reward proof
 */
export async function generateStakingRewardProof(
  sender: AccountId | string,
  boostRate: number,
  signingKey: PrivateKey,
  stakes: Stake[],
  options: StakingProofOptions = {}
): Promise<RewardProof> {
  if (!options.allowUnsafeLayout) {
    assertStakesSigningLayout(stakes, options.maxBaseRates);
  }
  const currentTimestamp = Math.floor(Date.now() / 1000);

  // Convert sender to EVM address
  let senderEVM: string;
  if (typeof sender === 'string') {
    senderEVM = sender.startsWith('0x') ? sender : '0x' + sender;
  } else {
    // AccountId object - use toSolidityAddress()
    senderEVM = '0x' + sender.toSolidityAddress();
  }

  // Get raw private key for ethers Wallet
  const rawKey = signingKey.toStringRaw();
  const signer = new Wallet(`0x${rawKey}`);

  // Encode each stake as bytes32
  const bytes32EncodedStakes: string[] = [];
  for (const stake of stakes) {
    const encodedStake = solidityPackedKeccak256(
      ['address', 'uint256[]', 'uint256[]'],
      [stake.collection, stake.serials, stake.rewards]
    );
    bytes32EncodedStakes.push(encodedStake);
  }

  // Hash everything together
  const hash = solidityPackedKeccak256(
    ['address', 'uint256', 'bytes32[]', 'uint256'],
    [senderEVM, boostRate, bytes32EncodedStakes, currentTimestamp]
  );

  // Sign the hash
  const signature = await signer.signMessage(getBytes(hash));

  return {
    boostRate,
    validityTimestamp: currentTimestamp,
    signature,
  };
}

/**
 * Validate a stake object
 * @param stake - Stake to validate
 * @throws Error if stake is invalid
 */
export function validateStake(stake: Stake): void {
  if (!stake.collection || !stake.collection.startsWith('0x')) {
    throw new Error('Invalid collection address: must be EVM format with 0x prefix');
  }

  if (stake.collection.length !== 42) {
    throw new Error('Invalid collection address: must be 40 hex characters plus 0x prefix');
  }

  if (!Array.isArray(stake.serials) || stake.serials.length === 0) {
    throw new Error('Serials must be a non-empty array');
  }

  if (!Array.isArray(stake.rewards) || stake.rewards.length === 0) {
    throw new Error('Rewards must be a non-empty array');
  }

  if (stake.serials.length !== stake.rewards.length) {
    throw new Error(
      `Serials length (${stake.serials.length}) must match rewards length (${stake.rewards.length})`
    );
  }

  for (const serial of stake.serials) {
    if (!Number.isInteger(serial) || serial < 1) {
      throw new Error(`Invalid serial number: ${serial}`);
    }
  }

  for (const reward of stake.rewards) {
    if (!Number.isInteger(reward) || reward < 0) {
      throw new Error(`Invalid reward rate: ${reward}`);
    }
  }
}

/**
 * Calculate total NFTs being staked
 * @param stakes - Array of stakes
 * @returns Total count of NFTs
 */
export function countTotalNFTs(stakes: Stake[]): number {
  return stakes.reduce((total, stake) => total + stake.serials.length, 0);
}
