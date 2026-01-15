/**
 * Check gem boost levels via BoostManager
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, parseCommaList } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'checkGemLevel.js 0.0.BBB 0.0.GGG1,0.0.GGG2 <serials>', [
		'BBB is the BoostManager address',
		'GGG1,GGG2,... is the gem collections to check',
		'serials is the serial number of the NFT to check (1 per token in list)',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokens = parseCommaList(args[1]).map(t => TokenId.fromString(t));
	const serials = args[2].split(',').map(s => parseInt(s, 10));

	if (tokens.length !== serials.length) {
		console.log('ERROR: Number of tokens and serials must match');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Check Gem Level',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token(s)': tokens.map(t => t.toString()).join(', '),
			'Serial(s)': serials.join(', '),
		},
	});

	const boostManagerIface = loadInterface('BoostManager');

	// Query each token/serial pair
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const serial = serials[i];

		const encodedCommand = boostManagerIface.encodeFunctionData('getBoostLevel', [
			token.toSolidityAddress(),
			serial,
		]);

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const level = boostManagerIface.decodeFunctionResult('getBoostLevel', result);
		console.log('Gem:', token.toString(), 'Level:', lookupLevel(Number(level[0])), '(Rank', Number(level[0]), ')');
	}
};

runScript(main);
