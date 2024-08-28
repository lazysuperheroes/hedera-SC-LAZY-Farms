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
const { getContractEVMAddress, checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
let lazyTokenId;
let boostManagerId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

try {
	lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	boostManagerId = AccountId.fromString(process.env.BOOST_MANAGER_CONTRACT_ID);
}
catch (err) {
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
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: leaveMission.js 0.0.MMMM');
		console.log('		MMM is the mission address');
		return;
	}

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString(), 'HAPI:', args[0]);

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

	console.log('Mission Completes:', userEnd, '->', new Date(userEnd * 1000).toISOString());

	if (userEnd < Date.now() / 1000) {
		console.log('Mission completed. Try claiming rewards instead');
		return;
	}

	console.log('To withdraw you need an allowance to the Mission for HBAR dust');

	console.log('\nChecking Allowances...');
	// check if the user has HBAR allowance to Mission to facilitate unstaking
	let found = false;
	let boostFound = false;

	const mirrorHbarAllowances = await checkHbarAllowances(env, operatorId);
	for (let a = 0; a < mirrorHbarAllowances.length; a++) {
		const allowance = mirrorHbarAllowances[a];
		// console.log('Hbar Allowance found:', allowance.owner, allowance.spender);
		if (allowance.spender == contractId.toString()) {
			if (allowance.amount >= 10) {
				console.log('FOUND: Sufficient Hbar allowance to Mission', allowance.amount);
				found = true;
			}
		}
		else if (allowance.spender == boostManagerId.toString()) {
			if (allowance.amount >= 1) {
				console.log('FOUND: Sufficient Hbar allowance to Boost Manager', allowance.amount);
				boostFound = true;
			}
		}
	}

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

		if (result != 'SUCCESS') {
			console.log('Error setting HBAR allowance to Mission:', result);
			return;
		}

		console.log('ALLOWANCE SET: 10 tinybar allowance to Mission');
	}

	if (!boostFound) {
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


	const proceed = readlineSync.keyInYNStrict('Do you want to exit the mission (no rewards)?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}


	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		2_000_000,
		'leaveMission',
		[],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error exiting mission:', result);
		return;
	}

	console.log('Mission Exited. Transaction ID:', result[2]?.transactionId?.toString());
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
