/**
 * Update the PRNG contract address on MissionFactory
 *
 * Safety rails:
 *   - BEFORE: fetches the current PRNG address and the deployed-mission list.
 *     Already-deployed missions cache the PRNG at clone time, so they are NOT
 *     fixed by this update; the script warns and requires explicit confirmation
 *     if any missions are deployed.
 *   - AFTER: reads back prngGenerator() and asserts it equals the new address
 *     (skipped in --multisig mode, where the change is only queued, not executed).
 *
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
	isMultisigEnabled,
	contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'updatePrngContract.js 0.0.MMMM 0.0.PPPP', [
		'MMMM is the MissionFactory contract ID',
		'PPPP is the new PRNG contract ID',
	]);

	const contractId = ContractId.fromString(args[0]);
	const newPrngId = ContractId.fromString(args[1]);

	const missionFactoryIface = loadInterface('MissionFactory');

	// Read prngGenerator() from the contract, returning a canonical "0.0.x" string
	const fetchPrng = async () => {
		const encoded = missionFactoryIface.encodeFunctionData('prngGenerator', []);
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const decoded = missionFactoryIface.decodeFunctionResult('prngGenerator', raw);
		return decoded[0] ? ContractId.fromEvmAddress(0, 0, decoded[0]).toString() : 'Not Set';
	};

	// Fetch current PRNG address for user visibility
	let currentPrng = 'Unknown';
	try {
		currentPrng = await fetchPrng();
	}
	catch {
		currentPrng = 'Could not fetch';
	}

	// Fetch deployed missions: any existing mission cached the OLD PRNG at clone
	// time and will NOT be fixed by this update.
	let deployedMissions = null;
	try {
		const encoded = missionFactoryIface.encodeFunctionData('getDeployedMissions', []);
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		const decoded = missionFactoryIface.decodeFunctionResult('getDeployedMissions', raw);
		deployedMissions = decoded[0];
	}
	catch {
		deployedMissions = null;
	}

	const missionCount = deployedMissions === null ? 'Could not fetch' : deployedMissions.length;

	printHeader({
		scriptName: 'Update PRNG Contract',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Current PRNG Contract': currentPrng,
			'New PRNG Contract': newPrngId.toString(),
			'Deployed Missions': missionCount,
		},
	});

	// Safety gate: deployed missions keep their cached PRNG; warn before proceeding.
	if (deployedMissions === null) {
		console.log('\n⚠️  WARNING: could not read getDeployedMissions(). Could not confirm whether any missions cached the old PRNG.');
		confirmOrExit('Proceed without confirming the deployed-mission list?');
	}
	else if (deployedMissions.length > 0) {
		console.log(`\n⚠️  WARNING: ${deployedMissions.length} mission(s) are already deployed. They cached the previous PRNG at clone time and will NOT use the new one — only missions deployed AFTER this update will. Affected missions would need redeploying.`);
		deployedMissions.forEach((m) => console.log(`     - ${ContractId.fromEvmAddress(0, 0, m).toString()}`));
		confirmOrExit('Update the PRNG anyway (existing missions stay on the old one)?');
	}
	else {
		console.log('\n✔  No missions deployed — safe to update; nothing has cached the old PRNG.');
	}

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

	// Verify-after-mutation: poll prngGenerator() until it reflects the new address.
	// Skipped under multisig, where the transaction is only queued, not yet executed.
	if (isMultisigEnabled()) {
		console.log('\n- Multisig mode: update queued, not executed yet.');
		console.log(`  After the multisig transaction executes, confirm with: prngGenerator() == ${newPrngId.toString()}`);
		return;
	}

	console.log('\n- Verifying on-chain that prngGenerator() now points to the new contract...');
	const expected = newPrngId.toString();
	let onChain = 'Unknown';
	for (let attempt = 1; attempt <= 5; attempt++) {
		await sleep(3000); // let the mirror node catch up to latest consensus state
		try {
			onChain = await fetchPrng();
		}
		catch {
			onChain = 'Could not fetch';
		}
		if (onChain === expected) break;
		console.log(`  attempt ${attempt}/5: prngGenerator() = ${onChain} (waiting for ${expected})`);
	}

	if (onChain === expected) {
		console.log(`\n✅ VERIFIED: prngGenerator() == ${expected}`);
	}
	else {
		console.log(`\n❌ NOT VERIFIED: prngGenerator() = ${onChain}, expected ${expected}.`);
		console.log('   The transaction may still be settling on the mirror node — re-check shortly, or confirm the tx status above.');
		process.exitCode = 1;
	}
};

runScript(main);
