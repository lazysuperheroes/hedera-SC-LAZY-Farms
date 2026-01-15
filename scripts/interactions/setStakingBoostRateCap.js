/**
 * Set the boost rate cap on LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setStakingBoostRateCap.js 0.0.SSS <cap>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<cap> is the max boost rate allowed [>=0]',
	]);

	const contractId = ContractId.fromString(args[0]);
	const brc = parseInt(args[1]);

	if (brc < 0) {
		console.log('Invalid boost rate cap:', brc);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting Boost Rate Cap',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW Boost Rate Cap': brc.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old boostRateCap from mirror
	const encodedCommand = lnsIface.encodeFunctionData('boostRateCap', []);

	const obr = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const oldBoostRateCap = lnsIface.decodeFunctionResult('boostRateCap', obr);
	console.log('\n-Old Boost Rate Cap (mirror):', oldBoostRateCap[0].toString());

	confirmOrExit('Do you want to update the Stakable Boost Rate Cap?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		null,
		'setBoostRateCap',
		[brc],
		multisigOptions,
	);

	logResult(result, 'Boost Rate Cap updated');
};

runScript(main);
