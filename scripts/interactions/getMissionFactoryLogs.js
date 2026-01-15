/**
 * Get and optionally save logs from a MissionFactory contract
 * Refactored to use shared utilities
 */
const fs = require('fs');
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmAction, runScript } = require('../../utils/scriptHelpers');
const { getEventsFromMirror } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getMissionFactoryLogs.js 0.0.MMMM', ['MMM is the mission factory address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Get MissionFactory Logs',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const missionFactoryIface = loadInterface('MissionFactory');

	// Fetch logs from mirror node
	const logs = await getEventsFromMirror(env, contractId, missionFactoryIface);

	const writeToFile = confirmAction('Do you want to write logs to file?');

	if (!writeToFile) {
		if (logs) {
			for (const log of logs) {
				console.log(log);
			}
		}
		else {
			console.log('ERROR: No logs found');
		}
		return;
	}

	// Write logs to a text file
	const now = new Date();
	const dateHour = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
	const outputFile = `./logs/MissionFactory-logs-${contractId}-${dateHour}.txt`;

	try {
		fs.writeFileSync(outputFile, logs.join('\n'));
		console.log(`Logs have been written to ${outputFile}`);
	}
	catch (err) {
		console.error(err);
		console.log('Error writing logs to file - check smart-contracts/logs directory exists');
	}
};

runScript(main);
