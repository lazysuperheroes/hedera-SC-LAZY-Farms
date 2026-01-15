/**
 * Delegate NFT serials to another account via LazyDelegateRegistry
 * Refactored to use shared utilities
 */
const { ContractId, TokenId, AccountId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(4, 'delegateToken.js 0.0.LDR 0.0.TOKEN <serials> 0.0.TARGET', [
		'LDR is the LazyDelegateRegistry address',
		'TOKEN is the token address',
		'serials is the serial numbers (comma-separated)',
		'TARGET is the account to delegate to',
		'Example: delegateToken.js 0.0.1234 0.0.5678 1,2,3 0.0.91011',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const serials = parseCommaList(args[2]).map(Number);
	const target = AccountId.fromString(args[3]);

	printHeader({
		scriptName: 'Delegate Token',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': token.toString(),
			'Serial(s)': serials.join(', '),
			'Delegate To': target.toString(),
		},
	});

	const ldrIface = loadInterface('LazyDelegateRegistry');

	confirmOrExit('Do you want to delegate the token?');

	const result = await contractExecuteFunction(
		contractId,
		ldrIface,
		client,
		GAS.BOOST_ACTIVATE,
		'delegateNFT',
		[target.toSolidityAddress(), token.toSolidityAddress(), serials],
	);

	logResult(result, 'Serial(s) delegated');
};

runScript(main);
