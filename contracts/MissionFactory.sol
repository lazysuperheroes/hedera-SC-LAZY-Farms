// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IMission } from "./interfaces/IMission.sol";
import { IRoles } from "./interfaces/IRoles.sol";
import { IBoostManager } from "./interfaces/IBoostManager.sol";
import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title MissionFactory
 * @author Lazy Superheroes
 * @notice Factory contract for deploying and managing NFT farming missions
 * @dev Uses OpenZeppelin Clones (minimal proxy pattern) for gas-efficient mission deployment.
 *      Integrates with Hedera Token Service (HTS) for native token operations.
 *      Manages role-based access control for admins, deployers, and deployed missions.
 *      Emits aggregated events from child missions for easier off-chain indexing.
 */
contract MissionFactory is HederaTokenService, IRoles {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice Emitted when a user completes a mission and claims rewards
    /// @param mission The address of the completed mission
    /// @param wallet The address of the user who completed the mission
    /// @param timestamp The block timestamp when the mission was completed
	event MissionCompletedFactory(address indexed mission, address indexed wallet, uint256 timestamp);

    /// @notice Emitted when a new mission is deployed via the factory
    /// @param mission The address of the newly deployed mission contract
    /// @param _missionDuration The duration of the mission in seconds
    /// @param _entryFee The fee required to enter the mission (in $LAZY tokens)
    /// @param _feeBurnPercentage The percentage of the entry fee that is burned (0-100)
    /// @param _lastEntryTimestamp The deadline timestamp after which no new entries are allowed
    event MissionCreatedFactory(
		address indexed mission,
        uint256 _missionDuration,
        uint256 _entryFee,
        uint256 _feeBurnPercentage,
        uint256 _lastEntryTimestamp
    );

    /// @notice Emitted when a user joins a mission
    /// @param mission The address of the mission joined
    /// @param _user The address of the user who joined
    /// @param _entryTimestamp The block timestamp when the user entered
    /// @param _endOfMissionTimestamp The timestamp when the user's mission will complete
    event MissionJoinedFactory(
		address indexed mission,
        address _user,
        uint256 _entryTimestamp,
        uint256 _endOfMissionTimestamp
    );

    /// @notice Emitted when a boost is activated for a user's mission
    /// @param _mission The address of the boosted mission
    /// @param _missionParticipant The address of the user who activated the boost
    /// @param _boostReduction The time reduction applied by the boost (in seconds)
    /// @param _newEndTimestamp The new mission end timestamp after boost
    /// @param _newMissionDuration The new effective mission duration after boost
    /// @param _boostType The type of boost used (Gem or Lazy)
	event BoostActivatedFactory(
        address _mission,
        address _missionParticipant,
        uint256 _boostReduction,
        uint256 _newEndTimestamp,
        uint256 _newMissionDuration,
		IBoostManager.BoostType _boostType
    );

    /// @notice Emitted when the number of available slots in a mission changes
    /// @param mission The address of the mission
    /// @param _slotsRemaining The number of slots still available
    /// @param _timestamp The block timestamp of the update
	event SlotsRemainingFactory(address indexed mission, uint256 _slotsRemaining, uint256 _timestamp);

    /// @notice Emitted for general factory messages (e.g., receiving HBAR)
    /// @param _type The type of message (e.g., "Receive", "Fallback")
    /// @param _sender The address that triggered the message
    /// @param _amount The amount of HBAR received (in tinybars)
    /// @param _message A descriptive message
	event FactoryMessage(
		string _type,
		address _sender,
		uint256 _amount,
		string _message
	);

    /// @notice Set of addresses authorized to deploy new missions
    EnumerableSet.AddressSet private deployers;
    /// @notice Set of addresses with admin privileges
    EnumerableSet.AddressSet private admins;
    /// @notice Set of all currently active deployed mission addresses
	EnumerableSet.AddressSet private deployedMissions;
    /// @notice Mapping from mission address to the deployer who created it
    mapping(address => address) public missions;
    /// @notice Mapping from deployer address to their most recently created mission
    mapping(address => address) public creators;
    /// @notice The $LAZY token address used for entry fees and rewards
    address public lazyToken;
    /// @notice The BoostManager contract address for handling mission boosts
    address public boostManager;
    /// @notice The PRNG contract address for random number generation
	address public prngGenerator;
    /// @notice The mission template contract used for cloning new missions
    address public missionTemplate;
    /// @notice The LazyGasStation contract for gas/fee handling
	address public lazyGasStation;
    /// @notice The LazyDelegateRegistry contract for NFT delegation
	address public lazyDelegateRegistry;

    /**
     * @notice Deploys a new MissionFactory with all required dependencies
     * @dev Associates the factory with the $LAZY token upon deployment.
     *      The deployer is automatically added as both admin and deployer.
     * @param _lazyToken The address of the $LAZY token contract
     * @param _boostManager The address of the BoostManager contract
     * @param _lazyGasStation The address of the LazyGasStation contract
     * @param _missionTemplate The address of the Mission template for cloning
     * @param _prngGenerator The address of the PRNG contract for randomness
     * @param _lazyDelegateRegistry The address of the delegation registry
     */
    constructor(
        address _lazyToken,
        address _boostManager,
        address _lazyGasStation,
        address _missionTemplate,
		address _prngGenerator,
		address _lazyDelegateRegistry
    ) {
        admins.add(msg.sender);
        deployers.add(msg.sender);
        lazyToken = _lazyToken;
        boostManager = _boostManager;
        lazyGasStation = _lazyGasStation;
        missionTemplate = _missionTemplate;
		prngGenerator = _prngGenerator;
		lazyDelegateRegistry = _lazyDelegateRegistry;

		int256 response = HederaTokenService.associateToken(
			address(this),
			lazyToken
		);

		if (response != HederaResponseCodes.SUCCESS) {
			revert("Associate Failed");
		}
    }

    /**
     * @notice Modifier to restrict function access based on role
     * @dev Reverts with PermissionDenied if the caller does not have the required role.
     *      Supports Admin, Deployer, Mission, and BoostManager roles.
     * @param role The role required to execute the function
     */
    modifier onlyRole(Role role) {
        if (role == Role.Admin) {
        	if (!admins.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Admin);
        }
		else if (role == Role.Deployer) {
			if (!deployers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Deployer);
        } else if (role == Role.Mission) {
			if (!deployedMissions.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Mission);
		} else if (role == Role.BoostManager) {
			if (boostManager != msg.sender) revert PermissionDenied(msg.sender, Role.BoostManager);
		}
        _;
    }

    /**
     * @notice Add or remove addresses from the deployer role
     * @dev Only callable by admins. Deployers can create new missions via deployMission().
     * @param _deployer Array of addresses to add or remove
     * @param _add If true, adds the addresses; if false, removes them
     */
    function updateDeployers(
        address[] memory _deployer,
        bool _add
    ) external onlyRole(Role.Admin) {
        for (uint256 i = 0; i < _deployer.length; i++) {
            if (_add) {
                deployers.add(_deployer[i]);
            } else {
                deployers.remove(_deployer[i]);
            }
        }
    }

    /**
     * @notice Add a new admin to the factory
     * @dev Only callable by existing admins. Admins have full control over factory settings.
     * @param _admin The address to grant admin privileges
     * @return True if the admin was successfully added, false if already an admin
     */
    function addAdmin(
        address _admin
    ) external onlyRole(Role.Admin) returns (bool) {
        return admins.add(_admin);
    }

    /**
     * @notice Remove an admin from the factory
     * @dev Only callable by admins. Cannot remove the last remaining admin to prevent lockout.
     * @param _admin The address to revoke admin privileges from
     * @return True if the admin was successfully removed, false if not an admin
     */
	function removeAdmin(
		address _admin
	) external onlyRole(Role.Admin) returns (bool) {
		//check if admin is the last one
		require(admins.length() > 1, "Last Admin");
		return admins.remove(_admin);
	}

    /**
     * @notice Deploy a new mission contract using the minimal proxy pattern
     * @dev Creates a clone of missionTemplate and initializes it with the provided parameters.
     *      The caller becomes the mission creator and is registered in the missions mapping.
     *      Emits MissionCreatedFactory event upon successful deployment.
     * @param _missionDuration The duration users must stake to complete the mission (in seconds)
     * @param _entryFee The $LAZY token fee required to enter the mission
     * @param _missionRequirements Array of NFT collection addresses required to enter
     * @param _missionRewards Array of NFT collection addresses available as rewards
     * @param _feeBurnPercentage Percentage of entry fee to burn (0-100)
     * @param _lastEntryTimestamp Unix timestamp after which new entries are blocked
     * @param _numberOfRequirements Number of NFTs required from requirement collections
     * @param _numberOfRewards Number of NFT rewards the user will receive upon completion
     * @return The address of the newly deployed mission contract
     */
    function deployMission(
        uint256 _missionDuration,
        uint256 _entryFee,
        address[] memory _missionRequirements,
        address[] memory _missionRewards,
        uint256 _feeBurnPercentage,
        uint256 _lastEntryTimestamp,
        uint8 _numberOfRequirements,
        uint8 _numberOfRewards
    ) external onlyRole(Role.Deployer) returns (address) {
        address newMission = Clones.clone(missionTemplate);
        IMission(newMission).initialize(
            _missionDuration,
            _entryFee,
            _missionRequirements,
            _missionRewards,
            _feeBurnPercentage,
            _lastEntryTimestamp,
            msg.sender,
            address(this),
            _numberOfRequirements,
            _numberOfRewards
        );

        missions[newMission] = msg.sender;
        creators[msg.sender] = newMission;
		deployedMissions.add(newMission);
		ILazyGasStation(lazyGasStation).addContractUser(newMission);

		emit MissionCreatedFactory(
			newMission,
			_missionDuration,
			_entryFee,
			_feeBurnPercentage,
			_lastEntryTimestamp
		);

        return newMission;
    }

    /**
     * @notice Update the BoostManager contract address
     * @dev Only callable by admins. The BoostManager handles mission duration reductions.
     * @param _boostManager The address of the new BoostManager contract
     */
    function updateBoostManager(
        address _boostManager
    ) external onlyRole(Role.Admin) {
        boostManager = _boostManager;
    }

    /**
     * @notice Update the mission template used for cloning new missions
     * @dev Only callable by admins. Useful for upgrading mission logic without redeploying the factory.
     *      Existing missions are not affected; only new deployments will use the updated template.
     * @param _missionTemplate The address of the new Mission template contract
     */
	function updateMissionTemplate(
		address _missionTemplate
	) external onlyRole(Role.Admin) {
		missionTemplate = _missionTemplate;
	}

    /**
     * @notice Get all currently deployed and active mission addresses
     * @dev This is an unbounded array operation. Performance may degrade with many active missions.
     *      Used by external services (e.g., HTS Discord bot) to track mission contracts.
     *      Missions are removed from this list when closed via closeMission().
     * @return Array of all active mission contract addresses
     */
	function getDeployedMissions() external view returns (address[] memory) {
		return deployedMissions.values();
	}

    /**
     * @notice Get available slots and entry costs for all deployed missions
     * @dev This is an unbounded operation iterating over all missions. Performance may degrade with many missions.
     *      Useful for displaying mission availability in a UI.
     * @return Array of mission addresses in the same order as the other return arrays
     * @return Array of available slot counts for each mission
     * @return Array of entry fees for each mission (in $LAZY tokens)
     */
	function getAvailableSlots() external view returns (address[] memory, uint256[] memory, uint256[] memory) {
		uint256[] memory availableSlots = new uint256[](deployedMissions.length());
		address[] memory missionList = new address[](deployedMissions.length());
		uint256[] memory missionCosts = new uint256[](deployedMissions.length());
		for (uint256 i = 0; i < deployedMissions.length(); i++) {
			// ensure same order
			missionList[i] = deployedMissions.at(i);
			availableSlots[i] = IMission(deployedMissions.at(i)).getSlotsRemaining();
			missionCosts[i] = IMission(deployedMissions.at(i)).entryFee();
		}
		return (missionList, availableSlots, missionCosts);
	}

    /**
     * @notice Get all active missions for a specific user
     * @dev Iterates through all deployed missions to find user participation.
     *      This is an unbounded operation; performance may degrade with many missions.
     * @param _user The address of the user to query
     * @return missionList Array of mission addresses the user is currently participating in
     * @return endTimestamps Array of Unix timestamps when each mission will complete for the user
     * @return boosted Array of booleans indicating whether each mission has an active boost
     */
	function getLiveMissions(address _user)	external view returns (
		address[] memory missionList,
		uint256[] memory endTimestamps,
		bool[] memory boosted
	) {
		// find out how many missions the user is in
		uint256 missionCount = 0;
		for (uint256 i = 0; i < deployedMissions.length(); i++) {
			if (IMission(deployedMissions.at(i)).isParticipant(_user)) {
				missionCount++;
			}
		}
		// size return arrays
		missionList = new address[](missionCount);
		endTimestamps = new uint256[](missionCount);
		boosted = new bool[](missionCount);
		// populate return arrays
		uint256 missionIndex = 0;
		for (uint256 i = 0; i < deployedMissions.length(); i++) {
			if (IMission(deployedMissions.at(i)).isParticipant(_user)) {
				missionList[missionIndex] = deployedMissions.at(i);
				(endTimestamps[missionIndex], boosted[missionIndex]) = IMission(deployedMissions.at(i)).getUserEndAndBoost(_user);
				missionIndex++;
			}
		}
	}

    /**
     * @notice Get detailed participation info for a user in a specific mission
     * @dev Delegates to the mission contract to retrieve staking details.
     * @param _user The address of the user to query
     * @param _mission The address of the mission to query
     * @return _stakedNFTs Array of NFT collection addresses the user has staked
     * @return _stakedSerials 2D array of serial numbers staked from each collection
     * @return _entryTimestamp Unix timestamp when the user entered the mission
     * @return _endOfMissionTimestamp Unix timestamp when the user's mission will complete
     * @return _boosted Whether the user has an active boost on this mission
     */
	function getUsersMissionParticipation(
		address _user,
		address _mission
	) external view returns (
		address[] memory _stakedNFTs,
		uint256[][] memory _stakedSerials,
		uint256 _entryTimestamp,
		uint256 _endOfMissionTimestamp,
		bool _boosted) {
		return IMission(_mission).getMissionParticipation(_user);
	}

    /**
     * @notice Get the boost status details for a user in a specific mission
     * @dev Delegates to the mission contract to retrieve boost information.
     * @param _user The address of the user to query
     * @param _mission The address of the mission to query
     * @return _boostType The type of boost used (None, Gem, or Lazy)
     * @return _collection The NFT collection address if a gem boost was used
     * @return _tokenId The serial number of the gem NFT if a gem boost was used
     */
	function getUsersBoostStatus(
		address _user,
		address _mission
	) external view returns (
		IBoostManager.BoostType _boostType, address _collection, uint256 _tokenId
	) {
		return IMission(_mission).getUsersBoostInfo(_user);
	}

    /**
     * @notice Pause or unpause multiple missions at once
     * @dev Only callable by admins. Paused missions do not allow new entries.
     *      Existing participants can still complete and claim rewards.
     * @param _mission Array of mission addresses to update
     * @param _paused True to pause, false to unpause
     */
	function updateMissionPause(
		address[] calldata _mission,
		bool _paused
	) external onlyRole(Role.Admin) {
		for (uint256 i = 0; i < _mission.length; i++) {
			require(deployedMissions.contains(_mission[i]), "Wrong mission address");
			IMission(_mission[i]).updatePauseStatus(_paused);
		}
	}

    /**
     * @notice Set the start timestamp for multiple missions
     * @dev Only callable by admins. Missions cannot be entered before their start timestamp.
     * @param _mission Array of mission addresses to update
     * @param _startTimestamp Unix timestamp when the missions should become active
     */
	function setMissionStart(
		address[] calldata _mission,
		uint256 _startTimestamp
	) external onlyRole(Role.Admin) {
		for (uint256 i = 0; i < _mission.length; i++) {
			require(deployedMissions.contains(_mission[i]), "Wrong mission address");
			IMission(_mission[i]).setStartTimestamp(_startTimestamp);
		}
	}

    /**
     * @notice Broadcast remaining slots event from a mission
     * @dev Only callable by deployed mission contracts. Used for event aggregation at the factory level.
     * @param _slotsRemaining The number of slots remaining in the calling mission
     */
	function broadcastSlotsRemaining(
		uint256 _slotsRemaining
	) external onlyRole(Role.Mission) {
		emit SlotsRemainingFactory(msg.sender, _slotsRemaining, block.timestamp);
	}

    /**
     * @notice Broadcast mission completion event from a mission
     * @dev Only callable by deployed mission contracts. Used for event aggregation at the factory level.
     * @param _wallet The address of the user who completed the mission
     */
	function broadcastMissionComplete(
		address _wallet
	) external onlyRole(Role.Mission) {
		emit MissionCompletedFactory(msg.sender, _wallet, block.timestamp);
	}

    /**
     * @notice Broadcast mission joined event from a mission
     * @dev Only callable by deployed mission contracts. Used for event aggregation at the factory level.
     * @param _wallet The address of the user who joined the mission
     * @param _endOfMissionTimestamp Unix timestamp when the user's mission will complete
     */
	function broadcastMissionJoined(
		address _wallet,
		uint256 _endOfMissionTimestamp
	) external onlyRole(Role.Mission) {
		emit MissionJoinedFactory(msg.sender, _wallet, block.timestamp, _endOfMissionTimestamp);
	}

    /**
     * @notice Broadcast boost activation event from the BoostManager
     * @dev Only callable by the BoostManager contract. Used for event aggregation at the factory level.
     * @param _mission The address of the boosted mission
     * @param _wallet The address of the user who activated the boost
     * @param _boostReduction The time reduction applied by the boost (in seconds)
     * @param _newEndMission The new mission end timestamp after boost
     * @param _newMissionDuration The new effective mission duration after boost
     * @param _boostType The type of boost used (Gem or Lazy)
     */
	function broadcastMissionBoost(
		address _mission,
		address _wallet,
		uint256 _boostReduction,
		uint256 _newEndMission,
		uint256 _newMissionDuration,
		IBoostManager.BoostType _boostType
	) external onlyRole(Role.BoostManager) {
		emit BoostActivatedFactory(_mission, _wallet, _boostReduction, _newEndMission, _newMissionDuration, _boostType);
	}

    /**
     * @notice Remove a closed mission from the factory's active missions list
     * @dev Only callable by the mission contract itself when it closes.
     *      Removes the mission from deployedMissions set.
     * @param _mission The address of the mission to remove
     */
	function closeMission(
		address _mission
	) external onlyRole(Role.Mission) {
		if (!deployedMissions.contains(_mission)) {
			revert("Mission Remove NOT FOUND");
		}
		bool s = deployedMissions.remove(_mission);
		if (!s) {
			revert("Mission Remove FAIL");
		}
	}

    /**
     * @notice Update the PRNG contract address used for random number generation
     * @dev Only callable by admins. The PRNG contract is used for random reward selection in missions.
     * @param _prngGenerator The address of the new PRNG contract
     */
	function updatePrngContract(
		address _prngGenerator
	) external onlyRole(Role.Admin) {
		prngGenerator = _prngGenerator;
	}

    /**
     * @notice Check if an address has admin privileges
     * @dev The factory contract itself is also considered an admin.
     * @param _user The address to check
     * @return True if the address is an admin or the factory contract itself
     */
	function isAdmin(address _user) external view returns (bool) {
		// check if user is this factory or in the admins set
		return _user == address(this) || admins.contains(_user);
	}

    /**
     * @notice Check if an address has deployer privileges
     * @param _user The address to check
     * @return True if the address can deploy new missions
     */
	function isDeployer(address _user) external view returns (bool) {
		return deployers.contains(_user);
	}

    /**
     * @notice Get all current admin addresses
     * @return Array of all addresses with admin privileges
     */
	function getAdmins() external view returns (address[] memory) {
		return admins.values();
	}

    /**
     * @notice Get all current deployer addresses
     * @return Array of all addresses with deployer privileges
     */
	function getDeployers() external view returns (address[] memory) {
		return deployers.values();
	}

    /**
     * @notice Update the LazyGasStation contract address
     * @dev Only callable by admins. The gas station handles fee payments for contract operations.
     * @param _lazyGasStation The address of the new LazyGasStation contract
     */
    function updateLGS(address _lazyGasStation) external onlyRole(Role.Admin) {
        lazyGasStation = _lazyGasStation;
    }

    /**
     * @notice Update the $LAZY token address
     * @dev Only callable by admins. Associates the factory with the new token.
     *      Use with caution; generally better to redeploy the factory for token changes.
     * @param _lazyToken The address of the new $LAZY token contract
     */
	function setLazyToken(address _lazyToken) external onlyRole(Role.Admin) {
		lazyToken = _lazyToken;
		// need to associate the new token
		HederaTokenService.associateToken(
			address(this),
			lazyToken
		);
	}

    /**
     * @notice Transfer HBAR from the factory contract to a specified address
     * @dev Only callable by admins. Maintains a minimum balance of 10 HBAR when missions are active
     *      to ensure smart contract rent can be paid.
     * @param receiverAddress The payable address to receive the HBAR
     * @param amount The amount of HBAR to transfer (in tinybars)
     */
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyRole(Role.Admin)
    {
		if (receiverAddress == address(0) || amount == 0) {
			revert("Invalid address or amount");
		}

		// if there are deployed missions ensure at least 10 hbar is left behind
		// this gives certainty on Smart Contract Rent
		if (deployedMissions.length() > 0) {
			uint256 balance = address(this).balance;
			if (balance - amount < 10 ) {
				revert("Mission Active - Min Bal 10");
			}
		}

		Address.sendValue(receiverAddress, amount);
    }

    /**
     * @notice Transfer $LAZY tokens from the factory contract to a specified address
     * @dev Only callable by admins. Uses HTS transferToken for native Hedera token transfers.
     * @param _receiver The address to receive the $LAZY tokens
     * @param _amount The amount of $LAZY tokens to transfer (adjusted for decimals)
     */
	function retrieveLazy(
		address _receiver,
		int64 _amount
	) external onlyRole(Role.Admin) {
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

    /**
     * @notice Allows the contract to receive HBAR
     * @dev Emits a FactoryMessage event when HBAR is received directly.
     */
    receive() external payable {
        emit FactoryMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    /**
     * @notice Fallback function to receive HBAR when called with data
     * @dev Emits a FactoryMessage event when HBAR is received via fallback.
     */
    fallback() external payable {
        emit FactoryMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
