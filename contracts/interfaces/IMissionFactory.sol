// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import { IBoostManager } from "./IBoostManager.sol";

interface IMissionFactory {
	function broadcastSlotsRemaining(
		uint256 _slotsRemaining
	) external;

	function broadcastMissionComplete(
		address _wallet
	) external;

	function broadcastMissionJoined(
		address _wallet,
		uint256 _endOfMissionTimestamp
	) external;

	function broadcastMissionBoost(
		address _mission,
		address _wallet,
		uint256 _boostReduction,
		uint256 _newEndMission,
		uint256 _newMissionDuration,
		IBoostManager.BoostType _boostType
	) external;

	function isAdmin(
		address _wallet
	) external view returns (bool);

	function closeMission(
		address _mission
	) external;


	function lazyToken() external view returns (address);

	function lazyGasStation() external view returns (address);

	function boostManager() external view returns (address);

	function prngGenerator() external view returns (address);

	function lazyDelegateRegistry() external view returns (address);
}