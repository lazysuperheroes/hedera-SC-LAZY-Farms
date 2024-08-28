const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

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
		console.log('Usage: checkHasBoost.js 0.0.BBB 0.0.UUU 0.0.MMM');
		console.log('       BBB is the BoostManager address');
		console.log('       UUU is the user address');
		console.log('       MMM is the mission address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const userAddress = AccountId.fromString(args[1]);
	const missionAddressEVM = await getContractEVMAddress(env, args[2]);
	const missionAddress = ContractId.fromEvmAddress(0, 0, missionAddressEVM);


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Checking User:', userAddress.toString());
	console.log('\n-Checking Mission:', missionAddress.toString());

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	// query the EVM via mirror node (readOnlyEVMFromMirrorNode)

	const encodedCommand = boostManagerIface.encodeFunctionData(
		'hasBoost',
		[userAddress.toSolidityAddress(), missionAddress.toSolidityAddress()],
	);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostDetails = boostManagerIface.decodeFunctionResult(
		'hasBoost',
		result,
	);
	console.log('Has Boost:', boostDetails);

};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
