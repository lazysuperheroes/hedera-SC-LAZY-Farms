const {
	ContractId,
	AccountId,
	TokenId,
	Client,
} = require('@hashgraph/sdk');
require('dotenv').config();
const { ethers } = require('ethers');
const { default: axios } = require('axios');
const { createDirectus, rest, readItems, staticToken, updateItem, createItem } = require('@directus/sdk');

let operatorId = process.env.ACCOUNT_ID ?? '0.0.888';
let env = process.env.LAZY_STAKING_ENV ?? null;
const cacheTable = process.env.LAZY_STAKING_CACHE_TABLE ?? 'LazyEconomyCache';
const client = createDirectus(process.env.DIRECTUS_DB_URL).with(rest());
const writeClient = createDirectus(process.env.DIRECTUS_DB_URL).with(staticToken(process.env.DIRECTUS_TOKEN)).with(rest());
const supressLogs = process.env.STAKING_CACHE_SUPRESS_LOGS === '1' || process.env.STAKING_CACHE_SUPRESS_LOGS === 'true';

let hederaClient;
let lazyStakingContract;
const evmToHederaAccountMap = new Map();

const TYPES = {
	LONGEST_STAKED: 'LONGEST_STAKED',
	HIGHEST_DAILY_RATE: 'HIGHEST_DAILY_RATE',
	LARGEST_BOOST: 'LARGEST_BOOST',
	LARGEST_UNCLAIMED: 'LARGEST_UNCLAIMED',
};

class lazyEconomyCache {
	constructor(stakingUsers, totalItemsStaked, totalLazyEarned, totalEarnRate, collections = [], top25s = []) {
		this.stakingUsers = stakingUsers;
		this.totalItemsStaked = totalItemsStaked;
		this.totalLazyEarned = totalLazyEarned;
		this.totalEarnRate = totalEarnRate;
		this.collections = collections;
		this.top25s = top25s;
	}

