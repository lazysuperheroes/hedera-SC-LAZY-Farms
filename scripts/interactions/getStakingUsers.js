/**
 * Get list of staking users from LazyNFTStaking contract
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getStakingUsers.js 0.0.LNS', [
		'LNS is the LazyStakingNFTs Contract address',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Get Staking Users',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	const encodedCommand = lnsIface.encodeFunctionData('getStakingUsers', []);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const users = lnsIface.decodeFunctionResult('getStakingUsers', result);

	console.log('Users:', users[0].map((u) => AccountId.fromEvmAddress(0, 0, u).toString()).join(', '));
};

runScript(main);
