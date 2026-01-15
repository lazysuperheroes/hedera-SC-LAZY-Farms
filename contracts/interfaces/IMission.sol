// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IBoostManager } from "./IBoostManager.sol";

/**
 * @title IMission
 * @notice Interface for individual farming mission contracts
 * @dev Missions are deployed as minimal proxies (clones) via MissionFactory.
 * Users stake requirement NFTs to enter a mission for a set duration,
 * then claim randomized reward NFTs upon completion.
 */
interface IMission {

	/**
	 * @notice Get the number of available participation slots
	 * @dev Slots are determined by reward NFTs available minus active participants
	 * @return _slotsRemaining Number of users that can still join the mission
	 */
	function getSlotsRemaining() external view returns (uint256 _slotsRemaining);

	/**
	 * @notice Get all reward NFT collections and their available serials
	 * @return _rewards Array of reward NFT collection addresses
	 * @return _rewardSerials 2D array of available serial numbers per collection
	 */
	function getRewards() external view returns (address[] memory _rewards, uint256[][] memory _rewardSerials);

	/**
	 * @notice Get all requirement NFT collections and their serial restrictions
	 * @return _requirements Array of requirement NFT collection addresses
	 * @return _limitedSerials Whether each collection has serial restrictions
	 * @return _requirementSerials 2D array of allowed serials (if limited)
	 */
	function getRequirements() external view returns (
		address[] memory _requirements,
		bool[] memory _limitedSerials,
		uint256[][] memory _requirementSerials);

	/**
	 * @notice Get list of all active mission participants
	 * @return _users Array of addresses currently in the mission
	 */
	function getUsersOnMission() external view returns (address[] memory _users);

	/**
	 * @notice Get detailed participation info for a specific user
	 * @param _user Address of the participant to query
	 * @return _stakedNFTs Collections the user staked as requirements
	 * @return _stakedSerials Serial numbers staked per collection
	 * @return _entryTimestamp When the user entered the mission
	 * @return _endOfMissionTimestamp When the user can claim rewards
	 * @return _boosted Whether the user has an active boost
	 */
	function getMissionParticipation(address _user) external view returns (
		address[] memory _stakedNFTs,
		uint256[][] memory _stakedSerials,
		uint256 _entryTimestamp,
		uint256 _endOfMissionTimestamp,
		bool _boosted);

	/**
	 * @notice Get boost details for a participant
	 * @param _user Address of the participant
	 * @return _boostType Type of boost (NONE, LAZY, or GEM)
	 * @return _collection Gem NFT collection if GEM boost, else zero address
	 * @return serial Gem serial number if GEM boost, else 0
	 */
	function getUsersBoostInfo(address _user) external view returns(IBoostManager.BoostType _boostType, address _collection, uint256 serial);

	/**
	 * @notice Get user's mission end time and boost status
	 * @param _user Address of the participant
	 * @return _endOfMissionTimestamp Unix timestamp when mission completes (0 if not participating)
	 * @return boosted Whether the user has activated a boost
	 */
	function getUserEndAndBoost(
		address _user
	) external view returns (uint256 _endOfMissionTimestamp, bool boosted);

	/**
	 * @notice Pause or unpause mission entries
	 * @dev Only callable by mission admin. Does not affect active participants.
	 * @param _paused True to pause, false to unpause
	 */
	function updatePauseStatus(bool _paused) external;

	/**
	 * @notice Set when the mission opens for entries
	 * @dev Only callable by mission admin. Set to 0 for immediate availability.
	 * @param _startTimestamp Unix timestamp when entries are allowed
	 */
	function setStartTimestamp(uint256 _startTimestamp) external;

	/**
	 * @notice Get the current entry fee in $LAZY tokens
	 * @dev Fee may decrease over time if Dutch auction is configured
	 * @return _entryFee Entry fee amount (8 decimals)
	 */
	function entryFee() external view returns (uint256 _entryFee);

	/**
	 * @notice Reduce a participant's remaining mission duration (called by BoostManager)
	 * @dev Only callable by authorized BoostManager contract
	 * @param _wallet Address of the participant to boost
	 * @param _boostReduction Percentage to reduce duration (0-100)
	 * @return New end timestamp after boost
	 * @return New remaining duration in seconds
	 */
    function reduceStakingPeriod(
        address _wallet,
        uint256 _boostReduction
    ) external returns (uint256, uint256);

	/**
	 * @notice Check if an address is currently participating in the mission
	 * @param _wallet Address to check
	 * @return _isParticipant True if address has active participation
	 */
    function isParticipant(
        address _wallet
    ) external view returns (bool _isParticipant);

	/**
	 * @notice Initialize a mission clone with parameters
	 * @dev Only callable once per clone. Called by MissionFactory during deployment.
	 * @param _missionDuration Duration in seconds users must stake
	 * @param _entryFee Fee in $LAZY tokens (8 decimals)
	 * @param _missionRequirements NFT collections users must stake to enter
	 * @param _missionRewards NFT collections available as rewards
	 * @param _feeBurnPercentage Percentage of entry fee to burn (0-100)
	 * @param _lastEntryTimestamp Deadline for new entries (Unix timestamp)
	 * @param _creator Address of mission creator (receives admin rights)
	 * @param _missionFactory Address of the factory that deployed this mission
	 * @param _numberOfRequirements Number of NFTs user must stake to enter
	 * @param _numberOfRewards Number of NFTs user receives on completion
	 */
    function initialize(
        uint256 _missionDuration,
        uint256 _entryFee,
        address[] memory _missionRequirements,
        address[] memory _missionRewards,
        uint256 _feeBurnPercentage,
        uint256 _lastEntryTimestamp,
        address _creator,
        address _missionFactory,
        uint8 _numberOfRequirements,
        uint8 _numberOfRewards
    ) external;
}
