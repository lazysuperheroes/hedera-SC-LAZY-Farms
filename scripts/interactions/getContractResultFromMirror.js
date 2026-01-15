/**
 * Get contract result from mirror node
 * Refactored to use shared utilities
 */
const { translateTransactionForWebCall, getContractResult } = require('../../utils/hederaMirrorHelpers');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	const args = parseArgs(2, 'getContractResultFromMirror.js <contract name> <txId>', [
		'contract name is the contract name',
		'txId is the transaction hash',
		'Example: getContractResultFromMirror.js MissionFactory 0.0.3566849@1708780635.278906242',
	]);

	const contractName = args[0];
	const txId = args[1];
	const txIdParsed = translateTransactionForWebCall(txId);

	printHeader({
		scriptName: 'Get Contract Result',
		env,
		contractName,
		transactionId: txId,
		parsedTxId: txIdParsed,
	});

	const contractIface = loadInterface(contractName);

	const result = await getContractResult(env, txIdParsed, contractIface);

	console.log('\n-Transaction Receipt:', result);
};

runScript(main);
