// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

interface IBoostManager {

	enum BoostLevel {
        C,
        R,
        SR,
        UR,
        LR,
        SPE
    }

	enum BoostType {
		NONE,
		LAZY,
		GEM
	}

	function boostWithLazy(
		address _mission
	) external returns (uint256 _endDate);

	function boostWithGemCards(
		address _mission,
        address _collectionAddress,
        uint256 _tokenId
	) external returns (uint256);

	function endMissionBoost(
		address _missionParticipant
	) external;

	function hasBoost(
		address _missionParticipant,
		address _mission
	) external view returns (bool _hasBoost);

	function getGemCollections() external view returns (address[] memory _gemCollections);

	function getBoostLevel(
		address _collectionAddress,
		uint256 _tokenId
	) external view returns (BoostLevel _boostLevel);

	function getBoostData(
		BoostLevel _boostLevel
	) external view returns (address[] memory _collections, bool[] memory _serialLocked, uint256[][] memory _serials, uint256 _boostReduction);

	function getBoostItem(
		address _mission,
		address _user
	) external view returns (BoostType _boostType, address _collection, uint256 _tokenId);
}