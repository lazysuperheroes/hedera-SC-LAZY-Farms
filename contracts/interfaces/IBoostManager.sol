// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title IBoostManager
 * @notice Interface for the mission boost system
 * @dev Allows users to reduce mission duration using gem NFTs or $LAZY tokens.
 * Gem NFTs are staked during the boost and returned on mission completion.
 * $LAZY boosts are consumable (tokens are partially burned).
 */
interface IBoostManager {

	/**
	 * @notice Gem rarity levels that determine boost power
	 * @dev Higher levels provide greater duration reduction
	 */
	enum BoostLevel {
        C,      // Common - lowest reduction
        R,      // Rare
        SR,     // Super Rare
        UR,     // Ultra Rare
        LR,     // Legend Rare
        SPE     // Special - highest reduction
    }

	/**
	 * @notice Type of boost activated on a mission
	 */
	enum BoostType {
		NONE,   // No boost active
		LAZY,   // $LAZY token boost (consumable)
		GEM     // Gem NFT boost (returned on completion)
	}

	/**
	 * @notice Activate a boost using $LAZY tokens
	 * @dev Tokens are drawn from user and partially burned. Cannot boost twice.
	 * @param _mission Address of the mission to boost
	 * @return _endDate New mission end timestamp after boost
	 */
	function boostWithLazy(
		address _mission
	) external returns (uint256 _endDate);

	/**
	 * @notice Activate a boost by staking a gem NFT
	 * @dev Gem is held by contract until mission ends. Returned on completion/exit.
	 * @param _mission Address of the mission to boost
	 * @param _collectionAddress Gem NFT collection address
	 * @param _tokenId Serial number of the gem NFT
	 * @return New mission end timestamp after boost
	 */
	function boostWithGemCards(
		address _mission,
        address _collectionAddress,
        uint256 _tokenId
	) external returns (uint256);

	/**
	 * @notice End a boost and return gem NFT if applicable
	 * @dev Called by Mission contract when user completes or leaves mission
	 * @param _missionParticipant Address of the user whose boost is ending
	 */
	function endMissionBoost(
		address _missionParticipant
	) external;

	/**
	 * @notice Check if a user has an active boost on a mission
	 * @param _missionParticipant Address of the user
	 * @param _mission Address of the mission
	 * @return _hasBoost True if user has an active boost
	 */
	function hasBoost(
		address _missionParticipant,
		address _mission
	) external view returns (bool _hasBoost);

	/**
	 * @notice Get all NFT collections registered as gem boosters
	 * @return _gemCollections Array of gem collection addresses
	 */
	function getGemCollections() external view returns (address[] memory _gemCollections);

	/**
	 * @notice Get the boost level for a specific gem NFT
	 * @dev Reverts if collection/serial not registered as a gem
	 * @param _collectionAddress Gem NFT collection address
	 * @param _tokenId Serial number of the gem
	 * @return _boostLevel The gem's rarity level (C, R, SR, UR, LR, SPE)
	 */
	function getBoostLevel(
		address _collectionAddress,
		uint256 _tokenId
	) external view returns (BoostLevel _boostLevel);

	/**
	 * @notice Get configuration data for a boost level
	 * @param _boostLevel The rarity level to query
	 * @return _collections NFT collections at this level
	 * @return _serialLocked Whether each collection has serial restrictions
	 * @return _serials Allowed serials per collection (if locked)
	 * @return _boostReduction Percentage duration reduction (0-100)
	 */
	function getBoostData(
		BoostLevel _boostLevel
	) external view returns (address[] memory _collections, bool[] memory _serialLocked, uint256[][] memory _serials, uint256 _boostReduction);

	/**
	 * @notice Get the active boost details for a user on a mission
	 * @param _mission Address of the mission
	 * @param _user Address of the user
	 * @return _boostType Type of boost (NONE, LAZY, GEM)
	 * @return _collection Gem collection if GEM boost, else zero address
	 * @return _tokenId Gem serial if GEM boost, else 0
	 */
	function getBoostItem(
		address _mission,
		address _user
	) external view returns (BoostType _boostType, address _collection, uint256 _tokenId);
}
