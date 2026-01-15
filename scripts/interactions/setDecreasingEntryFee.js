/**
 * Set decreasing entry fee (Dutch auction) for a Mission
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, formatTokenAmount, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });
	const lazyDecimals = getLazyDecimals();

	const args = parseArgs(5, 'setDecreasingEntryFee.js 0.0.MMMM <start> <min> <decrement> <interval>', [
		'MMMM is the mission address',
		'<start> is the start timestamp for the Dutch auction',
		'<min> is the minimum fee in $LAZY (smallest units)',
		'<decrement> is the decrement amount per interval (smallest units)',
		'<interval> is the decrement interval in seconds',
	]);

	const contractId = ContractId.fromString(args[0]);
	const startTimestamp = parseInt(args[1]);
	const minFee = parseInt(args[2]);
	const decrement = parseInt(args[3]);
	const interval = parseInt(args[4]);

	printHeader({
		scriptName: 'Set Decreasing Entry Fee (Dutch Auction)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Start Time': `${startTimestamp} -> ${new Date(startTimestamp * 1000).toISOString()}`,
			'Min Fee': `${formatTokenAmount(minFee, lazyDecimals, '$LAZY')}`,
			'Decrement': `${formatTokenAmount(decrement, lazyDecimals, '$LAZY')} per interval`,
			'Interval': `${interval} seconds / ${interval / 60} minutes / ${interval / 3600} hours`,
		},
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to enable decreasing entry cost (Dutch auction) for this mission?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.BOOST_ACTIVATE,
		'setDecreasingEntryFee',
		[startTimestamp, minFee, decrement, interval],
		multisigOptions,
	);

	logResult(result, 'Dutch Auction Engaged');
};

runScript(main);
