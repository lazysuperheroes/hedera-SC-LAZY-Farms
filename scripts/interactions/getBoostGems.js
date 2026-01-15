/**
 * Get gem collections from BoostManager
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getBoostGems.js 0.0.BBB', ['BBB is the BoostManager address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Get Boost Gems',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const boostManagerIface = loadInterface('BoostManager');

	const encodedCommand = boostManagerIface.encodeFunctionData('getGemCollections', []);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const gems = boostManagerIface.decodeFunctionResult('getGemCollections', result);
	console.log('Raw:', gems);
	console.log('Gems:', gems[0].map(g => TokenId.fromSolidityAddress(g).toString()).join(', '));
};

runScript(main);
