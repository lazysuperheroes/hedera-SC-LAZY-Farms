/**
 * Deploy PrngSystemContract as a standalone contract.
 * The PRNG contract has no constructor arguments.
 *
 * Requires in .env:
 *   ENVIRONMENT  - test | main | preview | local
 *   ACCOUNT_ID   - operator Hedera account ID
 *   PRIVATE_KEY  - ED25519 private key
 *
 * After deployment, save the printed contract ID as PRNG_CONTRACT_ID in .env
 * for use by other deployment scripts.
 */
const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { contractDeployFunction } = require('../../utils/solidityHelpers');

require('dotenv').config();

const prngName = 'PrngSystemContract';
const GAS_LIMIT = 2_500_000;

// Load operator credentials
let operatorKey;
let operatorId;

try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	if (!operatorKey || !operatorId) {
		console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	let client;

	console.log('\n- Using ENVIRONMENT:', env);

	if (env.toUpperCase() === 'TEST') {
		client = Client.forTestnet();
		console.log('Deploying to *TESTNET*');
	}
	else if (env.toUpperCase() === 'MAIN') {
		client = Client.forMainnet();
		console.log('Deploying to *MAINNET*');
	}
	else if (env.toUpperCase() === 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('Deploying to *PREVIEWNET*');
	}
	else if (env.toUpperCase() === 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('Deploying to *LOCAL*');
	}
	else {
		console.log('ERROR: Must specify MAIN, TEST, PREVIEW, or LOCAL as ENVIRONMENT in .env file');
		process.exit(1);
	}

	client.setOperator(operatorId, operatorKey);

	console.log('\n- Using Operator:', operatorId.toString());

	// Warn if a PRNG contract ID is already set in .env
	if (process.env.PRNG_CONTRACT_ID) {
		console.log('\nWARNING: PRNG_CONTRACT_ID is already set in .env:', process.env.PRNG_CONTRACT_ID);
		const overwrite = readlineSync.keyInYNStrict('An existing PRNG contract ID is configured. Do you still want to deploy a new one?');
		if (!overwrite) {
			console.log('Aborting.');
			return;
		}
	}

	console.log('\n- Contract    :', prngName);
	console.log('- Gas Limit   :', GAS_LIMIT.toLocaleString());
	console.log('- No constructor arguments required.\n');

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy a new PrngSystemContract?');
	if (!proceed) {
		console.log('Aborting.');
		return;
	}

	// Load compiled bytecode from Hardhat artifacts
	const prngJson = JSON.parse(
		fs.readFileSync(`./artifacts/contracts/${prngName}.sol/${prngName}.json`),
	);
	const prngBytecode = prngJson.bytecode;

	console.log('\n- Deploying', prngName, '@ gas', GAS_LIMIT, '...');

	const [prngId] = await contractDeployFunction(client, prngBytecode, GAS_LIMIT);

	const prngContractId = ContractId.fromString(prngId.toString());

	console.log('\n✔  PrngSystemContract deployed successfully!');
	console.log('   Contract ID         :', prngContractId.toString());
	console.log('   EVM / Solidity addr :', prngContractId.toSolidityAddress());
	console.log('\nSave the following line to your .env file:');
	console.log(`   PRNG_CONTRACT_ID=${prngContractId.toString()}`);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
