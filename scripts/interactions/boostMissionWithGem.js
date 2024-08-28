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
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');
const { setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const boostManagerName = 'BoostManager';
const missionName = 'Mission';

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
	if (args.length != 4 || getArgFlag('h')) {
		console.log('Usage: boostMissionWithLazy.js 0.0.BBBB 0.0.MMMM 0.0.GGG <serial>');
		console.log('		BBBB is the boost manager address');
		console.log('		MMMM is the mission address');
		console.log('		GGG is the collection address of the boost Gem');
		console.log('		<serial> is the serial number of the NFT');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const missionAsEVM = await getContractEVMAddress(env, args[1]);
	const missionId = ContractId.fromEvmAddress(0, 0, missionAsEVM);
	const gemId = TokenId.fromString(args[2]);
	const serial = Number(args[3]);


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Boost Manager:', contractId.toString());
	console.log('\n-Using Mission:', missionId.toString(), '->', args[1]);
	console.log('\n-Using Gem:', gemId.toString());
	console.log('\n-Using Serial:', serial);

	// import ABI
	const boostJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${boostManagerName}.sol/${boostManagerName}.json`,
		),
	);

	const boostIface = new ethers.Interface(boostJSON.abi);

	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${missionName}.sol/${missionName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	// get current end time from Mission using getUserEndAndBoost via mirror node
	let encodedCommand = missionIface.encodeFunctionData('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	let result = await readOnlyEVMFromMirrorNode(
		env,
		missionId,
		encodedCommand,
		operatorId,
		false,
	);


	const currentEndAndBoost = missionIface.decodeFunctionResult('getUserEndAndBoost', result);

	const currEndTimestamp = Number(currentEndAndBoost[0]);
	if (currEndTimestamp == 0) {
		console.log('User is not on this mission. Exiting...');
		return;
	}
	else if (currEndTimestamp < Math.floor(Date.now() / 1000)) {
		console.log('User has completed this mission. No need to Boost. Exiting...');
		return;
	}

	console.log('User has Boosted:', Boolean(currentEndAndBoost[1]));

	if (currentEndAndBoost[1]) {
		console.log('exiting...');
		return;
	}


	console.log('User current end:', currEndTimestamp, '->', new Date(currEndTimestamp * 1000).toISOString());
	// show user time remaining
	const timeRemaining = currEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('User time remaining:', timeRemaining, 'seconds ->', Math.floor(timeRemaining / 60), 'minutes ->', Math.floor(timeRemaining / 3600), 'hours ->', Math.floor(timeRemaining / 86400), 'days');

	// check the reduction via getBoostLevel
	encodedCommand = boostIface.encodeFunctionData('getBoostLevel', [
		gemId.toSolidityAddress(),
		serial,
	]);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const reduction = boostIface.decodeFunctionResult('getBoostLevel', result);

	console.log('Gem is Boost level:', lookupLevel(Number(reduction[0])));

	// use getBoostData for the level to find the reduction time
	encodedCommand = boostIface.encodeFunctionData('getBoostData', [
		Number(reduction[0]),
	]);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostData = boostIface.decodeFunctionResult('getBoostData', result);

	console.log('This boost reduces your time remaining by:', Number(boostData[3]), '%');


	const proceed = readlineSync.keyInYNStrict('Do you want to Boost with Gem NFT (NFT returned on exit)?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	// set NFT allowance to BoostManager
	// set NFT allowance
	result = await setNFTAllowanceAll(
		client,
		[gemId],
		operatorId,
		contractId,
	);

	if (result != 'SUCCESS') {
		console.log('Error setting NFT allowance:', result);
		return;
	}

	result = await contractExecuteFunction(
		contractId,
		boostIface,
		client,
		800_000,
		'boostWithGemCards',
		[missionId.toSolidityAddress(), gemId.toSolidityAddress(), serial],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error boosting:', result);
		return;
	}

	console.log('Boosted!. Transaction ID:', result[2]?.transactionId?.toString());

	// get current end time from Mission using getUserEndAndBoost via mirror node
	encodedCommand = missionIface.encodeFunctionData('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	result = await readOnlyEVMFromMirrorNode(
		env,
		missionId,
		encodedCommand,
		operatorId,
		false,
	);

	const newEndAndBoost = missionIface.decodeFunctionResult('getUserEndAndBoost', result);

	console.log('User has Boosted:', Boolean(newEndAndBoost[1]));

	const newEndTimestamp = Number(newEndAndBoost[0]);

	console.log('User new end:', newEndTimestamp, '->', new Date(newEndTimestamp * 1000).toISOString());
	// show user time remaining
	const newTimeRemaining = newEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('User time remaining:', newTimeRemaining, 'seconds ->', Math.floor(newTimeRemaining / 60), 'minutes ->', Math.floor(newTimeRemaining / 3600), 'hours ->', Math.floor(newTimeRemaining / 86400), 'days');
};


main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
