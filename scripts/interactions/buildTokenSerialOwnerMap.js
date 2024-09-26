const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
}

const contractName = 'LazyDelegateRegistry';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if ((args.length < 2 || args.length > 3) || getArgFlag('h')) {
		console.log('Usage: buildTokenSerialOwnerMap.js 0.0.LDR 0.0.WW1,0.0.WW2... [0.0.TT1,0.0.TT2...]');
		console.log('       LDR is the LazyDelegateRegistry address');
		console.log('       WW1,WW2... is the list of wallet addresses to check');
		console.log('       TT1,TT2... is the [optional] list of token addresses to check');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const walletList = args[1].split(',').map((w) => AccountId.fromString(w));
	let tokenList = [];
	if (args.length === 3) {
		tokenList = args[2].split(',').map((t) => TokenId.fromString(t));
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using Contract:', contractId.toString());
	console.log('-Checking Wallets:', walletList.map((w) => w.toString()).join(', '));

	if (tokenList.length > 0) {
		console.log('\n-Checking Tokens:', tokenList.map((t) => t.toString()).join(', '));
	}
	else {
		console.log('\n-Checking Tokens: All');
	}

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	const tokentoSerialUserMap = new Map();

	for (const wallet of walletList) {

		// query the EVM via mirror node (readOnlyEVMFromMirrorNode)
		const encodedCommand = boostManagerIface.encodeFunctionData(
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

		const tokensAndSerials = boostManagerIface.decodeFunctionResult(
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

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
