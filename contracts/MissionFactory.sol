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

contract MissionFactory is HederaTokenService, IRoles {
    using EnumerableSet for EnumerableSet.AddressSet;

	event MissionCompletedFactory(address indexed mission, address indexed wallet, uint256 timestamp);

    event MissionCreatedFactory(
		address indexed mission,
        uint256 _missionDuration,
        uint256 _entryFee,
        uint256 _feeBurnPercentage,
        uint256 _lastEntryTimestamp
    );

    event MissionJoinedFactory(
		address indexed mission, 
        address _user,
        uint256 _entryTimestamp,
        uint256 _endOfMissionTimestamp
    );

	event BoostActivatedFactory(
        address _mission,
        address _missionParticipant,
        uint256 _boostReduction,
        uint256 _newEndTimestamp,
        uint256 _newMissionDuration,
		IBoostManager.BoostType _boostType
    );

	event SlotsRemainingFactory(address indexed mission, uint256 _slotsRemaining, uint256 _timestamp);

	event FactoryMessage(
		string _type,
		address _sender,
		uint256 _amount,
		string _message
	);

    //add deployer role
    EnumerableSet.AddressSet private deployers;
    EnumerableSet.AddressSet private admins;
	EnumerableSet.AddressSet private deployedMissions;
    mapping(address => address) public missions;
    mapping(address => address) public creators;
    address public lazyToken;
    address public boostManager;
	address public prngGenerator;
    address public missionTemplate;
	address public lazyGasStation;
	address public lazyDelegateRegistry;

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

    function addAdmin(
        address _admin
    ) external onlyRole(Role.Admin) returns (bool) {
        return admins.add(_admin);
    }

	function removeAdmin(
		address _admin
	) external onlyRole(Role.Admin) returns (bool) {
		//check if admin is the last one
		require(admins.length() > 1, "Last Admin");
		return admins.remove(_admin);
	}

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
     * @dev Allows the owner to add a boost manager
     * @param _boostManager The address of the admin to add
     */
    function updateBoostManager(
        address _boostManager
    ) external onlyRole(Role.Admin) {
        boostManager = _boostManager;
    }

	/**
	 * Potentially useful in case of upgrade to mission we can leave the factory intact
	 * @dev Allows the owner to update the mission template
	 * @param _missionTemplate The address of the new mission template
	 */
	function updateMissionTemplate(
		address _missionTemplate
	) external onlyRole(Role.Admin) {
		missionTemplate = _missionTemplate;
	}

	/**
	 * @dev get live missions, this is unbounded so could have issues if live missions grows too large
	 * As long as farms deployed per project (vs one for whole ecosystem) should be golden
	 * @dev will be used by the HTS discord token bot to ignore ownership transitions into missions
	 * As the missions will show here unless closed (when closed no user is in the factory) allowinfg HTS bot
	 * to ignore the mission address
	 * @return address[] list of the deployed mission contracts
	 */
	function getDeployedMissions() external view returns (address[] memory) {
		return deployedMissions.values();
	}

	/**
	* @dev get available slots for each mission deployed, again unbounded so could have issues if live missions grows too large
	* As long as farms deployed per project (vs one for whole ecosystem) should be golden
	* @return address[] list of the deployed mission contracts
	* @return uint256[] list of the available slots for each mission
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

	function getUsersBoostStatus(
		address _user,
		address _mission
	) external view returns (
		IBoostManager.BoostType _boostType, address _collection, uint256 _tokenId
	) {
		return IMission(_mission).getUsersBoostInfo(_user);
	}

	function updateMissionPause(
		address[] calldata _mission,
		bool _paused
	) external onlyRole(Role.Admin) {
		for (uint256 i = 0; i < _mission.length; i++) {
			require(deployedMissions.contains(_mission[i]), "Wrong mission address");
			IMission(_mission[i]).updatePauseStatus(_paused);
		}
	}

	function setMissionStart(
		address[] calldata _mission,
		uint256 _startTimestamp
	) external onlyRole(Role.Admin) {
		for (uint256 i = 0; i < _mission.length; i++) {
			require(deployedMissions.contains(_mission[i]), "Wrong mission address");
			IMission(_mission[i]).setStartTimestamp(_startTimestamp);
		}
	}

	function broadcastSlotsRemaining(
		uint256 _slotsRemaining
	) external onlyRole(Role.Mission) {
		emit SlotsRemainingFactory(msg.sender, _slotsRemaining, block.timestamp);
	}

	function broadcastMissionComplete(
		address _wallet
	) external onlyRole(Role.Mission) {
		emit MissionCompletedFactory(msg.sender, _wallet, block.timestamp);
	}

	function broadcastMissionJoined(
		address _wallet,
		uint256 _endOfMissionTimestamp
	) external onlyRole(Role.Mission) {
		emit MissionJoinedFactory(msg.sender, _wallet, block.timestamp, _endOfMissionTimestamp);
	}

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
	* @dev When a mission closes allows it to be removed from the factory
	* @param _mission The address of the mission to close
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

	/**
	* @dev Allows the owner to update the prng contract
	* @param _prngGenerator The address of the new prng contract
	 */
	function updatePrngContract(
		address _prngGenerator
	) external onlyRole(Role.Admin) {
		prngGenerator = _prngGenerator;
	}

	function isAdmin(address _user) external view returns (bool) {
		// check if user is this factory or in the admins set
		return _user == address(this) || admins.contains(_user);
	}

	function isDeployer(address _user) external view returns (bool) {
		return deployers.contains(_user);
	}

	function getAdmins() external view returns (address[] memory) {
		return admins.values();
	}

	function getDeployers() external view returns (address[] memory) {
		return deployers.values();
	}

    /**
     * @dev update Lazy Gas Station contract
     * @param _lazyGasStation new address
     */
    function updateLGS(address _lazyGasStation) external onlyRole(Role.Admin) {
        lazyGasStation = _lazyGasStation;
    }

	/**
	 * @dev update Lazy Token - method to allow for future token upgrades but likely better to redploy factory
	 * @param _lazyToken new address
	 */
	function setLazyToken(address _lazyToken) external onlyRole(Role.Admin) {
		lazyToken = _lazyToken;
		// need to associate the new token
		HederaTokenService.associateToken(
			address(this),
			lazyToken
		);
	}

	/// @param receiverAddress address in EVM fomat of the reciever of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
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

	// allows the contract to recieve HBAR
    receive() external payable {
        emit FactoryMessage(
            "Receive",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }

    fallback() external payable {
        emit FactoryMessage(
            "Fallback",
            msg.sender,
            msg.value,
            "Hbar received"
        );
    }
}
