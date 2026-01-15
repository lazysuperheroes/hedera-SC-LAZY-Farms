/**
 * Check live FT allowance via LazyAllowanceUtility
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(4, 'checkLiveFTAllowance.js 0.0.CCC 0.0.TOKEN 0.0.OWNER 0.0.SPENDER', [
		'CCC is the LazyAllowanceUtility address',
		'TOKEN is the FT token we are checking allowance for',
		'OWNER is the owner of the token(s)',
		'SPENDER is the spender of the token',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const owner = AccountId.fromString(args[2]);
	const spender = AccountId.fromString(args[3]);

	printHeader({
		scriptName: 'Check Live FT Allowance',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': token.toString(),
			'Owner': owner.toString(),
			'Spender': spender.toString(),
		},
	});

	const allowanceIface = loadInterface('LazyAllowanceUtility');

	const encodedCommand = allowanceIface.encodeFunctionData('checkLiveAllowance', [
		token.toSolidityAddress(),
		owner.toSolidityAddress(),
		spender.toSolidityAddress(),
	]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const approved = allowanceIface.decodeFunctionResult('checkLiveAllowance', result);
	console.log('Live Allowance:', Number(approved[0]));
};

runScript(main);
