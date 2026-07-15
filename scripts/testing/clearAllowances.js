/**
 * Scan and revoke ALL outstanding allowances (NFT approve-for-all, fungible-token,
 * and HBAR/crypto) that the operator account has granted.
 *
 * Why this exists: Hedera caps the number of live allowances an account may hold at
 * 100 (crypto + token + NFT combined). Test suites that deploy fresh spender contracts
 * every run keep adding approve-for-all NFT allowances that persist forever, eventually
 * tripping MAX_ALLOWANCES_EXCEEDED (status 294) on the next approve. Running this resets
 * the operator account back to zero so those suites can run again.
 *
 * Only the allowance OWNER can revoke, so this clears allowances owned by the operator
 * (ACCOUNT_ID / PRIVATE_KEY in .env). It never touches anyone else's allowances.
 *
 * Requires in .env: ENVIRONMENT (test|main|preview|local), ACCOUNT_ID, PRIVATE_KEY
 *
 * Usage:
 *   node scripts/testing/clearAllowances.js     # scan -> confirm -> clear -> verify
 */
const {
	Client,
	AccountId,
	PrivateKey,
	TokenId,
	Hbar,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const {
	clearNFTAllowances,
	clearFTAllowances,
	clearHbarAllowances,
} = require('../../utils/hederaHelpers');
const {
	getNFTApprovedForAllAllowances,
	checkFTAllowances,
	checkHbarAllowances,
} = require('../../utils/hederaMirrorHelpers');
require('dotenv').config();

const env = process.env.ENVIRONMENT ?? null;

// The mirror node lags the network by a few seconds; give it time to re-index between
// a revoke and the next scan so we do not re-clear entries that are already gone.
const MIRROR_LAG_MS = 6000;
// Safety guard so a mirror that never converges cannot loop forever. Each pass clears
// up to a full mirror page per category, so a 100-allowance account needs only a few.
const MAX_PASSES = 12;

let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pull all three allowance categories the operator currently owns from the mirror node
 * and normalise them into the shapes the clear* helpers expect.
 * @returns {Promise<{nft: object[], ft: object[], hbar: object[]}>}
 */
async function scan() {
	const nftMap = await getNFTApprovedForAllAllowances(env, operatorId);
	const ftRaw = await checkFTAllowances(env, operatorId);
	const hbarRaw = await checkHbarAllowances(env, operatorId);

	const nft = [];
	// getNFTApprovedForAllAllowances returns Map<spender, tokenId[]> (or 0 on error).
	if (nftMap && typeof nftMap.forEach === 'function') {
		nftMap.forEach((tokenList, spender) => {
			tokenList.forEach(tokenId => {
				nft.push({
					tokenId: TokenId.fromString(tokenId),
					owner: operatorId,
					spender: AccountId.fromString(spender),
				});
			});
		});
	}

	// check*Allowances return the raw mirror allowance array (or 0 on error).
	const ft = (Array.isArray(ftRaw) ? ftRaw : []).map(a => ({
		tokenId: TokenId.fromString(a.token_id),
		owner: operatorId,
		spender: AccountId.fromString(a.spender),
	}));

	const hbar = (Array.isArray(hbarRaw) ? hbarRaw : []).map(a => ({
		owner: operatorId,
		spender: AccountId.fromString(a.spender),
	}));

	return { nft, ft, hbar };
}

const main = async () => {
	if (!operatorKey || !operatorId) {
		console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	let client;
	console.log('\n- Using ENVIRONMENT:', env);
	if (env?.toUpperCase() === 'TEST') {
		client = Client.forTestnet();
		console.log('Clearing on *TESTNET*');
	}
	else if (env?.toUpperCase() === 'MAIN') {
		client = Client.forMainnet();
		console.log('Clearing on *MAINNET*');
	}
	else if (env?.toUpperCase() === 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('Clearing on *PREVIEWNET*');
	}
	else if (env?.toUpperCase() === 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Clearing on *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify MAIN, TEST, PREVIEW or LOCAL as ENVIRONMENT in .env file');
		return;
	}
	client.setOperator(operatorId, operatorKey);
	// AccountAllowanceApproveTransaction takes its fee ceiling from the client default,
	// and the SDK's 2 HBAR default is too low to revoke a batch of allowances at the
	// current low HBAR price -> INSUFFICIENT_TX_FEE. Raise the cap (metered, not charged).
	// NB: keep this at 50 (or <21) HBAR. setDefaultMaxTransactionFee validates via a signed
	// int32 of the tinybar amount, so values ~[21.5, 43) HBAR wrap negative and wrongly
	// throw "defaultMaxTransactionFee must be non-negative". 50 HBAR wraps back positive.
	client.setDefaultMaxTransactionFee(new Hbar(50));

	console.log('- Operator (owner):', operatorId.toString());

	const { nft, ft, hbar } = await scan();
	const total = nft.length + ft.length + hbar.length;

	console.log('\n- Outstanding allowances owned by', operatorId.toString() + ':');
	console.log(`    NFT (approve-for-all) : ${nft.length}`);
	console.log(`    Fungible token        : ${ft.length}`);
	console.log(`    HBAR / crypto         : ${hbar.length}`);
	console.log(`    TOTAL                 : ${total}   (network cap is 100)`);

	if (total === 0) {
		console.log('\n✅ Nothing to clear — account already reports 0 allowances.');
		return;
	}

	const proceed = readlineSync.keyInYNStrict(`\nRevoke all ${total} allowance(s) owned by ${operatorId.toString()}?`);
	if (!proceed) {
		console.log('Aborting — no changes made.');
		return;
	}

	// Clear whatever the mirror currently reports, wait for it to re-index, re-scan, and
	// repeat. Looping drains categories that exceed a single mirror page and tolerates
	// propagation lag, ending only once the account reads back 0 (verify-after-mutation).
	for (let pass = 1; pass <= MAX_PASSES; pass++) {
		const batch = await scan();
		const batchTotal = batch.nft.length + batch.ft.length + batch.hbar.length;
		if (batchTotal === 0) {
			console.log(`\n✅ Verified: 0 allowances remaining on ${operatorId.toString()}.`);
			return;
		}

		console.log(`\n- Pass ${pass}: clearing NFT ${batch.nft.length} / FT ${batch.ft.length} / HBAR ${batch.hbar.length} ...`);

		if (batch.nft.length) {
			console.log('    NFT clear  :', await clearNFTAllowances(client, batch.nft));
		}
		if (batch.ft.length) {
			console.log('    FT clear   :', await clearFTAllowances(client, batch.ft));
		}
		if (batch.hbar.length) {
			console.log('    HBAR clear :', await clearHbarAllowances(client, batch.hbar));
		}

		await sleep(MIRROR_LAG_MS);
	}

	// Guard tripped — do a final scan so we report the true remaining count.
	const left = await scan();
	const leftTotal = left.nft.length + left.ft.length + left.hbar.length;
	if (leftTotal === 0) {
		console.log(`\n✅ Verified: 0 allowances remaining on ${operatorId.toString()}.`);
	}
	else {
		console.log(`\n⚠️  ${leftTotal} allowance(s) still reported after ${MAX_PASSES} passes (mirror lag or a stubborn entry). Re-run to finish.`);
		process.exitCode = 1;
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
