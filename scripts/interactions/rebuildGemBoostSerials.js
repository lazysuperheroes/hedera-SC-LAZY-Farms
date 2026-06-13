/**
 * Rebuild: register the single new gem token on BoostManager with per-level
 * locked serials. State-reconciling and resumable.
 *
 * The serial->level map below was derived and verified by
 * scripts/debug/analyzeGemRemap.js against the remint rarity_map.json /
 * serial_map.json: it covers serials 1-3490 exactly, with no gaps or overlaps.
 * Level index: C=0 R=1 SR=2 UR=3 LR=4 SPE=5.
 *
 * On every run it queries getBoostData() for the token's currently-locked serials
 * per level, diffs against the target, and only sends the MISSING serials. So a
 * partial/interrupted run is resumed automatically with no redundant transactions
 * (it also no-ops cleanly if everything is already in place).
 *
 * addCollectionToBoostLevelWithLockedSerials is incremental/idempotent for
 * (level, token); remaining serials are batched (one EnumerableSet.add per
 * serial — too many for a single 15M-gas tx). Levels are processed smallest-first
 * so a first-time tokenAssociate() lands on a tiny batch.
 *
 * Tune via env: BATCH_SIZE (default 150), GAS_LIMIT (default 9_000_000).
 * Supports --multisig (queues instead of executing; readback is then skipped).
 *
 * Usage:
 *   node scripts/interactions/rebuildGemBoostSerials.js 0.0.BBB 0.0.TTT
 *     BBB - BoostManager contract ID
 *     TTT - new gem token ID (single collection, serial-locked)
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const {
	parseArgs, printHeader, confirmOrExit, runScript,
	getMultisigOptions, isMultisigEnabled, contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

// Verified ranges (inclusive) per level index.
const LEVEL_RANGES = {
	0: [[421, 1170], [1531, 2280], [2431, 2920], [3481, 3490]], // C   (5%)  2000
	1: [[1231, 1530], [2281, 2430], [3071, 3370]],              // R   (10%) 750
	2: [[61, 210], [271, 420], [2921, 3070]],                   // SR  (15%) 450
	3: [[1, 60], [211, 270], [1171, 1230]],                     // UR  (25%) 180
	4: [[3371, 3380]],                                          // LR  (40%) 10
	5: [[3381, 3480]],                                          // SPE (20%) 100
};
// One known serial per level for the post-run getBoostLevel readback.
const SAMPLE = { 0: 421, 1: 1231, 2: 61, 3: 1, 4: 3371, 5: 3381 };
// Process smallest level first so a first-time token association is on a tiny batch.
const LEVEL_ORDER = [4, 5, 3, 2, 1, 0];
const TOTAL_EXPECTED = 3490;

const BATCH = parseInt(process.env.BATCH_SIZE || '150', 10);
const GAS = parseInt(process.env.GAS_LIMIT || '9000000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const expand = (ranges) => {
	const out = [];
	for (const [a, b] of ranges) for (let s = a; s <= b; s++) out.push(s);
	return out;
};
const chunk = (arr, n) => {
	const out = [];
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
};

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'rebuildGemBoostSerials.js 0.0.BBB 0.0.TTT', [
		'0.0.BBB is the BoostManager contract ID',
		'0.0.TTT is the new gem token ID',
	]);
	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const iface = loadInterface('BoostManager');

	// High gas cap: getBoostData() copies the whole serial set to memory, so a
	// populated level (up to 2000 serials) needs millions of gas to simulate.
	// eth_call gas is a free simulation ceiling, not real spend.
	const query = async (fcn, params = [], gas = 15_000_000) => {
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, iface.encodeFunctionData(fcn, params), operatorId, false, gas);
		return iface.decodeFunctionResult(fcn, raw);
	};

	// Self-validate the embedded map BEFORE touching the chain: exact 1..3490 cover.
	const seen = new Set();
	for (const lvl of Object.keys(LEVEL_RANGES)) {
		for (const s of expand(LEVEL_RANGES[lvl])) {
			if (seen.has(s)) throw new Error(`Embedded map error: duplicate serial ${s}`);
			seen.add(s);
		}
	}
	for (let i = 1; i <= TOTAL_EXPECTED; i++) if (!seen.has(i)) throw new Error(`Embedded map error: missing serial ${i}`);
	if (seen.size !== TOTAL_EXPECTED) throw new Error(`Embedded map error: ${seen.size} serials != ${TOTAL_EXPECTED}`);

	// Reconcile: read serials already locked for THIS token at each level, diff vs target.
	const tokenAddr = `0x${token.toSolidityAddress()}`.toLowerCase();
	const plan = [];
	const summary = [];
	for (const lvl of LEVEL_ORDER) {
		const target = expand(LEVEL_RANGES[lvl]);
		const data = await query('getBoostData', [lvl]); // [collections, serialLocked, serials[][], reduction]
		const idx = data[0].findIndex((c) => c.toLowerCase() === tokenAddr);
		const present = new Set(idx >= 0 ? data[2][idx].map(Number) : []);

		const stray = [...present].filter((s) => !seen.has(s));
		if (stray.length) console.log(`⚠️  ${lookupLevel(lvl)}: ${stray.length} on-chain serial(s) not in target map (left untouched): ${stray.slice(0, 10).join(', ')}${stray.length > 10 ? '…' : ''}`);

		const remaining = target.filter((s) => !present.has(s));
		summary.push({ lvl, target: target.length, present: present.size, remaining: remaining.length });
		for (const ch of chunk(remaining, BATCH)) plan.push({ lvl, ch });
	}

	printHeader({
		scriptName: 'Rebuild Gem Boost (serial-locked, single token)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': token.toString(),
			'Batch size': BATCH,
			'Gas / call': GAS.toLocaleString(),
		},
	});
	console.log('Reconciliation (target / already on-chain / to add):');
	for (const s of summary) console.log(`  ${lookupLevel(s.lvl).padEnd(3)} : ${s.target} / ${s.present} / ${s.remaining}`);
	const totalRemaining = summary.reduce((n, s) => n + s.remaining, 0);
	console.log(`  Total to add: ${totalRemaining} serials across ${plan.length} transaction(s).`);

	if (plan.length === 0) {
		console.log('\nNothing to add — token is already fully configured. Proceeding to verification.');
	}
	else {
		confirmOrExit(`Add ${totalRemaining} missing serials to ${token.toString()} across ${plan.length} transactions?`);

		const multisigOptions = getMultisigOptions();
		let i = 0;
		for (const { lvl, ch } of plan) {
			i++;
			const result = await contractExecuteWithMultisig(
				contractId, iface, client, GAS,
				'addCollectionToBoostLevelWithLockedSerials', [lvl, token.toSolidityAddress(), ch], multisigOptions,
			);
			if (!isMultisigEnabled() && result[0]?.status?.toString() !== 'SUCCESS') {
				console.log(`ERROR on batch ${i}/${plan.length} (${lookupLevel(lvl)} serials ${ch[0]}-${ch[ch.length - 1]}):`, result);
				console.log('Re-run after resolving — completed serials are detected and skipped automatically.');
				process.exitCode = 1;
				return;
			}
			console.log(`[${i}/${plan.length}] ${lookupLevel(lvl)} +${ch.length} (serials ${ch[0]}-${ch[ch.length - 1]})  tx: ${result[2]?.transactionId?.toString() ?? '(queued)'}`);
		}

		if (isMultisigEnabled()) {
			console.log('\n- Multisig: adds queued. After execution, re-run to reconcile and verify.');
			return;
		}
	}

	console.log('\n- Verifying getBoostLevel() on a sample serial per level...');
	await sleep(4000); // let the mirror node catch up
	let ok = true;
	for (const lvl of [0, 1, 2, 3, 4, 5]) {
		const serial = SAMPLE[lvl];
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, iface.encodeFunctionData('getBoostLevel', [token.toSolidityAddress(), serial]), operatorId, false);
		const got = Number(iface.decodeFunctionResult('getBoostLevel', raw)[0]);
		const pass = got === lvl;
		ok = ok && pass;
		console.log(`  serial ${serial}: getBoostLevel = ${lookupLevel(got)} (expected ${lookupLevel(lvl)}) ${pass ? '✅' : '❌'}`);
	}
	console.log(ok ? '\n✅ VERIFIED: sample serials resolve to their expected levels. Rebuild complete.' : '\n❌ MISMATCH — investigate before relying on the config.');
	if (!ok) process.exitCode = 1;
};

runScript(main);
