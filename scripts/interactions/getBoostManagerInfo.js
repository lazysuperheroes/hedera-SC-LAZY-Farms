/**
 * Get BoostManager contract information
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getBoostManagerInfo.js 0.0.BBB', ['BBB is the boost manager address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'BoostManager Info',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const boostManagerIface = loadInterface('BoostManager');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = boostManagerIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return boostManagerIface.decodeFunctionResult(fcnName, result);
	};

	// Get lazy token and its details
	const lazyToken = await query('lazyToken');
	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	const cost = await query('lazyBoostCost');
	console.log('Cost to boost with FT:', Number(cost[0]) / 10 ** lazyTokenDetails.decimals, lazyTokenDetails.symbol, '(', lazyTokenId.toString(), ')');

	const reduction = await query('lazyBoostReduction');
	console.log('Consumable boost reduces your time remaining by:', Number(reduction[0]), '%');

	const feeBurnPercentage = await query('feeBurnPercentage');
	console.log('Fee Burn Percentage:', Number(feeBurnPercentage[0]), '%');

	const missionFactory = await query('missionFactory');
	console.log('Mission Factory:', ContractId.fromEvmAddress(0, 0, missionFactory[0]).toString());

	const liveBoosts = await query('liveBoosts');
	console.log('Live Boosts:', Number(liveBoosts[0]));

	const gemCollections = await query('getGemCollections');
	console.log('Gem Collections:', gemCollections[0].map(c => TokenId.fromSolidityAddress(c).toString()).join(', '));

	// Display boost data for all 6 levels
	for (let i = 0; i < 6; i++) {
		const boostData = await query('getBoostData', [i]);
		console.log('Boost', lookupLevel(i));
		for (let j = 0; j < boostData[0].length; j++) {
			console.log('\tGem:', TokenId.fromSolidityAddress(boostData[0][j]).toString());
			console.log('\t\tSerial Locked:', Boolean(boostData[1][j]));
			console.log('\t\tSerials:', boostData[2][j].map(s => Number(s)).join(', '));
			console.log('\t\tReduction:', Number(boostData[3]), '%\n');
		}
	}
};

runScript(main);
