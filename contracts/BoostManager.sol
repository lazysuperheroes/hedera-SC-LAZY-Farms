// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { HederaResponseCodes } from "./HederaResponseCodes.sol";

import { IMission } from "./interfaces/IMission.sol";
import { IBoostManager } from "./interfaces/IBoostManager.sol";
import { IMissionFactory } from "./interfaces/IMissionFactory.sol";
import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { TokenStaker } from "./TokenStaker.sol";

/**
 * @title BoostManager
 * @author Lazy Superheroes Team
 * @notice Manages boost mechanics for missions, allowing users to reduce their staking period
 * @dev This contract handles boosting a mission reducing the staking period.
 *      Boosts can be acquired in two ways:
 *      1. Staking gem NFTs - Different rarity levels provide different boost percentages
 *      2. Purchasing with $LAZY tokens - A flat boost percentage for a set token cost
 *
 *      Gem rarity levels and their default boost reductions:
 *      - C (Common): 5%
 *      - R (Rare): 10%
 *      - SR (Super Rare): 15%
 *      - UR (Ultra Rare): 25%
 *      - LR (Legendary Rare): 40%
 *      - SPE (Special): 20%
 *
 *      When using gem cards, the NFT is staked (transferred to this contract) for the
 *      duration of the mission and returned upon mission completion.
 */
