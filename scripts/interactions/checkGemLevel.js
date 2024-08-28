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
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

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
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: checkGemLevel.js 0.0.BBB 0.0.GGG1,0.0.GGG2 <serials>');
		console.log('       BBB is the BoostManager address');
		console.log('       GGG1,GGG2,... is the gem collections to check');
		console.log('       serials is the serial number of the NFT to check (1 per token in list)');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const tokens = args[1].split(',').map((t) => TokenId.fromString(t));
	const serials = args.slice(2).map((s) => parseInt(s));

	if (tokens.length != serials.length) {
		console.log('ERROR: Number of tokens and serials must match');
		process.exit(1);
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Checking Tokens:', tokens.map((t) => t.toString()).join(', '));
	console.log('\n-Checking Serials:', serials.join(', '));

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	// query the EVM via mirror node (readOnlyEVMFromMirrorNode)
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const serial = serials[i];
		const encodedCommand = boostManagerIface.encodeFunctionData(
			'getBoostLevel',
			[token.toSolidityAddress(), serial],
		);

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const level = boostManagerIface.decodeFunctionResult(
			'getBoostLevel',
			result,
		);
		console.log('Gem:', token.toString(), 'Level:', lookupLevel(Number(level[0])), '(Rank ', Number(level[0]), ')');
	}

};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
