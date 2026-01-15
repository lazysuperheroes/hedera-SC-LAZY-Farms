/**
 * Get LazyNFTStaking contract information
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getLazyNFTStakingInfo.js 0.0.SSS', ['0.0.SSS is the LazyNFTStaking contract']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Staking',
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

	const systemWallet = await query('systemWallet');
	console.log('systemWallet:', systemWallet[0]);

	const distributionPeriod = await query('distributionPeriod');
	const dp = Number(distributionPeriod[0]);
	console.log('distributionPeriod:', dp, 'seconds, or', dp / 3600, 'hours or', dp / 86400, 'days');

	const periodForBonus = await query('periodForBonus');
	console.log('periodForBonus:', Number(periodForBonus[0]), 'periods');

	const hodlBonusRate = await query('hodlBonusRate');
	console.log('hodlBonusRate:', Number(hodlBonusRate[0]), '%');

	const maxBonusTimePeriods = await query('maxBonusTimePeriods');
	console.log('maxBonusTimePeriods:', Number(maxBonusTimePeriods[0]));

	const burnPercentage = await query('burnPercentage');
	console.log('burnPercentage:', Number(burnPercentage[0]));

	const boostRateCap = await query('boostRateCap');
	console.log('boostRateCap:', Number(boostRateCap[0]));

	const totalItemsStaked = await query('totalItemsStaked');
	console.log('totalItemsStaked:', Number(totalItemsStaked[0]));

	const users = await query('getStakingUsers');
	console.log(`getStakingUsers: (${users[0].length})`, users[0].map(u => AccountId.fromEvmAddress(0, 0, u).toString()).join(', '));

	const collections = await query('getStakableCollections');
	console.log('getStakableCollections:', collections[0].map(c => TokenId.fromSolidityAddress(c).toString()));
};

runScript(main);
