/**
 * Check boost level configuration in BoostManager
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	// Initialize client and get environment
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	// Parse arguments
	const args = parseArgs(2, 'checkBoostLevelConfig.js 0.0.BBB <rank>', [
		'BBB is the BoostManager address',
		'rank is the boost level',
	]);

	const contractId = ContractId.fromString(args[0]);
	const rank = getLevel(args[1]);

	// Print header
	printHeader({
		scriptName: 'Boost Level Config',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Checking Rank': `${rank} (${lookupLevel(rank)})`,
		},
	});

	// Load contract interface
	const boostManagerIface = loadInterface('BoostManager');

	// Query boost data
	const encodedCommand = boostManagerIface.encodeFunctionData('getBoostData', [rank]);
	const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
	const boostDetails = boostManagerIface.decodeFunctionResult('getBoostData', result);

	// Display results
	console.log('Reduction:', Number(boostDetails[3]), '%');
	console.log('Gems:', boostDetails[0].map(g => TokenId.fromSolidityAddress(g).toString()).join(', '));
	console.log('Serial Locked:', boostDetails[1]);
	console.log('Serials:', boostDetails[2]);
};

runScript(main);
