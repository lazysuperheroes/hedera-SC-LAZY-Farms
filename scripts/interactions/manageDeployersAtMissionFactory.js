const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');

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

const contractName = 'MissionFactory';

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
		console.log('Usage: manageDeployersAtMissionFactory.js 0.0.MMMM 0.0.DDD1,0.0.DDD2 [1|0]');
		console.log('       MMMM is the mission factory address');
		console.log('       DDD1,DDD2 are the deployer addresses (comma separated - no spaces)');
		console.log('       1 to add, 0 to remove');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const deployerAddressList = args[1].split(',');
	let add;
	if (args[2] == '1') {
		add = true;
	}
	else if (args[2] == '0') {
		add = false;
	}
	else {
		console.log('Usage: manageDeployersAtMissionFactory.js 0.0.MMMM 0.0.AAAA [add|remove]');
		console.log(args[2], 'is not a valid action');
		return;
	}

	const deployerAccountIds = deployerAddressList.map((addr) => AccountId.fromString(addr).toString());
	const deployerSolidityAddresses = deployerAddressList.map((addr) => AccountId.fromString(addr).toSolidityAddress());

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Proposed Deployers:', deployerAccountIds);
	console.log('\n-Action:', add ? 'add' : 'remove');

	const proceed = readlineSync.keyInYNStrict('Do you want to change deployers?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionFactoryIface = new ethers.Interface(missionJSON.abi);


	// deployMission
	const result = await contractExecuteFunction(
		contractId,
		missionFactoryIface,
		client,
		null,
		'updateDeployers',
		[
			deployerSolidityAddresses,
			add,
		],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.error('ERROR: Transaction failed', result);
		return;
	}

	console.log('Deployers updated - Tx Id:', result[2].transactionId.toString());

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
