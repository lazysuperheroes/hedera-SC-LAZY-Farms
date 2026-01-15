// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title ILazyAllowanceUtility
 * @notice Interface for querying HTS token allowances
 * @dev Provides read-only functions to check fungible and non-fungible token
 * allowances on Hedera. Used by dApps to verify user has set required allowances
 * before executing transactions.
 */
interface ILazyAllowanceUtility {

	/**
	 * @notice Thrown when function arguments are invalid
	 */
	error InvalidArguments();

	/**
	 * @notice Emitted for utility operations
	 * @param sender Address that called the function
	 * @param value Associated value (if any)
	 * @param message Description of the operation
	 */
	event LazyAllowanceUtilityEvent (
		address indexed sender,
		uint256 indexed value,
		string message
	);

	/**
	 * @notice Check the live allowance of a fungible token
	 * @dev Queries current on-chain allowance state
	 * @param _token Address of the HTS token (EVM format)
	 * @param _owner Address of the token owner (EVM format)
	 * @param _spender Address of the approved spender (EVM format)
	 * @return allowance Number of tokens allowed to be spent
	 */
	function checkLiveAllowance(address _token, address _owner, address _spender) external view returns (uint256 allowance);

	/**
	 * @notice Check if spender is approved for all serials of an NFT collection
	 * @dev Checks the "approve all" status for NFTs
	 * @param _token Address of the NFT collection (EVM format)
	 * @param _owner Address of the NFT owner (EVM format)
	 * @param _spender Address to check approval for (EVM format)
	 * @return isApproved True if spender is approved for all serials
	 */
	function isApprovedForAllSerials(address _token, address _owner, address _spender) external view returns (bool isApproved);

	/**
	 * @notice Batch check live allowances for multiple fungible tokens
	 * @dev More efficient than multiple individual calls
	 * @param _token Array of token addresses (EVM format)
	 * @param _owner Array of owner addresses (EVM format)
	 * @param _spender Array of spender addresses (EVM format)
	 * @return allowances Array of allowance amounts
	 */
	function checkLiveAllowances(address[] memory _token, address[] memory _owner, address[] memory _spender) external view returns (uint256[] memory allowances);

	/**
	 * @notice Batch check "approve all" status for multiple NFT collections
	 * @dev More efficient than multiple individual calls
	 * @param _token Array of NFT collection addresses (EVM format)
	 * @param _owner Array of owner addresses (EVM format)
	 * @param _spender Array of spender addresses (EVM format)
	 * @return approvals Array of approval statuses
	 */
	function checkTokensApprovedForAllSerial(address[] memory _token, address[] memory _owner, address[] memory _spender) external view returns (bool[] memory approvals);

	/**
	 * @notice Get the approved address for a specific NFT serial
	 * @dev Returns the address approved to transfer this specific NFT
	 * @param _token Address of the NFT collection (EVM format)
	 * @param _serial Serial number of the NFT
	 * @return approvedAddress Address approved to transfer this NFT
	 */
	function checkApprovedAddress(address _token, uint256 _serial) external returns (address approvedAddress);

	/**
	 * @notice Batch get approved addresses for multiple NFT serials
	 * @dev More efficient than multiple individual calls
	 * @param _token Array of NFT collection addresses (EVM format)
	 * @param _serial Array of serial numbers
	 * @return approvedAddresses Array of approved addresses
	 */
	function checkApprovedAddresses(address[] memory _token, uint256[] memory _serial) external returns (address[] memory approvedAddresses);
}
