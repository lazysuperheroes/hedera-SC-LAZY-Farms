/**
 * Set the burn percentage on LazyNFTStaking contract
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult } = require('../../utils/scriptHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setStakingBurnPercentage.js 0.0.SSS <rate>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<rate> is the percentage of the staking reward to burn [0-100]',
	]);

	const contractId = ContractId.fromString(args[0]);
	const burnPercentage = parseInt(args[1]);

	if (burnPercentage < 0 || burnPercentage > 100) {
		console.log('Invalid burn percentage:', burnPercentage);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting Staking Burn Percentage',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW Burn Percentage': `${burnPercentage}%`,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old burnPercentage from mirror
	const encodedCommand = lnsIface.encodeFunctionData('burnPercentage', []);

	const obr = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
	);

	const oldBurnPercentage = lnsIface.decodeFunctionResult('burnPercentage', obr);

	console.log('\n-Old Burn Percentage:', oldBurnPercentage[0].toString(), '%');

	confirmOrExit('Do you want to update the Stakable Burn %?');

	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		null,
		'setBurnPercentage',
		[burnPercentage],
	);

	logResult(result, 'Burn Percentage updated');
};

runScript(main);
