// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";

import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { IRoles } from "./interfaces/IRoles.sol";
import { IBurnableHTS } from "./interfaces/IBurnableHTS.sol";

/// @title LazyGasStation - Fee Payment and $LAZY Distribution Hub
/// @author stowerling.eth / stowerling.hbar
/// @notice This contract serves as a centralized hub for managing $LAZY token and HBAR distributions
/// @dev Authorized contracts can request refills of $LAZY tokens or HBAR, and process payouts with optional burn
/// The contract uses role-based access control with Admins, Authorizers, and ContractUsers
contract LazyGasStation is HederaTokenService, ILazyGasStation, IRoles, ReentrancyGuard {
	using SafeCast for uint256;
	using SafeCast for int256;
	using EnumerableSet for EnumerableSet.AddressSet;
	using Address for address;

	/// @notice Enum representing the type of payment for refills
	/// @dev Used in events to distinguish between HBAR and $LAZY refills
	enum PaymentType {
		Hbar,
		Lazy
	}

	/// @notice Emitted when a contract receives a refill of $LAZY or HBAR
	/// @param _callingContract The address of the contract that requested the refill
	/// @param _amount The amount of tokens or HBAR refilled
	/// @param _type The type of refill (Hbar or Lazy)
	event GasStationRefillEvent(
		address indexed _callingContract,
		uint256 _amount,
		PaymentType _type
	);

	/// @notice Emitted when $LAZY tokens are paid out to a user or drawn from a user
	/// @param _callingContract The contract initiating the funding operation
	/// @param _user The user receiving or providing the tokens
	/// @param _amount The total amount of tokens involved
	/// @param _burnPercentage The percentage of tokens burned (0-100)
	/// @param _fromUser True if tokens are drawn from the user, false if paid out to the user
	event GasStationFunding(
		address indexed _callingContract,
		address indexed _user,
		uint256 _amount,
		uint256 _burnPercentage,
		bool _fromUser
	);

	/// @notice Emitted when access control roles are modified
	/// @param _executor The admin who made the change
	/// @param _address The address whose role was modified
	/// @param _added True if role was added, false if removed
	/// @param _role The role that was modified
	event GasStationAccessControlEvent(
		address indexed _executor,
		address indexed _address,
		bool _added,
		Role _role
	);

	/// @notice Emitted when the contract receives HBAR via receive() or fallback()
	/// @param message Descriptive message ("Receive" or "Fallback")
	/// @param sender The address that sent the HBAR
	/// @param value The amount of HBAR received in tinybars
	event GasStationStatus (
		string message,
		address sender,
		uint256 value
	);

	/// @dev Set of addresses with admin privileges (can manage all roles)
	EnumerableSet.AddressSet private admins;
	/// @dev Set of addresses that can authorize contract users
	EnumerableSet.AddressSet private authorizers;
	/// @dev Set of contract addresses that can request refills and payouts
	EnumerableSet.AddressSet private contractUsers;

	/// @notice The $LAZY token contract address
	address public lazyToken;
	/// @notice The Lazy SCT (Smart Contract Treasury) address used for burning tokens
	address public lazySCT;

	/// @notice Thrown when token association with HTS fails during construction
	error AssociationFailed();
	/// @notice Thrown when contract has insufficient balance for requested operation
	/// @param _required The amount requested
	/// @param _available The amount available in the contract
	error Empty(uint256 _required, uint256 _available);
	/// @notice Thrown when function arguments are invalid (zero amount, invalid percentage, etc.)
	error BadInput();
	/// @notice Thrown when a token payout transfer fails
	error PayoutFailed();
	/// @notice Thrown when the net payout (after burn) transfer fails
	error NetPayoutFailed();
	/// @notice Thrown when token burn operation fails via the SCT
	error BurnFailed();
	/// @notice Thrown when attempting to remove the last admin (at least one must remain)
	error LastAdmin();
	/// @notice Thrown when user has not approved sufficient $LAZY allowance for drawLazyFrom
	error InsufficientAllowance();
	/// @notice Thrown when transferFrom to this contract fails in drawLazyFrom operations
	error ToLGSTransferFailed();

	/// @notice Deploys the LazyGasStation and associates it with $LAZY token
	/// @dev The deployer becomes the first admin. Contract associates with $LAZY via HTS
	/// @param _lazyToken The address of the $LAZY token contract
	/// @param _lazySCT The address of the Lazy SCT contract for burning tokens
	constructor(
		address _lazyToken,
		address _lazySCT
	) {
		lazyToken = _lazyToken;
		lazySCT = _lazySCT;

		int256 response = HederaTokenService.associateToken(
			address(this),
			lazyToken
		);

		if (response != HederaResponseCodes.SUCCESS) {
			revert AssociationFailed();
		}

		admins.add(msg.sender);
	}

	/// @dev Restricts function access to admin addresses only
	modifier onlyAdmin() {
		if(!admins.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.Admin);
		_;
	}

	/// @dev Restricts function access to authorizer addresses only
	modifier onlyAuthorizer() {
		if(!authorizers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationAuthorizer);
		_;
	}

	/// @dev Restricts function access to registered contract users only
	modifier onlyContractUser() {
		if(!contractUsers.contains(msg.sender)) revert PermissionDenied(msg.sender, Role.GasStationContractUser);
		_;
	}

	/// @dev Restricts function access to either admins or authorizers
	modifier onlyAdminOrAuthorizer() {
		if(!(admins.contains(msg.sender) || authorizers.contains(msg.sender)))
			revert PermissionDenied(msg.sender, Role.AdminOrCreator);
		_;
	}

	/// @notice Refill the calling contract with $LAZY tokens from the gas station
	/// @dev Only callable by registered contract users. Transfers $LAZY directly to caller
	/// @param _amount The amount of $LAZY tokens to transfer to the calling contract
	function refillLazy(
		uint256 _amount
	) external onlyContractUser nonReentrant {
		if (IERC20(lazyToken).balanceOf(address(this)) < _amount) {
			revert Empty(_amount, IERC20(lazyToken).balanceOf(address(this)));
		}
		if (_amount == 0) {
			revert BadInput();
		}

		bool result = IERC20(lazyToken).transfer(msg.sender, _amount);
		if (!result) {
			revert PayoutFailed();
		}

		emit GasStationRefillEvent(msg.sender, _amount, PaymentType.Lazy);
	}

	/// @notice Refill the calling contract with HBAR from the gas station
	/// @dev Only callable by registered contract users. Sends HBAR via Address.sendValue
	/// @param _amount The amount of HBAR (in tinybars) to transfer to the calling contract
	function refillHbar(
		uint256 _amount
	) external onlyContractUser nonReentrant {
		// check the contract has enough hbar
		if (address(this).balance < _amount) {
			revert Empty(_amount, address(this).balance);
		}
		if (_amount == 0) {
			revert BadInput();
		}

		Address.sendValue(payable(msg.sender), _amount);

		emit GasStationRefillEvent(msg.sender, _amount, PaymentType.Hbar);
	}

	/// @notice Pay out $LAZY tokens to a user with optional burn percentage
	/// @dev Burns a percentage of tokens via the SCT before paying out the remainder to the user
	/// @param _user The address of the user to receive the payout
	/// @param _amount The total amount of $LAZY tokens (before burn)
	/// @param _burnPercentage The percentage of tokens to burn (0-100)
	/// @return _payoutAmount The net amount actually paid to the user after burn
	function payoutLazy(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser nonReentrant returns (uint256 _payoutAmount) {
		if (_amount == 0 || _burnPercentage > 100) {
			revert BadInput();
		}		
		else if (IERC20(lazyToken).balanceOf(address(this)) < _amount) {
			revert Empty(_amount, IERC20(lazyToken).balanceOf(address(this)));
		}

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		bool result;
		if (burnAmt > 0) {
			int256 responseCode = IBurnableHTS(lazySCT).burn(
				lazyToken,
				burnAmt.toUint32()
			);

			if (responseCode != HederaResponseCodes.SUCCESS) {
				revert BurnFailed();
			}

			// pay out the remainder to the user
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0) {
				result = IERC20(lazyToken).transfer(
					_user,
					remainder
				);
				if (!result) {
					revert NetPayoutFailed();
				}
			}
			_payoutAmount = remainder;
		}
		else {
			result = IERC20(lazyToken).transfer(
				_user,
				_amount
			);
			if (!result) {
				revert PayoutFailed();
			}
			_payoutAmount = _amount;
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, false);
	}

	/// @notice Draw $LAZY tokens from a user and keep them in this contract
	/// @dev Convenience function that calls drawLazyFromPayTo with this contract as recipient
	/// Requires the user to have approved this contract for the specified amount
	/// @param _user The address of the user to draw tokens from
	/// @param _amount The total amount of $LAZY tokens to draw
	/// @param _burnPercentage The percentage of tokens to burn (0-100)
	function drawLazyFrom(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage
	) external onlyContractUser {
		drawLazyFromPayTo(_user, _amount, _burnPercentage, address(this));
	}

	/// @notice Draw $LAZY tokens from a user with optional burn and send remainder to a nominated address
	/// @dev Requires user approval. Burns specified percentage via SCT, then transfers remainder to _payTo
	/// If _payTo is this contract and there's no burn, tokens stay in this contract
	/// @param _user The address of the user to draw tokens from
	/// @param _amount The total amount of $LAZY tokens to draw
	/// @param _burnPercentage The percentage of tokens to burn (0-100)
	/// @param _payTo The address to receive the remainder after burn (can be this contract)
	function drawLazyFromPayTo(
		address _user,
		uint256 _amount,
		uint256 _burnPercentage,
		address _payTo
	) public onlyContractUser nonReentrant {
		if (IERC20(lazyToken).allowance(_user, address(this)) < _amount) {
			revert InsufficientAllowance();
		}
		else if (_amount == 0 || _burnPercentage > 100 || _payTo == address(0)) {
			revert BadInput();
		}

		uint256 burnAmt = (_amount * _burnPercentage) / 100;

		// If there is any to burn will need to transfer to this contract first then send balanmce on
		bool result;
		if (burnAmt > 0) {
			result = IERC20(lazyToken).transferFrom(
				_user,
				address(this),
				_amount
			);
			if (!result) {
				revert ToLGSTransferFailed();
			}
			int256 responseCode = IBurnableHTS(lazySCT).burn(
                lazyToken,
                burnAmt.toUint32()
            );

            if (responseCode != HederaResponseCodes.SUCCESS) {
                revert BurnFailed();
            }

			// send the remainder to nominated address
			uint256 remainder = _amount - burnAmt;
			if (remainder > 0 && _payTo != address(this)) {
				result = IERC20(lazyToken).transferFrom(
					address(this),
					_payTo,
					remainder
				);
				if (!result) {
					revert NetPayoutFailed();
				}
			}
		}
		else {
			result = IERC20(lazyToken).transferFrom(
				_user,
				_payTo,
				_amount
			);
			if (!result) {
				revert PayoutFailed();
			}
		}

		emit GasStationFunding(msg.sender, _user, _amount, _burnPercentage, true);
	}

	/// @notice Add a new admin to the Gas Station
	/// @dev Only existing admins can add new admins
	/// @param _admin The address to grant admin privileges
	/// @return _added True if the admin was added, false if already an admin
	function addAdmin(
		address _admin
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _admin, true, Role.Admin);
		return admins.add(_admin);
	}

	/// @notice Remove an admin from the Gas Station
	/// @dev Cannot remove the last admin to prevent lockout. Only admins can remove admins
	/// @param _admin The address to revoke admin privileges from
	/// @return _removed True if the admin was removed, false if not an admin
	function removeAdmin(
		address _admin
	) external onlyAdmin returns (bool _removed){
		if (admins.length() == 1) {
			revert LastAdmin();
		}
		emit GasStationAccessControlEvent(msg.sender, _admin, false, Role.Admin);
		return admins.remove(_admin);
	}

	/// @notice Add an authorizer to the Gas Station
	/// @dev Authorizers can add/remove contract users but cannot manage admins or other authorizers
	/// @param _authorized The address to grant authorizer privileges
	/// @return _added True if the authorizer was added, false if already an authorizer
	function addAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _added){
		emit GasStationAccessControlEvent(msg.sender, _authorized, true, Role.GasStationAuthorizer);
		return authorizers.add(_authorized);
	}

	/// @notice Remove an authorizer from the Gas Station
	/// @dev Only admins can remove authorizers
	/// @param _authorized The address to revoke authorizer privileges from
	/// @return _removed True if the authorizer was removed, false if not an authorizer
	function removeAuthorizer(
		address _authorized
	) external onlyAdmin returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _authorized, false, Role.GasStationAuthorizer);
		return authorizers.remove(_authorized);
	}

	/// @notice Add a contract user that can request refills and payouts
	/// @dev Only contract addresses can be added (not EOAs). Admins and authorizers can add users
	/// @param _deployer The contract address to grant usage privileges
	/// @return _added True if the contract user was added, false if already registered
	function addContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _added){
		if (_deployer == address(0) || !_deployer.isContract()) {
			revert BadInput();
		}
		emit GasStationAccessControlEvent(msg.sender, _deployer, true, Role.GasStationContractUser);
		return contractUsers.add(_deployer);
	}

	/// @notice Remove a contract user from the Gas Station
	/// @dev Admins and authorizers can remove contract users
	/// @param _deployer The contract address to revoke usage privileges from
	/// @return _removed True if the contract user was removed, false if not registered
	function removeContractUser(
		address _deployer
	) external onlyAdminOrAuthorizer returns (bool _removed){
		emit GasStationAccessControlEvent(msg.sender, _deployer, false, Role.GasStationContractUser);
		return contractUsers.remove(_deployer);
	}

	/// @notice Get the list of all admin addresses
	/// @return _admins Array of all addresses with admin privileges
	function getAdmins() external view returns (address[] memory _admins) {
		return admins.values();
	}

	/// @notice Get the list of all authorizer addresses
	/// @return _authorizers Array of all addresses with authorizer privileges
	function getAuthorizers() external view returns (address[] memory _authorizers) {
		return authorizers.values();
	}

	/// @notice Get the list of all registered contract user addresses
	/// @return _contractUsers Array of all contract addresses with usage privileges
	function getContractUsers() external view returns (address[] memory _contractUsers) {
		return contractUsers.values();
	}

	/// @notice Check if an address has admin privileges
	/// @param _admin The address to check
	/// @return _isAdmin True if the address is an admin, false otherwise
	function isAdmin(address _admin) external view returns (bool _isAdmin) {
		return admins.contains(_admin);
	}

	/// @notice Check if an address has authorizer privileges
	/// @param _authorizer The address to check
	/// @return _isAuthorizer True if the address is an authorizer, false otherwise
	function isAuthorizer(address _authorizer) external view returns (bool _isAuthorizer) {
		return authorizers.contains(_authorizer);
	}

	/// @notice Check if an address is a registered contract user
	/// @param _contractUser The address to check
	/// @return _isContractUser True if the address is a registered contract user, false otherwise
	function isContractUser(address _contractUser) external view returns (bool _isContractUser) {
		return contractUsers.contains(_contractUser);
	}

	/// @notice Transfer HBAR from the contract to a specified receiver
	/// @dev Admin-only function for withdrawing HBAR from the gas station
	/// @param receiverAddress The payable address to send the HBAR to
	/// @param amount The amount of HBAR (in tinybars) to transfer
    function transferHbar(address payable receiverAddress, uint256 amount)
        external
        onlyAdmin()
    {
		if (receiverAddress == address(0) || amount == 0) {
			revert BadInput();
		}
		Address.sendValue(receiverAddress, amount);
    }

	/// @notice Retrieve $LAZY tokens from the contract to a specified receiver
	/// @dev Admin-only function for withdrawing $LAZY tokens from the gas station
	/// @param _receiver The address to send the $LAZY tokens to
	/// @param _amount The amount of $LAZY tokens to transfer
	function retrieveLazy(
		address _receiver,
		uint256 _amount
	) external onlyAdmin() {
		if (_receiver == address(0) || _amount == 0) {
			revert BadInput();
		}

		IERC20(lazyToken).transfer(_receiver, _amount);
	}

	/// @notice Allows the contract to receive HBAR directly
	/// @dev Emits GasStationStatus event when HBAR is received
    receive() external payable {
        emit GasStationStatus(
            "Receive",
            msg.sender,
            msg.value
        );
    }

	/// @notice Fallback function that allows the contract to receive HBAR with data
	/// @dev Emits GasStationStatus event when HBAR is received via fallback
    fallback() external payable {
        emit GasStationStatus(
            "Fallback",
            msg.sender,
            msg.value
        );
    }
}