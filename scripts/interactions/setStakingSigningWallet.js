/**
 * Set the system signing wallet for LazyNFTStaking contract
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult } = require('../../utils/scriptHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, signingKey, env } = createHederaClient({
		requireOperator: true,
		requireSigningKey: true,
	});

	const args = parseArgs(1, 'setStakingSigningWallet.js 0.0.SSS', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'expect SIGNING_KEY to be set in .env',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Setting Staking Signing Wallet',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'New signing key (Public)': signingKey.publicKey.toEvmAddress(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old systemWallet from Mirror Node
	const encodedCommand = lnsIface.encodeFunctionData('systemWallet', []);

	const osw = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
	);

	const oldSystemWallet = lnsIface.decodeFunctionResult('systemWallet', osw);

	console.log('\n-Old System Wallet (signing public key):', oldSystemWallet[0].toString());

	confirmOrExit('Do you want to update the System Signing Wallet?');

	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		null,
		'setSystemWallet',
		[signingKey.publicKey.toEvmAddress()],
	);

	logResult(result, 'System Wallet updated');
};

runScript(main);
