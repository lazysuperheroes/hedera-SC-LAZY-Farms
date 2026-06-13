/* eslint-disable no-console */
// Verify whether the operator is a BoostManager admin WITHOUT a getter:
// simulate an onlyAdmin call via the mirror node (estimate=false executes the
// modifier; state changes are discarded, nothing is persisted).
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const BOOST_MANAGER = '0.0.8257105';

(async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });
	const contractId = ContractId.fromString(BOOST_MANAGER);
	const iface = loadInterface('BoostManager');

	// Read current cost so we can pass it straight back (a no-op even conceptually).
	const costRaw = iface.decodeFunctionResult(
		'lazyBoostCost',
		await readOnlyEVMFromMirrorNode(env, contractId, iface.encodeFunctionData('lazyBoostCost', []), operatorId, false),
	)[0];

	console.log(`Probing onlyAdmin via setLazyBoostCost(${costRaw}) as ${operatorId} on ${BOOST_MANAGER} (simulation only)...`);

	const data = iface.encodeFunctionData('setLazyBoostCost', [costRaw]);
	try {
		await readOnlyEVMFromMirrorNode(env, contractId, data, operatorId, false);
		console.log(`\n✅ ADMIN CONFIRMED: ${operatorId} passes the onlyAdmin modifier (no revert). Safe to run teardown/rebuild.`);
	}
	catch (e) {
		const body = JSON.stringify(e?.response?.data ?? e?.message ?? e);
		if (/Permission Denied|Not Admin/i.test(body)) {
			console.log(`\n❌ NOT ADMIN: ${operatorId} reverted on the onlyAdmin call — it must be added via addAdmin first.`);
		}
		else if (/CONTRACT_REVERT/i.test(body)) {
			console.log(`\n❌ REVERTED (likely not admin): ${body}`);
		}
		else {
			console.log(`\n⚠️  INCONCLUSIVE (non-revert error): ${body}`);
		}
	}
})();
