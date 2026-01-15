// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title IPrngSystemContract
 * @notice Interface for Hedera's pseudorandom number generation system
 * @dev Wraps Hedera's native PRNG precompile for generating verifiable random numbers.
 * Used by Mission contracts for fair, random reward selection.
 */
interface IPrngSystemContract {

    /**
     * @notice Generate a 256-bit pseudorandom seed
     * @dev Uses the first 256 bits of the running hash from the n-3 transaction record.
     * Users can derive a number in range via: (seed % range)
     * @return 32-byte pseudorandom seed
     */
    function getPseudorandomSeed() external returns (bytes32);

    /**
     * @notice Generate a pseudorandom number within a specified range
     * @dev Combines system seed with user seed for additional entropy
     * @param lo Lower bound (inclusive)
     * @param hi Upper bound (inclusive)
     * @param userSeed Additional entropy provided by caller
     * @return Pseudorandom number in range [lo, hi]
     */
	function getPseudorandomNumber(uint256 lo, uint256 hi, uint256 userSeed) external returns (uint256);

    /**
     * @notice Generate a single uint256 pseudorandom number
     * @dev Convenience function using full uint256 range
     * @return Pseudorandom uint256 value
     */
	function generateRandomNumber() external returns (uint256);

    /**
     * @notice Generate an array of pseudorandom numbers within a range
     * @dev Useful for selecting multiple random items (e.g., reward NFTs)
     * @param lo Lower bound (inclusive)
     * @param hi Upper bound (inclusive)
     * @param userSeed Additional entropy provided by caller
     * @param arrayLength Number of random values to generate
     * @return Array of pseudorandom numbers in range [lo, hi]
     */
	function getPseudorandomNumberArray(uint256 lo, uint256 hi, uint256 userSeed, uint256 arrayLength) external returns (uint256[] memory);
}
