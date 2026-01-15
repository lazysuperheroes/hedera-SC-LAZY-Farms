/**
 * Revoke NFT delegation via LazyDelegateRegistry
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'revokeTokenDelegation.js 0.0.LDR 0.0.TOKEN <serials>', [
		'LDR is the LazyDelegateRegistry address',
		'TOKEN is the token address',
		'serials is the serial numbers (comma-separated)',
		'Example: revokeTokenDelegation.js 0.0.1234 0.0.5678 1,2,3',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const serials = parseCommaList(args[2]).map(Number);

	printHeader({
		scriptName: 'Revoke Token Delegation',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': token.toString(),
			'Serial(s)': serials.join(', '),
		},
	});

	const ldrIface = loadInterface('LazyDelegateRegistry');

	confirmOrExit('Do you want to revoke the delegation?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		ldrIface,
		client,
		GAS.BOOST_ACTIVATE,
		'revokeDelegateNFT',
		[token.toSolidityAddress(), serials],
		multisigOptions,
	);

	logResult(result, 'Serial(s) revoked');
};

runScript(main);
