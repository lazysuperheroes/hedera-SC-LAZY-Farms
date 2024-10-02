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
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file', err);
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
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: getStakingRewardAndRatesForUser.js 0.0.LNS 0.0.UUU');
		console.log('       LNS is the LazyStakingNFTs Contract address');
		console.log('	    UUU is the User address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const user = AccountId.fromString(args[1]);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using Contract:', contractId.toString());
	console.log('-Checking User:', user.toString());

	// import ABI
	const lnsJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const lnsIface = new ethers.Interface(lnsJSON.abi);

	// get the lazyToken from the contract using lazyToken method via mirror node (readOnlyEVMFromMirrorNode)
	const encodedCommand0 = lnsIface.encodeFunctionData(
		'lazyToken',
		[],
	);

	const result0 = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand0,
		operatorId,
		false,
	);

	const lazyToken = TokenId.fromSolidityAddress(lnsIface.decodeFunctionResult(
		'lazyToken',
		result0,
	)[0]);

	const lazyTokenDetails = await getTokenDetails(env, lazyToken);

	const lazyDecimals = lazyTokenDetails.decimals;

	console.log('\n-Lazy Token:', lazyToken.toString(), 'Decimals:', lazyDecimals);


	// query the EVM via mirror node (readOnlyEVMFromMirrorNode)

	const encodedCommand = lnsIface.encodeFunctionData(
		'getBaseRewardRate',
		[user.toSolidityAddress()],
	);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const baseRewardRate = lnsIface.decodeFunctionResult(
		'getBaseRewardRate',
		result,
	);

	const encodedCommand2 = lnsIface.encodeFunctionData(
		'getActiveBoostRate',
		[user.toSolidityAddress()],
	);

	const result2 = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand2,
		operatorId,
		false,
	);

	const activeBoostRate = lnsIface.decodeFunctionResult(
		'getActiveBoostRate',
		result2,
	);

	// calculateRewards

	const encodedCommand3 = lnsIface.encodeFunctionData(
		'calculateRewards',
		[user.toSolidityAddress()],
	);

	const result3 = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand3,
		operatorId,
		false,
	);

	const rewards = lnsIface.decodeFunctionResult(
		'calculateRewards',
		result3,
	);

	// getStakedNFTs

	const encodedCommand4 = lnsIface.encodeFunctionData(
		'getStakedNFTs',
		[user.toSolidityAddress()],
	);

	const result4 = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand4,
		operatorId,
		false,
	);

	const stakedNFTs = lnsIface.decodeFunctionResult(
		'getStakedNFTs',
		result4,
	);

	console.log('\n-Base Reward Rate:', Number(baseRewardRate) / 10 ** lazyDecimals);
	console.log('-Active Boost Rate:', Number(activeBoostRate), '%');
	console.log('-Lazy Earnt:', Number(rewards[0]) / 10 ** lazyDecimals);
	console.log('-Total Reward Rate:', Number(rewards[1]) / 10 ** lazyDecimals);
	console.log('-As Of:', Number(rewards[2]), `${new Date(Number(rewards[2]) * 1000).toISOString()}`);
	// work out the time until next claim (in hours / minutes / seconds) as 24 hours from the as of time
	const timeUntilNextClaim = 24 * 60 * 60 - (Date.now() / 1000 - Number(rewards[2]));
	const hours = Math.floor(timeUntilNextClaim / 3600);
	const minutes = Math.floor((timeUntilNextClaim % 3600) / 60);
	const seconds = Math.floor(timeUntilNextClaim % 60);
	console.log('-Time Until Next Claim:', `${hours} hours, ${minutes} minutes, ${seconds} seconds`);
	console.log('-Last Claim:', Number(rewards[3]), `${new Date(Number(rewards[3]) * 1000).toISOString()}`);
	// output stakedNFTs which is of type [address[] memory collections, uint256[][] memory serials]
	let stakedNFTString = '';
	for (let i = 0; i < stakedNFTs[0].length; i++) {
		if (stakedNFTs[1][i].length != 0) {
			// get TokenDetails from the mirror node
			const tokenDetails = await getTokenDetails(env, TokenId.fromSolidityAddress(stakedNFTs[0][i]));
			stakedNFTString += `Collection: ${TokenId.fromSolidityAddress(stakedNFTs[0][i]).toString()} - ${tokenDetails.name} [`;
			stakedNFTString += `Serials: ${stakedNFTs[1][i].map(s => Number(s)).join(', ')}]\n`;
		}
	}
	console.log('\n-Staked NFTs:\n' + stakedNFTString);

};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
