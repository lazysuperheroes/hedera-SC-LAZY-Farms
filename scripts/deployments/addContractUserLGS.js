const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
require('dotenv').config();

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

const lazyGasStationName = 'LazyGasStation';

const env = process.env.ENVIRONMENT ?? null;
let client;
let lazyGasStationId;
let lgsIface;

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

	console.log('\n-Using ENIVRONMENT:', env);

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Updating in *MAINNET* #liveAmmo');
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

	// expect two arguments supplied to the command the LGS and the user to add
	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: addContractUserLGS.js 0.0.LGS 0.0.USER');
		console.log('       LGS is the LazyGasStation address');
		console.log('       USER is the address to add as a contract user');
		return;
	}

	lazyGasStationId = ContractId.fromString(args[0]);
	const contractUser = ContractId.fromString(args[1]);

	client.setOperator(operatorId, operatorKey);
	// deploy the contract
	console.log('\n-Using Operator:', operatorId.toString());

	console.log('-Using Lazy Gas Station Contract:', lazyGasStationId.toString());

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	lgsIface = new ethers.Interface(lazyGasStationJSON.abi);

	let encodedCommand = lgsIface.encodeFunctionData('getAdmins', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		lazyGasStationId,
		encodedCommand,
		operatorId,
		false,
	);

	const admins = lgsIface.decodeFunctionResult(
		'getAdmins',
		result,
	);

	console.log('Admins:', admins[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 2) getAuthorizers

	encodedCommand = lgsIface.encodeFunctionData('getAuthorizers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		lazyGasStationId,
		encodedCommand,
		operatorId,
		false,
	);

	const authorizers = lgsIface.decodeFunctionResult(
		'getAuthorizers',
		result,
	);

	console.log('Authorizers:', authorizers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 3) getContractUsers

	encodedCommand = lgsIface.encodeFunctionData('getContractUsers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		lazyGasStationId,
		encodedCommand,
		operatorId,
		false,
	);

	const contractUsers = lgsIface.decodeFunctionResult(
		'getContractUsers',
		result,
	);

	console.log('Contract Users:', contractUsers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	const proceed = readlineSync.keyInYNStrict('Do you want to add the contract user?');

	if (!proceed) {
		console.log('Exiting...');
		return;
	}

	// add the Boost Manager to the lazy gas station as a contract user
	rslt = await contractExecuteFunction(
		lazyGasStationId,
		lgsIface,
		client,
		null,
		'addContractUser',
		[contractUser.toSolidityAddress()],
	);

	if (rslt[0]?.status.toString() != 'SUCCESS') {
		console.log('ERROR adding Boost Manager to LGS:', rslt);
		return;
	}

	console.log('Contract User added to Lazy Gas Station:', rslt[2].transactionId.toString());

};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
