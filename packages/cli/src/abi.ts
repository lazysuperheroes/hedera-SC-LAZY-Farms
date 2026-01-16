/**
 * ABI Fragments for Contract Queries
 * Minimal ABIs for read-only operations - matches actual deployed contracts
 */

import { Interface } from 'ethers';

/**
 * LazyNFTStaking read functions
 * Based on ILazyNFTStaking.sol and LazyNFTStaking.sol
 */
export const NFT_STAKING_ABI = [
  'function getStakingUsers() view returns (address[])',
  'function getStakableCollections() view returns (address[])',
  'function getStakedNFTs(address _user) view returns (address[] collections, uint256[][] serials)',
  'function getStakedSerials(address _collection) view returns (uint256[])',
  'function getNumStakedNFTs(address _collection) view returns (uint256)',
  'function getBaseRewardRate(address _user) view returns (uint256)',
  'function getActiveBoostRate(address _user) view returns (uint256)',
  'function getMaxBaseRate(address _user) view returns (uint256)',
];

export const nftStakingInterface = new Interface(NFT_STAKING_ABI);

/**
 * MissionFactory read functions
 * Based on IMissionFactory.sol and MissionFactory.sol
 */
export const MISSION_FACTORY_ABI = [
  'function getDeployedMissions() view returns (address[])',
  'function getAvailableSlots() view returns (address[], uint256[], uint256[])',
  'function getLiveMissions(address _user) view returns (address[], uint256[], bool[])',
  'function isAdmin(address _wallet) view returns (bool)',
  'function lazyToken() view returns (address)',
  'function lazyGasStation() view returns (address)',
  'function boostManager() view returns (address)',
  'function prngGenerator() view returns (address)',
  'function lazyDelegateRegistry() view returns (address)',
];

export const missionFactoryInterface = new Interface(MISSION_FACTORY_ABI);

/**
 * Mission read functions
 * Based on IMission.sol and Mission.sol
 */
export const MISSION_ABI = [
  'function getSlotsRemaining() view returns (uint256)',
  'function getUsersOnMission() view returns (address[])',
  'function isParticipant(address _user) view returns (bool)',
  'function entryFee() view returns (uint256)',
  'function getMissionParticipation(address _user) view returns (uint256 _entryTimestamp, uint256 _endOfMissionTimestamp, bool _boosted)',
  'function getUserEndAndBoost(address _user) view returns (uint256 _endOfMissionTimestamp, bool boosted)',
  'function getRequirements() view returns (address[] _requiredCollections, uint256[] _requiredQuantities, address _rewardCollection, uint256 _rewardsPerUser, uint256 _missionDuration, uint256 _maxParticipants, uint256 _minTier)',
  'function getDecrementDetails() view returns (bool, uint256, uint256, uint256)',
];

export const missionInterface = new Interface(MISSION_ABI);

/**
 * BoostManager read functions
 * Based on IBoostManager.sol and BoostManager.sol
 */
export const BOOST_MANAGER_ABI = [
  'function getGemCollections() view returns (address[])',
  'function getBoostLevel(address _collectionAddress, uint256 _tokenId) view returns (uint8)',
  'function getBoostData(uint8 _boostLevel) view returns (address[], bool[], uint256[][], uint256)',
  'function hasBoost(address _missionParticipant, address _mission) view returns (bool)',
  'function getBoostItem(address _mission, address _user) view returns (uint8, address, uint256)',
];

export const boostManagerInterface = new Interface(BOOST_MANAGER_ABI);

/**
 * LazyDelegateRegistry read functions
 * Based on ILazyDelegateRegistry.sol
 */
export const DELEGATE_REGISTRY_ABI = [
  'function getDelegateWallet(address _wallet) view returns (address)',
  'function checkDelegateWallet(address _actualWallet, address _proposedDelegate) view returns (bool)',
  'function getWalletsDelegatedTo(address _delegate) view returns (address[])',
];

export const delegateRegistryInterface = new Interface(DELEGATE_REGISTRY_ABI);

/**
 * LazyGasStation read functions
 * Based on ILazyGasStation.sol
 */
export const GAS_STATION_ABI = [
  'function isContractUser(address _contractAddress) view returns (bool)',
];

export const gasStationInterface = new Interface(GAS_STATION_ABI);

/**
 * Encode a function call
 */
export function encodeCall(iface: Interface, functionName: string, args: unknown[] = []): string {
  return iface.encodeFunctionData(functionName, args);
}

/**
 * Decode a function result
 */
export function decodeResult(iface: Interface, functionName: string, data: string): unknown {
  return iface.decodeFunctionResult(functionName, data);
}
