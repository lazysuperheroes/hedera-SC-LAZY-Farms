// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title ILazyGasStation
 * @notice Interface for the centralized fee and token distribution hub
 * @dev Manages $LAZY token flows between users and contracts. Handles entry fees,
 * reward payouts, and token burns. Authorized contracts can request funds.
 */
interface ILazyGasStation {

	/**
	 * @notice Request $LAZY tokens from the gas station
	 * @dev Only callable by authorized contract users
	 * @param _amount Amount of $LAZY to transfer to caller
	 */
	function refillLazy(uint256 _amount) external;

	/**
	 * @notice Request HBAR from the gas station
	 * @dev Only callable by authorized contract users
	 * @param _amount Amount of HBAR (in tinybars) to transfer to caller
	 */
	function refillHbar(uint256 _amount) external;

	/**
	 * @notice Draw $LAZY tokens from a user (for entry fees)
	 * @dev User must have approved gas station. Portion may be burned.
	 * @param _user Address to draw tokens from
	 * @param _amount Total amount to draw
	 * @param _burnPercentage Percentage to burn (0-100)
	 */
	function drawLazyFrom(address _user, uint256 _amount, uint256 _burnPercentage) external;

	/**
	 * @notice Draw $LAZY from user and send remainder to a recipient
	 * @dev Used when fees should go to a specific address (e.g., mission creator)
	 * @param _user Address to draw tokens from
	 * @param _amount Total amount to draw
	 * @param _burnPercentage Percentage to burn (0-100)
	 * @param _payTo Address to receive the non-burned portion
	 */
	function drawLazyFromPayTo(address _user, uint256 _amount, uint256 _burnPercentage, address _payTo) external;

	/**
	 * @notice Pay $LAZY tokens to a user (for reward claims)
	 * @dev Portion is burned before payout. Only callable by authorized contracts.
	 * @param _user Address to pay tokens to
	 * @param _amount Gross amount before burn
	 * @param _burnPercentage Percentage to burn (0-100)
	 * @return _payoutAmount Net amount transferred to user
	 */
	function payoutLazy(address _user, uint256 _amount, uint256 _burnPercentage) external returns (uint256 _payoutAmount);

	/**
	 * @notice Add an admin who can manage gas station configuration
	 * @dev Only callable by existing admin
	 * @param _admin Address to grant admin role
	 * @return _added True if successfully added
	 */
	function addAdmin(address _admin) external returns (bool _added);

	/**
	 * @notice Remove an admin (cannot remove last admin)
	 * @dev Only callable by existing admin
	 * @param _admin Address to revoke admin role
	 * @return _removed True if successfully removed
	 */
	function removeAdmin(address _admin) external returns (bool _removed);

	/**
	 * @notice Add an authorizer who can add contract users
	 * @dev Only callable by admin
	 * @param _authorized Address to grant authorizer role
	 * @return _added True if successfully added
	 */
	function addAuthorizer(address _authorized) external returns (bool _added);

	/**
	 * @notice Remove an authorizer
	 * @dev Only callable by admin
	 * @param _authorized Address to revoke authorizer role
	 * @return _removed True if successfully removed
	 */
	function removeAuthorizer(address _authorized) external returns (bool _removed);

	/**
	 * @notice Add a contract that can request funds from gas station
	 * @dev Only callable by authorizer. Must be a contract address.
	 * @param _deployer Contract address to authorize
	 * @return _added True if successfully added
	 */
	function addContractUser(address _deployer) external returns (bool _added);

	/**
	 * @notice Remove a contract's authorization to request funds
	 * @dev Only callable by authorizer
	 * @param _deployer Contract address to deauthorize
	 * @return _removed True if successfully removed
	 */
	function removeContractUser(address _deployer) external returns (bool _removed);

	/**
	 * @notice Get the $LAZY Smart Contract Token address
	 * @dev Used for token burn operations via HTS
	 * @return _lazySCT Address of the $LAZY token contract
	 */
	function lazySCT() external returns (address _lazySCT);
}
