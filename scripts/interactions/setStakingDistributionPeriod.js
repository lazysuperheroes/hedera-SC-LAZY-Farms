const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

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

const contractName = 'LazyNFTStaking';

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
		console.log('Usage: setStakingDistributionPeriod.js 0.0.SSS <period>');
		console.log('		0.0.SSS is the LazyNFTStaking contract to update');
		console.log('		<period> is the new distribution period');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const secondsForDistribution = parseInt(args[1]);

	if (secondsForDistribution < 1) {
		console.log('Invalid distribution Bonus Period:', secondsForDistribution);
		return;
	}

	console.log('\n-**SETTING DISTRIBUTION PERIOD (SECONDS))**');

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-NEW distributionPeriod:', secondsForDistribution, 'seconds (hours:', secondsForDistribution / 3600, ' <-> days:', secondsForDistribution / 86400, ')');

	// import ABI
	const lnsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lnsIface = new ethers.Interface(lnsJSON.abi);

	// get distributionPeriod via mirror node
	const encodedCommand = lnsIface.encodeFunctionData('distributionPeriod');

	const distributionPeriod = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	// decode the result and display in seconds/hours/days
	const currentDistributionPeriod = lnsIface.decodeFunctionResult('distributionPeriod', distributionPeriod);

	console.log('Current Distribution Period:', currentDistributionPeriod, 'seconds (hours:', currentDistributionPeriod / 3600, ' <-> days:', currentDistributionPeriod / 86400, ')');

	const proceed = readlineSync.keyInYNStrict('Do you want to update the Distribution period?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}


	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		null,
		'setDistributionPeriod',
		[secondsForDistribution],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error setting Distribution Perop period:', result);
		return;
	}

	console.log('Updsted DISTRIBUTION PERIO. Transaction ID:', result[2]?.transactionId?.toString());

};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
