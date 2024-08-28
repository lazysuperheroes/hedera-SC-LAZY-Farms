const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers');

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
const boostManagerName = 'BoostManager';

const env = process.env.ENVIRONMENT ?? null;
const LAZY_BURN_PERCENT = process.env.LAZY_BURN_PERCENT ?? 25;

let boostManagerId, ldrId;
let lazyTokenId;
let client;
let lazyGasStationId;

try {
	ldrId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
	lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
}
catch (err) {
	console.log('ERROR: Must specify LDR_CONTRACT_ID, LAZY_TOKEN_ID, and LAZY_GAS_STATION_CONTRACT_ID in the .env file');
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

	const boostManagerJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${boostManagerName}.sol/${boostManagerName}.json`,
		),
	);


	console.log('LAZY_BURN_PERCENT (env) ->', process.env.LAZY_BURN_PERCENT);
	console.log('LAZY_BURN_PERCENT (to use) ->', LAZY_BURN_PERCENT);
	console.log('LAZY_DELEGATE_REGISTRY ->', ldrId.toString());
	console.log('LAZY_TOKEN_ID ->', lazyTokenId.toString());
	console.log('LAZY_GAS_STATION_CONTRACT_ID ->', lazyGasStationId.toString());

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy a new Boost Manager?');

	if (!proceed) {
		console.log('Aborting');
		return;
	}

	const gasLimit = 1_800_000;
	console.log(
		'\n- Deploying contract...',
		boostManagerName,
		'\n\tgas@',
		gasLimit,
	);

	const boostManagerBytecode = boostManagerJson.bytecode;

	const boostManagerParams = new ContractFunctionParameters()
		.addAddress(lazyTokenId.toSolidityAddress())
		.addAddress(lazyGasStationId.toSolidityAddress())
		.addAddress(ldrId.toSolidityAddress())
		.addUint256(LAZY_BURN_PERCENT);

	[boostManagerId] = await contractDeployFunction(
		client,
		boostManagerBytecode,
		gasLimit,
		boostManagerParams,
	);

	console.log(
		`Boost Manager contract created with ID: ${boostManagerId} / ${boostManagerId.toSolidityAddress()}`,
	);
};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
