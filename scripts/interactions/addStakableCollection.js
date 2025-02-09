const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file', err);
}

const LAZY_TOKEN = process.env.LAZY_TOKEN_ID;

if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
	console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
	process.exit(1);
}

if (LAZY_TOKEN === undefined || LAZY_TOKEN == null) {
	console.log('Environment required, please specify LAZY_TOKEN_ID in the .env file');
	process.exit(1);
}

const contractName = 'LazyNFTStaking';

const env = process.env.ENVIRONMENT ?? null;

let client;

const main = async () => {
	// configure the client object
	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('executing in *MAINNET* #liveAmmo');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('testing in *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: addStakableCollection.js 0.0.SSS 0.0.CCC1,0.0.CCC2,0.0.CCC3 R1,R2,R3');
		console.log('		0.0.SSS is the LazyNFTStaking contract to update');
		console.log('		0.0.CCC1,0.0.CCC2,0.0.CCC3 is the collections to add to the staking contract (comma separated - no spaces)');
		console.log('		R1,R2,R3 is max reward rate per collection (comma separated - no spaces)');
		console.log('		Example: addStakableCollection.js 0.0.12345 0.0.123,0.0.456,0.0.789 1,2,3');
		console.log('		Reward Rate in whole $LAZY that can be earned per period');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const tokenList = args[1].split(',').map((t) => TokenId.fromString(t));
	const tokenListAsSolidity = tokenList.map((t) => t.toSolidityAddress());
	const rewardRates = args[2].split(',').map((r) => parseInt(r));

	// check the token list is <= 12
	if (tokenList.length > 12) {
		console.log('Error: Too many tokens in the list. Max is 12');
		return;
	}

	// check reward rates length is same as token list
	if (tokenList.length !== rewardRates.length) {
		console.log('Error: Reward rates length must match token list length');
		return;
	}

	console.log('\n-**ADDING COLLECTIONS FOR STAKING**');
	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Collection(s):', tokenList.map((t) => t.toString()).join(', '));

	// get the Lazy token info
	const lazyTokenInfo = await getTokenDetails(env, LAZY_TOKEN);

	// for each token, get the token info form the mirror
	for (const token of tokenList) {
		const tokenInfo = await getTokenDetails(env, token.toString());
		console.log('-Token:', token.toString(), 'Symbol:', tokenInfo.symbol, 'Name:', tokenInfo.name, 'Max Reward Rate:', rewardRates[tokenList.indexOf(token)] / 10 ** lazyTokenInfo.decimals, lazyTokenInfo.symbol);
	}

	console.log('\n-Reward Rate:', rewardRates);

	// import ABI
	const lnsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lnsIface = new ethers.Interface(lnsJSON.abi);


	const proceed = readlineSync.keyInYNStrict('Do you want to update the Stakable Collections?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const gas = 300_000 + tokenList.length * 1_000_000;

	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		gas,
		'setStakeableCollection',
		[tokenListAsSolidity, rewardRates],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error adding:', result);
		return;
	}

	console.log('Collections now stakeable. Transaction ID:', result[2]?.transactionId?.toString());

};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
