/**
 * Bulk set start time for missions via MissionFactory
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'bulkStartTimeSet.js 0.0.FFFF 0.0.MM1,0.0.MM2 <timestamp>', [
		'FFFF is the mission factory address',
		'MM1,MM2 are the mission addresses (comma separated - no spaces)',
		'timestamp in seconds',
	]);

	const contractId = ContractId.fromString(args[0]);
	const missionList = parseCommaList(args[1]);

	let startTime;
	let startTimestamp;
	try {
		startTimestamp = parseInt(args[2]);
		startTime = new Date(startTimestamp * 1000);
	}
	catch (err) {
		console.log('ERROR: Must be a valid timestamp as the third argument');
		console.log(args[2], err.message);
		process.exit(1);
	}

	const missionsAsAccountIds = missionList.map((m) => AccountId.fromString(m).toString());
	const missionsAsSolidityAddresses = [];

	for (const mission of missionList) {
		missionsAsSolidityAddresses.push(await getContractEVMAddress(env, mission));
	}

	printHeader({
		scriptName: 'Bulk Start Time Set',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Missions (Hedera)': missionList.join(', '),
			'Missions (EVM)': missionsAsAccountIds.join(', '),
			'Start Time': `${startTimestamp} -> ${startTime.toISOString()}`,
		},
	});

	confirmOrExit('Do you want to change the start time?');

	const missionFactoryIface = loadInterface('MissionFactory');

	const result = await contractExecuteFunction(
		contractId,
		missionFactoryIface,
		client,
		null,
		'setMissionStart',
		[
			missionsAsSolidityAddresses,
			startTimestamp,
		],
	);

	logResult(result, 'Start time updated');
};

runScript(main);
