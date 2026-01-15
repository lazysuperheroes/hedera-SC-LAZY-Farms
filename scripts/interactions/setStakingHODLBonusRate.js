/**
 * Set the HODL bonus rate on LazyNFTStaking contract
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

	const args = parseArgs(2, 'setStakingHODLBonusRate.js 0.0.SSS <hodl>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<hodl> is the boost % when HODLing',
	]);

	const contractId = ContractId.fromString(args[0]);
	const hodlRate = parseInt(args[1]);

	if (hodlRate < 0) {
		console.log('Invalid HODL rate percentage:', hodlRate);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting HODL Rate',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW HODL Rate': `${hodlRate}%`,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old hodlBonusRate from mirror
	const encodedCommand = lnsIface.encodeFunctionData('hodlBonusRate', []);

	const ohr = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
	);

	const oldHODLPerc = lnsIface.decodeFunctionResult('hodlBonusRate', ohr);

	console.log('\n-Old HODL Rate:', oldHODLPerc[0].toString(), '%');

	confirmOrExit('Do you want to update the HODL rate?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		null,
		'setHodlBonusRate',
		[hodlRate],
		multisigOptions,
	);

	logResult(result, 'HODL Rate updated');
};

runScript(main);
