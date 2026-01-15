// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import { IBoostManager } from "./IBoostManager.sol";

/**
 * @title IMissionFactory
 * @notice Interface for the mission deployment factory
 * @dev Factory deploys Mission contracts as minimal proxies (clones) and aggregates
 * events from child missions for centralized indexing. Also manages admin/deployer roles.
 */
interface IMissionFactory {

	/**
	 * @notice Broadcast slot availability change from a child mission
	 * @dev Called by Mission contracts to emit SlotsRemainingFactory event
	 * @param _slotsRemaining Current available slots in the calling mission
	 */
	function broadcastSlotsRemaining(
		uint256 _slotsRemaining
	) external;

	/**
	 * @notice Broadcast mission completion from a child mission
	 * @dev Called by Mission contracts when a user claims rewards
	 * @param _wallet Address of the user who completed the mission
	 */
	function broadcastMissionComplete(
		address _wallet
	) external;

	/**
	 * @notice Broadcast new mission participation from a child mission
	 * @dev Called by Mission contracts when a user enters
	 * @param _wallet Address of the user who joined
	 * @param _endOfMissionTimestamp When the user's mission will complete
	 */
	function broadcastMissionJoined(
		address _wallet,
		uint256 _endOfMissionTimestamp
	) external;

	/**
	 * @notice Broadcast boost activation from BoostManager
	 * @dev Called by BoostManager when a user activates a boost
	 * @param _mission Address of the mission being boosted
	 * @param _wallet Address of the user activating the boost
	 * @param _boostReduction Percentage reduction applied (0-100)
	 * @param _newEndMission New mission end timestamp after boost
	 * @param _newMissionDuration New remaining duration in seconds
	 * @param _boostType Type of boost (LAZY or GEM)
	 */
	function broadcastMissionBoost(
		address _mission,
		address _wallet,
		uint256 _boostReduction,
		uint256 _newEndMission,
		uint256 _newMissionDuration,
		IBoostManager.BoostType _boostType
	) external;

	/**
	 * @notice Check if an address has admin privileges
	 * @param _wallet Address to check
	 * @return True if address is an admin
	 */
	function isAdmin(
		address _wallet
	) external view returns (bool);

	/**
	 * @notice Permanently close a mission
	 * @dev Only callable by factory admin. Removes mission from active set
	 * and returns any unclaimed reward NFTs to the mission creator.
	 * @param _mission Address of the mission to close
	 */
	function closeMission(
		address _mission
	) external;

	/**
	 * @notice Get the $LAZY token address used by all missions
	 * @return Address of the $LAZY token contract
	 */
	function lazyToken() external view returns (address);

	/**
	 * @notice Get the LazyGasStation contract address
	 * @return Address of the gas station for fee handling
	 */
	function lazyGasStation() external view returns (address);

	/**
	 * @notice Get the BoostManager contract address
	 * @return Address of the boost manager for mission acceleration
	 */
	function boostManager() external view returns (address);

	/**
	 * @notice Get the PRNG generator contract address
	 * @return Address of the Hedera PRNG contract for random reward selection
	 */
	function prngGenerator() external view returns (address);

	/**
	 * @notice Get the LazyDelegateRegistry contract address
	 * @return Address of the delegation registry for NFT custody delegation
	 */
	function lazyDelegateRegistry() external view returns (address);
}
