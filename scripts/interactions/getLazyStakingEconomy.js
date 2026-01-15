/**
 * Get $LAZY Staking Economy overview
 * Queries staking contract for all users and collections
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getLazyStakingEconomy.js 0.0.SSS', [
		'0.0.SSS is the LazyNFTStaking contract',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Lazy Staking Economy',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = lnsIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return lnsIface.decodeFunctionResult(fcnName, result);
	};

	// Get lazyToken
	const lazyTokenEVM = await query('lazyToken');
	const lazyToken = TokenId.fromSolidityAddress(lazyTokenEVM[0]);

	// Get lazyToken details from mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	console.log('LazyToken:', lazyToken.toString(), 'Decimal:', lazyTokenDetails.decimals);

	const lazyDecimals = lazyTokenDetails.decimals;

	// Get totalItemsStaked
	const totalItemsStaked = await query('totalItemsStaked');
	console.log('totalItemsStaked:', Number(totalItemsStaked[0]));

	// Get stakingUsers
	const users = await query('getStakingUsers');
	console.log('getStakingUsers:', users[0].length);

	let totalLazyEarned = 0;
	let totalEarnRate = 0;

	for (const user of users[0]) {
		const rewards = await query('calculateRewards', [user]);
		const activeBoostRate = await query('getActiveBoostRate', [user]);
		const baseRate = await query('getBaseRewardRate', [user]);

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

	// Get stakable collections
	const collections = await query('getStakableCollections');

	// Get staking stats for each collection
	for (const collection of collections[0]) {
		const numStaked = await query('getNumStakedNFTs', [collection]);
		const collectionDetails = await getTokenDetails(env, TokenId.fromSolidityAddress(collection));

		console.log(
			`Collection: ${collectionDetails.name} [${collectionDetails.symbol}] has ${numStaked[0]} NFTs staked (${
				((Number(numStaked[0]) / Number(collectionDetails.total_supply)) * 100).toFixed(2)
			}%)`,
		);
	}
};

runScript(main);
