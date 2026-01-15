/**
 * Get MissionFactory contract information
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getMissionFactoryInfo.js 0.0.MMMM', ['MMM is the mission factory address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'MissionFactory Info',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const missionFactoryIface = loadInterface('MissionFactory');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionFactoryIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionFactoryIface.decodeFunctionResult(fcnName, result);
	};

	const deployedMissions = await query('getDeployedMissions');
	console.log('Deployed Missions:', deployedMissions);

	const availableSlots = await query('getAvailableSlots');
	console.log('Available Slots:', availableSlots);

	const lazyToken = await query('lazyToken');
	console.log('Lazy Token:', lazyToken ? ContractId.fromEvmAddress(0, 0, lazyToken[0]).toString() : 'Not Set');

	const boostManager = await query('boostManager');
	console.log('Boost Manager:', boostManager ? ContractId.fromEvmAddress(0, 0, boostManager[0]).toString() : 'Not Set');

	const lazyGasStation = await query('lazyGasStation');
	console.log('Lazy Gas Station:', lazyGasStation ? ContractId.fromEvmAddress(0, 0, lazyGasStation[0]).toString() : 'Not Set');

	const prngGenerator = await query('prngGenerator');
	console.log('PRNG Generator:', prngGenerator ? ContractId.fromEvmAddress(0, 0, prngGenerator[0]).toString() : 'Not Set');

	const missionTemplate = await query('missionTemplate');
	console.log('Mission Template:', missionTemplate ? ContractId.fromEvmAddress(0, 0, missionTemplate[0]).toString() : 'Not Set');

	const lazyDelegateRegistry = await query('lazyDelegateRegistry');
	console.log('Lazy Delegate Registry:', lazyDelegateRegistry ? ContractId.fromEvmAddress(0, 0, lazyDelegateRegistry[0]).toString() : 'Not Set');

	const admins = await query('getAdmins');
	const adminList = admins[0].map(a => AccountId.fromEvmAddress(0, 0, a));
	console.log('Admins:', adminList.join(', '));

	const deployers = await query('getDeployers');
	const deployerList = deployers[0].map(a => AccountId.fromEvmAddress(0, 0, a));
	console.log('Deployers:', deployerList.join(', '));
};

runScript(main);
