const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

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
	if (operatorId === undefined || operatorId == null) {
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
	// call lazyToken method
	let encodedCall = lnsIface.encodeFunctionData('lazyToken', []);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const lazyTokenEVM = lnsIface.decodeFunctionResult('lazyToken', result);

	const lazyToken = TokenId.fromSolidityAddress(lazyTokenEVM[0]);

	// now get the details of the lazyToken from the mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);

	console.log(
		'LazyToken:',
		lazyToken.toString(),
		'Decimal:',
		lazyTokenDetails.decimals,
	);

	const lazyDecimals = lazyTokenDetails.decimals;

	// totalItemsStaked
	encodedCall = lnsIface.encodeFunctionData('totalItemsStaked', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const totalItemsStaked = lnsIface.decodeFunctionResult(
		'totalItemsStaked',
		result,
	);

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

	console.log('getStakingUsers:', users[0].length);

	let totalLazyEarned = 0;
	let totalEarnRate = 0;

	for (const user of users[0]) {
		encodedCall = lnsIface.encodeFunctionData('calculateRewards', [user]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const rewards = lnsIface.decodeFunctionResult('calculateRewards', result);

		// getActiveBoostRate for user
		encodedCall = lnsIface.encodeFunctionData('getActiveBoostRate', [user]);

		const boostRateResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const activeBoostRate = lnsIface.decodeFunctionResult(
			'getActiveBoostRate',
			boostRateResult,
		);

		// getBaseRewardRate for user
		encodedCall = lnsIface.encodeFunctionData('getBaseRewardRate', [user]);

		const baseRateResult = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const baseRate = lnsIface.decodeFunctionResult(
			'getBaseRewardRate',
			baseRateResult,
		);

		totalLazyEarned += Number(rewards[0]);
		totalEarnRate += Number(rewards[1]);

		console.log(
			'User:',
			AccountId.fromEvmAddress(0, 0, user).toString(),
			'has earnt:',
			Number(rewards[0]) / 10 ** lazyDecimals,
			`Lazy (Current Rate: ${Number(rewards[1]) / 10 ** lazyDecimals}/day)`,
			`Base Rate: ${Number(baseRate) / 10 ** lazyDecimals}/day`,
			`Active Boost Rate: ${Number(activeBoostRate)}%`,
			`as of ${new Date(Number(rewards[2]) * 1000).toUTCString()}`,
			rewards[3]
				? `Last Claim ${new Date(Number(rewards[3]) * 1000).toUTCString()}`
				: '',
		);
	}

	console.log(
		'Total Lazy Earned:',
		totalLazyEarned / 10 ** lazyDecimals,
		'Total Earn Rate:',
		totalEarnRate / 10 ** lazyDecimals,
	);

	// getStakableCollections
	encodedCall = lnsIface.encodeFunctionData('getStakableCollections', []);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCall,
		operatorId,
		false,
	);

	const collections = lnsIface.decodeFunctionResult(
		'getStakableCollections',
		result,
	);

	// getNumStakedNFTs for each collection to see how many NFTs are staked
	// get the TokenDetails and show % staked

	for (const collection of collections[0]) {
		encodedCall = lnsIface.encodeFunctionData('getNumStakedNFTs', [collection]);

		result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCall,
			operatorId,
			false,
		);

		const numStaked = lnsIface.decodeFunctionResult('getNumStakedNFTs', result);

		const collectionDetails = await getTokenDetails(
			env,
			TokenId.fromSolidityAddress(collection),
		);

		console.log(
			`Collection: ${collectionDetails.name} [${
				collectionDetails.symbol
			}] has ${numStaked[0]} NFTs staked (${
				((Number(numStaked[0]) / Number(collectionDetails.total_supply)) * 100).toFixed(2)
			}%)`,
		);
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
