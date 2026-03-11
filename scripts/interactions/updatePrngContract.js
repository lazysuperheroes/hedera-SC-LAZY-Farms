/**
 * Update the PRNG contract address on MissionFactory
 * Fetches the current PRNG address from the contract before confirming the change.
 * Supports --multisig flag for multi-signature execution.
 *
 * Usage:
 *   node scripts/interactions/updatePrngContract.js 0.0.MMMM 0.0.PPPP
 *
 *   MMMM  - MissionFactory contract ID
 *   PPPP  - New PRNG contract ID
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const {
	parseArgs,
	printHeader,
	confirmOrExit,
	logResult,
	runScript,
	getMultisigOptions,
	contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'updatePrngContract.js 0.0.MMMM 0.0.PPPP', [
		'MMMM is the MissionFactory contract ID',
		'PPPP is the new PRNG contract ID',
	]);

	const contractId = ContractId.fromString(args[0]);
	const newPrngId = ContractId.fromString(args[1]);

	const missionFactoryIface = loadInterface('MissionFactory');

	// Fetch current PRNG address from the contract for user visibility
	let currentPrng = 'Unknown';
	try {
		const encoded = missionFactoryIface.encodeFunctionData('prngGenerator', []);
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const decoded = missionFactoryIface.decodeFunctionResult('prngGenerator', raw);
		currentPrng = decoded[0]
			? ContractId.fromEvmAddress(0, 0, decoded[0]).toString()
			: 'Not Set';
	}
	catch {
		currentPrng = 'Could not fetch';
	}

	printHeader({
		scriptName: 'Update PRNG Contract',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Current PRNG Contract': currentPrng,
			'New PRNG Contract': newPrngId.toString(),
		},
	});

	confirmOrExit('Do you want to update the PRNG contract?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionFactoryIface,
		client,
		null,
		'updatePrngContract',
		[newPrngId.toSolidityAddress()],
		multisigOptions,
	);

	logResult(result, 'PRNG contract update');
};

runScript(main);
