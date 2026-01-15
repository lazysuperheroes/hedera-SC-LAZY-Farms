/**
 * Transfer HBAR or $LAZY from a BoostManager contract
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, Hbar, HbarUnit } = require('@hashgraph/sdk');
const { createHederaClient, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });
	const lazyDecimals = getLazyDecimals();

	const args = parseArgs(4, 'transferFundsFromBoostManager.js 0.0.BBBB 0.0.TTTT [hbar|lazy] <amount>', [
		'BBBB is the boost manager address',
		'TTTT is the receiver address',
		'hbar or lazy is the transfer type',
		'amount is the amount to transfer in hbar or lazy',
	]);

	const contractId = ContractId.fromString(args[0]);
	const recAddress = AccountId.fromString(args[1]);
	const transferType = args[2].toLowerCase();
	const amountInput = parseInt(args[3], 10);

	let method, amount;
	if (transferType === 'hbar') {
		method = 'transferHbar';
		amount = new Hbar(amountInput, HbarUnit.Hbar).toTinybars();
	}
	else if (transferType === 'lazy') {
		method = 'retrieveLazy';
		amount = Math.floor(amountInput * Math.pow(10, lazyDecimals));
	}
	else {
		console.log('ERROR:', args[2], 'is not a valid transfer type. Use "hbar" or "lazy".');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Transfer Funds from BoostManager',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Receiver': recAddress.toString(),
			'Amount': amountInput,
			'Type': transferType.toUpperCase(),
		},
	});

	confirmOrExit('Do you want to transfer funds?');

	const boostManagerIface = loadInterface('BoostManager');

	const result = await contractExecuteFunction(
		contractId,
		boostManagerIface,
		client,
		null,
		method,
		[recAddress.toSolidityAddress(), amount],
	);

	logResult(result, 'Transfer');
};

runScript(main);
