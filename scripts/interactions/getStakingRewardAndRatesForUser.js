/**
 * Get staking reward and rates for a specific user from LazyNFTStaking contract
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'getStakingRewardAndRatesForUser.js 0.0.LNS 0.0.UUU', [
		'LNS is the LazyStakingNFTs Contract address',
		'UUU is the User address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const user = AccountId.fromString(args[1]);

	printHeader({
		scriptName: 'Get Staking Reward and Rates for User',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Checking User': user.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Helper for mirror node queries
	const query = async (fcnName, params = [], gasLimit = undefined) => {
		const encoded = lnsIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false, gasLimit);
		return lnsIface.decodeFunctionResult(fcnName, result);
	};

	// Get the lazyToken from the contract
	const lazyTokenResult = await query('lazyToken');
	const lazyToken = TokenId.fromSolidityAddress(lazyTokenResult[0]);
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	const lazyDecimals = lazyTokenDetails.decimals;

	console.log('\n-Lazy Token:', lazyToken.toString(), 'Decimals:', lazyDecimals);

	// Query user data
	const baseRewardRate = await query('getBaseRewardRate', [user.toSolidityAddress()]);
	const activeBoostRate = await query('getActiveBoostRate', [user.toSolidityAddress()]);
	const rewards = await query('calculateRewards', [user.toSolidityAddress()]);
	const stakedNFTs = await query('getStakedNFTs', [user.toSolidityAddress()], 2_000_000);

	console.log('\n-Base Reward Rate:', Number(baseRewardRate[0]) / 10 ** lazyDecimals);
	console.log('-Active Boost Rate:', Number(activeBoostRate[0]), '%');
	console.log('-Lazy Earnt:', Number(rewards[0]) / 10 ** lazyDecimals);
	console.log('-Total Reward Rate:', Number(rewards[1]) / 10 ** lazyDecimals);
	console.log('-As Of:', Number(rewards[2]), `${new Date(Number(rewards[2]) * 1000).toISOString()}`);

	// Calculate time until next claim (24 hours from the as of time)
	const timeUntilNextClaim = 24 * 60 * 60 - (Date.now() / 1000 - Number(rewards[2]));
	const hours = Math.floor(timeUntilNextClaim / 3600);
	const minutes = Math.floor((timeUntilNextClaim % 3600) / 60);
	const seconds = Math.floor(timeUntilNextClaim % 60);
	console.log('-Time Until Next Claim:', `${hours} hours, ${minutes} minutes, ${seconds} seconds`);
	console.log('-Last Claim:', Number(rewards[3]), `${new Date(Number(rewards[3]) * 1000).toISOString()}`);

	// Output stakedNFTs which is of type [address[] memory collections, uint256[][] memory serials]
	let stakedNFTString = '';
	for (let i = 0; i < stakedNFTs[0].length; i++) {
		if (stakedNFTs[1][i].length !== 0) {
			// Get TokenDetails from the mirror node
			const tokenDetails = await getTokenDetails(env, TokenId.fromSolidityAddress(stakedNFTs[0][i]));
			stakedNFTString += `Collection: ${TokenId.fromSolidityAddress(stakedNFTs[0][i]).toString()} - ${tokenDetails.name} [`;
			stakedNFTString += `Serials: ${stakedNFTs[1][i].map(s => Number(s)).join(', ')}]\n`;
		}
	}
	console.log('\n-Staked NFTs:\n' + stakedNFTString);
};

runScript(main);
