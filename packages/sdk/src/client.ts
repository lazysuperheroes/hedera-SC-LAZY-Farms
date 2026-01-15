/**
 * Lazy Farming SDK Client
 * Main entry point for interacting with the LAZY farming contracts
 */

import {
  Client,
  AccountId,
  ContractId,
  TokenId,
  PrivateKey,
  ContractCallQuery,
  ContractExecuteTransaction,
} from '@hashgraph/sdk';
import { Interface } from 'ethers';
import type {
  SDKConfig,
  NetworkEnvironment,
  ContractAddresses,
  StakingInfo,
  StakeableCollection,
  Stake,
  RewardProof,
  TransactionResult,
  MissionInfo,
} from './types';
import { GAS, calculateStakeGas, MAINNET_CONTRACTS } from './constants';
import { generateStakingRewardProof, validateStake } from './helpers/staking';

// ABI imports - loaded at runtime to avoid bundling issues
/* eslint-disable @typescript-eslint/no-var-requires */
const LazyNFTStakingABI = require('../abi/LazyNFTStaking.json');
const MissionABI = require('../abi/Mission.json');
const MissionFactoryABI = require('../abi/MissionFactory.json');
const BoostManagerABI = require('../abi/BoostManager.json');
const LazyDelegateRegistryABI = require('../abi/LazyDelegateRegistry.json');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Create a Lazy Farming SDK client
 * @param config - SDK configuration
 * @returns Configured SDK client
 */
export function createClient(config: SDKConfig): LazyFarmingSDK {
  return new LazyFarmingSDK(config);
}

/**
 * Create a client for mainnet with default contract addresses
 * @param operatorId - Operator account ID
 * @param operatorKey - Operator private key
 * @param signingKey - Optional ECDSA signing key for staking
 * @returns Configured SDK client for mainnet
 */
export function createMainnetClient(
  operatorId: AccountId | string,
  operatorKey: PrivateKey | string,
  signingKey?: PrivateKey | string
): LazyFarmingSDK {
  return new LazyFarmingSDK({
    environment: 'mainnet',
    operatorId,
    operatorKey,
    signingKey,
  });
}

/**
 * Main SDK class
 */
export class LazyFarmingSDK {
  private readonly _client: Client;
  private readonly _operatorId: AccountId;
  private readonly _operatorKey: PrivateKey;
  private readonly _signingKey: PrivateKey | null;
  private readonly _environment: NetworkEnvironment;

  // Contract interfaces
  private readonly _stakingIface: Interface;
  private readonly _missionIface: Interface;
  private readonly _boostIface: Interface;
  private readonly _delegateIface: Interface;

  /** Factory interface - exposed for advanced usage */
  public readonly factoryIface: Interface;

  // Default contract addresses (mainnet)
  private _contracts: ContractAddresses;

  constructor(config: SDKConfig) {
    this._environment = config.environment;

    // Parse operator credentials
    this._operatorId =
      typeof config.operatorId === 'string'
        ? AccountId.fromString(config.operatorId)
        : config.operatorId;

    this._operatorKey =
      typeof config.operatorKey === 'string'
        ? PrivateKey.fromStringED25519(config.operatorKey)
        : config.operatorKey;

    // Parse optional signing key
    if (config.signingKey) {
      this._signingKey =
        typeof config.signingKey === 'string'
          ? PrivateKey.fromStringECDSA(config.signingKey)
          : config.signingKey;
    } else {
      this._signingKey = null;
    }

    // Create Hedera client
    this._client = this.createHederaClient();
    this._client.setOperator(this._operatorId, this._operatorKey);

    // Initialize contract interfaces
    this._stakingIface = new Interface(LazyNFTStakingABI);
    this._missionIface = new Interface(MissionABI);
    this.factoryIface = new Interface(MissionFactoryABI);
    this._boostIface = new Interface(BoostManagerABI);
    this._delegateIface = new Interface(LazyDelegateRegistryABI);

    // Set default mainnet addresses
    this._contracts = {
      lazyToken: MAINNET_CONTRACTS.LAZY_TOKEN,
      lazyNftStaking: MAINNET_CONTRACTS.NFT_STAKING,
      missionFactory: MAINNET_CONTRACTS.MISSION_FACTORY,
      boostManager: MAINNET_CONTRACTS.BOOST_MANAGER,
      lazyGasStation: MAINNET_CONTRACTS.GAS_STATION,
      delegateRegistry: MAINNET_CONTRACTS.DELEGATE_REGISTRY,
    };
  }

