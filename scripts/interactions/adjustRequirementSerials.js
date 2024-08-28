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
		console.log('Usage: adjustRequirementSerials.js 0.0.MMMM 0.0.TTT 1,2,5 add|remove');
		console.log('		MMM is the mission address');
		console.log('		TTT is the token Id for the requirement');
		console.log('		1,2,5 list of serials to add/remove restrictions');
		console.log('		add|remove to specify the action');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const tokenId = TokenId.fromString(args[1]);
	const serials = args[2].split(',').map((s) => parseInt(s));
	let add, method;
	if (args[3] == 'add') {
		add = true;
		method = 'addRequirementSerials';
	}
	else if (args[3] == 'remove') {
		add = false;
		method = 'removeRequirementSerials';
	}
	else {
		console.log('Invalid action. Must be add or remove');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using Token:', tokenId.toString());
	console.log('\n-Using Serials:', serials);
	console.log('\n-Action:', add ? 'Add' : 'Remove');

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);


	const proceed = readlineSync.keyInYNStrict('Do you want to adjust serial restrictions for requirements?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		800_000,
		method,
		[tokenId.toSolidityAddress(), serials],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error adding serials restrictions:', result);
		return;
	}

	console.log('Added Requirement Serials Restrictions. Transaction ID:', result[2]?.transactionId?.toString());
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
