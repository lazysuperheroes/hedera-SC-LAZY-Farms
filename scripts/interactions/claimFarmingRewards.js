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
const { setHbarAllowance } = require('../../utils/hederaHelpers');
const { checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
let lazyTokenId;
let boostManagerId;

try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

try {
	lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	boostManagerId = AccountId.fromString(process.env.BOOST_MANAGER_CONTRACT_ID);
}
catch {
	console.log('ERROR: Must specify LAZY_TOKEN_ID & BOOST_MANAGER_CONTRACT_ID in the .env file');
}

const contractName = 'Mission';

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

	// check Lazy and LGS are set
	if (
		lazyTokenId === undefined ||
		lazyTokenId == null ||
		boostManagerId === undefined ||
		boostManagerId == null
	) {
		console.log(
			'Environment required, please specify LAZY_TOKEN_ID & BOOST_MANAGER_CONTRACT_ID in the .env file',
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
		console.log('Usage: claimFarmingRewards.js 0.0.MMMM');
		console.log('		MMM is the mission address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	// check the end time to ensure it is worth claiming
	// using getUserEndAndBoost from mirror
	const encodedCommand = missionIface.encodeFunctionData(
		'getUserEndAndBoost',
		[operatorId.toSolidityAddress()],
	);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const userEndAndBoost = missionIface.decodeFunctionResult('getUserEndAndBoost', result);
	const userEnd = Number(userEndAndBoost[0]);
	const userBoost = Boolean(userEndAndBoost[1]);

	console.log('Mission Completes:', userEnd, '->', new Date(userEnd * 1000).toISOString(), 'Boost:', userBoost);

	if (userEnd > Date.now() / 1000) {
		console.log('Mission not yet completed');
		return;
	}

	console.log('Mission Completed - to withdraw you need an allowance to the Mission for hbar');

	console.log('\nChecking Allowances...');
	// check if the user has an hbar allowance to the mission
	let found = false;
	let boostFound = false;
	const hbarAllowances = await checkHbarAllowances(client, operatorId);
	hbarAllowances.forEach((allowance) => {
		if (allowance.accountId.toString() == operatorId.toString()) {
			found = true;
		}
		if (allowance.accountId.toString() == boostManagerId.toString()) {
			boostFound = true;
		}
	});

	if (!found) {
		console.log('ERROR: Insufficient HBAR allowance to Mission');
		const proceed = readlineSync.keyInYNStrict('Do you want to set the allowance?');
		if (!proceed) {
			console.log('User Aborted');
			return;
		}
		// set allowance to the Gas Station for the fee
		result = await setHbarAllowance(
			client,
			operatorId,
			contractId,
			10,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error setting HBAR allowance to LGS:', result);
			return;
		}

		console.log('ALLOWANCE SET: 10 Tinybar allowance to Mission');
	}

	if (userBoost) {
		// check if the boost is via a Gem
		// call getUsersBoostInfo form Mission
		const boostCommand = missionIface.encodeFunctionData(
			'getUsersBoostInfo',
			[operatorId.toSolidityAddress()],
		);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			boostCommand,
			operatorId,
			false,
		);

		const boostInfo = missionIface.decodeFunctionResult('getUsersBoostInfo', result);
		const boostType = Number(boostInfo[0]);

		if (boostType == 2) {
			console.log('Mission has a boost, you will need to have an allowance to the boost manager too');
			if (!boostFound) {
				console.log('ERROR: Insufficient HBAR allowance to Boost Manager');
				const proceed = readlineSync.keyInYNStrict('Do you want to set the allowance?');
				if (!proceed) {
					console.log('User Aborted');
					return;
				}
				// set allowance to the Gas Station for the fee
				result = await setHbarAllowance(
					client,
					operatorId,
					boostManagerId,
					1,
				);

				if (result[0]?.status?.toString() != 'SUCCESS') {
					console.log('Error setting HBAR allowance to Boost Manager:', result);
					return;
				}

				console.log('ALLOWANCE SET: 1 Tinybar allowance to Boost Manager');
			}
		}
	}


	const proceed = readlineSync.keyInYNStrict('Do you want to claim rewards and exit the mission?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}


	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		2_000_000,
		'claimRewards',
		[],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error claiming & exiting mission:', result);
		return;
	}

	console.log('Rewards Claimed. Transaction ID:', result[2]?.transactionId?.toString());
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
