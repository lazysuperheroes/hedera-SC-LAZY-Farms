/* eslint-disable no-console */
// Read-only: show, per level, how many target serials for the new gem token are
// already locked on BoostManager vs still missing. Mirrors the reconcile logic
// in rebuildGemBoostSerials.js. Usage: node scripts/debug/checkGemRebuildState.js 0.0.BBB 0.0.TTT
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

const LEVEL_RANGES = {
	0: [[421, 1170], [1531, 2280], [2431, 2920], [3481, 3490]],
	1: [[1231, 1530], [2281, 2430], [3071, 3370]],
	2: [[61, 210], [271, 420], [2921, 3070]],
	3: [[1, 60], [211, 270], [1171, 1230]],
	4: [[3371, 3380]],
	5: [[3381, 3480]],
};
const expand = (ranges) => { const o = []; for (const [a, b] of ranges) for (let s = a; s <= b; s++) o.push(s); return o; };

(async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });
	const contractId = ContractId.fromString(process.argv[2] || '0.0.8257105');
	const token = TokenId.fromString(process.argv[3] || '0.0.10580248');
	const iface = loadInterface('BoostManager');
	const tokenAddr = `0x${token.toSolidityAddress()}`.toLowerCase();

	console.log(`State for token ${token.toString()} on BoostManager ${contractId.toString()} (${env})\n`);
	console.log('  Lvl  target  present  remaining');
	let tT = 0, tP = 0, tR = 0;
	for (const lvl of [0, 1, 2, 3, 4, 5]) {
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, iface.encodeFunctionData('getBoostData', [lvl]), operatorId, false, 15_000_000);
		const data = iface.decodeFunctionResult('getBoostData', raw);
		const idx = data[0].findIndex((c) => c.toLowerCase() === tokenAddr);
		const present = new Set(idx >= 0 ? data[2][idx].map(Number) : []);
		const target = expand(LEVEL_RANGES[lvl]);
		const remaining = target.filter((s) => !present.has(s)).length;
		tT += target.length; tP += present.size; tR += remaining;
		console.log(`  ${lookupLevel(lvl).padEnd(3)}  ${String(target.length).padStart(6)}  ${String(present.size).padStart(7)}  ${String(remaining).padStart(9)}`);
	}
	console.log(`  ---  ------  -------  ---------`);
	console.log(`  ALL  ${String(tT).padStart(6)}  ${String(tP).padStart(7)}  ${String(tR).padStart(9)}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
