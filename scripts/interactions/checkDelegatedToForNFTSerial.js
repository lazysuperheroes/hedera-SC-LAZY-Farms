/**
 * Check NFT delegation status via LazyDelegateRegistry
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'checkDelegatedToForNFTSerial.js 0.0.LDR 0.0.TTT <serial>', [
		'LDR is the LazyDelegateRegistry address',
		'TTT is the token address',
		'serial is the serial number of the NFT to check',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const serial = parseInt(args[2], 10);

	printHeader({
		scriptName: 'Check Delegation',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': token.toString(),
			'Serial': serial,
		},
	});

	const ldrIface = loadInterface('LazyDelegateRegistry');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = ldrIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return ldrIface.decodeFunctionResult(fcnName, result);
	};

	// Get who the NFT is delegated to
	const userResult = await query('getNFTDelegatedTo', [token.toSolidityAddress(), serial]);
	const delegatedTo = AccountId.fromEvmAddress(0, 0, userResult[0]);
	console.log(`NFT ${serial} is delegated to: ${delegatedTo.toString()}`);

	// Get all NFTs delegated to that user
	const nftsResult = await query('getNFTsDelegatedTo', [userResult[0]]);
	const nfts = nftsResult[0].map(n => TokenId.fromSolidityAddress(n).toString());
	console.log(`NFTs delegated to ${delegatedTo.toString()}: ${nfts.join(', ')}`);

	// Get total serials delegated globally
	const totalResult = await query('totalSerialsDelegated', []);
	console.log(`(Global) Total Serials Delegated: ${totalResult[0]}`);
};

runScript(main);
