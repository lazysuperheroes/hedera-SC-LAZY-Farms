// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title Staking contract for NFTs
/// @author hich.eth
/// @author stowerling.eth / stowerling.hbar
/// @notice This smart contract allows users to stake their assets (NFT/Token) and receive Lazy Tokens in return

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {TokenStaker} from "./TokenStaker.sol";
import {LazyStakingSignatureVerifier} from "./libraries/LazyStakingSignatureVerifier.sol";

import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {ILazyNFTStaking} from "./interfaces/ILazyNFTStaking.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";

contract LazyNFTStaking is
    ILazyNFTStaking,
    Ownable,
    TokenStaker,
    ReentrancyGuard
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    error RateCapExceeded(uint256 _value, uint256 _cap);

    //MAPPINGS
    // mapping (EOA wallet => Address Set of staked collections)
    mapping(address => EnumerableSet.AddressSet) internal userStakedCollections;
    // EOA wallet to collection to serials
    mapping(address => mapping(address => EnumerableSet.UintSet))
        internal stakedCollections;
    // Collection to staked serials
    // information is useful for sharing staking state information
    mapping(address => EnumerableSet.UintSet) internal stakedSerials;
    // mapping (EOA address => total rewards per period)
    // constructed upon staking summnig the rewards of all staked NFTs
    mapping(address => uint256) internal userRewards;
    // mapping (address => pending rewards)
    // set upon staking addtional rewards (in effect a snapshot point)
    mapping(address => ILazyNFTStaking.Rewards) internal pendingRewards;
    // mapping (address => last claimed timestamp)
    // set upon staking if currently 0
    mapping(address => uint256) internal lastClaimed;
    // mapping (EOA address => boost rate)
    mapping(address => uint256) internal activeBoost;
    // mapping (collection address => max base reward rate)
    mapping(address => uint256) internal maxBaseRate;

    // STATIC VARIABLES
    uint256 public constant SCALAR = 100;
    uint256 public constant DIVISOR = 1_000_000;

    // VARIABLES
    EnumerableSet.AddressSet internal stakeableCollections;
    EnumerableSet.AddressSet internal stakingUsers;
    address public systemWallet;
    address public immutable LAZY_SCT;
    uint256[] public epochPoints;
    uint256[] public epochValues;
    uint256 public currentEpoch;
    uint256 public distributionPeriod;
    uint256 public burnPercentage;
    uint256 public boostRateCap;
    uint256 public totalItemsStaked;
    uint256 public immutable HALF_AFTER;
    uint256 public immutable LAZY_MAX_SUPPLY;
    uint16 public periodForBonus;
    uint16 public hodlBonusRate;
    uint16 public maxBonusTimePeriods;

    /**
     * @notice Constructor for NFTStaker
     * @param _lazyToken Address of Lazy Token
     * @param _lazyGasStation Address of Lazy Gas Station
     * @param _lazyDelegateRegistry Address of Lazy Delegate Registry
     * @param _signingWallet Address of the signing wallet
     * @param _burnPercentage Percentage of Lazy Tokens to burn on claim
     * @param _distributionPeriod distribution period in seconds -> Default: 86400 (1 day)
     * @param _boostRateCap Maximum base rate
     * @param _periodForBonus Reward period for bonus -> Default: 30 (30 days / ~1 month)
     * @param _hodlBonusRate multiplier for bonus rewards -> Default: 25 = 25%
     * @param _maxBonusTimePeriods maximum bonus time periods -> Default: 8 (8 months)
     * @param _lazyMaxSupply max supply of Lazy Tokens
     * @param _halfAfter number of tokens to be in circulation before halving -> Default: 50 million
     * @dev Initializes the NFTStaker contract
     * @dev Sets the burn percentage for Lazy Tokens
     * @dev Initializes the Lazy Token and Lazy SCT
     * @dev Sets the bonus reward per month
     * @dev Bonus reward is the number of Lazy Tokens that will be rewarded in bonus for not claiming rewards for months
     */
    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry,
        address _signingWallet,
        uint256 _burnPercentage,
        uint256 _distributionPeriod,
        uint256 _boostRateCap,
        uint16 _periodForBonus,
        uint16 _hodlBonusRate,
        uint16 _maxBonusTimePeriods,
        uint256 _lazyMaxSupply,
        uint256 _halfAfter
    ) {
        require(_signingWallet != address(0), "!signingWallet");
        require(_lazyToken != address(0), "!lazyToken");
        require(_lazyGasStation != address(0), "!lazyGasStation");
        burnPercentage = _burnPercentage;
        initContracts(_lazyToken, _lazyGasStation, _lazyDelegateRegistry);
        systemWallet = _signingWallet;
        distributionPeriod = _distributionPeriod;
        boostRateCap = _boostRateCap;
        periodForBonus = _periodForBonus;
        hodlBonusRate = _hodlBonusRate;
        maxBonusTimePeriods = _maxBonusTimePeriods;

        LAZY_SCT = ILazyGasStation(_lazyGasStation).lazySCT();

        LAZY_MAX_SUPPLY = _lazyMaxSupply;
        HALF_AFTER = _halfAfter;

        uint256 length = LAZY_MAX_SUPPLY / HALF_AFTER;
        epochPoints = new uint256[](length);
        epochValues = new uint256[](length);
        // epochValues starts at 1 then multiplies by 2 each offset
        epochValues[0] = 1;
        for (uint256 i = 1; i < length; ) {
            epochValues[i] = epochValues[i - 1] * 2;
            unchecked {
                ++i;
            }
        }
    }

    //modifier check signature
    modifier ValidSignature(
        Stake[] memory _stakes,
        RewardProof memory _rewardProof
    ) {
        require(isValidSignature(_stakes, _rewardProof), "Invalid signature");
        _;
    }

    /**
     * @notice Check if a signature is valid
     * @param _stakes Array of Stake structs
     * @param _rewardProof Reward proof struct
     * @dev Checks if a signature is valid
     * @dev Signature is valid if it is a hash of the bonus rate and the items to (un)stake and is signed by the system wallet
     * @dev Signature is valid if it is not expired [120 seconds from the current block.timestamp]
     */
    function isValidSignature(
        Stake[] memory _stakes,
        RewardProof memory _rewardProof
    ) public view returns (bool) {
        require(
            _rewardProof.validityTimestamp + 120 > block.timestamp,
            "Signature has expired"
        );

        return
            LazyStakingSignatureVerifier.verify(
                systemWallet,
                msg.sender,
                _rewardProof.boostRate,
                _stakes,
                _rewardProof.signature,
                _rewardProof.validityTimestamp
            );
    }

    function getStakedNFTs(
        address _user
    )
        external
        view
        returns (address[] memory collections, uint256[][] memory serials)
    {
        uint256 nbOfCollections = userStakedCollections[_user].length();
        collections = new address[](nbOfCollections);
        serials = new uint256[][](nbOfCollections);

        for (uint256 i = 0; i < nbOfCollections; i++) {
            collections[i] = userStakedCollections[_user].at(i);
            serials[i] = stakedCollections[_user][collections[i]].values();
        }
    }

    /**
     * @notice Get the staking users
     * @dev Returns all staking users
     */
    function getStakingUsers() external view returns (address[] memory users) {
        return stakingUsers.values();
    }

    /**
     * @notice Get the stakable collections
     * @dev Returns the stakable collections
     */
    function getStakableCollections()
        external
        view
        returns (address[] memory collections)
    {
        return stakeableCollections.values();
    }

    /**
     * @notice Get the serials staked for a collection
     * @param _collection Address of the collection
     * @dev Returns the serials staked for a collection
     */
    function getStakedSerials(
        address _collection
    ) external view returns (uint256[] memory serials) {
        return stakedSerials[_collection].values();
    }

    /**
     * @notice Get the number of NFTs staked for a collection
     * @param _collection Address of the collection
     * @dev Returns the number of NFTs staked for a collection
     */
    function getNumStakedNFTs(
        address _collection
    ) external view returns (uint256) {
        return stakedSerials[_collection].length();
    }

    /**
     * @notice Get the base earnign rate for a user (whole numbers only)
     * @param _user Address of the user
     * @dev Returns the base earning rate for a user [$LAZY per period staked]
     */
    function getBaseRewardRate(address _user) external view returns (uint256) {
        return userRewards[_user];
    }

    /**
     * @notice Get the current boost percentage for a user (whole numbers only)
     * @param _user Address of the user
     * @dev Returns the current boost percentage for a user
     */
    function getActiveBoostRate(address _user) external view returns (uint256) {
        return activeBoost[_user];
    }

	/**
	 * @notice Get the current epoch and increment value if required
	 * @dev public so it can be called by anyone if desired but automatically called when users interact with the contract
	 * via staking / unstaking / claiming rewards
	 */
    function checkHalvening() public {
        // calculate the supply net of tokens at the LAZY_SCT & lazyGasStation divided by HALF_AFTER
        uint256 epoch = (LAZY_MAX_SUPPLY -
            IERC20(lazyToken).balanceOf(LAZY_SCT) -
            IERC20(lazyToken).balanceOf(address(lazyGasStation))) / HALF_AFTER;

        if (epoch > currentEpoch) {
            currentEpoch = epoch;
            epochPoints[epoch] = block.timestamp;
        }
    }

    /**
     * @notice Stake NFTs
     * @param _stakes Array of Stake structs
     * @param _rewardProof Reward proof struct
     * @dev Stakes NFTs
     * @dev Stakes are stored in a mapping of user address to an array of staked collections
     * @dev Staked collections are stored in a mapping of user address and staking timestamp to an array of staked serials
     * @dev Staked serials are stored in a mapping of user address, collection address and staking timestamp to an array of staked serials
     */
    function stake(
        Stake[] memory _stakes,
        RewardProof memory _rewardProof
    ) external ValidSignature(_stakes, _rewardProof) {
        if (_rewardProof.boostRate > boostRateCap)
            revert RateCapExceeded(_rewardProof.boostRate, boostRateCap);
        // check if the epoch has changed
        checkHalvening();

        // allows us to get the list of live staking users
        bool newUser = stakingUsers.add(msg.sender);

        // if the user is freshly staking then set the last claimed timestamp to now
        // avoids situations where a user fully exits and then re-enters getting a headstart on rewards
        if (newUser) {
            lastClaimed[msg.sender] = block.timestamp;
        }

        // ordering matters here, we need to ensure the user has a correct entry time before calculating rewards
        (uint256 rewards, , , ) = calculateRewards(msg.sender);
        pendingRewards[msg.sender] = Rewards(rewards, block.timestamp);

        uint256 totalUserRewards = userRewards[msg.sender];

        for (uint256 i = 0; i < _stakes.length; ) {
            require(
                stakeableCollections.contains(_stakes[i].collection),
                "Invalid Collection"
            );

			for (uint256 j = 0; j < _stakes[i].serials.length; j++) {
                stakedCollections[msg.sender][_stakes[i].collection].add(
                    _stakes[i].serials[j]
                );

                // check if the base rate is exceeded
                if (_stakes[i].rewards[j] > maxBaseRate[_stakes[i].collection])
                    revert RateCapExceeded(
                        _stakes[i].rewards[j],
                        maxBaseRate[_stakes[i].collection]
                    );

                totalUserRewards += _stakes[i].rewards[j];

                // add the serial to the staked serials set
                stakedSerials[_stakes[i].collection].add(_stakes[i].serials[j]);
            }

            batchMoveNFTs(
                TransferDirection.STAKING,
                _stakes[i].collection,
                _stakes[i].serials,
                msg.sender,
                true
            );

            totalItemsStaked += _stakes[i].serials.length;

            // add the collection to the user's staked collections set
            userStakedCollections[msg.sender].add(_stakes[i].collection);

            emit ILazyNFTStaking.StakedNFT(
                msg.sender,
                _stakes[i].collection,
                _stakes[i].serials,
                _stakes[i].rewards
            );

            unchecked {
                ++i;
            }
        }

        userRewards[msg.sender] = totalUserRewards;
        activeBoost[msg.sender] = _rewardProof.boostRate;
    }

    /**
     * @notice Unstake NFTs
     * @param _stakes Array of Stake structs
     * @param _rewardProof Reward proof struct
     * @dev Unstakes NFTs
     */
    function unstake(
        Stake[] memory _stakes,
        RewardProof memory _rewardProof
    ) external ValidSignature(_stakes, _rewardProof) {
        require(_rewardProof.boostRate <= boostRateCap, "Boost rate > cap");
        require(stakingUsers.contains(msg.sender), "User not staking");

        // check for halvening will occur when claiming rewards
        claimRewards();
        activeBoost[msg.sender] = _rewardProof.boostRate;

        uint256 userTotalRewards = userRewards[msg.sender];
        for (uint256 i = 0; i < _stakes.length; ) {
            uint256 serialsLength = _stakes[i].serials.length;
            totalItemsStaked -= serialsLength;

            for (uint256 j = 0; j < serialsLength; ) {
                uint256 serial = _stakes[i].serials[j];
                require(
                    stakedCollections[msg.sender][_stakes[i].collection]
                        .contains(serial),
                    "NFT not staked"
                );
                stakedCollections[msg.sender][_stakes[i].collection].remove(
                    serial
                );
                userTotalRewards -= _stakes[i].rewards[j];

                // remove the serial from the staked serials set
                stakedSerials[_stakes[i].collection].remove(serial);

                unchecked {
                    ++j;
                }
            }

            batchMoveNFTs(
                TransferDirection.WITHDRAWAL,
                _stakes[i].collection,
                _stakes[i].serials,
                msg.sender,
                true
            );

            emit ILazyNFTStaking.UnstakedNFT(
                msg.sender,
                _stakes[i].collection,
                _stakes[i].serials,
                _stakes[i].rewards
            );

            unchecked {
                ++i;
            }
        }
        // check if the user has any NFTs staked
        bool userHasStakes = false;
        // loop through the user's staked collections
        // remove those with no more serials staked
        // exit loop if user has stakes remaining
        while (userStakedCollections[msg.sender].length() > 0) {
            address collection = userStakedCollections[msg.sender].at(0);
            if (stakedCollections[msg.sender][collection].length() == 0) {
                userStakedCollections[msg.sender].remove(collection);
            } else {
                userHasStakes = true;
                break;
            }
        }

        if (!userHasStakes) {
            stakingUsers.remove(msg.sender);
            userRewards[msg.sender] = 0;
        } else {
            userRewards[msg.sender] = userTotalRewards;
        }
    }

    /**
     * @notice Claim rewards
     * @param _user Address of user
     * @dev Claims rewards for a user
     * @dev Rewards are calculated based on the staking time and the reward rate
     */
    function calculateRewards(
        address _user
    )
        public
        view
        returns (
            uint256 lazyEarnt,
            uint256 rewardRate,
            uint256 asOfTimestamp,
            uint256 userLastClaim
        )
    {
        uint256 periodsSinceSnapshot = (block.timestamp -
            pendingRewards[_user].snapshotTimestamp) / distributionPeriod;
        // calculate duration in days then calculate months
        // reward increase linearly with months and is capped to 8 months
        userLastClaim = lastClaimed[_user];
        uint256 timeSinceClaim = block.timestamp - userLastClaim;
        uint256 periodsSinceClaim = timeSinceClaim / distributionPeriod;
        asOfTimestamp = block.timestamp - (timeSinceClaim % distributionPeriod);
        // calculate elapsed bonus periods (capped)
        uint256 bonusPeriodsWithoutClaiming = (periodsSinceClaim /
            periodForBonus) <= maxBonusTimePeriods
            ? (periodsSinceClaim / periodForBonus)
            : maxBonusTimePeriods;

        // e.g. 25% bonus for 3 months = 75% bonus on top of base rate
        uint256 claimBonus = hodlBonusRate * bonusPeriodsWithoutClaiming;
        //if last snapshot timestamp is empty then consider the days since claim
        uint256 nbOfPeriods;
		uint256 calcFromTimestamp;
		if (pendingRewards[_user].snapshotTimestamp > userLastClaim) {
            nbOfPeriods = periodsSinceSnapshot;
			calcFromTimestamp = pendingRewards[_user].snapshotTimestamp;
		}
		else {
			nbOfPeriods = periodsSinceClaim;
			calcFromTimestamp = userLastClaim;
		}

        // calculate rewards
		uint256 userBaseRewardRate = userRewards[_user];
		uint256 userBoostRate = activeBoost[_user];

        // base rewards (userRewards) * boost rate * hodl bonus
        // adjusted for epoch

        // potential for rewards to pass across an epoch, if so we need to split the calulation
        // and sum the results

        // if calcFromTimestamp < epochPoints[currentEpoch] then we need to calculate the rewards
        // for the previous epochs and add them to the current epoch rewards
        // we need to subtract the periods occuring in prior epochs from the total periods

		// only run this loop if we are on an incremented epoch, run for prior epochs
		for (uint256 i = currentEpoch; i > 0; ) {
			// only act if the calcFromTimestamp is less than the next epochPoints timestamp
			if (calcFromTimestamp < epochPoints[i]) {
				// calculate the number of periods in this epoch
				uint256 periodsInPriorEpoch = (epochPoints[i] -
					Math.max(calcFromTimestamp, epochPoints[i - 1])) /
					distributionPeriod;

				if (periodsInPriorEpoch >= nbOfPeriods) {
					nbOfPeriods = 0;
				} else {
					nbOfPeriods -= periodsInPriorEpoch;
				}

				lazyEarnt += (calculateEpochRewardRate(
					i - 1,
					userBaseRewardRate,
					userBoostRate,
					claimBonus
				) * periodsInPriorEpoch);
			}
			else {
				// no need to keep running the loop
				break;
			}
			unchecked {
				--i;
			}
		}

        rewardRate = calculateEpochRewardRate(
            currentEpoch,
            userBaseRewardRate,
            userBoostRate,
            claimBonus
        );

        lazyEarnt +=
            rewardRate *
            nbOfPeriods +
            pendingRewards[_user].lastRewardSnapshot;
    }

    function calculateEpochRewardRate(
        uint256 epoch,
        uint256 baseRate,
        uint256 boost,
        uint256 bonus
    ) internal view returns (uint256) {
        uint256 rewardRate = (baseRate * SCALAR) / epochValues[epoch];
        rewardRate *= (100 + boost) * (100 + bonus);
        rewardRate /= DIVISOR;

        return rewardRate;
    }

    /**
     * @notice Claim rewards
     * @dev Claims rewards for a user
     * @dev Rewards are calculated based on the staking time and the reward rate
     * @dev Burn percentage is the percentage of Lazy Tokens that will be burned when claiming rewards
     * @dev Burn percentage is set by the owner
     * @dev Rewards are transferred to the user
     */
    function claimRewards() public nonReentrant returns (uint256 rewardPaid) {
        // check if the epoch shifted
        checkHalvening();

        // calculate user rewards and determine burn amount
        (uint256 rewards, , uint256 asOfTimestamp, ) = calculateRewards(
            msg.sender
        );

        //last claim should be rounded to the previous whole time period
        lastClaimed[msg.sender] =
            block.timestamp -
            (block.timestamp - asOfTimestamp);

        //delete all pending rewards
        delete pendingRewards[msg.sender];

        // let Lazy Gas Station handle the transfer
		if (rewards > 0) {
			rewardPaid = lazyGasStation.payoutLazy(
				msg.sender,
				rewards,
				burnPercentage
			);
		}

        emit ILazyNFTStaking.ClaimedRewards(
            msg.sender,
            rewards,
            burnPercentage
        );
    }

    /**
     * @notice set the system wallet
     * @param _systemWallet Address of the system wallet
     */
    function setSystemWallet(address _systemWallet) public onlyOwner {
        require(_systemWallet != address(0), "!systemWallet");
        systemWallet = _systemWallet;
    }

    /**
     * @notice set the distribution period
     * @param _distributionPeriod distribution period in seconds
     */
    function setDistributionPeriod(
        uint256 _distributionPeriod
    ) public onlyOwner {
        require(_distributionPeriod > 0, "Invalid distribution period");
        distributionPeriod = _distributionPeriod;
        emit ILazyNFTStaking.StakingMessage(
            "DistributionPeriod",
            msg.sender,
            _distributionPeriod,
            "Updated"
        );
    }

    /**
     * @notice Set the reward rate for a collection
     * @param _collectionAddress Array of collection addresses
     * @param _maxRewardRate Array of max reward rates for a token
     * @dev Sets the reward rate for a collection
     * @dev Reward rate is the number of Lazy Tokens that will be rewarded per day
     * @dev Associates the collection with the Lazy Token
     */
    function setStakeableCollection(
        address[] memory _collectionAddress,
        uint256[] memory _maxRewardRate
    ) external onlyOwner {
        require(
            _collectionAddress.length == _maxRewardRate.length,
            "!InputMatchlength"
        );

        // batch association would be more efficient but risks failure if any have been associated before

        for (uint256 i = 0; i < _collectionAddress.length; i++) {
            stakeableCollections.add(_collectionAddress[i]);
            maxBaseRate[_collectionAddress[i]] = _maxRewardRate[i];
        }

        safeBatchTokenAssociate(_collectionAddress);
    }

    function removeStakeableCollection(
        address[] memory _collectionAddress
    ) external onlyOwner {
        for (uint256 i = 0; i < _collectionAddress.length; i++) {
            stakeableCollections.remove(_collectionAddress[i]);
            maxBaseRate[_collectionAddress[i]] = 0;
        }
    }

    /**
     * @notice Update the max base rate for a collection
     * @param _collection Array of collection addresses
     * @param _maxRewardRate Array of max reward rates
     * @dev Updates the max base rate for a collection
     * @dev Max base rate is the maximum base rate that can be applied for a token of a collection
     */
    function updateMaxBaseRate(
        address[] memory _collection,
        uint256[] memory _maxRewardRate
    ) external onlyOwner {
        require(
            _collection.length == _maxRewardRate.length,
            "!InputMatchlength"
        );

        for (uint256 i = 0; i < _collection.length; i++) {
            maxBaseRate[_collection[i]] = _maxRewardRate[i];
        }
    }

	/**
	 * @notice Get the max base rate for a collection
	 */
	function getMaxBaseRate(
		address _collection
	) external view returns (uint256) {
		return maxBaseRate[_collection];
	}

    /**
     * @notice Set the burn percentage for Lazy Tokens
     * @param _burnPercentage Percentage of Lazy Tokens to burn
     * @dev Sets the burn percentage for Lazy Tokens
     * @dev Burn percentage is the percentage of Lazy Tokens that will be burned when claiming rewards
     */
    function setBurnPercentage(uint256 _burnPercentage) public onlyOwner {
        burnPercentage = _burnPercentage;
        emit ILazyNFTStaking.StakingMessage(
            "BurnPercentage",
            msg.sender,
            _burnPercentage,
            "Updated"
        );
    }

    /**
     * @notice Set the boost cap
     * @param _boostRateCap Maximum boost rate
     * @dev Sets the boost cap
     * @dev Boost cap is the maximum boost rate that can be applied to a user
     */
    function setBoostRateCap(uint256 _boostRateCap) public onlyOwner {
        boostRateCap = _boostRateCap;
        emit ILazyNFTStaking.StakingMessage(
            "BoostRateCap",
            msg.sender,
            _boostRateCap,
            "Updated"
        );
    }

    /**
     * @notice Set the bonus rate
     * @param _hodlBonusRate Bonus rate
     * @dev Sets the bonus rate
     * @dev Bonus rate is the percentage of Lazy Tokens that will be rewarded in bonus for not claiming rewards for months
     */
    function setHodlBonusRate(uint16 _hodlBonusRate) public onlyOwner {
        hodlBonusRate = _hodlBonusRate;
        emit ILazyNFTStaking.StakingMessage(
            "HodlBonusRate",
            msg.sender,
            _hodlBonusRate,
            "Updated"
        );
    }

    function setPeriodForBonus(uint16 _periodForBonus) public onlyOwner {
        periodForBonus = _periodForBonus;
        emit ILazyNFTStaking.StakingMessage(
            "PeriodForBonus",
            msg.sender,
            _periodForBonus,
            "Updated"
        );
    }

    function setMaxBonusTimePeriods(
        uint16 _maxBonusTimePeriods
    ) public onlyOwner {
        maxBonusTimePeriods = _maxBonusTimePeriods;
        emit ILazyNFTStaking.StakingMessage(
            "MaxBonusTimePeriods",
            msg.sender,
            _maxBonusTimePeriods,
            "Updated"
        );
    }

    /**
     * @notice Unstake any NFT owned by a user
     * @param _collection Address of the NFT collection
     * @param _serials Array of serials of the NFTs to unstake
     *
     * @dev USE WITH CAUTION, this method unstakes NFTs without applying any rewards
     * it might cause the user to lose rewards. Once a single NFT removed this way all reward rates are reset
	 * and the user will need to remove/restake collateral to re-engage with the staking contract
     */
    function unstakeAnyNFT(
        address _collection,
        uint256[] memory _serials
    ) external {
		// let the user get their rewards
		claimRewards();

        // check if the user has any NFTs staked
		uint256 length = _serials.length;
        for (uint256 i = 0; i < length; ) {
            uint256 serial = _serials[i];
            require(
                stakedCollections[msg.sender][_collection].contains(serial),
                "NFT not staked"
            );
            stakedCollections[msg.sender][_collection].remove(serial);
            totalItemsStaked--;

            // remove the serial from the staked serials set
            stakedSerials[_collection].remove(serial);

			unchecked {
				++i;
			}
        }

        if (stakedCollections[msg.sender][_collection].length() == 0) {
            userStakedCollections[msg.sender].remove(_collection);
        }

        if (userStakedCollections[msg.sender].length() == 0) {
            stakingUsers.remove(msg.sender);
        }

        delete userRewards[msg.sender];
		delete activeBoost[msg.sender];

        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            _collection,
            _serials,
            msg.sender,
            true
        );
    }

    /**
     * @notice Unstake any NFT sent to the contract natively vs staking interaction
     * @param _collection Address of the NFT collection
     * @param _serials Array of serials of the NFTs to unstake
     *
     * @dev USE WITH CAUTION, potentially gas heavy depending on the number of NFTs staked
     * ultimately this is a user mistake edge case but attempting to handle it.
     */
    function unstakeUnauthorizedNFT(
        address _collection,
        uint256[] memory _serials
    ) external onlyOwner {
        // use the stakedSerials mapping to check if the collection / serials are staked
        // if not then we can unstake
        for (uint256 i = 0; i < stakedSerials[_collection].length(); i++) {
            uint256 serial = stakedSerials[_collection].at(i);
            for (uint256 j = 0; j < _serials.length; j++) {
                if (serial == _serials[j]) {
                    revert("NFTs staked by user");
                }
            }
        }

        batchMoveNFTs(
            TransferDirection.WITHDRAWAL,
            _collection,
            _serials,
            msg.sender,
            false
        );
    }

    /**
     * @notice Transfer HBAR from the contract
     * @param receiverAddress Address of the receiver
     * @param amount Amount of HBAR to transfer
     * @dev Transfers HBAR from the contract
     * @dev Only the owner can call this method
     */

    /// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external onlyOwner {
        if (receiverAddress == address(0) || amount == 0) {
            revert("Invalid address or amount");
        }

        // if there are users staking ensure at least 10 hbar is left behind
        // this gives certainty on Smart Contract Rent
        if (stakingUsers.length() > 0) {
            uint256 balance = address(this).balance;
            if (balance - amount < 10) {
                revert("Staking Active - Min Bal 10");
            }
        }

        Address.sendValue(receiverAddress, amount);
    }

    function retrieveLazy(address _receiver, int64 _amount) external onlyOwner {
        if (_receiver == address(0) || _amount == 0) {
            revert("Invalid address or amount");
        }
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

    // allows the contract top recieve HBAR
    receive() external payable {
        emit ILazyNFTStaking.StakingMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit ILazyNFTStaking.StakingMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
