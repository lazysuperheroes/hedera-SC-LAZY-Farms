/**
 * Stake NFTs in LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseNestedList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { generateStakingRewardProof, Stake } = require('../../utils/LazyNFTStakingHelper');
const { calculateStakeGas } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, signingKey, env } = createHederaClient({
		requireOperator: true,
		requireSigningKey: true,
	});

	const args = parseArgs(5, 'stakeNFT.js 0.0.SSS 0.0.CCC1,0.0.CCC2 S1,S2:S3,S4 R1,R2:R3,R4 <boostRate>', [
		'0.0.SSS is the LazyNFTStaking contract',
		'0.0.CCC1,0.0.CCC2 is the collections (comma separated - no spaces)',
		'S1,S2:S3,S4 is the list of serials (colon separated arrays)',
		'R1,R2:R3,R4 is the list of reward rates (colon separated arrays)',
		'<boostRate> is the boost rate for the message',
		'Example: stakeNFT.js 0.0.123 0.0.456,0.0.789 1,2,5:3,4,9 5,10,1:20,2,4 100',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = args[1].split(',').map(t => TokenId.fromString(t));
	const tokenListAsSolidity = tokenList.map(t => t.toSolidityAddress());
	const serialArrayList = parseNestedList(args[2]);
	const rewardRates = parseNestedList(args[3]);
	const boostRate = parseInt(args[4], 10);

	if (tokenList.length !== rewardRates.length) {
		console.log('Error: Reward rates length must match token list length');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Staking',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collection(s)': tokenList.map(t => t.toString()).join(', '),
			'Serials': JSON.stringify(serialArrayList),
			'Reward Rates': JSON.stringify(rewardRates),
			'Boost Rate': boostRate,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	confirmOrExit('Do you want to stake these NFTs?');

	// Build stake objects
	const stakes = [];
	for (let i = 0; i < tokenList.length; i++) {
		stakes.push(new Stake(tokenListAsSolidity[i], serialArrayList[i], rewardRates[i]));
		console.log('Preparing to Stake:', stakes[i]);
	}

	// Generate signature proof
	const rewardProof = await generateStakingRewardProof(operatorId, boostRate, signingKey, stakes);

	const gas = calculateStakeGas(tokenList.length);

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		gas,
		'stake',
		[stakes, rewardProof],
		multisigOptions,
	);

	logResult(result, 'Stake executed');
};

runScript(main);
