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
const { setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { getSerialsOwned, getTokenDetails } = require('../../utils/hederaMirrorHelpers');

// Prompt for operator details if not found in .env file
let operatorKey;
let operatorId;
const contractName = 'Mission';

if (process.env.PRIVATE_KEY && process.env.ACCOUNT_ID) {
	try {
		operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
		operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	}
	catch (err) {
		console.log('ERROR: Invalid PRIVATE_KEY or ACCOUNT_ID in the .env file.');
		process.exit(1);
	}
}
else {
	console.log('Please enter your Hedera account details.');
	const privateKeyInput = readlineSync.question('Enter your private key (ED25519 format): ');
	const accountIdInput = readlineSync.question('Enter your account ID (e.g., 0.0.1234): ');

	try {
		operatorKey = PrivateKey.fromStringED25519(privateKeyInput);
		operatorId = AccountId.fromString(accountIdInput);
	}
	catch (err) {
		console.log('ERROR: Invalid input for PRIVATE_KEY or ACCOUNT_ID.');
		process.exit(1);
	}
}

console.log('\n-Using Operator:', operatorId.toString());

// Suggest ENVIRONMENT from process.env and allow user to confirm or enter a new value
let env = process.env.ENVIRONMENT;
const suggestedEnv = env ? ` (${env})` : '';
env = readlineSync.question(`Enter the environment you are using (TEST, MAIN, PREVIEW, LOCAL)${suggestedEnv}: `) || env;

if (!env) {
	console.log('ERROR: Environment is required. Please specify TEST, MAIN, PREVIEW, or LOCAL.');
	process.exit(1);
}

let client;

if (env.toUpperCase() == 'TEST') {
	client = Client.forTestnet();
	console.log('testing in *TESTNET*');
}
else if (env.toUpperCase() == 'MAIN') {
	client = Client.forMainnet();
	console.log('running in *MAINNET*');
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
	process.exit(1);
}

const main = async () => {

	client.setOperator(operatorId, operatorKey);
	console.log('-Using ENVIRONMENT:', env.toUpperCase());

	// User inputs for contract ID, token ID, and serials
	const contractIdInput = readlineSync.question('Enter the contract ID (e.g., 0.0.1234): ');
	const tokenIdInput = readlineSync.question('Enter the token ID (e.g., 0.0.5678): ');

	const contractId = ContractId.fromString(contractIdInput);
	const tokenId = TokenId.fromString(tokenIdInput);

	// check the token is correct via mirror node
	const tokenInfo = await getTokenDetails(env, tokenId);
	if (tokenInfo == null) {
		console.log('Token not found:', tokenId.toString());
		process.exit(0);
	}

	console.log('Token Info:', tokenInfo);

	const confirmedToken = readlineSync.keyInYNStrict('Is this the correct token?');

	if (!confirmedToken) {
		console.log('User aborted.');
		process.exit(0);
	}

	// get list of owned serials from mirror node for the token
	let serialsList = await getSerialsOwned(env, operatorId, tokenId);

	if (serialsList.length == 0) {
		console.log('No serials found for the token.');
		process.exit(0);
	}
	else if (serialsList.length < 50) {
		console.log('Found:', serialsList.length, '\n\nserials:', serialsList);
	}
	else {
		// loop the serials and capture the min and max
		let minSerial = serialsList[0];
		let maxSerial = serialsList[0];
		serialsList.forEach(serial => {
			if (serial < minSerial) {
				minSerial = serial;
			}
			if (serial > maxSerial) {
				maxSerial = serial;
			}
		});
		console.log('Found:', serialsList.length, 'range:', minSerial, 'to', maxSerial);
	}

	const randomSerials = readlineSync.keyInYNStrict('Do you want to add random serials?');

	let serials = [];

	if (randomSerials) {
		const numberOfSerials = readlineSync.questionInt('Enter the number of serials to add: ');
		const serialRange = readlineSync.keyInYNStrict('Do you want to pick within a range?: ');

		if (serialRange) {
			const selectSerials = [];
			const startSerial = readlineSync.questionInt('Enter the start serial: ');
			const endSerial = readlineSync.questionInt('Enter the end serial: ');

			for (let i = 0; i < serialsList.length; i++) {
				if (serialsList[i] >= startSerial && serialsList[i] <= endSerial) {
					selectSerials.push(serialsList[i]);
				}
			}
			serialsList = selectSerials;
		}

		if (numberOfSerials > serialsList.length) {
			console.log('Not enough serials to pick from.\n\nRequired:', numberOfSerials, 'Available:', serialsList.length);
			console.log('serials:', serialsList);
			process.exit(0);
		}

		// run the shuffle multiple times to randomize the serials
		serialsList = shuffleArray(serialsList);
		serialsList = shuffleArray(serialsList);
		serialsList = shuffleArray(serialsList);
		serialsList = shuffleArray(serialsList);

		serials = serialsList.slice(0, numberOfSerials);
	}
	else {
		const serialsInput = readlineSync.question('Enter the list of serials to add (comma-separated, e.g., 1,2,5): ');
		serials = serialsInput.split(',').map(s => parseInt(s, 10));
	}

	console.log('\n-Using Contract:', contractId.toString());
	console.log('-Using Token:', tokenId.toString());
	console.log('-Using Serials:', serials);

	// Import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	const proceed = readlineSync.keyInYNStrict('Do you want to add collateral to the mission?');
	if (!proceed) {
		console.log('User aborted.');
		process.exit(0);
	}

	let result = await setNFTAllowanceAll(
		client,
		[tokenId],
		operatorId,
		contractId,
	);

	// Push the reward(s) up
	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		1_200_000,
		'addRewardSerials',
		[tokenId.toSolidityAddress(), serials],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error adding reward serials:', result);
		return;
	}

	console.log('Added Reward Serials. Transaction ID:', result[2]?.transactionId?.toString());

	process.exit(0);
};

function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});