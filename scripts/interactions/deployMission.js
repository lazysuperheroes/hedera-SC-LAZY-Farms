/* eslint-disable prefer-const */
const {
	Client,
	AccountId,
	PrivateKey,
	TokenId,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { sleep } = require('../../utils/nodeHelpers');
const readline = require('readline');

//   readline interface
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

// Color codes
const colors = {
	reset: '\x1b[0m',
	cyan: '\x1b[36m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
};

// Promisify rl.question to use async/await with color
const question = (query, color = colors.reset) => new Promise((resolve) => rl.question(color + query + colors.reset, resolve));

let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromBytesED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.error(`${colors.red}ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file${colors.reset}`);
	process.exit(1);
}

const contractName = 'MissionFactory';
let client;

const main = async () => {
	const defaultEnvironment = process.env.ENVIRONMENT ? `(type enter to use default: ${process.env.ENVIRONMENT})` : '';
	const environment = await question(`Select the environment TEST, MAIN, PREVIEW, LOCAL ${defaultEnvironment}: `, colors.cyan) || process.env.ENVIRONMENT;

	const defaultContractId = process.env.MISSION_FACTORY_CONTRACT_ID ? `(type enter to use default: ${process.env.MISSION_FACTORY_CONTRACT_ID})` : '';
	const contractIdInput = await question(`Enter the Mission Factory contract ID ${defaultContractId}: `, colors.yellow) || process.env.MISSION_FACTORY_CONTRACT_ID;

	const durationInput = await question('Enter the duration of the mission in seconds: ', colors.cyan);
	const feeInput = await question('Enter the fee in $LAZY: ', colors.yellow);
	const requirementsInput = await question('Enter requirement token IDs (comma separated, no spaces): ', colors.cyan);
	const rewardsInput = await question('Enter reward token IDs (comma separated, no spaces): ', colors.yellow);
	const burnInput = await question('Enter the burn % of LAZY fees when entering the mission (0-100): ', colors.cyan);
	const expiryInput = await question('Enter the timestamp for expiry: ', colors.yellow);
	const numReqInput = await question('Enter the number of requirements to enter the mission: ', colors.cyan);
	const numRewInput = await question('Enter the number of rewards for a user: ', colors.yellow);
	rl.close();

	// ASCII Rocket
	console.log(`
        ${colors.yellow}         
         |
         |
        / \\
       / _ \\
      |.o '.|
      |'._.'|
      |  🗲   |
     ,'|  |  |'.
    /  |  |  |  \\
    |,-'--|--'-.|${colors.reset}
    `);

	// Parse inputs
	const contractId = ContractId.fromString(contractIdInput);
	const duration = parseInt(durationInput);
	const fee = parseInt(feeInput);
	const requirements = requirementsInput.split(',');
	const rewards = rewardsInput.split(',');
	const burn = parseInt(burnInput);
	const expiry = parseInt(expiryInput);
	const numReq = parseInt(numReqInput);
	const numRew = parseInt(numRewInput);

	// Configure client based on environment
	switch (environment.toUpperCase()) {
	case 'TEST': {
		client = Client.forTestnet();
		break;
	}
	case 'MAIN': {
		client = Client.forMainnet();
		break;
	}
	case 'PREVIEW': {
		client = Client.forPreviewnet();
		break;
	}
	case 'LOCAL': {
		let node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		break;
	}
	}

	client.setOperator(operatorId, operatorKey);

	const reqTokenAsSolidityList = requirements.map(tokenId => TokenId.fromString(tokenId).toSolidityAddress());
	const rewTokenAsSolidityList = rewards.map(tokenId => TokenId.fromString(tokenId).toSolidityAddress());

	// Import ABI
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
		3_000_000,
		'deployMission',
		[
			duration,
			fee,
			reqTokenAsSolidityList,
			rewTokenAsSolidityList,
			burn,
			expiry,
			numReq,
			numRew,
		],
	);
	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.error('ERROR: Transaction failed');
		return;
	}

	const missionContract = ContractId.fromEvmAddress(0, 0, result[1][0]);
	// Wait for the contract to be created and populated to mirrors
	await sleep(5000);
	const missionId = await missionContract.populateAccountNum(client);

	console.log('Mission deployed:', missionId.toString());
};

main()
	.then(() => {
		console.log('Process completed successfully.');
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});

