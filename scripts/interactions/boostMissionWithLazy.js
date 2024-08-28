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
const { getTokenDetails, checkFTAllowances, getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { setFTAllowance } = require('../../utils/hederaHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
let lgsId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
	lgsId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID & LAZY_GAS_STATION_CONTRACT_ID in the .env file');
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
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: boostMissionWithLazy.js 0.0.BBBB 0.0.MMMM');
		console.log('		BBBB is the boost manager address');
		console.log('		MMMM is the mission address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const missionAsEVM = await getContractEVMAddress(env, args[1]);
	const missionId = ContractId.fromEvmAddress(0, 0, missionAsEVM);


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Boost Manager:', contractId.toString());
	console.log('\n-Using Mission:', missionId.toString(), '->', args[1]);

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

	console.log('User has Boosted:', Boolean(currentEndAndBoost[1]));

	if (result[1]) {
		console.log('exiting...');
		return;
	}

	const currEndTimestamp = Number(currentEndAndBoost[0]);

	console.log('User current end:', currEndTimestamp, '->', new Date(currEndTimestamp * 1000).toISOString());
	// show user time remaining
	const timeRemaining = currEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('User time remaining:', timeRemaining, 'seconds ->', Math.floor(timeRemaining / 60), 'minutes ->', Math.floor(timeRemaining / 3600), 'hours ->', Math.floor(timeRemaining / 86400), 'days');

	// get the cost in $LAZY to boost
	encodedCommand = boostIface.encodeFunctionData('lazyBoostCost', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const cost = boostIface.decodeFunctionResult('lazyBoostCost', result);

	// get the Lazy token ID -> lazyToken

	encodedCommand = boostIface.encodeFunctionData('lazyToken', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const lazyToken = boostIface.decodeFunctionResult('lazyToken', result);
	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);

	// get the decimals of the lazy token
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	console.log('Cost to enter:', Number(cost[0].toString()) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol, '(', lazyTokenId.toString(), ')');

	// check the reduction via lazyBoostReduction
	encodedCommand = boostIface.encodeFunctionData('lazyBoostReduction', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const reduction = boostIface.decodeFunctionResult('lazyBoostReduction', result);

	console.log('Consumable boost reduces your time remaining by:', Number(reduction[0]), '%');

	// check the user has the approval set to LGS for the cost
	const mirrorFTAllowances = await checkFTAllowances(env, operatorId);

	let found = false;
	for (let a = 0; a < mirrorFTAllowances.length; a++) {
		const allowance = mirrorFTAllowances[a];
		// console.log('FT Allowance found:', allowance.token_id, allowance.owner, allowance.spender);
		if (allowance.token_id == lazyTokenId.toString() && allowance.spender == contractId.toString()) {
			if (allowance.amount >= cost) {
				console.log('FOUND: Sufficient $LAZY allowance to LGS', allowance.amount / Math.pow(10, lazyTokenDetails.decimals));
				found = true;
			}
		}
	}

	if (!found) {
		console.log('ERROR: Insufficient $LAZY allowance to LGS');
		const proceed = readlineSync.keyInYNStrict('Do you want to set the allowance?');
		if (!proceed) {
			console.log('User Aborted');
			return;
		}
		// set allowance to the Gas Station for the fee
		result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lgsId,
			cost,
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Error setting $LAZY allowance to LGS:', result);
			return;
		}

		console.log(`ALLOWANCE SET: ${cost / 10 ** lazyTokenDetails.decimals} ${lazyTokenDetails.symbol} allowance to LGS ${lgsId.toString()}`);
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to Boost with $LAZY (consumable boost)?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	result = await contractExecuteFunction(
		contractId,
		boostIface,
		client,
		500_000,
		'boostWithLazy',
		[missionId.toSolidityAddress()],
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
