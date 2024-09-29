const {
	AccountId,
	ContractId,
	Client,
	PrivateKey,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const readlineSync = require('readline-sync');
const { ethers } = require('ethers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { checkMirrorBalance } = require('../../utils/hederaMirrorHelpers');

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

const env = process.env.ENVIRONMENT ?? null;
let client;

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
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: retrieveLazyFromContract.js 0.0.CCC 0.0.DDD');
		console.log('       CCC is the contract address');
		console.log('       DDD is the destination address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const destination = AccountId.fromString(args[1]);
	
	const lazyToken = process.env.LAZY_TOKEN_ID;

	if (lazyToken === undefined || lazyToken == null) {
		console.log('ERROR: Must specify LAZY_TOKEN_ID in the .env file');
		process.exit(1);
	}
	// get the contract $LAZY balance from mirror node
	const lazyBalance = await checkMirrorBalance(env, contractId, process.env.LAZY_TOKEN_ID);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using Destination:', destination.toString());
	console.log('\n-Using Lazy Token:', lazyToken);
	console.log('\n-Contract Lazy Balance:', lazyBalance);

	// ask user the percentage of the balance to retrieve
	const percentage = parseFloat(readlineSync.question('Enter the percentage of the balance to retrieve: '));

	if (isNaN(percentage) || percentage < 0 || percentage > 100) {
		console.log('ERROR: Must specify a valid percentage');
		process.exit(1);
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('Executing in *MAINNET* #liveAmmo');
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

	// calculate the amount to retrieve
	const amount = Math.floor(lazyBalance * (percentage / 100));

	// creat interface from fragment
	const methodFragment =  {
        "inputs": [
            {
                "internalType": "address",
                "name": "_receiver",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            }
        ],
        "name": "retrieveLazy",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    };


	const contractIface = new ethers.Interface([methodFragment]);

	// execute the retrieveLazy method
	const result = await contractExecuteFunction(
		contractId,
		contractIface,
		client,
		null,
		'retrieveLazy',
		[destination.toSolidityAddress(), amount],
	);

	console.log('Tx:', result[0].status.toString(), 'txId:', result[2].transactionId.toString());
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
