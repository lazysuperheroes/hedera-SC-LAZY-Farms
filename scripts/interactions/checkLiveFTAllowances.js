/**
 * Batch check live FT allowances via LazyAllowanceUtility
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, parseCommaList } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(4, 'checkLiveFTAllowances.js 0.0.CCC 0.0.TOKEN1,0.0.TOKEN2 0.0.OWNER1,0.0.OWNER2 0.0.SPENDER1,0.0.SPENDER2', [
		'BATCH CHECK VERSION',
		'CCC is the LazyAllowanceUtility address',
		'TOKEN1,TOKEN2,... is the FT token list we are checking for live allowances',
		'OWNER1,OWNER2,... is the owners of the token(s)',
		'SPENDER1,SPENDER2,... is the spenders of the tokens',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[1]).map(t => TokenId.fromString(t));
	const ownerList = parseCommaList(args[2]).map(t => AccountId.fromString(t));
	const spenderList = parseCommaList(args[3]).map(t => AccountId.fromString(t));

	printHeader({
		scriptName: 'Check Live FT Allowances (Batch)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token(s)': tokenList.map(t => t.toString()).join(', '),
			'Owner(s)': ownerList.map(t => t.toString()).join(', '),
			'Spender(s)': spenderList.map(t => t.toString()).join(', '),
		},
	});

	const allowanceIface = loadInterface('LazyAllowanceUtility');

	const encodedCommand = allowanceIface.encodeFunctionData('checkLiveAllowances', [
		tokenList.map(t => t.toSolidityAddress()),
		ownerList.map(o => o.toSolidityAddress()),
		spenderList.map(s => s.toSolidityAddress()),
	]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const approved = allowanceIface.decodeFunctionResult('checkLiveAllowances', result);

	for (let i = 0; i < tokenList.length; i++) {
		console.log(
			'Token:', tokenList[i].toString(),
			'Owner:', ownerList[i].toString(),
			'Spender:', spenderList[i].toString(),
			'Live Allowance:', Number(approved[0][i]),
		);
	}
};

runScript(main);
