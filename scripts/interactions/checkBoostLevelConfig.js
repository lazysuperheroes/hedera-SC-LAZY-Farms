const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
}

const contractName = 'BoostManager';

const env = process.env.ENVIRONMENT ?? null;

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
		console.log('Usage: getBoostGems.js 0.0.BBB <rank>');
		console.log('       BBB is the BoostManager address');
		console.log('       rank is the boost level');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const rank = getLevel(args[1]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Checking Rank:', rank, '(', lookupLevel(rank), ')');

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	// query the EVM via mirror node (readOnlyEVMFromMirrorNode)

	const encodedCommand = boostManagerIface.encodeFunctionData(
		'getBoostData',
		[rank],
	);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostDetails = boostManagerIface.decodeFunctionResult(
		'getBoostData',
		result,
	);
	console.log('Reduction:', Number(boostDetails[3]), '%');
	console.log('Gems:', boostDetails[0].map((g) => TokenId.fromSolidityAddress(g).toString()).join(', '));
	console.log('Serial Locked:', boostDetails[1]);
	console.log('Serials:', boostDetails[2]);

};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
