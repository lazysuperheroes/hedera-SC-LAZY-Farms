// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Farming mission
/// @author hich.eth
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract allows users to stake their assets (NFT/Token) depending on the
/// remaining slots available. After a certain amount of time they will be able to claim the
/// staking rewards.
/// @dev now uses hbar for royalty handling currently

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";

import {TokenStaker} from "./TokenStaker.sol";
import {IMissionFactory} from "./interfaces/IMissionFactory.sol";
import {IBoostManager} from "./interfaces/IBoostManager.sol";
import {IMission} from "./interfaces/IMission.sol";
import {IRoles} from "./interfaces/IRoles.sol";

contract Mission is TokenStaker, IMission, IRoles, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeCast for uint256;

    error UsersOnMission();

    event FallbackEvent(address, address, string);
    event MissionCompleted(address indexed wallet, uint256 timestamp);

    event MissionJoined(
        address _user,
        uint256 _entryTimestamp,
        uint256 _endOfMissionTimestamp
    );

    event SlotsRemaining(uint256 _slotsRemaining, uint256 _timestamp);

    struct MissionParticipation {
        address[] collections;
        uint256[][] serials;
        uint256 entryTimestamp;
        uint256 endOfMission;
    }

    struct MissionState {
        IMissionFactory factory;
        address missionCreator;
        uint256 missionDuration;
        uint256 entryFee;
        uint256 feeBurnPercentage;
        uint256 lastEntryTimestamp;
        uint256 startTimestamp;
        uint256 minEntryFee;
        uint32 decrementAmount;
        uint32 decrementInterval;
        uint32 totalSerialsAsRewards;
        uint8 nbOfRewards;
        uint8 nbOfRequirements;
    }
    struct MissionRequirements {
        bool limitedSerials;
        EnumerableSet.UintSet serials;
    }

    IMissionFactory public missionFactory;
    mapping(address => MissionParticipation) private missionParticipants;
    mapping(address => MissionRequirements) private missionRequirements;
    mapping(address => uint256[]) private missionRewards;

    uint16 public activeParticipants;
    address public boostManager;
    MissionState public missionState;
    uint256 public slotsAvailable;
    address public prngGenerator;
    bool public isPaused;
    bool private isInitialized;

    EnumerableSet.AddressSet private missionRequirementsSet;
    EnumerableSet.AddressSet private missionRewardsSet;
    EnumerableSet.AddressSet private missionRewardsUniverseSet;
    EnumerableSet.AddressSet private missionParticipantsSet;

    modifier onlyParticipant() {
        require(
            missionParticipants[msg.sender].endOfMission != 0,
            "No mission active"
        );
        _;
    }

    modifier onlyBooster() {
        if (msg.sender != boostManager)
            revert PermissionDenied(msg.sender, Role.BoostManager);
        _;
    }

    modifier onlyAdminOrCreator() {
        if (!isAdmin(msg.sender))
            revert PermissionDenied(msg.sender, Role.Admin);
        _;
    }

    /**
     * @notice Initializes a new mission instance with the provided configuration
     * @dev Called once after clone deployment by MissionFactory. Sets up mission parameters,
     *      associates required tokens, and initializes the mission in a paused state.
     *      Reverts if already initialized or if critical parameters are zero/empty.
     * @param _missionDuration The duration of the mission in seconds that users must stake
     * @param _entryFee The $LAZY token fee required to enter the mission (in token units with decimals)
     * @param _missionRequirements Array of NFT collection addresses that users must stake to enter
     * @param _missionRewards Array of NFT collection addresses that will be used as rewards
     * @param _feeBurnPercentage Percentage of entry fee to burn (0-100)
     * @param _lastEntryTimestamp Unix timestamp after which no new entries are allowed
     * @param _missionCreator Address of the mission creator who has admin privileges
     * @param _missionFactory Address of the MissionFactory contract that deployed this mission
     * @param _numberOfRequirements Total number of NFT serials required to enter the mission
     * @param _numberOfRewards Number of NFT rewards given per mission completion
     */
    function initialize(
        uint256 _missionDuration,
        uint256 _entryFee,
        address[] memory _missionRequirements,
        address[] memory _missionRewards,
        uint256 _feeBurnPercentage,
        uint256 _lastEntryTimestamp,
        address _missionCreator,
        address _missionFactory,
        uint8 _numberOfRequirements,
        uint8 _numberOfRewards
    ) external {
        require(!isInitialized, "Already initialized");
        if (
            _missionDuration == 0 ||
            _numberOfRewards == 0 ||
            _numberOfRequirements == 0 ||
            _missionCreator == address(0)
        ) {
            revert BadArgument();
        }

        isInitialized = true;

        missionFactory = IMissionFactory(_missionFactory);
        initContracts(
            missionFactory.lazyToken(),
            missionFactory.lazyGasStation(),
            missionFactory.lazyDelegateRegistry()
        );
        boostManager = missionFactory.boostManager();
        prngGenerator = missionFactory.prngGenerator();

        missionState = MissionState(
            missionFactory,
            _missionCreator,
            _missionDuration,
            _entryFee,
            _feeBurnPercentage,
            _lastEntryTimestamp,
            0,
            0,
            0,
            0,
            0,
            _numberOfRewards,
            _numberOfRequirements
        );

        addRequirementAndRewardCollections(
            _missionRequirements,
            _missionRewards
        );

        isPaused = true;
    }

    /**
     * @notice Adds NFT collections that can be used as requirements or rewards for the mission
     * @dev Associates each collection token with this contract via HTS. Can only be called
     *      when no users are actively participating in the mission. Duplicate collections
     *      are handled gracefully (no re-association).
     * @param _missionRequirements Array of NFT collection addresses to add as valid entry requirements
     * @param _missionRewards Array of NFT collection addresses to add to the reward pool universe
     */
    function addRequirementAndRewardCollections(
        address[] memory _missionRequirements,
        address[] memory _missionRewards
    ) public onlyAdminOrCreator {
        if (activeParticipants != 0) {
            revert UsersOnMission();
        }
        //link each requirement to its token address
        uint256 loopLength = _missionRequirements.length;
        for (uint256 i = 0; i < loopLength; ) {
            bool added = missionRequirementsSet.add(_missionRequirements[i]);
            if (added) {
                tokenAssociate(_missionRequirements[i]);
            }

            unchecked {
                ++i;
            }
        }

        //link each reward to its token address
        loopLength = _missionRewards.length;
        for (uint256 i = 0; i < loopLength; ) {
            bool added = missionRewardsUniverseSet.add(_missionRewards[i]);
            if (added) {
                tokenAssociate(_missionRewards[i]);
            }

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Adds specific serial numbers as valid requirements for a collection
     * @dev When serials are added, the collection becomes "limited" meaning only
     *      those specific serials can be used to enter the mission. The collection
     *      must already be registered as a requirement collection.
     * @param _collectionAddress The NFT collection address to add serial restrictions for
     * @param _serials Array of serial numbers that are valid for mission entry
     */
    function addRequirementSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
        if (!missionRequirementsSet.contains(_collectionAddress)) {
            revert BadArgument();
        }
        if (_serials.length == 0) {
            revert BadArgument();
        }

        for (uint256 i = 0; i < _serials.length; i++) {
            missionRequirements[_collectionAddress].serials.add(_serials[i]);
        }

        missionRequirements[_collectionAddress].limitedSerials = true;
    }

    /**
     * @notice Removes specific serial numbers from the valid requirements for a collection
     * @dev If all serials are removed from a collection, the limitedSerials flag is set to false,
     *      allowing any serial from that collection to be used. The collection must already be
     *      registered as a requirement collection.
     * @param _collectionAddress The NFT collection address to remove serial restrictions from
     * @param _serials Array of serial numbers to remove from the valid list
     */
    function removeRequirementSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
        if (!missionRequirementsSet.contains(_collectionAddress)) {
            revert BadArgument();
        }
        if (_serials.length == 0) {
            revert BadArgument();
        }

        for (uint256 i = 0; i < _serials.length; i++) {
            missionRequirements[_collectionAddress].serials.remove(_serials[i]);
        }

        if (missionRequirements[_collectionAddress].serials.length() == 0) {
            missionRequirements[_collectionAddress].limitedSerials = false;
        }
    }

    /**
     * @notice Adds NFT serials as rewards to the mission reward pool
     * @dev Transfers the specified NFTs from the caller to this contract. Updates the
     *      available slots based on total rewards divided by rewards per completion.
     *      No admin check - anyone can add rewards to expand the mission capacity.
     *      The collection must already be in the reward universe set.
     * @param _collectionAddress The NFT collection address for the reward NFTs
     * @param _serials Array of serial numbers to add as rewards (transferred from caller)
     */
    function addRewardSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external {
        if (!missionRewardsUniverseSet.contains(_collectionAddress)) {
            revert BadArgument();
        }
        if (_serials.length == 0) {
            revert BadArgument();
        }
        // not adding admin check, if someone else wants to add slots...fine?!

        for (uint256 i = 0; i < _serials.length; i++) {
            missionRewards[_collectionAddress].push(_serials[i]);
        }

        // check the reward is in the live set
        if (!missionRewardsSet.contains(_collectionAddress)) {
            missionRewardsSet.add(_collectionAddress);
        }

        // use batch move to allow for simplified interactions
        // no need to delegate the rewards back as ownership is intended to be transferred
        batchMoveNFTs(
            TransferDirection.STAKING,
            _collectionAddress,
            _serials,
            msg.sender,
            false
        );

        // keep track of the total number of collateral items as rewards allows us to
        // add rewards as singles and still have the correct number of slots available
        missionState.totalSerialsAsRewards += _serials.length.toUint32();

        slotsAvailable =
            missionState.totalSerialsAsRewards /
            missionState.nbOfRewards;

        broadcastSlotsRemaining(slotsAvailable - activeParticipants);
    }

    /**
     * @notice Returns the number of available slots remaining in the mission
     * @dev Calculated as total slots (based on rewards) minus active participants
     * @return _slotsRemaining The number of slots still available for new participants
     */
    function getSlotsRemaining()
        external
        view
        returns (uint256 _slotsRemaining)
    {
        return slotsAvailable - activeParticipants;
    }

    /**
     * @notice Updates the pause status of the mission
     * @dev Missions start life paused after initialization. When paused, no new entries
     *      are allowed but existing participants can still claim rewards or leave.
     *      Only admins or the mission creator can update pause status.
     * @param _paused True to pause the mission, false to unpause and allow entries
     */
    function updatePauseStatus(bool _paused) external onlyAdminOrCreator {
        isPaused = _paused;
    }

    /**
     * @notice Sets the timestamp when the mission opens for entry
     * @dev If set to 0, the mission is effectively open immediately (subject to pause status).
     *      If set to a future timestamp, entries are blocked until that time.
     *      Only admins or the mission creator can update this value.
     * @param _startTimestamp Unix timestamp when entries should be allowed (0 for immediate)
     */
    function setStartTimestamp(
        uint256 _startTimestamp
    ) external onlyAdminOrCreator {
        missionState.startTimestamp = _startTimestamp;
    }

    /**
     * @notice Returns all reward collections and their available serial numbers
     * @dev Returns the current state of the reward pool. As rewards are claimed,
     *      the returned arrays will shrink. Empty collections are removed from the set.
     * @return _rewards Array of NFT collection addresses in the active reward pool
     * @return _rewardSerials 2D array of serial numbers available for each collection
     */
    function getRewards()
        external
        view
        returns (address[] memory _rewards, uint256[][] memory _rewardSerials)
    {
        _rewards = new address[](missionRewardsSet.length());
        _rewardSerials = new uint256[][](missionRewardsSet.length());
        for (uint256 i = 0; i < missionRewardsSet.length(); i++) {
            _rewards[i] = missionRewardsSet.at(i);
            _rewardSerials[i] = missionRewards[missionRewardsSet.at(i)];
        }
        return (_rewards, _rewardSerials);
    }

    /**
     * @notice Allows a user to enter the mission by staking required NFTs
     * @dev Validates mission is open, has slots, and user meets all requirements.
     *      Transfers NFTs from user to contract (supports delegation). Charges entry fee
     *      via LazyGasStation with configured burn percentage. User can only have one
     *      active participation at a time.
     * @param _collectionAddress Array of NFT collection addresses being staked
     * @param _serials 2D array of serial numbers for each collection (must total nbOfRequirements)
     */
    function enterMission(
        address[] memory _collectionAddress,
        uint256[][] memory _serials
    ) external {
        require(!isPaused, "Mission paused");
        require(
            slotsAvailable != 0 && slotsAvailable > activeParticipants,
            "No more slots available"
        );
        require(
            missionState.startTimestamp == 0 ||
                block.timestamp > missionState.startTimestamp,
            "Mission not open yet"
        );
        require(
            block.timestamp < missionState.lastEntryTimestamp,
            "Mission closed"
        );

        require(
            missionParticipants[msg.sender].endOfMission == 0,
            "Already joined"
        );

        // block off the slot early. If the staking fails, the slot will be freed up again
        activeParticipants++;

        missionParticipantsSet.add(msg.sender);

        broadcastSlotsRemaining(slotsAvailable - activeParticipants);

        lazyGasStation.drawLazyFrom(
            msg.sender,
            entryFee(),
            missionState.feeBurnPercentage
        );

        uint256 totalSerials = 0;
        //check if serials are allowed + number of serials matches the number of requirements
        for (uint256 i = 0; i < _collectionAddress.length; i++) {
            require(
                missionRequirementsSet.contains(_collectionAddress[i]),
                "Collection not included"
            );

            // if serials are limited check they are all valid
            if (missionRequirements[_collectionAddress[i]].limitedSerials) {
                for (uint256 j = 0; j < _serials[i].length; j++) {
                    require(
                        missionRequirements[_collectionAddress[i]]
                            .serials
                            .contains(_serials[i][j]),
                        "Serials not authorized"
                    );
                }
            }

            // using batch move to allow > 8 tokens to be used for an entry condition
            batchMoveNFTs(
                TransferDirection.STAKING,
                _collectionAddress[i],
                _serials[i],
                msg.sender,
                true
            );

            totalSerials += _serials[i].length;
        }

        require(
            totalSerials == missionState.nbOfRequirements,
            "Invalid requirement number"
        );

        //Add participant to the mission
        missionParticipants[msg.sender] = MissionParticipation(
            _collectionAddress,
            _serials,
            block.timestamp,
            block.timestamp + missionState.missionDuration
        );

        broadcastMissionJoined(
            msg.sender,
            missionParticipants[msg.sender].endOfMission
        );
    }

    /**
     * @notice Returns all wallet addresses currently participating in the mission
     * @dev Returns the full list of active participants. List is updated when users
     *      enter or leave the mission.
     * @return _users Array of wallet addresses currently on the mission
     */
    function getUsersOnMission()
        external
        view
        returns (address[] memory _users)
    {
        return missionParticipantsSet.values();
    }

    /**
     * @notice Returns the full participation details for a user on this mission
     * @dev More gas efficient than returning the struct directly. Returns empty/zero values
     *      if the user is not currently participating.
     * @param _user The wallet address to query participation for
     * @return _stakedNFTs Array of NFT collection addresses the user has staked
     * @return _stakedSerials 2D array of serial numbers staked for each collection
     * @return _entryTimestamp Unix timestamp when the user entered the mission
     * @return _endOfMissionTimestamp Unix timestamp when the user can claim rewards
     * @return _boosted Whether the user has an active boost reducing their mission duration
     */
    function getMissionParticipation(
        address _user
    )
        external
        view
        returns (
            address[] memory _stakedNFTs,
            uint256[][] memory _stakedSerials,
            uint256 _entryTimestamp,
            uint256 _endOfMissionTimestamp,
            bool _boosted
        )
    {
        return (
            missionParticipants[_user].collections,
            missionParticipants[_user].serials,
            missionParticipants[_user].entryTimestamp,
            missionParticipants[_user].endOfMission,
            IBoostManager(boostManager).hasBoost(_user, address(this))
        );
    }

    /**
     * @notice Returns the mission end timestamp and boost status for a user
     * @dev Lightweight query for UI display of mission progress and boost status
     * @param _user The wallet address to query
     * @return _endOfMissionTimestamp Unix timestamp when the user can claim rewards (0 if not participating)
     * @return boosted Whether the user has an active boost on this mission
     */
    function getUserEndAndBoost(
        address _user
    ) external view returns (uint256 _endOfMissionTimestamp, bool boosted) {
        return (
            missionParticipants[_user].endOfMission,
            IBoostManager(boostManager).hasBoost(_user, address(this))
        );
    }

    /**
     * @notice Returns detailed boost information for a user on this mission
     * @dev Queries the BoostManager for the specific boost item being used (if any)
     * @param _user The wallet address to query boost info for
     * @return _boostType The type of boost (None, Gem, or Lazy token)
     * @return _collection The NFT collection address if using a gem boost (zero address otherwise)
     * @return serial The serial number of the gem NFT if using gem boost (0 otherwise)
     */
    function getUsersBoostInfo(
        address _user
    )
        external
        view
        returns (
            IBoostManager.BoostType _boostType,
            address _collection,
            uint256 serial
        )
    {
        return IBoostManager(boostManager).getBoostItem(address(this), _user);
    }

    /**
     * @notice Returns all requirement collections and their serial restrictions
     * @dev Returns the full configuration of which NFT collections and serials can be used
     *      to enter the mission. Collections without serial limits will have empty arrays.
     * @return _requirements Array of NFT collection addresses that can be used for entry
     * @return _limitedSerials Array of booleans indicating if each collection has serial restrictions
     * @return _requirementSerials 2D array of allowed serial numbers for each limited collection
     */
    function getRequirements()
        external
        view
        returns (
            address[] memory _requirements,
            bool[] memory _limitedSerials,
            uint256[][] memory _requirementSerials
        )
    {
        _requirements = new address[](missionRequirementsSet.length());
        _limitedSerials = new bool[](missionRequirementsSet.length());
        _requirementSerials = new uint256[][](missionRequirementsSet.length());
        for (uint256 i = 0; i < missionRequirementsSet.length(); i++) {
            _requirements[i] = missionRequirementsSet.at(i);
            _limitedSerials[i] = missionRequirements[
                missionRequirementsSet.at(i)
            ].limitedSerials;
            if (_limitedSerials[i])
                _requirementSerials[i] = missionRequirements[
                    missionRequirementsSet.at(i)
                ].serials.values();
        }
        return (_requirements, _limitedSerials, _requirementSerials);
    }

    function broadcastSlotsRemaining(uint256 slots) internal {
        missionState.factory.broadcastSlotsRemaining(slots);
        emit SlotsRemaining(slots, block.timestamp);
    }

    function broadcastMissionComplete(address wallet) internal {
        missionState.factory.broadcastMissionComplete(wallet);
        emit MissionCompleted(wallet, block.timestamp);
    }

    function broadcastMissionJoined(
        address wallet,
        uint256 endOfMissionTimestamp
    ) internal {
        missionState.factory.broadcastMissionJoined(
            wallet,
            endOfMissionTimestamp
        );
        emit MissionJoined(wallet, block.timestamp, endOfMissionTimestamp);
    }

    /**
     * @notice Allows a participant to claim their randomized NFT rewards after mission completion
     * @dev Uses Hedera PRNG to randomly select rewards from the available pool. Transfers
     *      the configured number of reward NFTs to the caller. Automatically calls leaveMission()
     *      to return staked NFTs. Protected by nonReentrant modifier to prevent exploits.
     *      Reverts if mission duration has not elapsed.
     */
    function claimRewards() external onlyParticipant nonReentrant {
        require(
            block.timestamp >= missionParticipants[msg.sender].endOfMission,
            "Mission not finished"
        );

        for (uint256 i = 0; i < missionState.nbOfRewards; i++) {
            uint256 randRewardIndex = IPrngSystemContract(prngGenerator)
                .getPseudorandomNumber(0, missionRewardsSet.length(), 0);
            address rewardAddress = missionRewardsSet.at(randRewardIndex);
            uint256 randSerialIndex = IPrngSystemContract(prngGenerator)
                .getPseudorandomNumber(
                    0,
                    missionRewards[rewardAddress].length,
                    1
                );

            uint256[] memory serials = new uint256[](1);
            serials[0] = missionRewards[rewardAddress][randSerialIndex];

            // singular move per reward
            // using batchMove to ensure refill() is called
            // no need to revoke delegation as ownership is intended to be transferred
            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                rewardAddress,
                serials,
                msg.sender,
                false
            );

            // remove serial from list of rewards
            missionRewards[rewardAddress][randSerialIndex] = missionRewards[
                rewardAddress
            ][missionRewards[rewardAddress].length - 1];
            missionRewards[rewardAddress].pop();

            // Required to ensure the rewards picked from are only those stored at the contract
            // Keeping a second master list to allow more collateral to be pushed up
            if (missionRewards[rewardAddress].length == 0) {
                missionRewardsSet.remove(rewardAddress);
                delete missionRewards[rewardAddress];
            }
        }

        //if rewards are claimed the slots available should be decremented
        slotsAvailable--;

        // action to leave is seperated to allow the user an emergency escape hatch
        leaveMission();
        broadcastMissionComplete(msg.sender);
    }

    /**
     * @notice Allows a participant to exit the mission and withdraw their staked NFTs
     * @dev Emergency escape hatch that allows users to leave without claiming rewards.
     *      Returns all staked NFTs to the user, ends any active boost, and frees up
     *      the mission slot. Called automatically by claimRewards() after reward distribution.
     *      Can be called at any time by an active participant.
     */
    function leaveMission() public onlyParticipant {
        IBoostManager boostManagerContract = IBoostManager(boostManager);
        if (boostManagerContract.hasBoost(msg.sender, address(this)))
            boostManagerContract.endMissionBoost(msg.sender);

        for (
            uint256 i = 0;
            i < missionParticipants[msg.sender].collections.length;
            i++
        ) {
            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                missionParticipants[msg.sender].collections[i],
                missionParticipants[msg.sender].serials[i],
                msg.sender,
                true
            );
        }
        delete missionParticipants[msg.sender];
        activeParticipants--;
        missionParticipantsSet.remove(msg.sender);

        broadcastSlotsRemaining(slotsAvailable - activeParticipants);
    }

    /**
     * @notice Reduces the remaining mission duration for a participant by a percentage
     * @dev Only callable by the BoostManager contract. Calculates the new end time based on
     *      elapsed time and applies the boost reduction to the remaining duration only.
     *      For example, a 50% boost with 60 seconds elapsed of 100 second mission would
     *      reduce remaining 40 seconds to 20 seconds.
     * @param _wallet The address of the mission participant to boost
     * @param _boostReduction The percentage reduction to apply (0-100, where 50 = 50% faster)
     * @return The new end of mission timestamp
     * @return The new remaining mission duration in seconds
     */
    function reduceStakingPeriod(
        address _wallet,
        uint256 _boostReduction
    ) external onlyBooster returns (uint256, uint256) {
        require(
            missionParticipants[_wallet].endOfMission != 0,
            "No staking found"
        );

        require(_boostReduction <= 100, "Invalid arg");

        uint256 boostAmount = 100 - _boostReduction;

        uint256 timeElapsed = block.timestamp -
            missionParticipants[_wallet].entryTimestamp;

        uint256 newMissionDuration = ((missionState.missionDuration -
            timeElapsed) * boostAmount) / 100;

        missionParticipants[_wallet].endOfMission =
            missionParticipants[_wallet].entryTimestamp +
            timeElapsed +
            newMissionDuration;

        return (missionParticipants[_wallet].endOfMission, newMissionDuration);
    }

    /**
     * @notice Permanently closes the mission and withdraws all remaining rewards
     * @dev One-way operation that cannot be undone. Sets lastEntryTimestamp to now and
     *      slotsAvailable to 0. Withdraws all remaining reward NFTs to the caller.
     *      Transfers any accumulated $LAZY and HBAR to the MissionFactory.
     *      Notifies the MissionFactory that this mission is closed.
     *      Can only be called when there are no active participants.
     */
    function closeMission() external onlyAdminOrCreator {
        if (activeParticipants != 0) {
            revert UsersOnMission();
        }

        // lock down the mission
        missionState.lastEntryTimestamp = block.timestamp;
        slotsAvailable = 0;

        // iterate through all rewards descending and withdraw
        while (missionRewardsSet.length() > 0) {
            address rewardAddress = missionRewardsSet.at(0);
            uint256[] memory serials = missionRewards[rewardAddress];
            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                missionRewardsSet.at(0),
                serials,
                msg.sender,
                false
            );
            // remove serial list from rewards
            delete missionRewards[rewardAddress];
            // remove reward from set
            missionRewardsSet.remove(rewardAddress);
        }

        // no more slots ever available
        broadcastSlotsRemaining(slotsAvailable);

        // send any $LAZY to the MissionFactory
        if (IERC20(lazyToken).balanceOf(address(this)) > 0) {
            bool result = IERC20(lazyToken).transfer(
                address(missionFactory),
                IERC20(lazyToken).balanceOf(address(this))
            );
            require(result, "Tfr fail");
        }

        // send any hbar to the MissionFactory
        if (address(this).balance > 0)
            Address.sendValue(
                payable(address(missionFactory)),
                address(this).balance
            );

        missionFactory.closeMission(address(this));
    }

    /**
     * @notice Withdraws specific reward NFTs from the mission without closing it
     * @dev Allows partial withdrawal of rewards. Updates slotsAvailable based on remaining
     *      rewards. Collection must be in the reward universe set. Only allowed when there
     *      are no active participants to prevent bait-and-switch scenarios where collateral
     *      changes between user entry and exit.
     * @param _collectionAddress The NFT collection address to withdraw from
     * @param _serials Array of serial numbers to withdraw (transferred to caller)
     */
    function withdrawRewards(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
        if (activeParticipants != 0) {
            revert UsersOnMission();
        }
        if (!missionRewardsUniverseSet.contains(_collectionAddress)) {
            revert BadArgument();
        }
        if (_serials.length == 0) {
            revert BadArgument();
        }

        // if there are no rewards known to the contract then we do not need to run check logic.
        if (missionRewards[_collectionAddress].length != 0) {
            // check the serials the contract knows of
            uint32 countToRemove = 0;
            for (uint256 i = 0; i < _serials.length; i++) {
                for (
                    uint256 j = 0;
                    j < missionRewards[_collectionAddress].length;
                    j++
                ) {
                    if (_serials[i] == missionRewards[_collectionAddress][j]) {
                        countToRemove++;
                        // remove serial from knownSerials
                        missionRewards[_collectionAddress][j] = missionRewards[
                            _collectionAddress
                        ][missionRewards[_collectionAddress].length - 1];
                        missionRewards[_collectionAddress].pop();
                    }
                }
            }

            missionState.totalSerialsAsRewards -= countToRemove;

            slotsAvailable =
                missionState.totalSerialsAsRewards /
                missionState.nbOfRewards;
        }

        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            _collectionAddress,
            _serials,
            msg.sender,
            false
        );

        if (missionRewards[_collectionAddress].length == 0) {
            missionRewardsSet.remove(_collectionAddress);
            delete missionRewards[_collectionAddress];
        }

        broadcastSlotsRemaining(slotsAvailable - activeParticipants);
    }

    /**
     * @notice Calculates and returns the current entry fee for the mission
     * @dev Supports decreasing entry fees over time (auction-style). If decrementAmount and
     *      decrementInterval are set, the fee decreases periodically from startTimestamp.
     *      Returns the base entryFee if decrement is not configured or mission hasn't started.
     *      Fee will not go below minEntryFee.
     * @return _entryFee The current entry fee in $LAZY tokens (with decimals)
     */
    function entryFee() public view returns (uint256 _entryFee) {
        if (
            block.timestamp < missionState.startTimestamp ||
            missionState.startTimestamp == 0 ||
            missionState.decrementAmount == 0 ||
            missionState.decrementInterval == 0
        ) return missionState.entryFee;
        else {
            uint256 timeSinceStart = block.timestamp -
                missionState.startTimestamp;
            uint256 decrements = timeSinceStart /
                missionState.decrementInterval;
            uint256 newFee;
            if (
                (decrements * missionState.decrementAmount) <
                missionState.entryFee
            ) {
                newFee =
                    missionState.entryFee -
                    (decrements * missionState.decrementAmount);
            } else {
                newFee = 0;
            }

            if (newFee < missionState.minEntryFee)
                return missionState.minEntryFee;
            else return newFee;
        }
    }

    /**
     * @notice Returns the decrement configuration for auction-style entry fees
     * @dev Helper function for frontends to efficiently calculate and display
     *      the current entry fee and countdown timer for Dutch auction entries.
     * @return _decrementInterval The interval in seconds between fee decrements
     * @return _startTimestamp The Unix timestamp when the mission opens and countdown starts
     */
    function getDecrementDetails()
        external
        view
        returns (uint32 _decrementInterval, uint256 _startTimestamp)
    {
        return (missionState.decrementInterval, missionState.startTimestamp);
    }

    /**
     * @notice Configures a Dutch auction-style decreasing entry fee for the mission
     * @dev Sets up automatic fee reduction over time. The fee starts at missionState.entryFee
     *      and decreases by decrementAmount every decrementInterval seconds until it reaches
     *      minEntryFee. Automatically unpauses the mission when called.
     * @param _startTimestamp Unix timestamp when the mission opens and fee countdown begins
     * @param _minEntryFee Floor price for the entry fee in $LAZY tokens (with decimals)
     * @param _decrementAmount Amount to reduce the fee by each interval (in $LAZY with decimals)
     * @param _decrementInterval Time in seconds between each fee reduction
     */
    function setDecreasingEntryFee(
        uint256 _startTimestamp,
        uint256 _minEntryFee,
        uint32 _decrementAmount,
        uint32 _decrementInterval
    ) external onlyAdminOrCreator {
        require(_decrementAmount > 0, "Decrement amount > 0");
        require(_decrementInterval > 0, "Decrement interval > 0");

        missionState.startTimestamp = _startTimestamp;
        missionState.minEntryFee = _minEntryFee;
        missionState.decrementAmount = _decrementAmount;
        missionState.decrementInterval = _decrementInterval;

        isPaused = false;
    }

    /**
     * @notice Checks if a wallet address is currently participating in the mission
     * @dev Returns true if the user has a non-zero endOfMission timestamp
     * @param _wallet The wallet address to check
     * @return _isParticipant True if the wallet is currently on the mission
     */
    function isParticipant(
        address _wallet
    ) external view returns (bool _isParticipant) {
        return missionParticipants[_wallet].endOfMission != 0;
    }

    /**
     * @notice Transfers HBAR from the mission contract to a specified address
     * @dev Only allowed when there are no active participants to prevent fund manipulation
     *      during active missions. Only admins or mission creator can call.
     * @param receiverAddress The payable address to receive the HBAR (EVM format)
     * @param amount The amount of HBAR to transfer in tinybar (1 HBAR = 100,000,000 tinybar)
     */
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyAdminOrCreator {
        if (receiverAddress == address(0) || amount == 0) {
            revert("Invalid address or amount");
        }

        // only allow hbar to be transferred when there are no active participants
        if (activeParticipants != 0) {
            revert UsersOnMission();
        }

        Address.sendValue(receiverAddress, amount);
    }

    /**
     * @notice Transfers $LAZY tokens from the mission contract to a specified address
     * @dev Only allowed when there are no active participants to prevent fund manipulation.
     *      Uses HTS transferToken for the transfer. Only admins or mission creator can call.
     * @param _receiver The address to receive the $LAZY tokens
     * @param _amount The amount of $LAZY tokens to transfer (with decimals, as int64 for HTS)
     */
    function retrieveLazy(
        address _receiver,
        int64 _amount
    ) external onlyAdminOrCreator {
        if (activeParticipants != 0) {
            revert UsersOnMission();
        }
        if (_receiver == address(0) || _amount == 0) {
            revert("Invalid address or amt");
        }

        int256 responseCode = transferToken(
            lazyToken,
            address(this),
            _receiver,
            _amount
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert("transferHTS - fail");
        }
    }

    /**
     * @notice Checks if a wallet address has admin privileges for this mission
     * @dev Returns true if the wallet is an admin on the MissionFactory OR is the mission creator
     * @param _wallet The wallet address to check for admin privileges
     * @return True if the wallet has admin privileges, false otherwise
     */
    function isAdmin(address _wallet) public view returns (bool) {
        return (missionFactory.isAdmin(_wallet) ||
            _wallet == missionState.missionCreator);
    }

    receive() external payable {
        emit FallbackEvent(
            address(0),
            msg.sender,
            "Receive: Hbar Received by Contract"
        );
    }

    fallback() external payable {
        emit FallbackEvent(address(0), msg.sender, "Fallback Called");
    }
}
