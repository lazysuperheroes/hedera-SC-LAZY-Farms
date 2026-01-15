// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title IBurnableHTS
 * @notice Interface for burning Hedera Token Service (HTS) tokens
 * @dev Wraps the HTS burn functionality for fungible tokens.
 * Used by LazyGasStation to burn $LAZY tokens as part of fee/reward processing.
 */
interface IBurnableHTS {

	/**
	 * @notice Burn a specified amount of fungible tokens
	 * @dev Only works for tokens where this contract has burn authority
	 * @param token Address of the HTS token to burn
	 * @param amount Amount of tokens to burn (smallest unit)
	 * @return responseCode Hedera response code (22 = SUCCESS)
	 */
	function burn(address token, uint32 amount) external returns (int256 responseCode);
}