	addCollection(collection) {
		// if the collection is not already in the list add it, otherwise update the numStaked / supply
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
		// convert collections and top25s to arrays of JSON
		return {
			stakingUsers: this.stakingUsers,
			totalItemsStaked: this.totalItemsStaked,
			totalLazyEarned: this.totalLazyEarned,
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
		// if name matches #XXX Jester then keep only Jester
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
		this.userList.push({ user, amount });
		this.parsed = false;
	}

	async parseTop25() {
		// sort by the amount field
		// create a JSON string for each user in UserList
		// format rank, user, amount

		if (this.parsed) return;

		const sortedList = this.userList.sort((a, b) => b.amount - a.amount);

		// only keep the top 25
		this.userList = sortedList.slice(0, 25);

		// if any user starts with 0x then convert to AccountId
		for (const user of this.userList) {
			if (user.user.startsWith('0x')) {
				// check the map for the user
				if (evmToHederaAccountMap.has(user.user)) {
					user.user = evmToHederaAccountMap.get(user.user);
				}
				else {
					// convert the user to an AccountId
					const parsedUser = (await AccountId.fromString(user.user).populateAccountNum(hederaClient));
					const translatedUser = `${parsedUser.shard}.${parsedUser.realm}.${parsedUser.num}`;
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

const main = async () => {

	if (env.toUpperCase() == 'TEST' || env.toUpperCase() == 'TESTNET') {
		hederaClient = Client.forTestnet();
		env = 'testnet';
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN' || env.toUpperCase() == 'MAINNET') {
		hederaClient = Client.forMainnet();
		env = 'mainnet';
		console.log('Processing in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW' || env.toUpperCase() == 'PREVIEWNET') {
		hederaClient = Client.forPreviewnet();
		env = 'previewnet';
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL' || env.toUpperCase() == 'LOCALHOST') {
		env = 'local';
		const node = { '127.0.0.1:50211': new AccountId(3) };
		hederaClient = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('testing in *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
		);
		return;
	}

	const args = process.argv.slice(2);
	if ((args.length > 1) || getArgFlag('h')) {
		console.log('Usage: lazyEconomyCacheService.js [0.0.LSC]');
		console.log('       LSC is the Lazy Staking contract if not supplied will use LAZY_STAKING_CONTRACT_ID from the .env file');
		return;
	}

	// if an argument is passed use that as the contract id
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

	// validate environment is in set of allowed values [mainnet, testnet, previewnet, local]
	if (!['mainnet', 'testnet', 'previewnet', 'local'].includes(env)) {
		console.log('ERROR: Invalid environment provided');
		return;
	}

	operatorId = AccountId.fromString(operatorId);

	const contractId = ContractId.fromString(lazyStakingContract);

	if (!supressLogs) console.log('\n-Using ENIVRONMENT:', env, 'operatorId:', operatorId.toString(), 'contractId:', contractId.toString());


	const lscIface = new ethers.Interface(
		[
			'function lazyToken() view returns (address)',
			'function totalItemsStaked() view returns (uint256)',
			'function getStakingUsers() view returns (address[] users)',
			'function calculateRewards(address) view returns (uint256 lazyEarned, uint256 rewardRate, uint256 asOfTimestamp, uint256 lastClaimedTimestamp)',
			'function getBaseRewardRate(address) view returns (uint256)',
			'function getActiveBoostRate(address) view returns (uint256)',
			'function getStakableCollections() view returns (address[] collections)',
			'function getNumStakedNFTs(address) view returns (uint256)',
		],
	);

	// query mirror nodes to call the following methods:
	// call lazyToken method
	let encodedCall = lscIface.encodeFunctionData('lazyToken', []);

	let result = await readOnlyEVMFromMirrorNode(
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const lazyTokenEVM = lscIface.decodeFunctionResult('lazyToken', result);

	const lazyToken = TokenId.fromSolidityAddress(lazyTokenEVM[0]);

	// now get the details of the lazyToken from the mirror node
	const lazyTokenDetails = await getTokenDetails(lazyToken);

	const lazyDecimals = lazyTokenDetails.decimals;

	// totalItemsStaked
	encodedCall = lscIface.encodeFunctionData('totalItemsStaked', []);

	result = await readOnlyEVMFromMirrorNode(
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const totalItemsStaked = lscIface.decodeFunctionResult(
		'totalItemsStaked',
		result,
	);

	// getStakingUsers
	encodedCall = lscIface.encodeFunctionData('getStakingUsers', []);

	result = await readOnlyEVMFromMirrorNode(
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const users = lscIface.decodeFunctionResult('getStakingUsers', result);

	let totalLazyEarned = 0;
	let totalEarnRate = 0;

	// build the top25 objects for each type
	const top25s = [
		new top25User(TYPES.LONGEST_STAKED),
		new top25User(TYPES.HIGHEST_DAILY_RATE),
		new top25User(TYPES.LARGEST_BOOST),
		new top25User(TYPES.LARGEST_UNCLAIMED),
	];

	const currentTimestamp = Math.floor(Date.now() / 1000);

	for (const user of users[0]) {
		encodedCall = lscIface.encodeFunctionData('calculateRewards', [user]);

		result = await readOnlyEVMFromMirrorNode(
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const rewards = lscIface.decodeFunctionResult('calculateRewards', result);

		// getActiveBoostRate for user
		encodedCall = lscIface.encodeFunctionData('getActiveBoostRate', [user]);

		const boostRateResult = await readOnlyEVMFromMirrorNode(
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const activeBoostRate = lscIface.decodeFunctionResult(
			'getActiveBoostRate',
			boostRateResult,
		);

		// getBaseRewardRate for user
		encodedCall = lscIface.encodeFunctionData('getBaseRewardRate', [user]);

		const baseRateResult = await readOnlyEVMFromMirrorNode(
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const baseRate = lscIface.decodeFunctionResult(
			'getBaseRewardRate',
			baseRateResult,
		);

		totalLazyEarned += Number(rewards[0]);
		totalEarnRate += Number(rewards[1]);

		// add user to the top25s
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

	const lazyEconomyCacheObj = new lazyEconomyCache(users[0].length, Number(totalItemsStaked[0]), totalLazyEarned / 10 ** lazyDecimals, totalEarnRate / 10 ** lazyDecimals);

	top25s.forEach(top25 => {
		lazyEconomyCacheObj.addTop25(top25);
	});

	if (!supressLogs) {
		console.log('LazyToken:', lazyToken.toString(), 'Decimal:', lazyTokenDetails.decimals);
		console.log('getStakingUsers:', users[0].length);
		console.log('totalItemsStaked:', Number(totalItemsStaked[0]));
		console.log('Total Lazy Earned:', totalLazyEarned / 10 ** lazyDecimals, 'Total Earn Rate:', totalEarnRate / 10 ** lazyDecimals);
	}

	// getStakableCollections
	encodedCall = lscIface.encodeFunctionData('getStakableCollections', []);

	result = await readOnlyEVMFromMirrorNode(
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const collections = lscIface.decodeFunctionResult(
		'getStakableCollections',
		result,
	);

	// getNumStakedNFTs for each collection to see how many NFTs are staked
	// get the TokenDetails and show % staked

	for (const collection of collections[0]) {
		encodedCall = lscIface.encodeFunctionData('getNumStakedNFTs', [collection]);

		result = await readOnlyEVMFromMirrorNode(
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const numStaked = lscIface.decodeFunctionResult('getNumStakedNFTs', result);

		const collectionDetails = await getTokenDetails(
			TokenId.fromSolidityAddress(collection),
		);

		lazyEconomyCacheObj.addCollection(new nftCollection(collectionDetails.name, collectionDetails.symbol, Number(collectionDetails.total_supply), Number(numStaked[0])));

		if (!supressLogs) {
			console.log(
				`Collection: ${collectionDetails.name} [${
					collectionDetails.symbol
				}] has ${numStaked[0]} NFTs staked (${
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
};

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

/**
 * Get the token decimal form mirror
 * @param {string} env
 * @param {TokenId|string} _tokenId
 * @returns {Object} details of the token
 */
async function getTokenDetails(_tokenId) {
	const tokenAsString = typeof _tokenId === 'string' ? _tokenId : _tokenId.toString();
	const baseUrl = getBaseURL(env);
	const url = `${baseUrl}/api/v1/tokens/${tokenAsString}`;
	let rtnVal = null;
	await axios.get(url)
		.then((response) => {
			const jsonResponse = response.data;
			rtnVal = {
				symbol: jsonResponse.symbol,
				name: jsonResponse.name,
				decimals: jsonResponse.decimals,
				total_supply: jsonResponse.total_supply,
				treasury_account_id: jsonResponse.treasury_account_id,
				type: jsonResponse.type,
			};
		})
		.catch(function(err) {
			console.error(err);
			return null;
		});

	return rtnVal;
}

/**
 * @param {String} env
 * @param {ContractId} contractId
 * @param {String} data command and parameters encoded as a string
 * @param {AccountId | string} from
 * @param {Boolean} estimate gas estimate
 * @param {Number} gas gas limit
 * @returns {String} encoded result
 */
async function readOnlyEVMFromMirrorNode(contractId, data, from, estimate = true, gas = 300_000) {
	const baseUrl = getBaseURL();

	// if from is a string convert it to an AccountId
	if (typeof from === 'string') {
		from = AccountId.fromString(from);
	}

	// if contractId is a string convert it to a ContractId
	if (typeof contractId === 'string') {
		contractId = ContractId.fromString(contractId);
	}

	const body = {
		'block': 'latest',
		'data': data,
		'estimate': estimate,
		'from': from.toSolidityAddress(),
		'gas': gas,
		'gasPrice': 100000000,
		'to': contractId.toSolidityAddress(),
		'value': 0,
	};

	const url = `${baseUrl}/api/v1/contracts/call`;

	const response = await axios.post(url, body);

	return response.data?.result;
}

function getBaseURL() {
	if (env.toLowerCase() == 'test' || env.toLowerCase() == 'testnet') {
		return 'https://testnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'main' || env.toLowerCase() == 'mainnet') {
		return 'https://mainnet-public.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'preview' || env.toLowerCase() == 'previewnet') {
		return 'https://previewnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'local') {
		return 'http://localhost:8000';
	}
	else {
		throw new Error('ERROR: Must specify either MAIN, TEST, LOCAL or PREVIEW as environment');
	}
}

function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

main()
	.then(() => {
		if (!supressLogs) console.log('INFO: Completed @', new Date().toUTCString());
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
