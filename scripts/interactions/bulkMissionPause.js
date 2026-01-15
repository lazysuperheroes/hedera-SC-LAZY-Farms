/**
 * Bulk pause/unpause missions via MissionFactory
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'bulkMissionPause.js 0.0.FFFF 0.0.MM1,0.0.MM2 [1|0]', [
		'FFFF is the mission factory address',
		'MM1,MM2 are the mission addresses (comma separated - no spaces)',
		'1 to pause, 0 to unpause',
	]);

	const contractId = ContractId.fromString(args[0]);
	const missionList = parseCommaList(args[1]);

	let pause;
	try {
		pause = parseInt(args[2]);
		if (pause !== 1 && pause !== 0) {
			throw new Error('Invalid pause value');
		}
	}
	catch (err) {
		console.log('ERROR: Must specify 1 or 0 to pause or unpause');
		console.log(args[2], err.message);
		process.exit(1);
	}

	const missionsAsAccountIds = missionList.map((m) => ContractId.fromString(m).toString());
	const missionsAsSolidityAddresses = [];

	for (const mission of missionList) {
		missionsAsSolidityAddresses.push(await getContractEVMAddress(env, mission));
	}

	printHeader({
		scriptName: 'Bulk Mission Pause',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Missions (Hedera)': missionList.join(', '),
			'Missions (EVM)': missionsAsAccountIds.join(', '),
			'Action': pause ? 'PAUSE' : 'UNPAUSE',
		},
	});

	confirmOrExit('Do you want to change pause status?');

	const missionFactoryIface = loadInterface('MissionFactory');

	const multisigOptions = getMultisigOptions();

	const result = await contractExecuteWithMultisig(
		contractId,
		missionFactoryIface,
		client,
		null,
		'updateMissionPause',
		[
			missionsAsSolidityAddresses,
			pause,
		],
		multisigOptions,
	);

	logResult(result, 'Pause updated');
};

runScript(main);