contract BoostManager is Ownable, TokenStaker, IBoostManager {
	using SafeCast for uint256;
	using SafeCast for int256;
	using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableSet for EnumerableSet.UintSet;

    /// @notice Stores information about a staked boost NFT
    /// @dev Used to track gem card NFTs staked for mission boosts
    struct Boost {
        /// @notice The NFT collection address
        address collectionAddress;
        /// @notice The specific token ID (serial) of the staked NFT
        uint256 tokenId;
    }

    /// @notice Configuration for gem card boosts at a specific rarity level
    /// @dev Contains all collections and optional serial restrictions for a boost level
    struct GemCardBoost {
        /// @notice The percentage reduction applied to mission duration (e.g., 10 = 10%)
		uint256 boostReduction;
        /// @notice Set of NFT collection addresses eligible for this boost level
        EnumerableSet.AddressSet collectionAddress;
        /// @notice Whether specific serials are required for each collection (true = only listed serials work)
		mapping(address => bool) serialLocked;
        /// @notice The specific serial numbers allowed per collection (only used if serialLocked is true)
		mapping(address => EnumerableSet.UintSet) serials;
    }

    /// @notice Emitted when a user activates a boost on a mission
    /// @param _mission The address of the mission contract
    /// @param _missionParticipant The user who activated the boost
    /// @param _boostReduction The percentage reduction applied to mission duration
    /// @param _newEndTimestamp The new mission end timestamp after boost
    /// @param _newMissionDuration The new total mission duration after boost
    /// @param _boostType The type of boost used (LAZY or GEM)
    event BoostActivated(
        address _mission,
        address _missionParticipant,
        uint256 _boostReduction,
        uint256 _newEndTimestamp,
        uint256 _newMissionDuration,
		BoostType _boostType
    );

    /// @notice Emitted for general contract messages, primarily HBAR receipts
    /// @param _type The type of message (e.g., "Receive", "Fallback")
    /// @param _sender The address that sent the message/value
    /// @param _amount The amount of HBAR received
    /// @param _message A descriptive message
	event BoostMessage(
		string _type,
		address _sender,
		uint256 _amount,
		string _message
	);

    /// @notice Thrown when invalid arguments are provided to a function
	error InvalidArguments();

    /// @dev Set of admin addresses with elevated privileges
	EnumerableSet.AddressSet private admins;

    /// @notice The cost in $LAZY tokens to purchase a boost (in token units, not tinybar)
    uint256 public lazyBoostCost = 5000; // cost in LAZY
    /// @notice The percentage reduction for $LAZY-purchased boosts (e.g., 10 = 10%)
    uint256 public lazyBoostReduction = 10; //reduction in %
    /// @notice Percentage of $LAZY fees that are burned (0-100)
    uint256 public feeBurnPercentage;

    /// @notice Address of the MissionFactory contract for event broadcasting
	address public missionFactory;

    /// @notice Counter tracking the number of NFTs currently staked as boosts
	uint256 public liveBoosts;

    /// @dev Mapping from boost level to its configuration
    mapping(BoostLevel => GemCardBoost) private gemBoostReduction;
    /// @dev Tracks active boosts per user per mission (user address => mission address => isActive)
    mapping(address => mapping(address => bool)) private activeBoosts;
    /// @dev Tracks staked boost NFTs (mission address => user address => Boost details)
    mapping(address => mapping(address => Boost)) private stakedBoost;

    /// @dev Set of all gem collection addresses eligible for boosts (across all levels)
	EnumerableSet.AddressSet private gemSet;

    /// @notice Ensures the caller is an active participant in the specified mission without an existing boost
    /// @dev Checks: 1) msg.sender is a participant in the mission, 2) No boost is already active
    /// @param _mission The address of the mission to check
    modifier onlyActivemission(address _mission) {
        IMission mission = IMission(payable(_mission));
        require(mission.isParticipant(msg.sender), "Not active");
        require(
            activeBoosts[msg.sender][_mission] == false,
            "Boost already active"
        );
        _;
    }

    /// @notice Ensures the caller is a mission contract with an active boost for the given participant
    /// @dev Used by Mission contracts when calling endMissionBoost to return staked NFTs
    /// @param _missionParticipant The address of the user who has the active boost
    modifier onlyBoostedMission(address _missionParticipant) {
        require(
            activeBoosts[_missionParticipant][msg.sender] == true,
            "Boost not active"
        );
        _;
    }

    /// @notice Restricts function access to admin addresses only
    /// @dev The initial deployer is automatically added as an admin in the constructor
	modifier onlyAdmin() {
		require(admins.contains(msg.sender), "Permission Denied - Not Admin");
        _;
    }

    /**
     * @notice Initializes the BoostManager contract with required dependencies
     * @dev Sets up the contract with:
     *      - Token contracts (LAZY token, gas station, delegate registry)
     *      - Default gem boost reduction percentages for each rarity level
     *      - Deployer as the initial admin
     * @param _lazyToken Address of the $LAZY token contract (HTS token)
     * @param _lazyGS Address of the LazyGasStation contract for fee handling
	 * @param _lazyDR Address of the LazyDelegateRegistry contract for NFT delegation
     * @param _feeBurnPercentage Percentage of $LAZY fees to burn (0-100)
     */
    constructor(
        address _lazyToken,
        address _lazyGS,
		address _lazyDR,
        uint256 _feeBurnPercentage
    ) {
        initContracts(_lazyToken, _lazyGS, _lazyDR);
        feeBurnPercentage = _feeBurnPercentage;


        //set default boost reduction for gem cards
        gemBoostReduction[BoostLevel.C].boostReduction = 5;
        gemBoostReduction[BoostLevel.R].boostReduction = 10;
        gemBoostReduction[BoostLevel.SR].boostReduction = 15;
        gemBoostReduction[BoostLevel.UR].boostReduction = 25;
        gemBoostReduction[BoostLevel.LR].boostReduction = 40;
        gemBoostReduction[BoostLevel.SPE].boostReduction = 20;

		// add admins
		admins.add(msg.sender);
    }

    /**
     * @notice Purchase a mission boost using $LAZY tokens
     * @dev Draws $LAZY from the caller via LazyGasStation (requires prior allowance).
     *      A portion of the $LAZY may be burned based on feeBurnPercentage.
     *      The boost reduces the user's remaining mission duration by lazyBoostReduction%.
     * @param _mission The address of the mission contract to boost
     * @return The new mission end timestamp after applying the boost
     */
    function boostWithLazy(
        address _mission
    ) external onlyActivemission(_mission) returns (uint256) {
		ILazyGasStation(lazyGasStation).drawLazyFrom(
			msg.sender,
			lazyBoostCost,
			feeBurnPercentage);

        return useBoost(_mission, lazyBoostReduction, BoostType.LAZY);
    }

    /**
     * @notice Activate a mission boost by staking a gem card NFT
     * @dev The user must have approved this contract to transfer the NFT (either via
     *      setApprovalForAll or approve for the specific token). The NFT will be:
     *      1. Transferred to this contract
     *      2. Delegated back to the original owner (so they retain visual ownership)
     *      3. Returned when the mission ends via endMissionBoost
     *
     *      The boost percentage depends on the gem's rarity level (C, R, SR, UR, LR, SPE).
     *      Reverts if the collection/serial is not authorized for any boost level.
     * @param _mission The address of the mission contract to boost
     * @param _collectionAddress The NFT collection address of the gem card
     * @param _tokenId The specific token ID (serial) of the gem card to stake
     * @return The new mission end timestamp after applying the boost
     */
    function boostWithGemCards(
        address _mission,
        address _collectionAddress,
        uint256 _tokenId
    ) external onlyActivemission(_mission) returns (uint256) {
		// get the boost level for the collection
		BoostLevel _boostLevel = getBoostLevel(_collectionAddress, _tokenId);

		// validate the allowance for the boost NFT
		// test for approved for all first
		bool isApproved = IERC721(_collectionAddress).isApprovedForAll(msg.sender, address(this));

		if (!isApproved) {
			// test for approved for this specific serial
			address approvedAddress = IERC721(_collectionAddress).getApproved(_tokenId);
			isApproved = approvedAddress == address(this) ? true : false;
		}

		if (!isApproved) { revert InvalidArguments(); }

        uint256[] memory serials = new uint256[](1);
        serials[0] = _tokenId;

		// increment tracker of NFTs staked
		liveBoosts++;

		// move the NFT to the Boost Contract and delegate ownership back to sender
        batchMoveNFTs(
            TransferDirection.STAKING,
            _collectionAddress,
            serials,
            msg.sender,
			true
        );

        stakedBoost[_mission][msg.sender] = Boost(_collectionAddress, _tokenId);

        return useBoost(_mission, gemBoostReduction[_boostLevel].boostReduction, BoostType.GEM);
    }

    /**
     * @notice Internal function to apply a boost to an active mission
     * @dev Marks the boost as active and calls the Mission contract to reduce the staking period.
     *      Emits BoostActivated event and broadcasts to MissionFactory if configured.
     * @param _mission The address of the mission contract
     * @param _boostReduction The percentage to reduce from the remaining staking period (0-100)
     * @param _boostType The type of boost being used (LAZY or GEM)
     * @return endDate The new mission end timestamp after applying the boost
     */
    function useBoost(
        address _mission,
        uint256 _boostReduction,
		BoostType _boostType
    ) internal returns (uint256 endDate) {
        require(!activeBoosts[msg.sender][_mission], "Mission already boosted");

        activeBoosts[msg.sender][_mission] = true;

        IMission mission = IMission(payable(_mission));

        (uint256 newEndMission, uint256 newMissionDuration) = mission
            .reduceStakingPeriod(msg.sender, _boostReduction);

		broadcastBoost(
			_mission,
			_boostReduction,
			newEndMission,
			newMissionDuration,
			_boostType
		);

        return newEndMission;
    }

    /**
     * @notice Internal function to return a staked gem card NFT to its owner
     * @dev Transfers the NFT from this contract back to the mission participant.
     *      Called internally when a mission ends and the boost needs to be released.
     *      Clears the stakedBoost mapping entry after transfer.
     * @param _missionParticipant The address of the user to receive the NFT back
     */
    function unstakeBoost(address _missionParticipant) internal {
        Boost memory boost = stakedBoost[msg.sender][_missionParticipant];

        uint256[] memory serials = new uint256[](1);
        serials[0] = boost.tokenId;

        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            boost.collectionAddress,
            serials,
            _missionParticipant,
			true
        );

        delete stakedBoost[msg.sender][_missionParticipant];
    }

    /**
     * @notice Called by a Mission contract to release a user's boost when the mission ends
     * @dev Only callable by the mission contract that has an active boost for the participant.
     *      If a gem card was staked (collectionAddress != 0), returns the NFT to the user.
     *      Decrements liveBoosts counter and clears the activeBoosts mapping.
     * @param _missionParticipant The address of the user whose boost is ending
     */
    function endMissionBoost(
        address _missionParticipant
    ) external onlyBoostedMission(_missionParticipant) {
        address collectionAddress = stakedBoost[msg.sender][_missionParticipant]
            .collectionAddress;

        if (collectionAddress != address(0)) {
            unstakeBoost(_missionParticipant);
			liveBoosts--;
        }

        delete activeBoosts[_missionParticipant][msg.sender];
    }

    /**
     * @notice Check if a user has an active boost for a specific mission
     * @dev Returns true if the user has activated any boost (LAZY or GEM) on the mission.
     *      This does not distinguish between boost types - use getBoostItem for details.
     * @param _missionParticipant The address of the user to check
     * @param _mission The address of the mission contract to check
     * @return _hasBoost True if the user has an active boost on this mission
     */
    function hasBoost(
        address _missionParticipant,
        address _mission
    ) public view returns (bool _hasBoost) {
        return activeBoosts[_missionParticipant][_mission];
    }

	/**
	 * @notice Determine the boost level for a given NFT collection and token ID
	 * @dev Checks each boost level (C, R, SR, UR, LR, SPE) to find where the collection/serial
	 *      is registered. If serialLocked is true for a collection, the specific tokenId must
	 *      also be in the allowed serials set.
	 *
	 *      The same collection can be registered at multiple levels with different serials,
	 *      allowing different serials of the same collection to have different rarities.
	 *      Levels are checked in order: C -> R -> SR -> UR -> LR -> SPE
	 * @param _collectionAddress The NFT collection address to check
	 * @param _tokenId The specific token ID (serial) to check
	 * @return _boostLevel The boost level (rarity) of the NFT
	 */
	function getBoostLevel(
		address _collectionAddress,
		uint256 _tokenId
	) public view returns (BoostLevel _boostLevel) {
		if (gemBoostReduction[BoostLevel.C].collectionAddress.contains(_collectionAddress)) {
			// check if the serial is locked
			if (gemBoostReduction[BoostLevel.C].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.C].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.C;
				}
				// if locked and no serial is a match then continue to test next condition
			}
			else {
				return BoostLevel.C;
			}
		}
		// if not else if to allow for multiple levels of rarity
		if (gemBoostReduction[BoostLevel.R].collectionAddress.contains(_collectionAddress)) {
			if (gemBoostReduction[BoostLevel.R].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.R].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.R;
				}
			}
			else {
				return BoostLevel.R;
			}
		}

		if (gemBoostReduction[BoostLevel.SR].collectionAddress.contains(_collectionAddress)) {
			if (gemBoostReduction[BoostLevel.SR].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.SR].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.SR;
				}
			}
			else {
				return BoostLevel.SR;
			}
		}

		if (gemBoostReduction[BoostLevel.UR].collectionAddress.contains(_collectionAddress)) {
			if (gemBoostReduction[BoostLevel.UR].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.UR].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.UR;
				}
			}
			else {
				return BoostLevel.UR;
			}
		}

		if (gemBoostReduction[BoostLevel.LR].collectionAddress.contains(_collectionAddress)) {
			if (gemBoostReduction[BoostLevel.LR].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.LR].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.LR;
				}
			}
			else {
				return BoostLevel.LR;
			}
		}

		if (gemBoostReduction[BoostLevel.SPE].collectionAddress.contains(_collectionAddress)) {
			if (gemBoostReduction[BoostLevel.SPE].serialLocked[_collectionAddress]) {
				if (gemBoostReduction[BoostLevel.SPE].serials[_collectionAddress].contains(_tokenId)) {
					return BoostLevel.SPE;
				}
			}
			else {
				return BoostLevel.SPE;
			}
		} else {
			revert("Collection not authorized");
		}
	}

	/**
	 * @notice Get all NFT collection addresses that are eligible for boosts
	 * @dev Returns addresses across all boost levels. Use getBoostData to see
	 *      which collections belong to which level and their serial restrictions.
	 * @return _gemCollections Array of all gem collection addresses
	 */
	function getGemCollections() external view returns (address[] memory _gemCollections) {
		return gemSet.values();
	}

	/**
	 * @notice Get detailed configuration for a specific boost level
	 * @dev Returns all collections registered at this level, whether they have serial
	 *      restrictions, the allowed serials (if restricted), and the boost percentage.
	 * @param _boostLevel The boost level to query (C, R, SR, UR, LR, or SPE)
	 * @return _collections Array of collection addresses at this level
	 * @return _serialLocked Array indicating if each collection has serial restrictions
	 * @return _serials 2D array of allowed serial numbers for each collection (empty if not locked)
	 * @return _boostReduction The percentage reduction for this boost level
	 */
	function getBoostData(
		BoostLevel _boostLevel
	) external view returns (address[] memory _collections, bool[] memory _serialLocked, uint256[][] memory _serials, uint256 _boostReduction) {
		_collections = gemBoostReduction[_boostLevel].collectionAddress.values();

		uint256 length = _collections.length;

		_serialLocked = new bool[](length);
		_serials = new uint256[][](length);
		for (uint256 i = 0; i < length;) {
			_serialLocked[i] = gemBoostReduction[_boostLevel].serialLocked[_collections[i]];
			if (_serialLocked[i]) {
				_serials[i] = gemBoostReduction[_boostLevel].serials[_collections[i]].values();
			}
			else {
				_serials[i] = new uint256[](0);
			}

			unchecked { ++i; }
		}

		_boostReduction = gemBoostReduction[_boostLevel].boostReduction;
	}

	/**
	 * @notice Get details about the boost used by a user on a specific mission
	 * @dev Returns the type of boost and, if it's a GEM boost, the staked NFT details.
	 *      For LAZY boosts, collection and tokenId will be address(0) and 0.
	 *      For NONE (no boost), all return values are default/zero.
	 * @param _mission The address of the mission contract
	 * @param _user The address of the user to query
	 * @return _boostType The type of boost (NONE, LAZY, or GEM)
	 * @return _collection The NFT collection address (only for GEM boosts)
	 * @return _tokenId The NFT token ID/serial (only for GEM boosts)
	 */
	function getBoostItem(
		address _mission,
		address _user
	) external view returns (BoostType _boostType, address _collection, uint256 _tokenId) {
		Boost memory boost = stakedBoost[_mission][_user];
		if (hasBoost(_user, _mission)) {
			if (boost.collectionAddress != address(0)) {
				return (BoostType.GEM, boost.collectionAddress, boost.tokenId);
			}
			else {
				return (BoostType.LAZY, boost.collectionAddress, boost.tokenId);
			}
		}
		else {
			return (BoostType.NONE, address(0), 0);
		}
	}

    /**
     * @notice Set the cost in $LAZY tokens to purchase a boost
     * @dev Admin only. The cost is in whole token units (not adjusted for decimals).
     *      Users must have sufficient $LAZY allowance to the LazyGasStation.
     * @param _lazyBoostCost The new cost in $LAZY tokens
     */
    function setLazyBoostCost(uint256 _lazyBoostCost) external onlyAdmin() {
        lazyBoostCost = _lazyBoostCost;
    }

    /**
     * @notice Update the boost percentage for a gem rarity level
     * @dev Admin only. Changes the percentage reduction for all gems of this level.
     *      For example, setting BoostLevel.UR to 30 means Ultra Rare gems reduce
     *      mission duration by 30%.
     * @param _boostLevel The boost level to configure (C, R, SR, UR, LR, or SPE)
     * @param _boostReduction The percentage reduction (0-100)
     */
    function setGemBoostReduction(
        BoostLevel _boostLevel,
        uint256 _boostReduction
    ) external onlyAdmin() {
        gemBoostReduction[_boostLevel].boostReduction = _boostReduction;
    }

    /**
     * @notice Update the percentage reduction for $LAZY-purchased boosts
     * @dev Admin only. This is the percentage reduction users receive when
     *      purchasing a boost with $LAZY tokens instead of staking a gem.
     * @param _lazyBoostReduction The new percentage reduction (0-100)
     */
    function setLazyBoostReduction(
        uint256 _lazyBoostReduction
    ) external onlyAdmin() {
        lazyBoostReduction = _lazyBoostReduction;
    }

	/**
	 * @notice Set the MissionFactory address for event broadcasting
	 * @dev Admin only. When set, boost activations will also be broadcast through
	 *      the MissionFactory contract for centralized event indexing.
	 *      Set to address(0) to disable factory broadcasting.
	 * @param _missionFactory The address of the MissionFactory contract
	 */
	function setMissionFactory(
		address _missionFactory
	) external onlyAdmin() {
		missionFactory = _missionFactory;
	}

	/**
	 * @notice Update the LazyGasStation contract address
	 * @dev Admin only. The LazyGasStation handles $LAZY token transfers for boost purchases.
	 *      Useful when redeploying infrastructure contracts.
	 * @param _lazyGasStation The address of the new LazyGasStation contract
	 */
	function setLazyGasStation(
		address _lazyGasStation
	) external onlyAdmin() {
		lazyGasStation = ILazyGasStation(_lazyGasStation);
	}

    /**
     * @notice Add an NFT collection as eligible for a specific boost level
     * @dev Admin only. All serials from this collection will be eligible for boosts.
     *      The contract will associate with the token to enable receiving NFTs.
     *      If the collection is already registered (at any level), use
     *      addCollectionToBoostLevelWithLockedSerials to add specific serials.
     * @param _boostLevel The boost level to register the collection at (C, R, SR, UR, LR, or SPE)
     * @param _collectionAddress The NFT collection address to add
     */
    function addCollectionToBoostLevel(
        BoostLevel _boostLevel,
        address _collectionAddress
    ) external onlyAdmin() {
		// if the collection is not already present - revert suggesting serial lock
		require(!gemSet.contains(_collectionAddress), "already added - use serial lock");
        gemBoostReduction[_boostLevel].collectionAddress.add(_collectionAddress);
		gemSet.add(_collectionAddress);

        tokenAssociate(_collectionAddress);
    }

	/**
	 * @notice Add an NFT collection with specific serial restrictions to a boost level
	 * @dev Admin only. Only the specified serials will be eligible for boosts.
	 *      This allows the same collection to have different serials at different
	 *      rarity levels (e.g., serials 1-10 are UR, serials 11-100 are R).
	 *      Will only associate with the token if this is the first time adding this collection.
	 * @param _boostLevel The boost level to register the serials at (C, R, SR, UR, LR, or SPE)
	 * @param _collectionAddress The NFT collection address
	 * @param _serials Array of specific token IDs (serials) that are eligible at this level
	 */
	function addCollectionToBoostLevelWithLockedSerials(
		BoostLevel _boostLevel,
        address _collectionAddress,
		uint256[] memory _serials
    ) external onlyAdmin() {
		gemBoostReduction[_boostLevel].collectionAddress.add(_collectionAddress);
		gemBoostReduction[_boostLevel].serialLocked[_collectionAddress] = true;
		for (uint256 i = 0; i < _serials.length;) {
			gemBoostReduction[_boostLevel].serials[_collectionAddress].add(_serials[i]);
			unchecked { ++i; }
		}
		bool added = gemSet.add(_collectionAddress);

		if (added) {
			tokenAssociate(_collectionAddress);
		}
	}

    /**
     * @notice Remove an NFT collection from a boost level
     * @dev Admin only. The collection must be currently registered.
     *      Note: This does not clear serial locks or serial data - if re-adding
     *      the collection later, previous serial data may still exist.
     *      Ensure no users have active boosts with NFTs from this collection before removing.
     * @param _boostLevel The boost level to remove the collection from
     * @param _collectionAddress The NFT collection address to remove
     */
    function removeCollectionFromBoostLevel(
        BoostLevel _boostLevel,
        address _collectionAddress
    ) external onlyAdmin() {
		require(gemSet.contains(_collectionAddress), "Collection not present");
        gemBoostReduction[_boostLevel].collectionAddress.remove(_collectionAddress);
		gemSet.remove(_collectionAddress);
    }

	/**
	 * @notice Set the percentage of $LAZY fees that are burned
	 * @dev Admin only. When users purchase boosts with $LAZY, this percentage
	 *      of the cost is burned rather than collected. Burning reduces
	 *      total token supply.
	 * @param _feeBurnPercentage The percentage to burn (0-100)
	 */
	function setLazyBurnPercentage(
		uint256 _feeBurnPercentage
	) external onlyAdmin() {
		feeBurnPercentage = _feeBurnPercentage;
	}

	/**
	 * @notice Add a new admin address
	 * @dev Current admin only. Admins can manage boost configurations,
	 *      add/remove collections, adjust costs, and withdraw funds.
	 * @param _admin The address to grant admin privileges to
	 * @return True if the admin was added, false if already an admin
	 */
	function addAdmin(
        address _admin
    ) external onlyAdmin() returns (bool) {
        return admins.add(_admin);
    }

	/**
	 * @notice Remove an admin address
	 * @dev Current admin only. Cannot remove the last admin to prevent
	 *      the contract from becoming unmanageable.
	 * @param _admin The address to revoke admin privileges from
	 * @return True if the admin was removed, false if not an admin
	 */
	function removeAdmin(
		address _admin
	) external onlyAdmin() returns (bool) {
		//check if admin is the last one
		require(admins.length() > 1, "Last Admin");
		return admins.remove(_admin);
	}

	/**
	 * @notice Internal function to emit boost events locally and to MissionFactory
	 * @dev Emits BoostActivated event from this contract. If missionFactory is set,
	 *      also calls the factory to emit a centralized event for easier indexing.
	 * @param _mission The mission contract address where the boost was applied
	 * @param _boostReduction The percentage reduction applied
	 * @param _newEndMission The new mission end timestamp
	 * @param _newMissionDuration The new total mission duration
	 * @param _boostType The type of boost used (LAZY or GEM)
	 */
	function broadcastBoost(
		address _mission,
		uint256 _boostReduction,
		uint256 _newEndMission,
		uint256 _newMissionDuration,
		BoostType _boostType
	) internal {

		emit BoostActivated(
            _mission,
            msg.sender,
            _boostReduction,
            _newEndMission,
            _newMissionDuration,
			_boostType
        );

		if (missionFactory != address(0)) {
			IMissionFactory(missionFactory).broadcastMissionBoost(
			_mission,
			msg.sender,
			_boostReduction,
			_newEndMission,
			_newMissionDuration,
			_boostType
			);
		}
	}

	/**
	 * @notice Withdraw $LAZY tokens from this contract to a specified receiver
	 * @dev Admin only. Note: Function name has a typo ("retieveLazy" instead of "retrieveLazy")
	 *      which is preserved for compatibility with the deployed contract.
	 *      Uses HTS transferToken to move tokens.
	 * @param _receiver The address to receive the $LAZY tokens
	 * @param _amount The amount of $LAZY to transfer (in tinybar/smallest unit)
	 */
	function retieveLazy(
		address _receiver,
		int64 _amount
	) external onlyAdmin() {
		// given latest Hedera security model need to move to allowance spends
		int256 responseCode = transferToken(
			lazyToken,
			address(this),
			_receiver,
			_amount
		);

		if (responseCode != HederaResponseCodes.SUCCESS) {
			revert("transferHTS - failed");
		}
	}

	/**
	 * @notice Withdraw HBAR from this contract to a specified receiver
	 * @dev Admin only. If there are NFTs currently staked as boosts (liveBoosts > 0),
	 *      at least 10 HBAR must remain in the contract to ensure sufficient balance
	 *      for Hedera smart contract rent payments.
	 * @param receiverAddress The payable address to receive the HBAR (EVM format)
	 * @param amount The amount of HBAR to transfer (in tinybar)
	 */
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyAdmin()
    {
		if (receiverAddress == address(0) || amount == 0) {
			revert("Invalid address or amount");
		}

		// if there are liveBoosts ensure at least 10 hbar is left behind
		// this gives certainty on Smart Contract Rent
		if (liveBoosts > 0) {
			uint256 balance = address(this).balance;
			if (balance - amount < 10 ) {
				revert("Boosts Active - Min Bal 10");
			}
		}

		Address.sendValue(receiverAddress, amount);
    }

	/**
	 * @notice Receive function to accept HBAR transfers
	 * @dev Emits a BoostMessage event when HBAR is received via direct transfer.
	 *      This allows the contract to hold HBAR for operational needs like
	 *      smart contract rent payments.
	 */
    receive() external payable {
        emit BoostMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

	/**
	 * @notice Fallback function to accept HBAR transfers with data
	 * @dev Emits a BoostMessage event when HBAR is received via calls with data
	 *      that don't match any function selector.
	 */
    fallback() external payable {
        emit BoostMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
