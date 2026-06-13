/**
 * List the gem-boost NFTs an account holds and the boost level each maps to.
 *
 * Defaults to the mainnet gems collection (0.0.10580248) and BoostManager
 * (0.0.8257105), so callers don't need to know the addresses. Override via env
 * GEM_TOKEN_ID / BOOST_MANAGER_CONTRACT_ID if needed.
 *
 * Serial -> level uses the published gem config (mirrors on-chain BoostManager;
 * authoritative check available via scripts/debug/verifyGemBoostBoundaries.js).
 * As a guard, the first owned serial is cross-checked against on-chain
 * getBoostLevel and a mismatch is flagged.
 *
 * Usage:
 *   node scripts/interactions/getMyGems.js 0.0.AAAA
 *     AAAA - the account whose gems to list
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const axios = require('axios');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode, getBaseURL } = require('../../utils/solidityHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

const GEM_TOKEN = process.env.GEM_TOKEN_ID || '0.0.10580248';
const BOOST_MANAGER = process.env.BOOST_MANAGER_CONTRACT_ID || '0.0.8257105';

// Published gem config: serial range -> level index (C0 R1 SR2 UR3 LR4 SPE5).
const LEVEL_RANGES = {
	0: [[421, 1170], [1531, 2280], [2431, 2920], [3481, 3490]],
	1: [[1231, 1530], [2281, 2430], [3071, 3370]],
	2: [[61, 210], [271, 420], [2921, 3070]],
	3: [[1, 60], [211, 270], [1171, 1230]],
	4: [[3371, 3380]],
	5: [[3381, 3480]],
};
const REDUCTION = { 0: 5, 1: 10, 2: 15, 3: 25, 4: 40, 5: 20 };

const levelOfSerial = (serial) => {
	for (const lvl of [0, 1, 2, 3, 4, 5]) {
		for (const [a, b] of LEVEL_RANGES[lvl]) if (serial >= a && serial <= b) return lvl;
	}
	return -1;
};

// Mirror-node NFT query, following pagination so large holdings are complete.
const getAllSerialsOwned = async (env, accountId, tokenId) => {
	const base = getBaseURL(env);
	let url = `${base}/api/v1/tokens/${tokenId}/nfts?account.id=${accountId}&limit=100`;
	const serials = [];
	while (url) {
		const { data } = await axios.get(url);
		for (const nft of data.nfts ?? []) serials.push(Number(nft.serial_number));
		url = data.links?.next ? `${base}${data.links.next}` : null;
	}
	return serials.sort((a, b) => a - b);
};

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getMyGems.js 0.0.AAAA', [
		'AAAA is the account whose gems to list',
		'(gem token + BoostManager default to mainnet; override via env GEM_TOKEN_ID / BOOST_MANAGER_CONTRACT_ID)',
	]);
	const accountId = AccountId.fromString(args[0]);
	const token = TokenId.fromString(GEM_TOKEN);
	const boostManagerId = ContractId.fromString(BOOST_MANAGER);

	printHeader({
		scriptName: 'My Gems',
		env,
		operatorId: operatorId.toString(),
		contractId: boostManagerId.toString(),
		additionalInfo: { 'Account': accountId.toString(), 'Gem token': token.toString() },
	});

	const serials = await getAllSerialsOwned(env, accountId.toString(), token.toString());
	if (serials.length === 0) {
		console.log(`\n${accountId.toString()} holds no ${token.toString()} gems.`);
		return;
	}

	// Sanity-check the local map against on-chain getBoostLevel for the first serial.
	try {
		const iface = loadInterface('BoostManager');
		const raw = await readOnlyEVMFromMirrorNode(env, boostManagerId, iface.encodeFunctionData('getBoostLevel', [token.toSolidityAddress(), serials[0]]), operatorId, false);
		const onChain = Number(iface.decodeFunctionResult('getBoostLevel', raw)[0]);
		if (onChain !== levelOfSerial(serials[0])) {
			console.log(`⚠️  On-chain getBoostLevel(serial ${serials[0]}) = ${lookupLevel(onChain)} disagrees with the local map. The gem config may have changed — re-derive with analyzeGemRemap.js. Listing uses the local map below.`);
		}
	}
	catch (e) {
		console.log('⚠️  Could not cross-check against on-chain getBoostLevel:', e.message);
	}

	// Group owned serials by level.
	const byLevel = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
	const unmapped = [];
	for (const s of serials) {
		const lvl = levelOfSerial(s);
		if (lvl < 0) unmapped.push(s);
		else byLevel[lvl].push(s);
	}

	console.log(`\n${accountId.toString()} holds ${serials.length} gem(s) on ${token.toString()}:\n`);
	// Show rarest-first.
	for (const lvl of [4, 3, 5, 2, 1, 0]) {
		const list = byLevel[lvl];
		if (!list.length) continue;
		const shown = list.length > 30 ? `${list.slice(0, 30).join(', ')} … (+${list.length - 30} more)` : list.join(', ');
		console.log(`  ${lookupLevel(lvl).padEnd(3)} (${REDUCTION[lvl]}% boost) x${list.length}: ${shown}`);
	}
	if (unmapped.length) console.log(`  ??  (not in any boost range) x${unmapped.length}: ${unmapped.join(', ')}`);

	const bestLevel = [4, 3, 5, 2, 1, 0].find((lvl) => byLevel[lvl].length);
	console.log(`\nBest gem: ${lookupLevel(bestLevel)} (${REDUCTION[bestLevel]}% mission-duration reduction).`);
};

runScript(main);
