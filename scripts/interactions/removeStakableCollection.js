/**
 * Remove stakeable NFT collections from LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'removeStakableCollection.js 0.0.SSS 0.0.CCC1,0.0.CCC2,0.0.CCC3', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'0.0.CCC1,0.0.CCC2,0.0.CCC3 is the collections to remove (comma separated - no spaces)',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[1]).map(t => TokenId.fromString(t));

	printHeader({
		scriptName: 'Remove Collections from Staking',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collections to Remove': tokenList.map(t => t.toString()).join(', '),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	confirmOrExit('Do you want to remove these Stakable Collections?');

	const tokenListAsSolidity = tokenList.map(t => t.toSolidityAddress());
	const gas = GAS.ADMIN_CALL + tokenList.length * 250_000;

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		gas,
		'removeStakeableCollection',
		[tokenListAsSolidity],
		multisigOptions,
	);

	logResult(result, 'Collections *NO LONGER* stakeable');
};

runScript(main);