  private createHederaClient(): Client {
    switch (this._environment) {
      case 'mainnet':
        return Client.forMainnet();
      case 'testnet':
        return Client.forTestnet();
      case 'previewnet':
        return Client.forPreviewnet();
      case 'local':
        return Client.forNetwork({ '127.0.0.1:50211': new AccountId(3) }).setMirrorNetwork(
          '127.0.0.1:5600'
        );
      default:
        throw new Error(`Unknown environment: ${this._environment}`);
    }
  }

  /** Get the underlying Hedera client */
  get client(): Client {
    return this._client;
  }

  /** Get the operator account ID */
  get operatorId(): AccountId {
    return this._operatorId;
  }

  /** Get the network environment */
  get environment(): NetworkEnvironment {
    return this._environment;
  }

  /** Set custom contract addresses */
  setContracts(addresses: Partial<ContractAddresses>): void {
    this._contracts = { ...this._contracts, ...addresses };
  }

  /** Get current contract addresses */
  getContracts(): ContractAddresses {
    return { ...this._contracts };
  }

  // ============================================================
  // Staking Operations
  // ============================================================

  /**
   * Get staking contract information
   */
  async getStakingInfo(
    contractId?: ContractId | string
  ): Promise<StakingInfo> {
    const id = this.resolveContractId(contractId, this._contracts.lazyNftStaking);

    const [
      totalStaked,
      totalDistributed,
      distributionPeriod,
      burnPercentage,
      hodlBonusRate,
      periodForBonus,
      maxBonusPeriods,
      boostRateCap,
    ] = await Promise.all([
      this.callContract(id, this._stakingIface, 'totalItemsStaked'),
      this.callContract(id, this._stakingIface, 'getTotalDistributed'),
      this.callContract(id, this._stakingIface, 'getDistributionPeriod'),
      this.callContract(id, this._stakingIface, 'getBurnPercentage'),
      this.callContract(id, this._stakingIface, 'getHODLBonusRate'),
      this.callContract(id, this._stakingIface, 'getPeriodForBonus'),
      this.callContract(id, this._stakingIface, 'getMaxBonusTimePeriods'),
      this.callContract(id, this._stakingIface, 'getBoostRateCap'),
    ]);

    return {
      totalStaked: Number(totalStaked),
      totalDistributed: BigInt(String(totalDistributed)),
      distributionPeriod: Number(distributionPeriod),
      burnPercentage: Number(burnPercentage),
      hodlBonusRate: Number(hodlBonusRate),
      periodForBonus: Number(periodForBonus),
      maxBonusPeriods: Number(maxBonusPeriods),
      boostRateCap: Number(boostRateCap),
    };
  }

  /**
   * Get stakeable collections
   */
  async getStakeableCollections(
    contractId?: ContractId | string
  ): Promise<StakeableCollection[]> {
    const id = this.resolveContractId(contractId, this._contracts.lazyNftStaking);
    const result = await this.callContract(id, this._stakingIface, 'getStakeableCollections') as [string[], bigint[]];

    // Result is tuple of [addresses[], maxRates[]]
    const addresses = result[0];
    const maxRates = result[1];

    return addresses.map((addr, i) => ({
      tokenId: addr,
      maxRewardRate: Number(maxRates[i]),
      isActive: true,
    }));
  }

  /**
   * Stake NFTs
   */
  async stake(
    stakes: Stake[],
    rewardProof: RewardProof,
    contractId?: ContractId | string
  ): Promise<TransactionResult> {
    const id = this.resolveContractId(contractId, this._contracts.lazyNftStaking);

    // Validate all stakes
    for (const s of stakes) {
      validateStake(s);
    }

    const gas = calculateStakeGas(stakes.length);

    return this.executeContract(id, this._stakingIface, 'stake', [stakes, rewardProof], gas);
  }

