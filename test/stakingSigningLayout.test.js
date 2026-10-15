// Pure unit tests for the staking signing layout (no network or deployment needed):
//   npx hardhat test test/stakingSigningLayout.test.js
const { expect } = require('chai');
const { describe, it } = require('mocha');
const { PrivateKey } = require('@hashgraph/sdk');
const {
	Stake,
	generateStakingRewardProof,
	layoutStakesForSigning,
	assertStakesSigningLayout,
} = require('../utils/LazyNFTStakingHelper');

// Model of how LazyNFTStaking reads a submitted entry whose packed hash matches a signed one: the
// hashed bytes are serials ++ rewards and the submitter picks where serials end (k). Returns every
// accepted split that would credit more (stake) or subtract less (unstake) than the signed rates.
function advantageousSplits(entry, maxBaseRate) {
	const packed = [...entry.serials, ...entry.rewards];
	const n = entry.serials.length;
	const rate = new Map(entry.serials.map((s, i) => [s, entry.rewards[i]]));
	const found = [];
	for (let k = 0; k <= packed.length; k++) {
		if (k === n) continue;
		const serials = packed.slice(0, k);
		const rewards = packed.slice(k);
		if (rewards.length < serials.length) continue;
		if (!serials.every((s) => rate.has(s))) continue;
		const applied = serials.reduce((t, _s, j) => t + rewards[j], 0);
		const legit = serials.reduce((t, s) => t + rate.get(s), 0);
		if (serials.every((_s, j) => rewards[j] <= maxBaseRate) && applied > legit) found.push(`stake k=${k}`);
		if (k > 0 && applied < legit) found.push(`unstake k=${k}`);
	}
	return found;
}

const COL = '0x00000000000000000000000000000000000bbaf1';

describe('Staking signing layout', function() {
	it('the model flags a naive grouped entry', function() {
		expect(advantageousSplits({ collection: COL, serials: [99, 6], rewards: [1000, 1000] }, 1000)).to.include('unstake k=1');
	});

	it('splits serials at or below the threshold and groups larger ones', function() {
		const out = layoutStakesForSigning([new Stake(COL.slice(2), [99, 6, 3001, 4500], [1000, 1000, 1000, 1000])], { [COL]: 1000 });
		expect(out.map((e) => e.serials)).to.deep.equal([[99, 3001, 4500], [6]]);
	});

	it('without a cap, signs one serial per entry', function() {
		const out = layoutStakesForSigning([new Stake(COL.slice(2), [5000, 6000], [100, 100])]);
		expect(out.map((e) => e.serials)).to.deep.equal([[5000], [6000]]);
	});

	it('no laid-out entry has an advantageous re-split (randomised)', function() {
		let x = 20261015;
		const next = () => {
			x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
			return x / 0x100000000;
		};
		const caps = [0, 200, 450, 500, 1000];
		for (let t = 0; t < 2000; t++) {
			const cap = caps[Math.floor(next() * caps.length)];
			const set = new Set();
			const count = 1 + Math.floor(next() * 15);
			while (set.size < count) set.add(1 + Math.floor(next() * (next() < 0.5 ? 150 : 6000)));
			const serials = [...set];
			const rewards = serials.map(() => Math.floor(next() * (cap + 1)));
			for (const entry of layoutStakesForSigning([{ collection: COL, serials, rewards }], { [COL]: cap })) {
				const found = advantageousSplits(entry, cap);
				if (found.length) throw new Error(`cap ${cap} ${JSON.stringify(entry)}: ${found.join(', ')}`);
			}
		}
	});

	it('the signer refuses unsafe layouts unless explicitly told it signs for itself', async function() {
		const key = PrivateKey.generateECDSA();
		const grouped = [new Stake(COL.slice(2), [99, 6], [1000, 1000])];
		let threw = false;
		try {
			await generateStakingRewardProof('0x0000000000000000000000000000000000001234', 0, key, grouped);
		}
		catch {
			threw = true;
		}
		expect(threw).to.be.true;
		expect(() => assertStakesSigningLayout(grouped, { [COL]: 1000 })).to.throw();
		const proof = await generateStakingRewardProof('0x0000000000000000000000000000000000001234', 0, key, grouped, { allowUnsafeLayout: true });
		expect(proof.signature).to.match(/^0x[0-9a-f]+$/);
		const safe = layoutStakesForSigning(grouped, { [COL]: 1000 });
		const ok = await generateStakingRewardProof('0x0000000000000000000000000000000000001234', 0, key, safe, { maxBaseRates: { [COL]: 1000 } });
		expect(ok.signature).to.match(/^0x[0-9a-f]+$/);
	});
});
