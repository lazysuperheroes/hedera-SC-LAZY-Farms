/**
 * Get LazyGasStation contract information
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	// Initialize client and get environment
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	// Parse arguments
	const args = parseArgs(1, 'getLazyGasStationInfo.js 0.0.LGS', [
		'LGS is the LazyGasStation address',
	]);

	const contractId = ContractId.fromString(args[0]);

	// Print header
	printHeader({
		scriptName: 'LazyGasStation Info',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	// Load contract interface
	const lgsIface = loadInterface('LazyGasStation');

	// Helper function for mirror node queries
	const queryContract = async (fcnName, params = []) => {
		const encodedCommand = lgsIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		return lgsIface.decodeFunctionResult(fcnName, result);
	};

	// Query and display results
	const admins = await queryContract('getAdmins');
	console.log('Admins:', admins[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	const authorizers = await queryContract('getAuthorizers');
	console.log('Authorizers:', authorizers[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	const contractUsers = await queryContract('getContractUsers');
	console.log('Contract Users:', contractUsers[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));
};

runScript(main);
