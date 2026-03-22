/**
 * Manage admin accounts at BoostManager
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
	getMultisigOptions,
	contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'manageAdminAtBoostManager.js 0.0.BBBB 0.0.AAAA [add|remove]', [
		'BBBB is the BoostManager contract address',
		'AAAA is the admin address',
		'add or remove is the action',
	]);

	const contractId = ContractId.fromString(args[0]);
	const adminAddress = AccountId.fromString(args[1]);
	const action = args[2].toLowerCase();

	let add;
	if (action === 'add') {
		add = true;
	}
	else if (action === 'remove') {
		add = false;
	}
	else {
		console.log('ERROR:', args[2], 'is not a valid action. Use "add" or "remove".');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Manage Admin at BoostManager',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Proposed Admin': adminAddress.toString(),
			'Action': add ? 'add' : 'remove',
		},
	});

	confirmOrExit('Do you want to proceed?');

	const boostManagerIface = loadInterface('BoostManager');
	const method = add ? 'addAdmin' : 'removeAdmin';

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		boostManagerIface,
		client,
		null,
		method,
		[adminAddress.toSolidityAddress()],
		multisigOptions,
	);

	logResult(result, 'Admin update');
};

runScript(main);
