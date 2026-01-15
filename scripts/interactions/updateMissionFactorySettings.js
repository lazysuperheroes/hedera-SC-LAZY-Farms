/**
 * Update MissionFactory settings (boost manager, template, prng, lgs, lazy token)
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');

const SETTING_METHODS = {
	boost: 'updateBoostManager',
	template: 'updateMissionTemplate',
	prng: 'updatePrngContract',
	lgs: 'updateLGS',
	lazy: 'setLazyToken',
};

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'updateMissionFactorySettings.js 0.0.MMMM 0.0.AAAA [boost|template|prng|lgs|lazy]', [
		'MMMM is the mission factory address',
		'AAAA is the new address',
		'boost|template|prng|lgs|lazy the item to update',
	]);

	const contractId = ContractId.fromString(args[0]);
	const newAddress = AccountId.fromString(args[1]);
	const setting = args[2].toLowerCase();

	const method = SETTING_METHODS[setting];
	if (!method) {
		console.log('ERROR:', args[2], 'is not a valid setting. Use: boost, template, prng, lgs, or lazy.');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Update MissionFactory Settings',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'New Address': newAddress.toString(),
			'Setting': setting,
			'Method': method,
		},
	});

	confirmOrExit('Do you want to change settings?');

	const missionFactoryIface = loadInterface('MissionFactory');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionFactoryIface,
		client,
		null,
		method,
		[newAddress.toSolidityAddress()],
		multisigOptions,
	);

	logResult(result, 'Settings update');
};

runScript(main);