  /**
   * Unstake NFTs
   */
  async unstake(
    stakes: Stake[],
    rewardProof: RewardProof,
    contractId?: ContractId | string
  ): Promise<TransactionResult> {
    const id = this.resolveContractId(contractId, this._contracts.lazyNftStaking);

    const gas = calculateStakeGas(stakes.length);

    return this.executeContract(id, this._stakingIface, 'unstake', [stakes, rewardProof], gas);
  }

  /**
   * Generate a reward proof for staking operations
   */
  async generateRewardProof(
    boostRate: number,
    stakes: Stake[]
  ): Promise<RewardProof> {
    if (!this._signingKey) {
      throw new Error('Signing key required for generating reward proofs');
    }

    return generateStakingRewardProof(
      this._operatorId,
      boostRate,
      this._signingKey,
      stakes
    );
  }

  // ============================================================
  // Mission Operations
  // ============================================================

  /**
   * Get mission information
   */
  async getMissionInfo(missionId: ContractId | string): Promise<MissionInfo> {
    const id = this.resolveContractId(missionId);

    const [
      name,
      description,
      duration,
      startTime,
      endTime,
      entryFee,
      maxParticipants,
      currentParticipants,
      slotsAvailable,
      isPaused,
    ] = await Promise.all([
      this.callContract(id, this._missionIface, 'getMissionName'),
      this.callContract(id, this._missionIface, 'getMissionDescription'),
      this.callContract(id, this._missionIface, 'getMissionDuration'),
      this.callContract(id, this._missionIface, 'getMissionStart'),
      this.callContract(id, this._missionIface, 'getMissionEnd'),
      this.callContract(id, this._missionIface, 'getEntryFee'),
      this.callContract(id, this._missionIface, 'getMaxParticipants'),
      this.callContract(id, this._missionIface, 'activeParticipants'),
      this.callContract(id, this._missionIface, 'slotsAvailable'),
      this.callContract(id, this._missionIface, 'isPaused'),
    ]);

    return {
      address: id.toString(),
      name: String(name),
      description: String(description),
      status: 'active', // Would need more logic to determine
      duration: Number(duration),
      startTime: Number(startTime),
      endTime: Number(endTime),
      entryFee: BigInt(String(entryFee)),
      maxParticipants: Number(maxParticipants),
      currentParticipants: Number(currentParticipants),
      slotsAvailable: Number(slotsAvailable),
      requirements: [], // Would need separate call
      rewards: [], // Would need separate call
      isPaused: Boolean(isPaused),
    };
  }

  /**
   * Enter a mission
   */
  async enterMission(
    missionId: ContractId | string,
    collection: TokenId | string,
    serials: number[]
  ): Promise<TransactionResult> {
    const id = this.resolveContractId(missionId);
    const tokenId =
      typeof collection === 'string' ? TokenId.fromString(collection) : collection;

    return this.executeContract(
      id,
      this._missionIface,
      'enterMission',
      [tokenId.toSolidityAddress(), serials],
      GAS.MISSION_ENTER
    );
  }

  /**
   * Leave a mission (forfeit rewards)
   */
  async leaveMission(missionId: ContractId | string): Promise<TransactionResult> {
    const id = this.resolveContractId(missionId);

    return this.executeContract(id, this._missionIface, 'leaveMission', [], GAS.MISSION_LEAVE);
  }

  /**
   * Claim mission rewards
   */
  async claimMissionRewards(missionId: ContractId | string): Promise<TransactionResult> {
    const id = this.resolveContractId(missionId);

    return this.executeContract(
      id,
      this._missionIface,
      'withdrawRewards',
      [[]],
      GAS.MISSION_CLAIM
    );
  }

  // ============================================================
  // Boost Operations
  // ============================================================

  /**
   * Boost mission with gem NFT
   */
  async boostWithGem(
    missionId: ContractId | string,
    gemCollection: TokenId | string,
    gemSerial: number,
    boostManagerId?: ContractId | string
  ): Promise<TransactionResult> {
    const boostId = this.resolveContractId(boostManagerId, this._contracts.boostManager);
    const mId = this.resolveContractId(missionId);
    const tokenId =
      typeof gemCollection === 'string' ? TokenId.fromString(gemCollection) : gemCollection;

    return this.executeContract(
      boostId,
      this._boostIface,
      'activateGemBoost',
      [mId.toSolidityAddress(), tokenId.toSolidityAddress(), gemSerial],
      GAS.BOOST_ACTIVATE
    );
  }

