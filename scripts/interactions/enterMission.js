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
const { contractExecuteFunction, contractExecuteQuery } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { setFTAllowance, setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { checkFTAllowances, getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
let lazyTokenId;
let lazyGasStationId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

try {
	lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
	lazyGasStationId = AccountId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
}
catch (err) {
	console.log('ERROR: Must specify LAZY_TOKEN_ID & LAZY_GAS_STATION_CONTRACT_ID in the .env file');
}

const contractName = 'Mission';

const env = process.env.ENVIRONMENT ?? null;
const LAZY_DECIMALS = process.env.LAZY_DECIMALS ?? 1;
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

	// check Lazy and LGS are set
	if (
		lazyTokenId === undefined ||
		lazyTokenId == null ||
		lazyGasStationId === undefined ||
		lazyGasStationId == null
	) {
		console.log(
			'Environment required, please specify LAZY_TOKEN_ID & LAZY_GAS_STATION_CONTRACT_ID in the .env file',
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
		console.log('Usage: enterMission.js 0.0.MMMM 0.0.Req1,0.0.Req2 1,2,5:2,3,4');
		console.log('		MMM is the mission address');
		console.log('		list of requirement tokens to stake (comma separated - no spaces)');
		console.log('		list of serials to stake (comma separated - no spaces - : to break per token)');
		console.log('		Example: shown suggests Req1 serials 1,2,5 and Req2 serials 2,3,4');
		return;
	}

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);
	const tokenIdList = args[1].split(',').map((t) => TokenId.fromString(t));
	const tokenIdAsSoldity = tokenIdList.map((t) => t.toSolidityAddress());
	const serialsOuterList = args[2].split(':');
	const serials = serialsOuterList.map((s) => s.split(',').map((sub) => parseInt(sub)));

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString(), ' => ', args[0]);
	console.log('\n-Using Tokens:', tokenIdList.map((t) => t.toString()));
	console.log('\n-Using Serials:', serials);

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	// check the mission entry fee
	const entryFee = await contractExecuteQuery(
		contractId,
		missionIface,
		client,
		null,
		'entryFee',
	);

	const fee = Number(entryFee[0]);

	console.log('\n-Entry Fee:', fee / Math.pow(10, LAZY_DECIMALS), '$Lazy');

	console.log('\nChecking Allowances...');
	// check if the user has $LAZY allowance > fee to LGS
	const mirrorFTAllowances = await checkFTAllowances(env, operatorId);
	let found = false;
	for (let a = 0; a < mirrorFTAllowances.length; a++) {
		const allowance = mirrorFTAllowances[a];
		// console.log('FT Allowance found:', allowance.token_id, allowance.owner, allowance.spender);
		if (allowance.token_id == lazyTokenId.toString() && allowance.spender == lazyGasStationId.toString()) {
			if (allowance.amount < fee) {
				console.log('ERROR: Insufficient $LAZY allowance to LGS');
				const proceed = readlineSync.keyInYNStrict('Do you want to set the allowance?');
				if (!proceed) {
					console.log('User Aborted');
					return;
				}
				// set allowance to the Gas Station for the fee
				const result = await setFTAllowance(
					client,
					lazyTokenId,
					operatorId,
					lazyGasStationId,
					fee,
				);

				if (result[0]?.status?.toString() != 'SUCCESS') {
					console.log('Error setting $LAZY allowance to LGS:', result);
					found = true;
					return;
				}

				console.log('ALLOWANCE SET: $LAZY allowance to LGS', fee / Math.pow(10, LAZY_DECIMALS));
			}
			console.log('FOUND: Sufficient $LAZY allowance to LGS', allowance.amount / Math.pow(10, LAZY_DECIMALS));
			found = true;
		}
	}

	if (!found) {
		console.log('ERROR: No $LAZY allowance to LGS found');
		const proceed = readlineSync.keyInYNStrict('Do you want to set the allowance?');
		if (!proceed) {
			console.log('User Aborted');
			return;
		}
		// set allowance to the Gas Station for the fee
		const result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		if (result != 'SUCCESS') {
			console.log('Error setting $LAZY allowance to LGS:', result);
			return;
		}

		console.log('ALLOWANCE SET: $LAZY allowance to LGS', fee / Math.pow(10, LAZY_DECIMALS));
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to set NFT allowances and enter the mission?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	// set NFT allowance
	let result = await setNFTAllowanceAll(
		client,
		tokenIdList,
		operatorId,
		contractId,
	);

	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		2_000_000,
		'enterMission',
		[tokenIdAsSoldity, serials],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error entering mission:', result);
		return;
	}

	console.log('Mission Entered. Transaction ID:', result[2]?.transactionId?.toString());
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
