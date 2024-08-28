// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IBoostManager } from "./IBoostManager.sol";

interface IMission {

	function getSlotsRemaining() external view returns (uint256 _slotsRemaining);

	function getRewards() external view returns (address[] memory _rewards, uint256[][] memory _rewardSerials);

	function getRequirements() external view returns (
		address[] memory _requirements,
		bool[] memory _limitedSerials,
		uint256[][] memory _requirementSerials);

	function getUsersOnMission() external view returns (address[] memory _users);

	function getMissionParticipation(address _user) external view returns (
		address[] memory _stakedNFTs, 
		uint256[][] memory _stakedSerials, 
		uint256 _entryTimestamp, 
		uint256 _endOfMissionTimestamp,
		bool _boosted);

	function getUsersBoostInfo(address _user) external view returns(IBoostManager.BoostType _boostType, address _collection, uint256 serial);

	function getUserEndAndBoost(
		address _user
	) external view returns (uint256 _endOfMissionTimestamp, bool boosted);

	function updatePauseStatus(bool _paused) external;

	function setStartTimestamp(uint256 _startTimestamp) external;

	function entryFee() external view returns (uint256 _entryFee);

    function reduceStakingPeriod(
        address _wallet,
        uint256 _boostReduction
    ) external returns (uint256, uint256);

    function isParticipant(
        address _wallet
    ) external view returns (bool _isParticipant);

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
