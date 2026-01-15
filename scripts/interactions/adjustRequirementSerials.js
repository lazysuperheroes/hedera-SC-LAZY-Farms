/**
 * Add or remove serial restrictions for mission requirements
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(4, 'adjustRequirementSerials.js 0.0.MMMM 0.0.TTT 1,2,5 add|remove', [
		'MMM is the mission address',
		'TTT is the token Id for the requirement',
		'1,2,5 list of serials to add/remove restrictions',
		'add|remove to specify the action',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenId = TokenId.fromString(args[1]);
	const serials = parseCommaList(args[2]).map(s => parseInt(s, 10));
	const action = args[3].toLowerCase();

	let add, method;
	if (action === 'add') {
		add = true;
		method = 'addRequirementSerials';
	}
	else if (action === 'remove') {
		add = false;
		method = 'removeRequirementSerials';
	}
	else {
		console.log('ERROR: Invalid action. Must be "add" or "remove".');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Adjust Requirement Serials',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': tokenId.toString(),
			'Serials': serials.join(', '),
			'Action': add ? 'Add' : 'Remove',
		},
	});

	confirmOrExit('Do you want to adjust serial restrictions for requirements?');

	const missionIface = loadInterface('Mission');

	const result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		800_000,
		method,
		[tokenId.toSolidityAddress(), serials],
	);

	logResult(result, 'Requirement Serials update');
};

runScript(main);
