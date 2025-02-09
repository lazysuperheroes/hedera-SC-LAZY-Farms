const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { homebrewPopulateAccountEvmAddress } = require('../../utils/hederaMirrorHelpers');
// const { hethers } = require('@hashgraph/hethers');
require('dotenv').config();

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
const contractName = 'MissionFactory';

const env = process.env.ENVIRONMENT ?? null;

let factoryContractId;
let client;

try {
	factoryContractId = ContractId.fromString(process.env.MISSION_FACTORY_CONTRACT_ID);
}
catch {
	console.log('ERROR: Must specify MISSION_FACTORY_CONTRACT_ID in the .env file');
}

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

	// check there is a parameter on the command line for the new user else output the help message
	const args = process.argv.slice(2);
	if (args.length < 1 || getArgFlag('h')) {
		console.log('Usage: node removeAdminFromMissionFactory.js.js 0.0.XXX');
		process.exit(1);
	}

	console.log('\n-Using ENIVRONMENT:', env);

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
	// deploy the contract
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Factory Contract:', factoryContractId.toString());

	const newUser = AccountId.fromString(args[0]);
	const userAsEVM = await homebrewPopulateAccountEvmAddress(env, newUser);
	console.log('\n-Adding Admin:', newUser.toString(), 'EVM:', userAsEVM);

	const proceed = readlineSync.keyInYNStrict('Do you want to remove the admin from mission factory?');

	if (!proceed) {
		console.log('Aborting');
		return;
	}

	// now update the mission Factory with the new mission template
	const missionFactoryJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionFactoryIface = new ethers.Interface(missionFactoryJson.abi);

	const rslt = await contractExecuteFunction(
		factoryContractId,
		missionFactoryIface,
		client,
		null,
		'removeAdmin',
		[userAsEVM],
	);

	if (rslt[0]?.status?.toString() != 'SUCCESS') {
		console.log('Failed to remove Admin:', rslt);
		return;
	}

	console.log('Admin removed:', rslt[2].transactionId.toString());

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
