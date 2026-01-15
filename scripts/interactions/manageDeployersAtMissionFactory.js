/**
 * Manage deployer accounts at MissionFactory
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const {
	parseArgs,
	printHeader,
	confirmOrExit,
	logResult,
	runScript,
	parseCommaList,
	getMultisigOptions,
	contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'manageDeployersAtMissionFactory.js 0.0.MMMM 0.0.DDD1,0.0.DDD2 [1|0]', [
		'MMMM is the mission factory address',
		'DDD1,DDD2 are the deployer addresses (comma separated - no spaces)',
		'1 to add, 0 to remove',
	]);

	const contractId = ContractId.fromString(args[0]);
	const deployerAddressList = parseCommaList(args[1]);

	let add;
	if (args[2] === '1') {
		add = true;
	}
	else if (args[2] === '0') {
		add = false;
	}
	else {
		console.log('ERROR:', args[2], 'is not a valid action. Use "1" to add or "0" to remove.');
		process.exit(1);
	}

	const deployerAccountIds = deployerAddressList.map(addr => AccountId.fromString(addr).toString());
	const deployerSolidityAddresses = deployerAddressList.map(addr => AccountId.fromString(addr).toSolidityAddress());

	printHeader({
		scriptName: 'Manage Deployers at MissionFactory',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Proposed Deployers': deployerAccountIds.join(', '),
			'Action': add ? 'add' : 'remove',
		},
	});

	confirmOrExit('Do you want to change deployers?');

	const missionFactoryIface = loadInterface('MissionFactory');

	// Use multisig if --multisig flag is present, otherwise direct execution
	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionFactoryIface,
		client,
		null,
		'updateDeployers',
		[deployerSolidityAddresses, add],
		multisigOptions,
	);

	logResult(result, 'Deployers update');
};

runScript(main);
