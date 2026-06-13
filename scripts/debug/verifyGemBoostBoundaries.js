/* eslint-disable no-console */
// Read-only final verification: check the FIRST and LAST serial of every target
// range resolves to its expected boost level via getBoostLevel (O(1), so this
// works even when a level holds thousands of serials, unlike getBoostData).
// Usage: node scripts/debug/verifyGemBoostBoundaries.js 0.0.BBB 0.0.TTT
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

(async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });
	const contractId = ContractId.fromString(process.argv[2] || '0.0.8257105');
	const token = TokenId.fromString(process.argv[3] || '0.0.10580248');
	const iface = loadInterface('BoostManager');
	const tokenSol = token.toSolidityAddress();

	const levelOf = async (serial) => {
		const raw = await readOnlyEVMFromMirrorNode(env, contractId, iface.encodeFunctionData('getBoostLevel', [tokenSol, serial]), operatorId, false);
		return Number(iface.decodeFunctionResult('getBoostLevel', raw)[0]);
	};

	console.log(`Boundary verification — token ${token.toString()} on ${contractId.toString()} (${env})\n`);
	let checks = 0, fails = 0;
	for (const lvl of [3, 2, 1, 0, 4, 5]) {
		for (const [a, b] of LEVEL_RANGES[lvl]) {
			for (const serial of (a === b ? [a] : [a, b])) {
				const got = await levelOf(serial);
				const ok = got === Number(lvl);
				checks++;
				if (!ok) fails++;
				console.log(`  ${lookupLevel(lvl).padEnd(3)} serial ${String(serial).padStart(4)}: ${lookupLevel(got)} ${ok ? '✅' : '❌'}`);
			}
		}
	}
	console.log(`\n${fails === 0 ? '✅' : '❌'} ${checks - fails}/${checks} boundary checks passed.`);
	process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
