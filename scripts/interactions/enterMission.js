/**
 * Enter a mission by staking NFTs
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient, getCommonContractIds, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, formatTokenAmount, parseNestedList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { contractExecuteQuery } = require('../../utils/solidityHelpers');
const { setFTAllowance, setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { checkFTAllowances, getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	// Initialize client and get environment
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_TOKEN_ID', 'LAZY_GAS_STATION_CONTRACT_ID'],
	});

	const { lazyTokenId, lazyGasStationId } = getCommonContractIds();
	const LAZY_DECIMALS = getLazyDecimals();

	// Parse arguments
	const args = parseArgs(3, 'enterMission.js 0.0.MMMM 0.0.Req1,0.0.Req2 1,2,5:2,3,4', [
		'MMM is the mission address',
		'list of requirement tokens to stake (comma separated - no spaces)',
		'list of serials to stake (comma separated - no spaces - : to break per token)',
		'Example: shown suggests Req1 serials 1,2,5 and Req2 serials 2,3,4',
	]);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);
	const tokenIdList = args[1].split(',').map(t => TokenId.fromString(t));
	const tokenIdAsSolidity = tokenIdList.map(t => t.toSolidityAddress());
	const serials = parseNestedList(args[2]);

	// Print header
	printHeader({
		scriptName: 'Enter Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} => ${args[0]}`,
		additionalInfo: {
			'Tokens': tokenIdList.map(t => t.toString()).join(', '),
			'Serials': JSON.stringify(serials),
		},
	});

	// Load contract interface
	const missionIface = loadInterface('Mission');

	// Check mission entry fee
	const entryFee = await contractExecuteQuery(contractId, missionIface, client, null, 'entryFee');
	const fee = Number(entryFee[0]);
	console.log('\n-Entry Fee:', formatTokenAmount(fee, LAZY_DECIMALS, '$LAZY'));

	// Check $LAZY allowance to LGS
	console.log('\nChecking Allowances...');
	const mirrorFTAllowances = await checkFTAllowances(env, operatorId);
	let hasAllowance = false;

	for (const allowance of mirrorFTAllowances) {
		if (allowance.token_id === lazyTokenId.toString() &&
			allowance.spender === lazyGasStationId.toString()) {
			if (allowance.amount < fee) {
				console.log('ERROR: Insufficient $LAZY allowance to LGS');
				confirmOrExit('Do you want to set the allowance?');

				const result = await setFTAllowance(client, lazyTokenId, operatorId, lazyGasStationId, fee);
				if (result[0]?.status?.toString() !== 'SUCCESS') {
					console.log('Error setting $LAZY allowance to LGS:', result);
					return;
				}
				console.log('ALLOWANCE SET: $LAZY allowance to LGS', formatTokenAmount(fee, LAZY_DECIMALS));
			}
			console.log('FOUND: Sufficient $LAZY allowance to LGS', formatTokenAmount(allowance.amount, LAZY_DECIMALS));
			hasAllowance = true;
			break;
		}
	}

	if (!hasAllowance) {
		console.log('ERROR: No $LAZY allowance to LGS found');
		confirmOrExit('Do you want to set the allowance?');

		const result = await setFTAllowance(client, lazyTokenId, operatorId, lazyGasStationId, fee);
		if (result !== 'SUCCESS') {
			console.log('Error setting $LAZY allowance to LGS:', result);
			return;
		}
		console.log('ALLOWANCE SET: $LAZY allowance to LGS', formatTokenAmount(fee, LAZY_DECIMALS));
	}

	// Confirm mission entry
	confirmOrExit('Do you want to set NFT allowances and enter the mission?');

	// Set NFT allowances
	await setNFTAllowanceAll(client, tokenIdList, operatorId, contractId);

	// Enter mission
	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.MISSION_ENTER,
		'enterMission',
		[tokenIdAsSolidity, serials],
		multisigOptions,
	);

	logResult(result, 'Mission Entered');
};

runScript(main);