  /**
   * Boost mission with $LAZY
   */
  async boostWithLazy(
    missionId: ContractId | string,
    lazyAmount: bigint,
    boostManagerId?: ContractId | string
  ): Promise<TransactionResult> {
    const boostId = this.resolveContractId(boostManagerId, this._contracts.boostManager);
    const mId = this.resolveContractId(missionId);

    return this.executeContract(
      boostId,
      this._boostIface,
      'activateLazyBoost',
      [mId.toSolidityAddress(), lazyAmount],
      GAS.BOOST_ACTIVATE
    );
  }

  // ============================================================
  // Delegation Operations
  // ============================================================

  /**
   * Delegate an NFT
   */
  async delegate(
    collection: TokenId | string,
    serial: number,
    delegateTo: AccountId | string,
    registryId?: ContractId | string
  ): Promise<TransactionResult> {
    const regId = this.resolveContractId(registryId, this._contracts.delegateRegistry);
    const tokenId =
      typeof collection === 'string' ? TokenId.fromString(collection) : collection;
    const delegate =
      typeof delegateTo === 'string' ? AccountId.fromString(delegateTo) : delegateTo;

    return this.executeContract(
      regId,
      this._delegateIface,
      'delegateToken',
      [tokenId.toSolidityAddress(), serial, delegate.toSolidityAddress()],
      GAS.STANDARD
    );
  }

  /**
   * Revoke delegation
   */
  async revokeDelegation(
    collection: TokenId | string,
    serial: number,
    registryId?: ContractId | string
  ): Promise<TransactionResult> {
    const regId = this.resolveContractId(registryId, this._contracts.delegateRegistry);
    const tokenId =
      typeof collection === 'string' ? TokenId.fromString(collection) : collection;

    return this.executeContract(
      regId,
      this._delegateIface,
      'revokeTokenDelegation',
      [tokenId.toSolidityAddress(), serial],
      GAS.STANDARD
    );
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private resolveContractId(
    id?: ContractId | string,
    fallback?: ContractId | string
  ): ContractId {
    const resolved = id ?? fallback;
    if (!resolved) {
      throw new Error('Contract ID required');
    }
    return typeof resolved === 'string' ? ContractId.fromString(resolved) : resolved;
  }

  private async callContract(
    contractId: ContractId,
    iface: Interface,
    fcnName: string,
    params: unknown[] = []
  ): Promise<unknown> {
    const encodedCall = iface.encodeFunctionData(fcnName, params);

    const query = new ContractCallQuery()
      .setContractId(contractId)
      .setFunctionParameters(Buffer.from(encodedCall.slice(2), 'hex'))
      .setGas(GAS.QUERY);

    const result = await query.execute(this._client);
    const decoded = iface.decodeFunctionResult(fcnName, result.bytes);

    return decoded.length === 1 ? decoded[0] : decoded;
  }

  private async executeContract(
    contractId: ContractId,
    iface: Interface,
    fcnName: string,
    params: unknown[],
    gas: number = GAS.STANDARD
  ): Promise<TransactionResult> {
    const encodedCall = iface.encodeFunctionData(fcnName, params);

    try {
      const tx = await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setFunctionParameters(Buffer.from(encodedCall.slice(2), 'hex'))
        .setGas(gas)
        .execute(this._client);

      // Wait for receipt to confirm transaction
      await tx.getReceipt(this._client);
      const record = await tx.getRecord(this._client);

      let data: unknown;
      try {
        data = iface.decodeFunctionResult(fcnName, record.contractFunctionResult!.bytes);
      } catch {
        // Some functions don't return data
      }

      return {
        success: true,
        transactionId: tx.transactionId.toString(),
        data,
        gasUsed: Number(record.contractFunctionResult?.gasUsed ?? 0),
      };
    } catch (error) {
      return {
        success: false,
        transactionId: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
