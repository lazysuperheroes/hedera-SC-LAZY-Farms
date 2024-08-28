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
 * @dev This contract handles boosting a mission reducing the staking period
 * @dev Boosts can be acquired by staking NFTs or by purchasing with $LAZY tokens
 */
contract BoostManager is Ownable, TokenStaker, IBoostManager {
	using SafeCast for uint256;
	using SafeCast for int256;
	using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableSet for EnumerableSet.UintSet;

    struct Boost {
        address collectionAddress;
        uint256 tokenId;
    }

    struct GemCardBoost {
		uint256 boostReduction;
        EnumerableSet.AddressSet collectionAddress;
		mapping(address => bool) serialLocked;
		mapping(address => EnumerableSet.UintSet) serials;
    }

    event BoostActivated(
        address _mission,
        address _missionParticipant,
        uint256 _boostReduction,
        uint256 _newEndTimestamp,
        uint256 _newMissionDuration,
		BoostType _boostType
    );

	event BoostMessage(
		string _type,
		address _sender,
		uint256 _amount,
		string _message
	);

	error InvalidArguments();

	EnumerableSet.AddressSet private admins;

    uint256 public lazyBoostCost = 5000; // cost in LAZY
    uint256 public lazyBoostReduction = 10; //reduction in %
    uint256 public feeBurnPercentage;

	address public missionFactory;

	uint256 public liveBoosts;

    mapping(BoostLevel => GemCardBoost) private gemBoostReduction;
    //lists all activate boosts for a user (user address => mission id => isActive)
    mapping(address => mapping(address => bool)) private activeBoosts;
    //lists all staked boosts any mission (mission address => user => {collectionAddress, tokenId})
    mapping(address => mapping(address => Boost)) private stakedBoost;

	EnumerableSet.AddressSet private gemSet;

    modifier onlyActivemission(address _mission) {
        IMission mission = IMission(payable(_mission));
        require(mission.isParticipant(msg.sender), "Not active");
        require(
            activeBoosts[msg.sender][_mission] == false,
            "Boost already active"
        );
        _;
    }

    modifier onlyBoostedMission(address _missionParticipant) {
        require(
            activeBoosts[_missionParticipant][msg.sender] == true,
            "Boost not active"
        );
        _;
    }

	modifier onlyAdmin() {
		require(admins.contains(msg.sender), "Permission Denied - Not Admin");
        _;
    }

    /**
     * @dev Constructor
     * @param _lazyToken Address of the LazyToken contract
     * @param _lazyGS Address of the LazyGasStation contract
	 * @param _lazyDR Address of the LazyDelegateRegistry contract
     * @param _feeBurnPercentage Percentage of the fee that will be burned
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
     * @dev buy boost with $LAZY
     * @param _mission address of mission participant
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
     * @dev get boost by staking NFTs
     * @param _mission address of mission participant
     * @param _collectionAddress address of the collection
     * @param _tokenId id of the token
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
     * @dev use boost in active mission
     * @param _mission address of mission participant
     * @param _boostReduction amount to reduce from staking period
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
     * @dev unstake NFTs : transfers NFT from the contract to user wallet
     * @param _missionParticipant address of mission participant
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
     * @dev return boost to user after a mission ends
     * @param _missionParticipant owner of the permanent boost
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
     * @dev check is a user has a boost for current mission
     * @param _missionParticipant owner of the  boost
     * @param _mission to check
     */
    function hasBoost(
        address _missionParticipant,
        address _mission
    ) public view returns (bool _hasBoost) {
        return activeBoosts[_missionParticipant][_mission];
    }

	/**
	 * @dev get boost level for a  (and serial if applicable!)
	 * @param _collectionAddress address of the collection
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
	 * @dev get the addressess of ALL NFTs useable for a boost
	 */
	function getGemCollections() external view returns (address[] memory _gemCollections) {
		return gemSet.values();
	}

	/**
	 * @dev get the addressess of NFTs for a given boost level
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
	 * @dev get the boost item used by a user
	 * @param _mission address of the mission
	 * @param _user address of the user
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
     * @dev set temporary boost cost
     * @param _lazyBoostCost to set
     */
    function setLazyBoostCost(uint256 _lazyBoostCost) external onlyAdmin() {
        lazyBoostCost = _lazyBoostCost;
    }

    /**
     * @dev update gem boost reduction amount
     * @param _boostLevel boost level
     * @param _boostReduction amount to reduce from staking period
     */
    function setGemBoostReduction(
        BoostLevel _boostLevel,
        uint256 _boostReduction
    ) external onlyAdmin() {
        gemBoostReduction[_boostLevel].boostReduction = _boostReduction;
    }

    /**
     * @dev update boost with lazy
     * @param _lazyBoostReduction amount to reduce from staking period
     */
    function setLazyBoostReduction(
        uint256 _lazyBoostReduction
    ) external onlyAdmin() {
        lazyBoostReduction = _lazyBoostReduction;
    }

	/**
	 * @dev update mission factory address allowing shared event broadcast
	 */
	function setMissionFactory(
		address _missionFactory
	) external onlyAdmin() {
		missionFactory = _missionFactory;
	}

	/**
	 * @dev update lazy gas station address (likely better for full deploy btu good to have options)
	 */
	function setLazyGasStation(
		address _lazyGasStation
	) external onlyAdmin() {
		lazyGasStation = ILazyGasStation(_lazyGasStation);
	}

    /**
     * @dev add collection to boost level
     * @param _boostLevel boost level to add collection to
     * @param _collectionAddress collection address to add
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
     *  @dev remove collection from boost level
     * @param _boostLevel boost level to remove collection from
     * @param _collectionAddress collection address to remove
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
	 * @dev set the percentage of the fee that will be burned
	 * @param _feeBurnPercentage percentage of the fee that will be burned
	 */
	function setLazyBurnPercentage(
		uint256 _feeBurnPercentage
	) external onlyAdmin() {
		feeBurnPercentage = _feeBurnPercentage;
	}

	function addAdmin(
        address _admin
    ) external onlyAdmin() returns (bool) {
        return admins.add(_admin);
    }

	function removeAdmin(
		address _admin
	) external onlyAdmin() returns (bool) {
		//check if admin is the last one
		require(admins.length() > 1, "Last Admin");
		return admins.remove(_admin);
	}

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

	/// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
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

	// allows the contract to recieve HBAR
    receive() external payable {
        emit BoostMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit BoostMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
