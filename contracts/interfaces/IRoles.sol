// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title IRoles
 * @notice Common role definitions and errors used across farming contracts
 * @dev Provides standardized role types for access control and common error definitions
 */
interface IRoles {

	/**
	 * @notice Role types used for access control across the system
	 * @dev Each contract uses relevant subset of these roles
	 */
	enum Role {
        Admin,                  // Full administrative access
        Deployer,               // Can deploy new missions via factory
		Mission,                // Mission contract role (for inter-contract calls)
		BoostManager,           // BoostManager contract role
		AdminOrCreator,         // Mission admin or original creator
		Participant,            // Active mission participant
		GasStationContractUser, // Contract authorized to use gas station
		GasStationAuthorizer    // Can add/remove contract users to gas station
    }

	/**
	 * @notice Thrown when caller lacks required role
	 * @param _user Address that attempted the action
	 * @param _role Role that was required but not held
	 */
	error PermissionDenied(address _user, Role _role);

	/**
	 * @notice Thrown when function arguments are invalid
	 * @dev Generic error for parameter validation failures
	 */
	error BadArgument();
}
