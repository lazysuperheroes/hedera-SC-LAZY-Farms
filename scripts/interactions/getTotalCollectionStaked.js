/**
 * Get total staked count for a collection via LazyNFTStaking
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'getTotalCollectionStaked.js 0.0.LNS 0.0.CCC', [
		'LNS is the LazyNFTStaking contract address',
		'CCC is the Collection address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);

	printHeader({
		scriptName: 'Get Total Collection Staked',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collection': token.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = lnsIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return lnsIface.decodeFunctionResult(fcnName, result);
	};

	// Get collection-specific staked count
	const totalStaked = await query('getNumStakedNFTs', [token.toSolidityAddress()]);
	console.log(`Total Staked (${token.toString()}):`, totalStaked[0]);

	// Get global total items staked
	const totalItemsStaked = await query('totalItemsStaked', []);
	console.log('Total Items Staked:', totalItemsStaked[0]);
};

runScript(main);
