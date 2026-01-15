/**
 * Transfer HBAR or $LAZY from a Mission contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { AccountId, ContractId, Hbar, HbarUnit } = require('@hashgraph/sdk');
const { createHederaClient, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });
	const lazyDecimals = getLazyDecimals();

	const args = parseArgs(4, 'transferFundsFromMission.js 0.0.MMMM 0.0.TTTT [hbar|lazy] <amount>', [
		'MMMM is the mission address',
		'TTTT is the receiver address',
		'hbar or lazy is the transfer type',
		'amount is the amount to transfer in hbar or lazy',
	]);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);
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
		scriptName: 'Transfer Funds from Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} (HAPI: ${args[0]})`,
		additionalInfo: {
			'Receiver': recAddress.toString(),
			'Amount': amountInput,
			'Type': transferType.toUpperCase(),
		},
	});

	confirmOrExit('Do you want to transfer funds?');

	const missionIface = loadInterface('Mission');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		null,
		method,
		[recAddress.toSolidityAddress(), amount],
		multisigOptions,
	);

	logResult(result, 'Transfer');
};

runScript(main);
