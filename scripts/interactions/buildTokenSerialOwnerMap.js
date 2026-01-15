/**
 * Build a map of token serials to their delegated owners
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'buildTokenSerialOwnerMap.js 0.0.LDR 0.0.WW1,0.0.WW2... [0.0.TT1,0.0.TT2...]', [
		'LDR is the LazyDelegateRegistry address',
		'WW1,WW2... is the list of wallet addresses to check',
		'TT1,TT2... is the [optional] list of token addresses to check',
	]);

	const contractId = ContractId.fromString(args[0]);
	const walletList = args[1].split(',').map((w) => AccountId.fromString(w));
	let tokenList = [];
	if (args.length === 3) {
		tokenList = args[2].split(',').map((t) => TokenId.fromString(t));
	}

	printHeader({
		scriptName: 'Build Token Serial Owner Map',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		wallets: walletList.map((w) => w.toString()).join(', '),
	});

	if (tokenList.length > 0) {
		console.log('\n-Checking Tokens:', tokenList.map((t) => t.toString()).join(', '));
	}
	else {
		console.log('\n-Checking Tokens: All');
	}

	const ldrIface = loadInterface('LazyDelegateRegistry');

	const tokentoSerialUserMap = new Map();

	for (const wallet of walletList) {
		// query the EVM via mirror node (readOnlyEVMFromMirrorNode)
		const encodedCommand = ldrIface.encodeFunctionData(
			'getNFTsDelegatedTo',
			[wallet.toSolidityAddress()],
		);

		const result = await readOnlyEVMFromMirrorNode(
			env,
			contractId,
			encodedCommand,
			operatorId,
			false,
		);

		const tokensAndSerials = ldrIface.decodeFunctionResult(
			'getNFTsDelegatedTo',
			result,
		);

		// tokensAndSerials is an array of [tokenId[], serial[][]]]
		for (let i = 0; i < tokensAndSerials[0].length; i++) {
			const tokenId = TokenId.fromSolidityAddress(tokensAndSerials[0][i]);
			const serials = tokensAndSerials[1][i];
			const serialUserMap = tokentoSerialUserMap.get(tokenId.toString()) ?? new Map();
			for (let j = 0; j < serials.length; j++) {
				const serial = serials[j];
				if (serial != 0) {
					serialUserMap.set(Number(serial), wallet.toString());
				}
			}
			tokentoSerialUserMap.set(tokenId.toString(), serialUserMap);
		}
	}

	// Print the map
	console.log('\nToken Serial Owner Map:');
	for (const [tokenId, serialUserMap] of tokentoSerialUserMap) {
		console.log(`Token ${tokenId.toString()}`);
		for (const [serial, owner] of serialUserMap) {
			console.log(`  Serial ${serial} - ${owner}`);
		}
	}
};

runScript(main);
