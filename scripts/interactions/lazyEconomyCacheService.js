/**
 * Lazy Economy Cache Service
 * Queries staking contract and stores results in Directus
 * Refactored to use shared utilities
 */
const { ContractId, AccountId, TokenId } = require('@hashgraph/sdk');
require('dotenv').config();
const { ethers } = require('ethers');
const { default: axios } = require('axios');
const { createDirectus, rest, readItems, staticToken, updateItem, createItem } = require('@directus/sdk');
const { parseArgs, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const {
	getBaseURL,
	getTokenDetails,
	checkMirrorBalance,
	checkMirrorHbarBalance,
	homebrewPopulateAccountNum,
} = require('../../utils/hederaMirrorHelpers');

// Configuration from environment
let operatorId = process.env.ACCOUNT_ID ?? '0.0.888';
let env = process.env.LAZY_STAKING_ENV ?? null;
const cacheTable = process.env.LAZY_STAKING_CACHE_TABLE ?? 'LazyEconomyCache';
const timeseriesTable = process.env.LAZY_STAKING_TIMESERIES_TABLE ?? 'LazyEconomyTimeseries';
const client = createDirectus(process.env.DIRECTUS_DB_URL).with(rest());
const writeClient = createDirectus(process.env.DIRECTUS_DB_URL).with(staticToken(process.env.DIRECTUS_TOKEN)).with(rest());
const supressLogs = process.env.STAKING_CACHE_SUPRESS_LOGS === '1' || process.env.STAKING_CACHE_SUPRESS_LOGS === 'true';
const lgsId = process.env.LAZY_GAS_STATION_ID ?? '0.0.7221483';
const lsctId = process.env.LAZY_SMART_CONTRACT_TREASURY ?? '0.0.1311003';
const treasuryId = process.env.TREASURY_ID ?? '0.0.499869';
const mintId = process.env.MINT_ID ?? '0.0.697777';
const gen1SalesId = process.env.GEN1_SALES_ID ?? '0.0.662623';
const lsvGen2SalesId = process.env.LSV_GEN2_SALES_ID ?? '0.0.659099';
const gen2RaffleId = process.env.GEN2_RAFFLE_ID ?? '0.0.658725';
const gen1RoyaltyId = process.env.GEN1_ROYALTY_ID ?? '0.0.841300';

let lazyStakingContract;
const evmToHederaAccountMap = new Map();

const TYPES = {
	LONGEST_STAKED: 'LONGEST_STAKED',
	HIGHEST_DAILY_RATE: 'HIGHEST_DAILY_RATE',
	LARGEST_BOOST: 'LARGEST_BOOST',
	LARGEST_UNCLAIMED: 'LARGEST_UNCLAIMED',
	MOST_CLAIMED: 'MOST_CLAIMED',
};

// ======================= Data Model Classes =======================

class lazyEconomyTimeSeries {
	constructor(burntSupply, ciculatingSupply, currentStakers, collectionsStaked = [], claimableLazy, lazyClaimed, nftsStaked, sctLazy, lgsLazy, treasuryLazy, mintLazy, gen1SalesHbar, lsvGen2SalesHbar, gen2RaffleHbar, gen1RoyaltyShare) {
		this.burntSupply = burntSupply;
		this.circulatingSupply = ciculatingSupply;
		this.currentStakers = currentStakers;
		this.collectionsStaked = collectionsStaked;
		this.claimableLazy = claimableLazy;
		this.lazyClaimed = lazyClaimed;
		this.nftsStaked = nftsStaked;
		this.sctLazy = sctLazy;
		this.lgsLazy = lgsLazy;
		this.treasuryLazy = treasuryLazy;
		this.mintLazy = mintLazy;
		this.gen1SalesHbar = gen1SalesHbar;
		this.lsvGen2SalesHbar = lsvGen2SalesHbar;
		this.gen2RaffleHbar = gen2RaffleHbar;
		this.gen1RoyaltyShare = gen1RoyaltyShare;
	}

	async toJSON() {
		return {
			burntSupply: this.burntSupply,
			circulatingSupply: this.circulatingSupply,
			currentStakers: this.currentStakers,
			collectionsStaked: this.getCollectionsAsJSON,
			claimableLazy: this.claimableLazy,
			lazyClaimed: this.lazyClaimed,
			nftsStaked: this.nftsStaked,
			sctLazy: this.sctLazy,
			lgsLazy: this.lgsLazy,
			treasuryLazy: this.treasuryLazy,
			mintLazy: this.mintLazy,
			gen1SalesHbar: this.gen1SalesHbar,
			lsvGen2SalesHbar: this.lsvGen2SalesHbar,
			gen2RaffleHbar: this.gen2RaffleHbar,
			gen1RoyaltyShare: this.gen1RoyaltyShare,
		};
	}

	getCollectionsAsJSON() {
		return this.collectionsStaked.map(collection => collection.toJSON());
	}

	async toString() {
		let rtnVal = `Burnt Supply: ${this.burntSupply}\n`;
		rtnVal += `Ciculating Supply: ${this.circulatingSupply}\n`;
		rtnVal += `Current Stakers: ${this.currentStakers}\n`;
		rtnVal += `Claimable Lazy: ${this.claimableLazy}\n`;
		rtnVal += `$LAZY Claimed: ${this.lazyClaimed}\n`;
		rtnVal += `NFTs Staked: ${this.nftsStaked}\n`;
		rtnVal += `SCT $LAZY: ${this.sctLazy}\n`;
		rtnVal += `LGS $LAZY: ${this.lgsLazy}\n`;
		rtnVal += `Treasury $LAZY: ${this.treasuryLazy}\n`;
		rtnVal += `Mint $LAZY: ${this.mintLazy}\n`;
		rtnVal += `Gen1 Sales Hbar: ${this.gen1SalesHbar}\n`;
		rtnVal += `LSV Gen2 Sales Hbar: ${this.lsvGen2SalesHbar}\n`;
		rtnVal += `Gen2 Raffle Hbar: ${this.gen2RaffleHbar}\n`;
		rtnVal += `Gen1 Royalty Share: ${this.gen1RoyaltyShare}\n`;
		for (const collection of this.collectionsStaked) {
			rtnVal += collection.toString() + '\n';
		}
		return rtnVal;
	}
}

class lazyEconomyCache {
	constructor(stakingUsers, totalItemsStaked, totalLazyEarned, totalLazyClaimed, totalEarnRate, collections = [], top25s = []) {
		this.stakingUsers = stakingUsers;
		this.totalItemsStaked = totalItemsStaked;
		this.totalLazyEarned = totalLazyEarned;
		this.totalLazyClaimed = totalLazyClaimed;
		this.totalEarnRate = totalEarnRate;
		this.collections = collections;
		this.top25s = top25s;
	}

	addCollection(collection) {
		const existingCollection = this.collections.find(c => c.symbol == collection.symbol);
		if (existingCollection) {
			existingCollection.numStaked += collection.numStaked;
			existingCollection.totalSupply += collection.totalSupply;
		}
		else {
			this.collections.push(collection);
		}
	}

	addTop25(top25) {
		this.top25s.push(top25);
	}

	async toJSON() {
		return {
			stakingUsers: this.stakingUsers,
			totalItemsStaked: this.totalItemsStaked,
			totalLazyEarned: this.totalLazyEarned,
			totalLazyClaimed: this.totalLazyClaimed,
			totalEarnRate: this.totalEarnRate,
			collections: this.getCollectionsAsJSON(),
			top25s: await this.getTop25sAsJSON(),
		};
	}

	async getTop25sAsJSON() {
		return await Promise.all(this.top25s.map(async top25 => await top25.toJSON()));
	}

	getCollectionsAsJSON() {
		return this.collections.map(collection => collection.toJSON());
	}

	async toString() {
		let rtnVal = `Total Items Staked: ${this.totalItemsStaked}\n`;
		rtnVal += `Total Lazy Earned: ${this.totalLazyEarned}\n`;
		rtnVal += `Total Lazy Claimed: ${this.totalLazyClaimed}\n`;
		rtnVal += `Total Earn Rate: ${this.totalEarnRate}\n`;

		this.collections.forEach(collection => {
			rtnVal += collection.toString() + '\n';
		});

		for (const top25 of this.top25s) {
			rtnVal += await top25.toString() + '\n';
		}

		return rtnVal;
	}
}

class nftCollection {
	constructor(name, symbol, totalSupply, numStaked) {
		const nameMatch = name.match(/#(\d+) (Jester)/);
		if (nameMatch) {
			name = nameMatch[2];
		}
		this.name = name;
		this.symbol = symbol == 'IPFS://bafkreie625ucklhyqwxqvopoc3aa6dmliji3xwagr3tfkziew3m2xdnd3i' ? 'GoldenHH' : symbol;
		this.totalSupply = totalSupply < numStaked ? numStaked : totalSupply;
		this.numStaked = numStaked;
	}

	toJSON() {
		return {
			name: this.name,
			symbol: this.symbol,
			totalSupply: this.totalSupply,
			numStaked: this.numStaked,
		};
	}

	toString() {
		return `${this.name} [${this.symbol}] has ${this.numStaked} NFTs staked (${((this.numStaked / this.totalSupply) * 100).toFixed(2)}%)`;
	}
}

class top25User {
	constructor(type, userList = []) {
		this.type = type;
		this.userList = userList;
		this.parsed = false;
	}

	addUser(user, amount) {
		if (this.userList.includes(user)) {
			const userIndex = this.userList.findIndex(u => u.user == user);
			this.userList[userIndex].amount += amount;
			return;
		}
		else {
			this.userList.push({ user, amount });
		}
		this.parsed = false;
	}

	async parseTop25() {
		if (this.parsed) return;

		const sortedList = this.userList.sort((a, b) => b.amount - a.amount);
		this.userList = sortedList.slice(0, 25);

		for (const user of this.userList) {
			if (user.user.startsWith('0x')) {
				if (evmToHederaAccountMap.has(user.user)) {
					user.user = evmToHederaAccountMap.get(user.user);
				}
				else {
					if (!supressLogs) console.log('INFO: Translating EVM address:', user.user);
					const translatedUser = await homebrewPopulateAccountNum(env, user.user);
					if (!supressLogs) console.log('INFO: Got:', translatedUser, 'for EVM address:', user.user);
					evmToHederaAccountMap.set(user.user, translatedUser);
					user.user = translatedUser;
				}
			}
		}

		this.parsed = true;
	}

	async toJSON() {
		await this.parseTop25();

		const jsonList = this.userList.map(user => {
			return {
				user: user.user.toString(),
				amount: user.amount,
			};
		});

		return {
			type: this.type,
			userList: jsonList,
		};
	}

	async toString() {
		await this.parseTop25();

		let rtnVal = `${this.type}\n`;

		this.userList.forEach((user, index) => {
			rtnVal += `${index + 1}: ${user.user} ${user.amount}\n`;
		});

		return rtnVal;
	}
}

// ======================= Main Logic =======================

const main = async () => {
	// Normalize environment
	if (env.toUpperCase() == 'TEST' || env.toUpperCase() == 'TESTNET') {
		env = 'testnet';
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN' || env.toUpperCase() == 'MAINNET') {
		env = 'mainnet';
		console.log('Processing in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW' || env.toUpperCase() == 'PREVIEWNET') {
		env = 'previewnet';
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL' || env.toUpperCase() == 'LOCALHOST') {
		env = 'local';
		console.log('testing in *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file');
		return;
	}

	const args = parseArgs(0, 'lazyEconomyCacheService.js [0.0.LSC]', [
		'LSC is the Lazy Staking contract if not supplied will use LAZY_STAKING_CONTRACT_ID from the .env file',
	]);

	// Use argument if provided, otherwise use env var
	if (args.length == 0) {
		lazyStakingContract = process.env.LAZY_STAKING_CONTRACT_ID ?? null;
	}
	else {
		lazyStakingContract = args[0];
	}

	if (!lazyStakingContract) {
		console.log('ERROR: No staking contract provided');
		return;
	}

	if (!['mainnet', 'testnet', 'previewnet', 'local'].includes(env)) {
		console.log('ERROR: Invalid environment provided');
		return;
	}

	operatorId = AccountId.fromString(operatorId);
	const contractId = ContractId.fromString(lazyStakingContract);

	if (!supressLogs) console.log('\n-Using ENVIRONMENT:', env, 'operatorId:', operatorId.toString(), 'contractId:', contractId.toString());

	const lscIface = new ethers.Interface([
		'function lazyToken() view returns (address)',
		'function totalItemsStaked() view returns (uint256)',
		'function getStakingUsers() view returns (address[] users)',
		'function calculateRewards(address) view returns (uint256 lazyEarned, uint256 rewardRate, uint256 asOfTimestamp, uint256 lastClaimedTimestamp)',
		'function getBaseRewardRate(address) view returns (uint256)',
		'function getActiveBoostRate(address) view returns (uint256)',
		'function getStakableCollections() view returns (address[] collections)',
		'function getNumStakedNFTs(address) view returns (uint256)',
		'event ClaimedRewards(address _user, uint256 _rewardAmount, uint256 _burnPercentage)',
	]);

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = lscIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return lscIface.decodeFunctionResult(fcnName, result);
	};

	// Get lazyToken
	const lazyTokenEVM = await query('lazyToken');
	const lazyToken = TokenId.fromSolidityAddress(lazyTokenEVM[0]);

	// Get lazyToken details
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	const lazyDecimals = lazyTokenDetails.decimals;

	// Get totalItemsStaked
	const totalItemsStaked = await query('totalItemsStaked');

	// Get stakingUsers
	const users = await query('getStakingUsers');

	let totalLazyEarned = 0;
	let totalEarnRate = 0;

	// Build the top25 objects for each type
	const top25s = [
		new top25User(TYPES.LONGEST_STAKED),
		new top25User(TYPES.HIGHEST_DAILY_RATE),
		new top25User(TYPES.LARGEST_BOOST),
		new top25User(TYPES.LARGEST_UNCLAIMED),
		new top25User(TYPES.MOST_CLAIMED),
	];

	const currentTimestamp = Math.floor(Date.now() / 1000);

	for (const user of users[0]) {
		const rewards = await query('calculateRewards', [user]);
		const activeBoostRate = await query('getActiveBoostRate', [user]);
		const baseRate = await query('getBaseRewardRate', [user]);

		totalLazyEarned += Number(rewards[0]);
		totalEarnRate += Number(rewards[1]);

		// Add user to the top25s
		top25s[0].addUser(user, currentTimestamp - Number(rewards[3]));
		top25s[1].addUser(user, Number(rewards[1]));
		top25s[2].addUser(user, Number(activeBoostRate));
		top25s[3].addUser(user, Number(rewards[0]) / 10 ** lazyDecimals);

		if (!supressLogs) {
			console.log(
				'User:',
				AccountId.fromEvmAddress(0, 0, user).toString(),
				'has earnt:',
				Number(rewards[0]) / 10 ** lazyDecimals,
				`Lazy (Current Rate: ${Number(rewards[1]) / 10 ** lazyDecimals}/day)`,
				`Base Rate: ${Number(baseRate) / 10 ** lazyDecimals}/day`,
				`Active Boost Rate: ${Number(activeBoostRate)}%`,
				`as of ${new Date(Number(rewards[2]) * 1000).toUTCString()}`,
				rewards[3]
					? `Last Claim ${new Date(Number(rewards[3]) * 1000).toUTCString()}`
					: '',
			);
		}
	}

	console.log('INFO: Looking up staking events');
	const lazyClaimedEvents = await getLazyClaimedViaEventsFromMirror(contractId, lscIface);

	if (!supressLogs) console.log('INFO: Total claimed events:', lazyClaimedEvents.length);

	let totalLazyClaimed = 0;
	const userToClaimed = new Map();
	lazyClaimedEvents.forEach(event => {
		const user = event.user;
		const rewardAmount = Number(event.rewardAmount) / 10 ** lazyDecimals;

		top25s[4].addUser(user, rewardAmount);
		totalLazyClaimed += rewardAmount;

		const userTotalClaimed = userToClaimed.get(user) ?? 0;
		userToClaimed.set(user, userTotalClaimed + rewardAmount);
	});

	if (!supressLogs) {
		console.log('INFO: Total users:', userToClaimed.size);
		console.log('INFO: Total Lazy Claimed:', totalLazyClaimed / 10 ** lazyDecimals);
	}

	const lazyEconomyCacheObj = new lazyEconomyCache(users[0].length, Number(totalItemsStaked[0]), totalLazyEarned / 10 ** lazyDecimals, totalLazyClaimed / 10 ** lazyDecimals, totalEarnRate / 10 ** lazyDecimals);

	top25s.forEach(top25 => {
		lazyEconomyCacheObj.addTop25(top25);
	});

	if (!supressLogs) {
		console.log('LazyToken:', lazyToken.toString(), 'Decimal:', lazyTokenDetails.decimals);
		console.log('getStakingUsers:', users[0].length);
		console.log('totalItemsStaked:', Number(totalItemsStaked[0]));
		console.log('Total Lazy Earned:', totalLazyEarned / 10 ** lazyDecimals, 'Total Earn Rate:', totalEarnRate / 10 ** lazyDecimals);
	}

	// Get stakable collections
	const collections = await query('getStakableCollections');

	for (const collection of collections[0]) {
		const numStaked = await query('getNumStakedNFTs', [collection]);
		const collectionDetails = await getTokenDetails(env, TokenId.fromSolidityAddress(collection));

		lazyEconomyCacheObj.addCollection(new nftCollection(collectionDetails.name, collectionDetails.symbol, Number(collectionDetails.total_supply), Number(numStaked[0])));

		if (!supressLogs) {
			console.log(
				`Collection: ${collectionDetails.name} [${collectionDetails.symbol}] has ${numStaked[0]} NFTs staked (${
					((Number(numStaked[0]) / Number(collectionDetails.total_supply)) * 100).toFixed(2)
				}%)`,
			);
		}
	}

	const ouptutAsStr = await lazyEconomyCacheObj.toString();
	const outputAsJSON = await lazyEconomyCacheObj.toJSON();

	console.log(ouptutAsStr);

	await postLastestEconomyToDirectus(lazyEconomyCacheObj);

	if (!supressLogs) {
		console.log(console.dir(outputAsJSON, { depth: 5 }));
	}

	// Gather additional data for timeseries
	const lgsLazy = await checkMirrorBalance(env, lgsId, lazyToken) / 10 ** lazyDecimals;
	const sctLazy = await checkMirrorBalance(env, lsctId, lazyToken) / 10 ** lazyDecimals;
	const treasuryLazy = await checkMirrorBalance(env, treasuryId, lazyToken) / 10 ** lazyDecimals;
	const mintLazy = await checkMirrorBalance(env, mintId, lazyToken) / 10 ** lazyDecimals;

	const gen1SalesHbar = await checkMirrorHbarBalance(env, gen1SalesId) / 10 ** 8;
	const lsvGen2SalesHbar = await checkMirrorHbarBalance(env, lsvGen2SalesId) / 10 ** 8;
	const gen2RaffleHbar = await checkMirrorHbarBalance(env, gen2RaffleId) / 10 ** 8;
	const gen1RoyaltyShare = await checkMirrorHbarBalance(env, gen1RoyaltyId) / 10 ** 8;

	console.log('INFO: LGS $LAZY:', lgsLazy);
	console.log('INFO: SCT $LAZY:', sctLazy);
	console.log('INFO: Treasury $LAZY:', treasuryLazy);
	console.log('INFO: Mint $LAZY:', mintLazy);
	console.log('INFO: Gen1 Sales Hbar:', gen1SalesHbar);
	console.log('INFO: LSV Gen2 Sales Hbar:', lsvGen2SalesHbar);
	console.log('INFO: Gen2 Raffle Hbar:', gen2RaffleHbar);
	console.log('INFO: Gen1 Royalty Share:', gen1RoyaltyShare);

	console.log('INFO: $LAZY Token Details:', lazyTokenDetails);

	lazyTokenDetails.max_supply = Number(lazyTokenDetails.max_supply) / 10 ** lazyDecimals;
	lazyTokenDetails.total_supply = Number(lazyTokenDetails.total_supply) / 10 ** lazyDecimals;

	console.log('Max Supply:', lazyTokenDetails.max_supply);
	console.log('Total Supply:', lazyTokenDetails.total_supply);

	const burntLazy = lazyTokenDetails.max_supply - lazyTokenDetails.total_supply;
	const ciculatingSupply = lazyTokenDetails.total_supply - lgsLazy - sctLazy;

	console.log('Burnt Supply:', burntLazy);
	console.log('Circulating Supply:', ciculatingSupply);

	const timeseries = new lazyEconomyTimeSeries(
		burntLazy,
		ciculatingSupply,
		lazyEconomyCacheObj.stakingUsers,
		lazyEconomyCacheObj.collections,
		lazyEconomyCacheObj.totalLazyEarned,
		lazyEconomyCacheObj.totalLazyClaimed,
		lazyEconomyCacheObj.totalItemsStaked,
		sctLazy,
		lgsLazy,
		treasuryLazy,
		mintLazy,
		gen1SalesHbar,
		lsvGen2SalesHbar,
		gen2RaffleHbar,
		gen1RoyaltyShare);

	await postTimeseriesToDirectus(timeseries);
};

// ======================= Directus Functions =======================

async function postTimeseriesToDirectus(lazyEconomyTimeSeriesObj) {
	try {
		await writeClient.request(createItem(timeseriesTable, {
			environment: env,
			snapshotDate: new Date(),
			burntSupply: lazyEconomyTimeSeriesObj.burntSupply,
			circulatingSupply: lazyEconomyTimeSeriesObj.circulatingSupply,
			currentStakers: lazyEconomyTimeSeriesObj.currentStakers,
			collectionsStaked: lazyEconomyTimeSeriesObj.getCollectionsAsJSON(),
			claimableLazy: lazyEconomyTimeSeriesObj.claimableLazy,
			lazyClaimed: lazyEconomyTimeSeriesObj.lazyClaimed,
			nftsStaked: lazyEconomyTimeSeriesObj.nftsStaked,
			sctLazy: lazyEconomyTimeSeriesObj.sctLazy,
			lgsLazy: lazyEconomyTimeSeriesObj.lgsLazy,
			treasuryLazy: lazyEconomyTimeSeriesObj.treasuryLazy,
			mintLazy: lazyEconomyTimeSeriesObj.mintLazy,
			gen1SalesHbar: lazyEconomyTimeSeriesObj.gen1SalesHbar,
			lsvGen2SalesHbar: lazyEconomyTimeSeriesObj.lsvGen2SalesHbar,
			gen2RaffleHbar: lazyEconomyTimeSeriesObj.gen2RaffleHbar,
			gen1RoyaltyShare: lazyEconomyTimeSeriesObj.gen1RoyaltyShare,
		}));
	}
	catch (error) {
		console.error(error);
	}
}

async function postLastestEconomyToDirectus(lazyEconomyCacheObj) {
	const response = await client.request(readItems(cacheTable, {
		fields: ['id'],
		filter: {
			contractId: {
				_eq: lazyStakingContract.toString(),
			},
			environment: {
				_eq: env,
			},
		},
		limit: 1,
	}));

	if (!response || response.length == 0) {
		await writeClient.request(createItem(cacheTable, {
			environment: env,
			contractId: lazyStakingContract.toString(),
			stakingUsers: lazyEconomyCacheObj.stakingUsers,
			totalItemsStaked: lazyEconomyCacheObj.totalItemsStaked,
			totalLazyEarned: lazyEconomyCacheObj.totalLazyEarned,
			totalEarnRate: lazyEconomyCacheObj.totalEarnRate,
			collections: lazyEconomyCacheObj.getCollectionsAsJSON(),
			top25s: await lazyEconomyCacheObj.getTop25sAsJSON(),
		}));
	}
	else {
		await writeClient.request(updateItem(cacheTable, response[0].id, {
			stakingUsers: lazyEconomyCacheObj.stakingUsers,
			totalItemsStaked: lazyEconomyCacheObj.totalItemsStaked,
			totalLazyEarned: lazyEconomyCacheObj.totalLazyEarned,
			totalEarnRate: lazyEconomyCacheObj.totalEarnRate,
			collections: lazyEconomyCacheObj.getCollectionsAsJSON(),
			top25s: await lazyEconomyCacheObj.getTop25sAsJSON(),
		}));
	}
}

// ======================= Helper Functions =======================

async function getLazyClaimedViaEventsFromMirror(contractId, iface) {
	const baseUrl = getBaseURL(env);
	let url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100`;

	if (!supressLogs) console.log('INFO: Fetching logs from:', url);

	const claimEvents = [];

	do {
		const response = await axios.get(url);
		const jsonResponse = response.data;
		jsonResponse.logs.forEach(log => {
			if (log.data == '0x') return;

			const event = iface.parseLog({ topics: log.topics, data: log.data });
			if (!event) return;

			if (event.name === 'ClaimedRewards') {
				claimEvents.push({
					user: event.args._user,
					rewardAmount: Number(event.args._rewardAmount),
					burnPercentage: Number(event.args._burnPercentage),
				});
			}
		});

		if (!jsonResponse.links.next) {
			break;
		}
		url = `${baseUrl}${jsonResponse.links.next}`;
		if (!supressLogs) console.log('INFO: Fetching logs from:', url);
	}
	while (url);

	return claimEvents;
}

runScript(main);
