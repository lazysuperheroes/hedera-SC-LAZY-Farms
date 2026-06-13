/* eslint-disable no-console */
// One-off analysis: reconcile the new gem token (0.0.10580248) rarity/serial maps
// against the BoostManager on-chain boost levels, via original_token cross-reference.
const fs = require('fs');

const BASE = 'D:/github/hedera-nft-scripts/gems-remint/05_mint';
const rarityMap = JSON.parse(fs.readFileSync(`${BASE}/rarity_map.json`));
const serialMap = JSON.parse(fs.readFileSync(`${BASE}/serial_map.json`));

// On-chain BoostManager config (from getBoostManagerInfo 0.0.8257105), old token -> level
const LEVELS = ['C', 'R', 'SR', 'UR', 'LR', 'SPE'];
const REDUCTION = { C: 5, R: 10, SR: 15, UR: 25, LR: 40, SPE: 20 };
const onChain = {
	C: ['1492915', '657800', '657798', '657779', '657774', '657768', '657740', '657731', '657728'],
	R: ['1492932', '657747', '657750', '657794', '657813', '657818'],
	SR: ['1492943', '657811', '657807', '657727', '657723', '657716', '657714'],
	UR: ['1492970', '657711', '657713', '657718', '657721', '657745', '657746'],
	LR: ['1492981', '657822', '657826'],
	SPE: ['1492959', '657829'],
};
const tokenToLevel = {};
for (const lvl of LEVELS) for (const t of onChain[lvl]) tokenToLevel[`0.0.${t}`] = lvl;

// 1) rarity -> { count, set of original_tokens, set of on-chain levels those tokens sit at }
const byRarity = {};
for (const row of serialMap) {
	const r = row.rarity;
	byRarity[r] ??= { count: 0, tokens: new Set(), levels: new Set(), ranks: new Set(), serials: [] };
	byRarity[r].count++;
	byRarity[r].tokens.add(row.original_token);
	byRarity[r].ranks.add(row.rarityRank);
	byRarity[r].serials.push(row.serial);
	const lvl = tokenToLevel[row.original_token];
	byRarity[r].levels.add(lvl ?? `UNKNOWN(${row.original_token})`);
}

// compress a sorted int array into "a-b,c,d-e"
function ranges(arr) {
	const s = [...arr].sort((a, b) => a - b);
	const out = [];
	let lo = s[0], prev = s[0];
	for (let i = 1; i < s.length; i++) {
		if (s[i] === prev + 1) { prev = s[i]; continue; }
		out.push(lo === prev ? `${lo}` : `${lo}-${prev}`);
		lo = prev = s[i];
	}
	out.push(lo === prev ? `${lo}` : `${lo}-${prev}`);
	return out.join(',');
}

console.log('=== serial_map total rows:', serialMap.length, '| rarity_map.total:', rarityMap.total, '===\n');

console.log('=== Rarity -> on-chain level (derived from original_token) ===');
const rarityToLevel = {};
for (const r of Object.keys(byRarity)) {
	const b = byRarity[r];
	const levels = [...b.levels];
	if (levels.length === 1) rarityToLevel[r] = levels[0];
	console.log(
		`${r.padEnd(10)} count=${String(b.count).padEnd(5)} ranks={${[...b.ranks].join(',')}} ` +
		`-> level(s): ${levels.join(', ')}${levels.length === 1 ? ` (${REDUCTION[levels[0]]}%)` : '  <-- AMBIGUOUS'}`,
	);
	console.log(`           original_tokens: ${[...b.tokens].sort().join(', ')}`);
}

console.log('\n=== rarity_map.byRarity declared ranges vs computed ===');
for (const r of Object.keys(rarityMap.byRarity)) {
	const declared = rarityMap.byRarity[r].serials;
	const computed = byRarity[r] ? ranges(byRarity[r].serials) : '(none)';
	const match = declared === computed ? 'MATCH' : 'DIFFER';
	console.log(`${r.padEnd(10)} declaredCount=${rarityMap.byRarity[r].count} computedCount=${byRarity[r]?.count} [${match}]`);
	if (match !== 'MATCH') {
		console.log(`   declared: ${declared}`);
		console.log(`   computed: ${computed}`);
	}
}

console.log('\n=== Proposed NEW config: token 0.0.10580248, serial-locked per level ===');
const levelSerials = {};
for (const row of serialMap) {
	const lvl = rarityToLevel[row.rarity];
	if (!lvl) continue;
	(levelSerials[lvl] ??= []).push(row.serial);
}
let grand = 0;
for (const lvl of LEVELS) {
	const arr = levelSerials[lvl] ?? [];
	grand += arr.length;
	console.log(`${lvl.padEnd(4)} (${REDUCTION[lvl]}%) : ${arr.length} serials -> ${ranges(arr)}`);
}
console.log(`TOTAL assigned: ${grand}`);

console.log('\n=== Coverage / overlap checks ===');
const seen = new Map();
let dupes = 0;
for (const row of serialMap) {
	seen.set(row.serial, (seen.get(row.serial) ?? 0) + 1);
	if (seen.get(row.serial) === 2) dupes++;
}
const serialsSorted = [...seen.keys()].sort((a, b) => a - b);
const min = serialsSorted[0], max = serialsSorted[serialsSorted.length - 1];
const missing = [];
for (let i = min; i <= max; i++) if (!seen.has(i)) missing.push(i);
console.log(`distinct serials: ${seen.size}, min: ${min}, max: ${max}`);
console.log(`duplicate serials: ${dupes}`);
console.log(`gaps in [${min}..${max}]: ${missing.length ? ranges(missing) : 'NONE'}`);
console.log(`unmapped-to-level rows: ${serialMap.filter(r => !rarityToLevel[r.rarity]).length}`);
