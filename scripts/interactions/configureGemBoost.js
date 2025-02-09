const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'BoostManager';

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
		console.log('testing in *MAINNET*');
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
		console.log('Usage: configureGemBoost.js 0.0.BBB <rank> <percentage>');
		console.log('		0.0.BBB is the BoostManager contract to update');
		console.log('		<rank> is the boost level (0 - 5 or C|R|SR|UR|LR|SPE)');
		console.log('		<percentage> is the percentage to reduce mission time');
		console.log('		- Must be a number (1-100)%');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	let rank;
	let reductionPercentage;
	try {
		rank = getLevel(args[1]);
		// validate rank is 0-5
		if (rank < 0 || rank > 5) {
			throw new Error('Invalid rank');
		}
		reductionPercentage = parseInt(args[2]);
		// validate percentage
		if (reductionPercentage < 1 || reductionPercentage > 100) {
			throw new Error('Invalid percentage');
		}
	}
	catch (err) {
		console.log('ERROR: Must specify a number for amount and percentage', err);
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Rank:', rank, '(', lookupLevel(rank), ')');
	console.log('\n-Percentage:', reductionPercentage, '%');

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);


	const proceed = readlineSync.keyInYNStrict('Do you want to update the $LAZY boost?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		boostManagerIface,
		client,
		null,
		'setGemBoostReduction',
		[rank, reductionPercentage],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error setting Gem Level:', result);
		return;
	}

	console.log('Gem Level Boost updated. Transaction ID:', result[2]?.transactionId?.toString());
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
