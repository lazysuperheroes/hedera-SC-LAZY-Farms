/**
 * Set the distribution period on LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { TIME } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setStakingDistributionPeriod.js 0.0.SSS <period>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<period> is the new distribution period in seconds',
	]);

	const contractId = ContractId.fromString(args[0]);
	const secondsForDistribution = parseInt(args[1]);

	if (secondsForDistribution < 1) {
		console.log('Invalid distribution period:', secondsForDistribution);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting Distribution Period (Seconds)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW Distribution Period': `${secondsForDistribution} seconds (hours: ${secondsForDistribution / TIME.HOUR} <-> days: ${secondsForDistribution / TIME.DAY})`,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get distributionPeriod via mirror node
	const encodedCommand = lnsIface.encodeFunctionData('distributionPeriod');

	const distributionPeriod = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const currentDistributionPeriod = lnsIface.decodeFunctionResult('distributionPeriod', distributionPeriod);

	console.log('Current Distribution Period:', currentDistributionPeriod[0].toString(), `seconds (hours: ${Number(currentDistributionPeriod[0]) / TIME.HOUR} <-> days: ${Number(currentDistributionPeriod[0]) / TIME.DAY})`);

	confirmOrExit('Do you want to update the Distribution period?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		null,
		'setDistributionPeriod',
		[secondsForDistribution],
		multisigOptions,
	);

	logResult(result, 'Distribution Period updated');
};

runScript(main);
