/**
 * Deployment Manifest Utilities
 * Helpers for reading and updating deployment manifests
 */
const fs = require('fs');
const path = require('path');

const DEPLOYMENTS_DIR = path.join(__dirname, '../deployments');

/**
 * Load a deployment manifest for the given network
 * @param {string} network - Network name (mainnet, testnet, previewnet, local)
 * @returns {object} Parsed manifest object
 */
function loadManifest(network) {
	const manifestPath = path.join(DEPLOYMENTS_DIR, `${network.toLowerCase()}.json`);

	if (!fs.existsSync(manifestPath)) {
		throw new Error(`No deployment manifest found for network: ${network}`);
	}

	return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/**
 * Save a deployment manifest
 * @param {string} network - Network name
 * @param {object} manifest - Manifest object to save
 */
function saveManifest(network, manifest) {
	const manifestPath = path.join(DEPLOYMENTS_DIR, `${network.toLowerCase()}.json`);

	// Update metadata
	manifest.metadata = manifest.metadata || {};
	manifest.metadata.lastUpdated = new Date().toISOString();

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	console.log(`Manifest saved: ${manifestPath}`);
}

/**
 * Get a contract from the manifest by name
 * @param {string} network - Network name
 * @param {string} contractName - Contract name in manifest
 * @returns {object|null} Contract info or null if not found
 */
function getContract(network, contractName) {
	const manifest = loadManifest(network);
	return manifest.contracts[contractName] || null;
}

/**
 * Get contract ID for a named contract
 * @param {string} network - Network name
 * @param {string} contractName - Contract name in manifest
 * @returns {string|null} Contract ID or null if not found
 */
function getContractId(network, contractName) {
	const contract = getContract(network, contractName);
	return contract?.contractId || null;
}

/**
 * Add or update a contract in the manifest
 * @param {string} network - Network name
 * @param {string} contractName - Key name for the contract
 * @param {object} contractInfo - Contract deployment info
 */
function updateContract(network, contractName, contractInfo) {
	const manifest = loadManifest(network);

	// Merge with existing if present
	manifest.contracts[contractName] = {
		...manifest.contracts[contractName],
		...contractInfo,
	};

	saveManifest(network, manifest);
}

/**
 * Record a new contract deployment
 * @param {string} network - Network name
 * @param {object} deployment - Deployment details
 * @param {string} deployment.name - Contract display name
 * @param {string} deployment.key - Manifest key
 * @param {string} deployment.contractId - Hedera contract ID
 * @param {string} deployment.sourcePath - Path to source file
 * @param {string} deployment.description - What the contract does
 * @param {object} [deployment.constructorArgs] - Constructor arguments
 * @param {string[]} [deployment.dependencies] - Names of dependent contracts
 * @param {string} [deployment.deploymentTx] - Transaction ID
 */
function recordDeployment(network, deployment) {
	const { ContractId } = require('@hashgraph/sdk');

	const contractId = ContractId.fromString(deployment.contractId);
	const evmAddress = '0x' + contractId.toSolidityAddress();

	const contractInfo = {
		name: deployment.name,
		type: 'contract',
		contractId: deployment.contractId,
		evmAddress,
		sourcePath: deployment.sourcePath,
		description: deployment.description,
		deployedAt: new Date().toISOString(),
		verified: false,
	};

	if (deployment.constructorArgs) {
		contractInfo.constructorArgs = deployment.constructorArgs;
	}

	if (deployment.dependencies) {
		contractInfo.dependencies = deployment.dependencies;
	}

	if (deployment.deploymentTx) {
		contractInfo.deploymentTx = deployment.deploymentTx;
	}

	updateContract(network, deployment.key, contractInfo);

	console.log(`\nRecorded deployment: ${deployment.name}`);
	console.log(`  Contract ID: ${deployment.contractId}`);
	console.log(`  EVM Address: ${evmAddress}`);
}

/**
 * Add an admin to the manifest roles
 * @param {string} network - Network name
 * @param {string} roleType - Role type (factoryAdmins, factoryDeployers, stakingAdmins)
 * @param {object} roleInfo - Role assignment info
 */
function addRole(network, roleType, roleInfo) {
	const manifest = loadManifest(network);

	manifest.roles = manifest.roles || {};
	manifest.roles[roleType] = manifest.roles[roleType] || [];

	// Check if already exists
	const exists = manifest.roles[roleType].some(r => r.address === roleInfo.address);
	if (!exists) {
		manifest.roles[roleType].push({
			...roleInfo,
			addedAt: roleInfo.addedAt || new Date().toISOString(),
		});
		saveManifest(network, manifest);
		console.log(`Added ${roleType}: ${roleInfo.address}`);
	}
	else {
		console.log(`Role already exists: ${roleInfo.address}`);
	}
}

/**
 * Remove a role from the manifest
 * @param {string} network - Network name
 * @param {string} roleType - Role type
 * @param {string} address - Account address to remove
 */
function removeRole(network, roleType, address) {
	const manifest = loadManifest(network);

	if (!manifest.roles?.[roleType]) {
		return;
	}

	const before = manifest.roles[roleType].length;
	manifest.roles[roleType] = manifest.roles[roleType].filter(r => r.address !== address);

	if (manifest.roles[roleType].length < before) {
		saveManifest(network, manifest);
		console.log(`Removed ${roleType}: ${address}`);
	}
}

/**
 * Add a staking collection to the manifest
 * @param {string} network - Network name
 * @param {object} collection - Collection info
 */
function addStakingCollection(network, collection) {
	const manifest = loadManifest(network);

	manifest.stakingCollections = manifest.stakingCollections || { collections: [] };

	const exists = manifest.stakingCollections.collections.some(
		c => c.tokenId === collection.tokenId,
	);

	if (!exists) {
		manifest.stakingCollections.collections.push({
			...collection,
			addedAt: collection.addedAt || new Date().toISOString(),
		});
		saveManifest(network, manifest);
		console.log(`Added staking collection: ${collection.tokenId}`);
	}
}

/**
 * Record a deployed mission
 * @param {string} network - Network name
 * @param {object} mission - Mission info
 */
function recordMission(network, mission) {
	const manifest = loadManifest(network);

	manifest.missions = manifest.missions || { examples: [] };
	manifest.missions.examples = manifest.missions.examples || [];

	manifest.missions.examples.push({
		...mission,
		deployedAt: mission.deployedAt || new Date().toISOString(),
	});

	saveManifest(network, manifest);
	console.log(`Recorded mission: ${mission.name} (${mission.contractId})`);
}

/**
 * Get all contract addresses as a flat object
 * @param {string} network - Network name
 * @returns {object} Map of contract names to IDs
 */
function getAllContractIds(network) {
	const manifest = loadManifest(network);
	const result = {};

	for (const [key, contract] of Object.entries(manifest.contracts)) {
		if (contract.contractId) {
			result[key] = contract.contractId;
		}
	}

	return result;
}

module.exports = {
	loadManifest,
	saveManifest,
	getContract,
	getContractId,
	updateContract,
	recordDeployment,
	addRole,
	removeRole,
	addStakingCollection,
	recordMission,
	getAllContractIds,
	DEPLOYMENTS_DIR,
};
