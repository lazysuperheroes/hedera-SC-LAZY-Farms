const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file', err);
}

const contractName = 'LazyNFTStaking';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID & SIGNING_KEY in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazyNFTStakingInfo.js 0.0.SSS');
		console.log('		0.0.SSS is the LazyNFTStaking contract to update');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-**STAKING**');
	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// import ABI
	const lnsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lnsIface = new ethers.Interface(lnsJSON.abi);

	// query mirror nodes to call the following methods:

	// systemWallet
	let encodedCall = lnsIface.encodeFunctionData('systemWallet', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const systemWallet = lnsIface.decodeFunctionResult('systemWallet', result);

	console.log('systemWallet:', systemWallet[0]);

	// distributionPeriod
	encodedCall = lnsIface.encodeFunctionData('distributionPeriod', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const distributionPeriod = lnsIface.decodeFunctionResult('distributionPeriod', result);

	console.log('distributionPeriod:', Number(distributionPeriod[0]), ' seconds, or', Number(distributionPeriod[0]) / 60 / 60, 'hours or', Number(distributionPeriod[0]) / 60 / 60 / 24, 'days');

	// periodForBonus
	encodedCall = lnsIface.encodeFunctionData('periodForBonus', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const periodForBonus = lnsIface.decodeFunctionResult('periodForBonus', result);

	console.log('periodForBonus:', Number(periodForBonus[0]), ' periods');

	// hodlBonusRate
	encodedCall = lnsIface.encodeFunctionData('hodlBonusRate', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const hodlBonusRate = lnsIface.decodeFunctionResult('hodlBonusRate', result);

	console.log('hodlBonusRate:', Number(hodlBonusRate[0]), '%');

	// maxBonusTimePeriods
	encodedCall = lnsIface.encodeFunctionData('maxBonusTimePeriods', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const maxBonusTimePeriods = lnsIface.decodeFunctionResult('maxBonusTimePeriods', result);

	console.log('maxBonusTimePeriods:', Number(maxBonusTimePeriods[0]));

	// burnPercentage
	encodedCall = lnsIface.encodeFunctionData('burnPercentage', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const burnPercentage = lnsIface.decodeFunctionResult('burnPercentage', result);

	console.log('burnPercentage:', Number(burnPercentage[0]));

	// boostRateCap
	encodedCall = lnsIface.encodeFunctionData('boostRateCap', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const boostRateCap = lnsIface.decodeFunctionResult('boostRateCap', result);

	console.log('boostRateCap:', Number(boostRateCap[0]));

	// totalItemsStaked
	encodedCall = lnsIface.encodeFunctionData('totalItemsStaked', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const totalItemsStaked = lnsIface.decodeFunctionResult('totalItemsStaked', result);

	console.log('totalItemsStaked:', Number(totalItemsStaked[0]));

	// getStakingUsers
	encodedCall = lnsIface.encodeFunctionData('getStakingUsers', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const users = lnsIface.decodeFunctionResult('getStakingUsers', result);

	console.log(`getStakingUsers: (${users[0].length})`, users[0].map((u) => AccountId.fromEvmAddress(0, 0, u).toString()).join(', '));

	// getStakableCollections
	encodedCall = lnsIface.encodeFunctionData('getStakableCollections', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const collections = lnsIface.decodeFunctionResult('getStakableCollections', result);

	console.log('getStakableCollections:', collections[0].map((c) => TokenId.fromSolidityAddress(c).toString()));

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
