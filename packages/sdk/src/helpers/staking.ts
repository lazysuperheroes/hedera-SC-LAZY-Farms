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

/**
 * Generate a staking reward proof
 * Signs the staking parameters to create a valid proof for the contract
 *
 * @param sender - The account performing the stake (AccountId or EVM address)
 * @param boostRate - Boost rate multiplier
 * @param signingKey - ECDSA private key for signing
 * @param stakes - Array of stake objects
 * @returns Signed reward proof
 */
export async function generateStakingRewardProof(
  sender: AccountId | string,
  boostRate: number,
  signingKey: PrivateKey,
  stakes: Stake[]
): Promise<RewardProof> {
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
