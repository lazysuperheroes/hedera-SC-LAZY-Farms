/**
 * Claim staking rewards from LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'claimStakingRewards.js 0.0.SSS', ['0.0.SSS is the LazyNFTStaking contract']);

	const contractId = ContractId.fromString(args[0]);

	const lnsIface = loadInterface('LazyNFTStaking');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = lnsIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return lnsIface.decodeFunctionResult(fcnName, result);
	};

	// Get user's staking info
	const baseRewardRate = await query('getBaseRewardRate', [operatorId.toSolidityAddress()]);
	const activeBoostRate = await query('getActiveBoostRate', [operatorId.toSolidityAddress()]);
	const rewards = await query('calculateRewards', [operatorId.toSolidityAddress()]);
	const stakedNFTs = await query('getStakedNFTs', [operatorId.toSolidityAddress()]);

	printHeader({
		scriptName: 'Staking Rewards',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	console.log('\n-Base Reward Rate:', baseRewardRate);
	console.log('\n-Active Boost Rate:', activeBoostRate);
	console.log('\n-Lazy Earned:', Number(rewards[0]));
	console.log('\n-Total Reward Rate:', Number(rewards[1]));
	console.log('\n-As Of:', Number(rewards[2]), new Date(Number(rewards[2]) * 1000).toISOString());
	console.log('\n-Last Claim:', Number(rewards[3]), new Date(Number(rewards[3]) * 1000).toISOString());

	// Display staked NFTs
	let stakedNFTString = '';
	for (let i = 0; i < stakedNFTs[0].length; i++) {
		stakedNFTString += `Collection: ${TokenId.fromSolidityAddress(stakedNFTs[0][i]).toString()} [`;
		stakedNFTString += `Serials: ${stakedNFTs[1][i].map(s => Number(s)).join(', ')}]\n`;
	}
	console.log('\n-Staked NFTs:\n' + stakedNFTString);

	confirmOrExit('Do you want to claim staking rewards (**HODL bonus will reset**)?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		GAS.BOOST_ACTIVATE,
		'claimRewards',
		[],
		multisigOptions,
	);

	logResult(result, 'Claim executed');
};

runScript(main);
