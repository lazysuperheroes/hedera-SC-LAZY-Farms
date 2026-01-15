// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title ILazyNFTStaking
 * @notice Interface for the NFT staking contract that earns $LAZY rewards
 * @dev Users stake NFTs from approved collections to earn $LAZY tokens over time.
 * Uses a signature-based reward proof system for secure rate verification.
 */
interface ILazyNFTStaking {

	/**
	 * @notice Emitted when NFTs are staked
	 * @param _user Address of the staker
	 * @param collection NFT collection address
	 * @param serials Array of serial numbers staked
	 * @param rewards Array of reward rates for each serial
	 */
	event StakedNFT(address _user, address collection, uint256[] serials, uint256[] rewards);

	/**
	 * @notice Emitted when NFTs are unstaked
	 * @param _user Address of the unstaker
	 * @param collection NFT collection address
	 * @param serials Array of serial numbers unstaked
	 * @param rewards Array of reward rates for each serial
	 */
    event UnstakedNFT(address _user, address collection, uint256[] serials, uint256[] rewards);

	/**
	 * @notice Emitted when staking rewards are claimed
	 * @param _user Address of the claimer
	 * @param _rewardAmount Total $LAZY earned before burn
	 * @param _burnPercentage Percentage of rewards burned
	 */
    event ClaimedRewards(
        address _user,
        uint256 _rewardAmount,
        uint256 _burnPercentage
    );

	/**
	 * @notice Emitted for configuration changes and fund receipts
	 * @param _functionName Name of the function that triggered the event
	 * @param _sender Address that initiated the action
	 * @param _amount Value or parameter involved
	 * @param _message Descriptive message
	 */
	event StakingMessage(
		string _functionName,
		address _sender,
		uint256 _amount,
		string _message
	);

	/**
	 * @notice Represents a staking action for a single collection
	 * @param collection NFT collection address
	 * @param serials Array of serial numbers to stake/unstake
	 * @param rewards Array of reward rates per serial (verified via signature)
	 */
    struct Stake {
        address collection;
        uint256[] serials;
        uint256[] rewards;
    }

	/**
	 * @notice Tracks reward accumulation state for a user
	 * @param lastRewardSnapshot Accumulated rewards at last update
	 * @param snapshotTimestamp Timestamp of last reward calculation
	 */
    struct Rewards {
        uint256 lastRewardSnapshot;
        uint256 snapshotTimestamp;
    }

	/**
	 * @notice Cryptographic proof of reward rates signed by backend
	 * @param boostRate Overall boost multiplier for the user
	 * @param validityTimestamp When the signature was created (120s validity)
	 * @param signature Backend signature over stake data
	 */
    struct RewardProof {
        uint256 boostRate;
        uint256 validityTimestamp;
        bytes signature;
    }

	/**
	 * @notice Stake NFTs to start earning $LAZY rewards
	 * @dev Requires valid signature from signing wallet. NFTs must be approved.
	 * @param _stakes Array of stake objects (collection + serials + rates)
	 * @param _rewardProof Signed proof of reward rates
	 */
    function stake(
        Stake[] memory _stakes,
		RewardProof memory _rewardProof
	) external;

	/**
	 * @notice Unstake NFTs and claim accumulated rewards
	 * @dev Requires valid signature. Returns NFTs and pays out rewards.
	 * @param _stakes Array of stake objects to unstake
	 * @param _rewardProof Signed proof of reward rates
	 */
    function unstake(
        Stake[] memory _stakes,
		RewardProof memory _rewardProof
	) external;

	/**
	 * @notice Claim accumulated $LAZY rewards without unstaking
	 * @dev Warning: Resets HODL bonus timer on claim
	 * @return rewardPaid Net amount of $LAZY transferred after burn
	 */
    function claimRewards() external returns (uint256 rewardPaid);

	/**
	 * @notice Get all addresses currently staking NFTs
	 * @return Array of staker addresses
	 */
	function getStakingUsers() external view returns (address[] memory);

	/**
	 * @notice Get all NFT collections approved for staking
	 * @return Array of collection addresses
	 */
	function getStakableCollections() external view returns (address[] memory);

	/**
	 * @notice Get all NFTs staked by a specific user
	 * @param _user Address of the staker
	 * @return collections Array of collection addresses the user has staked
	 * @return serials 2D array of serial numbers per collection
	 */
	function getStakedNFTs(
		address _user
	) external view returns (address[] memory collections, uint256[][] memory serials);

	/**
	 * @notice Get all staked serial numbers for a collection (across all users)
	 * @param _collection NFT collection address
	 * @return serials Array of all staked serial numbers
	 */
	function getStakedSerials(
		address _collection
	) external view returns (uint256[] memory serials);

	/**
	 * @notice Get total count of staked NFTs for a collection
	 * @param _collection NFT collection address
	 * @return Number of NFTs currently staked from this collection
	 */
	function getNumStakedNFTs(
		address _collection
	) external view returns (uint256);
}
