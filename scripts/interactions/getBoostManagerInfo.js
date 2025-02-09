const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
}

const contractName = 'BoostManager';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getBoostManagerInfo.js 0.0.BBB');
		console.log('       BB is the boost manager address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	// query the EVM via mirror node (readOnlyEVMFromMirrorNode) to know
	// 1) getDeployedMissions

	let encodedCommand = boostManagerIface.encodeFunctionData('lazyBoostCost', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const cost = boostManagerIface.decodeFunctionResult('lazyBoostCost', result);

	// get the Lazy token ID -> lazyToken

	encodedCommand = boostManagerIface.encodeFunctionData('lazyToken', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const lazyToken = boostManagerIface.decodeFunctionResult('lazyToken', result);
	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);

	// get the decimals of the lazy token
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	console.log('Cost to boost with FT:', Number(cost[0].toString()) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol, '(', lazyTokenId.toString(), ')');

	// check the reduction via lazyBoostReduction
	encodedCommand = boostManagerIface.encodeFunctionData('lazyBoostReduction', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const reduction = boostManagerIface.decodeFunctionResult('lazyBoostReduction', result);

	console.log('Consumable boost reduces your time remaining by:', Number(reduction[0]), '%');

	// get the feeBurnPercentage
	encodedCommand = boostManagerIface.encodeFunctionData('feeBurnPercentage', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const feeBurnPercentage = boostManagerIface.decodeFunctionResult('feeBurnPercentage', result);

	console.log('Fee Burn Percentage:', Number(feeBurnPercentage[0]), '%');

	// missionFactory
	encodedCommand = boostManagerIface.encodeFunctionData('missionFactory', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const missionFactory = boostManagerIface.decodeFunctionResult('missionFactory', result);

	console.log('Mission Factory:', ContractId.fromEvmAddress(0, 0, missionFactory[0]).toString());

	// liveBoosts

	encodedCommand = boostManagerIface.encodeFunctionData('liveBoosts', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const liveBoosts = boostManagerIface.decodeFunctionResult('liveBoosts', result);

	console.log('Live Boosts:', Number(liveBoosts[0]));

	// getGemCollections

	encodedCommand = boostManagerIface.encodeFunctionData('getGemCollections', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const gemCollections = boostManagerIface.decodeFunctionResult('getGemCollections', result);

	console.log('Gem Collections:', gemCollections[0].map((c) => TokenId.fromSolidityAddress(c).toString()).join(', '));

	for (let i = 0; i < 6; i++) {
		// getBoostData(i)

		encodedCommand = boostManagerIface.encodeFunctionData('getBoostData', [i]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const boostData = boostManagerIface.decodeFunctionResult('getBoostData', result);


		console.log('Boost', lookupLevel(i));
		for (let j = 0; j < boostData[0].length; j++) {
			console.log('\tGem:', TokenId.fromSolidityAddress(boostData[0][j]).toString());
			console.log('\t\tSerial Locked:', Boolean(boostData[1][j]));
			console.log('\t\tSerials:', boostData[2][j].map(s => Number(s)).join(', '));
			console.log('\t\tReduction:', Number(boostData[3]), '%\n');
		}
	}
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
