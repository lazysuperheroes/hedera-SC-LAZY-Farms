/**
 * Get stakeable collections from LazyNFTStaking
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getStakeableCollections.js 0.0.LNS', [
		'LNS is the LazyNFTStaking contract address',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Get Stakeable Collections',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	const encodedCommand = lnsIface.encodeFunctionData('getStakableCollections', []);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const tokens = lnsIface.decodeFunctionResult('getStakableCollections', result);
	console.log('Raw:', tokens);
	console.log('Stakeable Collections:', tokens[0].map(u => TokenId.fromSolidityAddress(u).toString()).join(', '));
};

runScript(main);
