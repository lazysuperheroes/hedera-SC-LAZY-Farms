const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractDeployFunction, contractExecuteFunction, contractExecuteQuery } = require('../../utils/solidityHelpers');
const { verifyContract } = require('@lazysuperheroes/hedera-verify');
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
const missionTemplateName = 'Mission';

const env = process.env.ENVIRONMENT ?? null;

let factoryContractId, missionTemplateId;
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

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy the new mission template and update the mission factory?');

	if (!proceed) {
		console.log('Aborting');
		return;
	}

	// Mission is a large contract (near the 24KB EIP-170 ceiling); code deposit alone is
	// ~200 gas/byte. 6.5M matches the Mission-template deploy in deployLazyFarms.js — the
	// prior 1.5M here was a copy-paste from a smaller step and reverted with INSUFFICIENT_GAS.
	const gasLimit = 6_500_000;

	// deploy mission template
	const missionTemplateJson = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${missionTemplateName}.sol/${missionTemplateName}.json`,
		),
	);

	const missionTemplateBytecode = missionTemplateJson.bytecode;

	console.log(
		'\n- Deploying contract...',
		missionTemplateName,
		'\n\tgas@',
		gasLimit,
	);

	[missionTemplateId] = await contractDeployFunction(
		client,
		missionTemplateBytecode,
		gasLimit,
	);

	console.log(
		`Mission Template contract created with ID: ${missionTemplateId} / ${missionTemplateId.toSolidityAddress()}`,
	);

	console.log('\nSave the following line to your .env (used by verify.config.js / hedera-verify harness):');
	console.log(`   MISSION_TEMPLATE_CONTRACT_ID=${missionTemplateId.toString()}`);

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
		'updateMissionTemplate',
		[missionTemplateId.toSolidityAddress()],
	);

	if (rslt[0]?.status?.toString() != 'SUCCESS') {
		console.log('Mission Factory failed to connect to Mission Template:', rslt);
		return;
	}

	console.log('Mission Factory connected to Mission Template:', rslt[2].transactionId.toString());

	// verify the swap actually took effect by reading the factory's missionTemplate getter
	const templateCheck = await contractExecuteQuery(
		factoryContractId,
		missionFactoryIface,
		client,
		null,
		'missionTemplate',
	);

	const onChainTemplate = String(templateCheck[0]).toLowerCase();
	const expectedTemplate = ('0x' + missionTemplateId.toSolidityAddress()).toLowerCase();

	if (onChainTemplate === expectedTemplate) {
		console.log(`\n✅ Verified: factory.missionTemplate() == ${templateCheck[0]} (new template)`);
	}
	else {
		console.log(`\n❌ MISMATCH: factory.missionTemplate() == ${templateCheck[0]} but expected ${expectedTemplate}`);
		console.log('   The update transaction reported SUCCESS but the getter does not match - investigate before relying on it.');
		process.exitCode = 1;
	}

	// Optional source verification on Sourcify (read-only — publishes source publicly).
	// Gated on VERIFY_ON_DEPLOY, wrapped in try/catch so a verification hiccup never masks a
	// successful deploy. Verifies the freshly deployed Mission template (the clone master).
	if (process.env.VERIFY_ON_DEPLOY === 'true' || process.env.VERIFY_ON_DEPLOY === '1') {
		console.log('\n- VERIFY_ON_DEPLOY set — verifying the Mission template on Sourcify (gives the mirror node a few seconds to index)...');
		try {
			const result = await verifyContract({
				contractName: missionTemplateName,
				env,
				contractId: missionTemplateId.toString(),
				initialDelayMs: 10_000,
				attempts: 4,
				retryDelayMs: 8_000,
			});
			console.log(`   Sourcify status : ${result.status}${result.match ? ` (${result.match})` : ''}`);
			if (result.message) console.log(`   Detail          : ${result.message}`);
			if (result.hashscanUrl) console.log(`   HashScan        : ${result.hashscanUrl}`);
			if (result.repoUrl) console.log(`   Sourcify repo   : ${result.repoUrl}`);
			// A fresh mainnet contract can out-run the mirror node / Sourcify index window,
			// returning 'error' or 'pending' here. That's transient — just re-run the CLI.
			if (result.status !== 'verified' && result.status !== 'already_verified') {
				console.log(`   Not yet verified — retry shortly with: npx hedera-verify ${missionTemplateName} ${missionTemplateId.toString()}`);
			}
		}
		catch (err) {
			console.log('   WARNING: verification failed — deploy still succeeded. You can retry later.');
			console.log('  ', err.message);
			console.log(`   Retry with: npx hedera-verify ${missionTemplateName} ${missionTemplateId.toString()}`);
		}
	}
	else {
		console.log('\n- Skipping Sourcify verification (set VERIFY_ON_DEPLOY=true to enable).');
		console.log(`   Verify later with: npx hedera-verify ${missionTemplateName} ${missionTemplateId.toString()}`);
	}

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
