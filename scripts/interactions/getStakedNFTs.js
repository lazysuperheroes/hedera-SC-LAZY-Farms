/**
 * Get staked NFTs for a user via LazyNFTStaking
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'getStakedNFTs.js 0.0.LNS 0.0.UUU', [
		'LNS is the LazyNFTStaking contract address',
		'UUU is the User address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const user = AccountId.fromString(args[1]);

	printHeader({
		scriptName: 'Get Staked NFTs',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'User': user.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	const encodedCommand = lnsIface.encodeFunctionData('getStakedNFTs', [
		user.toSolidityAddress(),
	]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const tokensAndSerials = lnsIface.decodeFunctionResult('getStakedNFTs', result);

	// Expect an array of 2 arrays [collections array, array of serials array]
	console.log('Raw:', tokensAndSerials);
	for (let t = 0; t < tokensAndSerials[0].length; t++) {
		console.log(
			'\nToken:', TokenId.fromSolidityAddress(tokensAndSerials[0][t].toString()).toString(),
			'\nSerials:', tokensAndSerials[1][t],
		);
	}
};

runScript(main);
