// eslint-disable-next-line no-unused-vars
const { PrivateKey } = require('@hashgraph/sdk');
const ethers = require('ethers');

class Stake {
	/**
	 * @param {string} collection the token address in EVM format
	 * @param {int[]} serials the serials of the tokens
	 * @param {int[]} rewards the reward rates of the tokens
	 * @constructor
	 * @public
	 */
	constructor(collection, serials, rewards) {
		this.collection = '0x' + collection;
		this.serials = serials;
		this.rewards = rewards;
	}
}

class RewardProof {
	/**
	 * @param {int} boostRate the boost rate to apply on top of the tokens
	 * @param {int} validityTimestamp the timestamp after which the proof is no longer valid
	 * @param {bytes} signature the signature of the proof
	 * @constructor
	 * @public
	 */
	constructor(boostRate, validityTimestamp, signature) {
		this.boostRate = boostRate;
		this.validityTimestamp = validityTimestamp;
		this.signature = signature;
	}
}

const capFor = (maxBaseRates, collection) => {
	if (!maxBaseRates) return undefined;
	const key = Object.keys(maxBaseRates).find((k) => k.toLowerCase() === collection.toLowerCase());
	return key === undefined ? undefined : maxBaseRates[key];
};

/**
 * Throws unless every entry is in canonical signing layout: in each entry, every serial after
 * the first must be greater than max(the collection's on-chain maxBaseRate, every rate in the
 * entry). Single-serial entries always qualify; multi-serial entries need the cap.
 * @param {Stake[]} stakes
 * @param {Object<string, number>} [maxBaseRates] getMaxBaseRate per collection EVM address (0x...)
 */
function assertStakesSigningLayout(stakes, maxBaseRates) {
	for (const stake of stakes) {
		if (stake.serials.length <= 1) continue;
		const cap = capFor(maxBaseRates, stake.collection);
		if (cap === undefined) {
			throw new Error(`Stake entry for ${stake.collection} has ${stake.serials.length} serials but no maxBaseRate was supplied. Lay stakes out with layoutStakesForSigning() before signing.`);
		}
		const threshold = Math.max(Number(cap), ...stake.rewards.map(Number));
		for (let i = 1; i < stake.serials.length; i++) {
			if (!(Number(stake.serials[i]) > threshold)) {
				throw new Error(`Stake entry for ${stake.collection} is not in signing layout (serial ${stake.serials[i]} at position ${i} must exceed ${threshold}). Lay stakes out with layoutStakesForSigning() before signing.`);
			}
		}
	}
}

/**
 * Lay stakes out for signing: serials are merged per collection; serials at or below
 * max(maxBaseRate, rates) each lead their own entry and larger serials follow the first entry.
 * Without a cap for a collection every serial gets its own entry. Submit the returned array to
 * stake()/unstake() exactly as signed.
 * @param {Stake[]} stakes requested stakes (any grouping)
 * @param {Object<string, number>} [maxBaseRates] getMaxBaseRate per collection EVM address (0x...)
 * @returns {Stake[]}
 */
function layoutStakesForSigning(stakes, maxBaseRates) {
	const byCollection = new Map();
	for (const stake of stakes) {
		if (stake.serials.length !== stake.rewards.length) {
			throw new Error(`Serials and rewards length mismatch for ${stake.collection}`);
		}
		const key = stake.collection.toLowerCase();
		const group = byCollection.get(key) ?? { collection: stake.collection, pairs: [] };
		stake.serials.forEach((serial, i) => {
			if (!Number.isInteger(Number(serial)) || Number(serial) < 1) throw new Error(`Invalid serial ${serial}`);
			if (group.pairs.some((p) => Number(p.serial) === Number(serial))) {
				throw new Error(`Duplicate serial ${serial} for ${stake.collection}`);
			}
			group.pairs.push({ serial: Number(serial), reward: Number(stake.rewards[i]) });
		});
		byCollection.set(key, group);
	}

	const toEntry = (collection, pairs) => ({ collection, serials: pairs.map((p) => p.serial), rewards: pairs.map((p) => p.reward) });
	const result = [];
	for (const { collection, pairs } of byCollection.values()) {
		const cap = capFor(maxBaseRates, collection);
		if (cap === undefined) {
			pairs.forEach((p) => result.push(toEntry(collection, [p])));
			continue;
		}
		const threshold = Math.max(Number(cap), ...pairs.map((p) => p.reward));
		const small = pairs.filter((p) => p.serial <= threshold);
		const big = pairs.filter((p) => p.serial > threshold);
		const groups = small.length > 0 ? small.map((p) => [p]) : [[]];
		groups[0].push(...big);
		groups.forEach((g) => result.push(toEntry(collection, g)));
	}
	assertStakesSigningLayout(result, maxBaseRates);
	return result;
}

/**
 * Generates a staking reward proof
 * The stakes must be in signing layout (see layoutStakesForSigning) and must be submitted to
 * stake()/unstake() exactly as signed.
 * @param {AccountId|string} _sender the account (or EVM address) of the sender. For an ECDSA
 *   account with an EVM alias, pass the alias: the contract binds msg.sender, which is the alias.
 * @param {int} _boostRate the boost rate to apply on top of the tokens
 * @param {PrivateKey} signingWalletPK the private key of the signing wallet
 * @param {Stake[]} stakes the stakes to be included in the proof, in signing layout
 * @param {Object} [options]
 * @param {Object<string, number>} [options.maxBaseRates] caps needed to sign multi-serial entries
 * @param {boolean} [options.allowUnsafeLayout] skip the layout check: only when signing for your
 *   own account (e.g. tests), never on behalf of other users
 * @returns {Promise<RewardProof>} the reward proof
 * @public
 * @async
 */
async function generateStakingRewardProof(_sender, _boostRate, signingWalletPK, stakes, options = {}) {
	if (!options.allowUnsafeLayout) {
		assertStakesSigningLayout(stakes, options.maxBaseRates);
	}
	const currentTimestamp = Math.floor(Date.now() / 1000);
	const senderAsEVM = typeof _sender === 'string'
		? (_sender.startsWith('0x') ? _sender : '0x' + _sender)
		: '0x' + _sender.toSolidityAddress();
	const signer = new ethers.Wallet(`0x${signingWalletPK.toStringRaw()}`);

	// first encode the stakes as bytes32 to handle the struct array
	const bytes32EncodedStakes = [];
	for (let i = 0; i < stakes.length; i++) {
		const stake = stakes[i];
		const encodedStake = ethers.solidityPackedKeccak256(
			['address', 'uint256[]', 'uint256[]'],
			[stake.collection, stake.serials, stake.rewards],
		);
		bytes32EncodedStakes.push(encodedStake);
	}

	// then hash the whole thing
	const hash = ethers.solidityPackedKeccak256(
		['address', 'uint256', 'bytes32[]', 'uint256'],
		[senderAsEVM, _boostRate, bytes32EncodedStakes, currentTimestamp],
	);

	const signature = await signer.signMessage(ethers.getBytes(hash));

	return new RewardProof(_boostRate, currentTimestamp, signature);
}

module.exports = {
	Stake,
	RewardProof,
	generateStakingRewardProof,
	layoutStakesForSigning,
	assertStakesSigningLayout,
};