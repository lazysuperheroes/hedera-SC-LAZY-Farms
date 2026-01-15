/**
 * Get staked serials for a collection via LazyNFTStaking
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'getStakedSerials.js 0.0.LNS 0.0.CCC', [
		'LNS is the LazyNFTStaking contract address',
		'CCC is the Collection address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);

	printHeader({
		scriptName: 'Get Staked Serials',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collection': token.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	const encodedCommand = lnsIface.encodeFunctionData('getStakedSerials', [
		token.toSolidityAddress(),
	]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const serials = lnsIface.decodeFunctionResult('getStakedSerials', result);
	console.log('Serials:', serials);
};

runScript(main);
