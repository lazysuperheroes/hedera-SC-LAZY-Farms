/**
 * Retrieve $LAZY from any contract with a retrieveLazy method
 * Prompts for percentage of balance to retrieve
 * Refactored to use shared utilities
 */
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { parseArgs, printHeader, logResult, runScript } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { checkMirrorBalance } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_TOKEN_ID'],
	});

	const args = parseArgs(2, 'retrieveLazyFromContract.js 0.0.CCC 0.0.DDD', [
		'CCC is the contract address',
		'DDD is the destination address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const destination = AccountId.fromString(args[1]);
	const lazyToken = process.env.LAZY_TOKEN_ID;

	// Get the contract $LAZY balance from mirror node
	const lazyBalance = await checkMirrorBalance(env, contractId, lazyToken);

	printHeader({
		scriptName: 'Retrieve $LAZY from Contract',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Destination': destination.toString(),
			'Lazy Token': lazyToken,
			'Contract Lazy Balance': lazyBalance,
		},
	});

	// Ask user the percentage of the balance to retrieve
	const percentage = parseFloat(readlineSync.question('Enter the percentage of the balance to retrieve: '));

	if (isNaN(percentage) || percentage < 0 || percentage > 100) {
		console.log('ERROR: Must specify a valid percentage (0-100)');
		process.exit(1);
	}

	// Calculate the amount to retrieve
	const amount = Math.floor(lazyBalance * (percentage / 100));

	console.log(`\nRetrieving ${amount} (${percentage}% of ${lazyBalance}) $LAZY`);

	// Create interface from fragment for the retrieveLazy method
	const methodFragment = {
		inputs: [
			{ internalType: 'address', name: '_receiver', type: 'address' },
			{ internalType: 'uint256', name: '_amount', type: 'uint256' },
		],
		name: 'retrieveLazy',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	};

	const contractIface = new ethers.Interface([methodFragment]);

	const result = await contractExecuteFunction(
		contractId,
		contractIface,
		client,
		null,
		'retrieveLazy',
		[destination.toSolidityAddress(), amount],
	);

	logResult(result, '$LAZY retrieval');
};

runScript(main);
