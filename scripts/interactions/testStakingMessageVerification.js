/**
 * Test staking message signature verification
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, parseNestedList, parseCommaList } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { generateStakingRewardProof, Stake } = require('../../utils/LazyNFTStakingHelper');

const main = async () => {
	const { operatorId, signingKey, env } = createHederaClient({
		requireOperator: true,
		requireSigningKey: true,
	});

	const args = parseArgs(5, 'testStakingMessageVerification.js 0.0.SSS 0.0.CCC1,0.0.CCC2,0.0.CCC3 S1,S2:S3,S4 R1,R2:R3,R4 <boostRate>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'0.0.CCC1,0.0.CCC2,0.0.CCC3 is the collections to add to the the message (comma separated - no spaces)',
		'S1,S2:S3,S4 is the list of serials (comma separated arrays - no spaces then colon separated)',
		'R1,R2:R3,R4 is the list of reward rates (comma separated arrays - no spaces then colon separated)',
		'<boostRate> is the boost rate for the message',
		'Example: testStakingMessageVerification.js 0.0.123 0.0.456,0.0.789 1,2,5:3,4,9 5,10,1:20,2,4 100',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[1]).map((t) => TokenId.fromString(t));
	const tokenListAsSolidity = tokenList.map((t) => t.toSolidityAddress());
	const serialArrayList = parseNestedList(args[2], true);
	const rewardRates = parseNestedList(args[3], true);
	const boostRate = parseInt(args[4]);

	// Check reward rates length is same as token list
	if (tokenList.length !== rewardRates.length) {
		console.log('Error: Reward rates length must match token list length');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Signature Validation Only',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collection(s)': tokenList.map((t) => t.toString()).join(', '),
			'Serials': JSON.stringify(serialArrayList),
			'Reward Rate': JSON.stringify(rewardRates),
			'Boost Rate': boostRate.toString(),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	confirmOrExit('Do you want to test the signature verification?');

	// Gather the Staking objects
	const stakes = [];

	for (let i = 0; i < tokenList.length; i++) {
		stakes.push(new Stake(tokenListAsSolidity[i], serialArrayList[i], rewardRates[i]));
		console.log('Preparing to Stake:', stakes[i]);
	}

	// Create the signature - pack the variables and hash them in the same order and manner as the contract
	const rewardProof = await generateStakingRewardProof(
		operatorId,
		boostRate,
		signingKey,
		stakes,
	);

	const encodedCommand = lnsIface.encodeFunctionData(
		'isValidSignature',
		[stakes, rewardProof],
	);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const valid = lnsIface.decodeFunctionResult(
		'isValidSignature',
		result,
	);

	console.log('Signature is valid:', valid[0]);
};

runScript(main);
