// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Farming mission
/// @author hich.eth
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract allows users to stake their assets (NFT/Token) depending on the
/// remaining slots available. After a certain amount of time they will be able to claim the
/// staking rewards.
/// @dev requires FT for royalty handling currently

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

    // fill mission details
    /// @param _missionDuration the duration of the mission in seconds
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
		if (_missionDuration == 0 ||
			_numberOfRewards == 0 ||
			_numberOfRequirements == 0 || 
			_missionCreator == address(0)) { revert BadArgument(); }

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

		addRequirementAndRewardCollections(_missionRequirements, _missionRewards);

        isPaused = true;
    }

	function addRequirementAndRewardCollections(
		address[] memory _missionRequirements,
		address[] memory _missionRewards
	) public onlyAdminOrCreator {
		if (activeParticipants != 0) { revert UsersOnMission(); }
		//link each requirement to its token address
		uint256 loopLength = _missionRequirements.length;
        for (uint256 i = 0; i < loopLength;) {
            bool added = missionRequirementsSet.add(_missionRequirements[i]);
			if (added) {
				tokenAssociate(_missionRequirements[i]);
			}

			unchecked {	++i; }
        }

        //link each reward to its token address
		loopLength = _missionRewards.length;
        for (uint256 i = 0; i < loopLength;) {
            bool added = missionRewardsUniverseSet.add(_missionRewards[i]);
			if (added) {
				tokenAssociate(_missionRewards[i]);
			}

			unchecked {	++i; }
        }
	}

    //add serial numbers for requirements
    function addRequirementSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
		if (!missionRequirementsSet.contains(_collectionAddress)) { revert BadArgument(); }
		if (_serials.length == 0) { revert BadArgument(); }

        for (uint256 i = 0; i < _serials.length; i++) {
            missionRequirements[_collectionAddress].serials.add(_serials[i]);
        }

        missionRequirements[_collectionAddress].limitedSerials = true;
    }

    function removeRequirementSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
		if (!missionRequirementsSet.contains(_collectionAddress)) { revert BadArgument(); }
		if (_serials.length == 0) { revert BadArgument(); }

        for (uint256 i = 0; i < _serials.length; i++) {
            missionRequirements[_collectionAddress].serials.remove(_serials[i]);
        }

        if (missionRequirements[_collectionAddress].serials.length() == 0) {
            missionRequirements[_collectionAddress].limitedSerials = false;
        }
    }

    //add serial numbers for rewards
    function addRewardSerials(
        address _collectionAddress,
        uint256[] memory _serials
    ) external {
		if (!missionRewardsUniverseSet.contains(_collectionAddress)) { revert BadArgument(); }
		if (_serials.length == 0) { revert BadArgument(); }
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

    function getSlotsRemaining()
        external
        view
        returns (uint256 _slotsRemaining)
    {
        return slotsAvailable - activeParticipants;
    }

    /**
     * Missions start life paused. Factory control the pause.
     * @dev update the pause status of the mission
     */
    function updatePauseStatus(bool _paused) external onlyAdminOrCreator {
        isPaused = _paused;
    }

    /**
     * @dev update the start timestamp of the mission, if 0 effective open (subject to pause)
     */
    function setStartTimestamp(
        uint256 _startTimestamp
    ) external onlyAdminOrCreator {
        missionState.startTimestamp = _startTimestamp;
    }

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

    /*
     * @dev join a mission
     * @param _collectionAddress address of the collection
     * @param _tokenId serial number of the NFT
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

    function getUsersOnMission()
        external
        view
        returns (address[] memory _users)
    {
        return missionParticipantsSet.values();
    }

    /**
     * we could pass back the struct, but this is a little more gas efficient
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

    function getUserEndAndBoost(
        address _user
    ) external view returns (uint256 _endOfMissionTimestamp, bool boosted) {
        return (
            missionParticipants[_user].endOfMission,
            IBoostManager(boostManager).hasBoost(_user, address(this))
        );
    }

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
     * @dev claim rewards
     * User can claim their rewards. uses Hedera PRNG to select the rewards.
     * marked as nonReentrant to avoid multiple claims exploits
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
     * @dev Allows emergency escape hatch for user. Will withdraw all NFTs and exit the mission
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
     * @dev reduce staking period (only callable by the boost manager)
     * @param _wallet mission participant
     * @param _boostReduction of the participant
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

    // function to end mission and withdraw all remaining rewards
    // one-way function, once closed, cannot be reopened
    function closeMission() external onlyAdminOrCreator {
		if (activeParticipants != 0) { revert UsersOnMission(); }

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

    //withdraw specific rewards from mission
    /**
     * @dev withdraw collateral from the mission. there can be multiple reward tokens per mission.
     * we know that the token must be in missionRewardsUniverseSet as only those are associated
     * only allowed when there are no active participants - users should not experience a bait and switch
     * on colateral in the contract between entering and exit.
     * @param _collectionAddress address of the collection to withdraw
     * @param _serials serials to withdraw
     */
    function withdrawRewards(
        address _collectionAddress,
        uint256[] memory _serials
    ) external onlyAdminOrCreator {
        if (activeParticipants != 0) { revert UsersOnMission(); }
		if (!missionRewardsUniverseSet.contains(_collectionAddress)) { revert BadArgument(); }
		if (_serials.length == 0) { revert BadArgument(); }

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

    // Allows a time based entry fee to be set to balance demand
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

    // helper function for the front end to efficient align the decrement for auction entry
    /// @return _decrementInterval the interval to decrement the entry fee by (seconds)
    /// @return _startTimestamp the timestamp to open the mission and start countdown (seconds)
    function getDecrementDetails()
        external
        view
        returns (uint32 _decrementInterval, uint256 _startTimestamp)
    {
        return (missionState.decrementInterval, missionState.startTimestamp);
    }

    // Allows the entry fee to drecement in time
    // automatically unpauses the mission now a start time is set
    /// @param _startTimestamp the timestamp to open the mission and start countdown
    /// @param _minEntryFee the minimum entry fee allowed ($LAZY - remember the decimals!)
    /// @param _decrementAmount the amount to decrement the entry fee by each period
    /// @param _decrementInterval the interval to decrement the entry fee by (seconds)
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

    function isParticipant(
        address _wallet
    ) external view returns (bool _isParticipant) {
        return missionParticipants[_wallet].endOfMission != 0;
    }

    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyAdminOrCreator {
        if (receiverAddress == address(0) || amount == 0) {
            revert("Invalid address or amount");
        }

        // only allow hbar to be transferred when there are no active participants
        if (activeParticipants != 0) { revert UsersOnMission(); }

        Address.sendValue(receiverAddress, amount);
    }

    function retrieveLazy(
        address _receiver,
        int64 _amount
    ) external onlyAdminOrCreator {
        if (activeParticipants != 0) { revert UsersOnMission(); }
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
