/**
 * Add reward serials to a Mission contract
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { getSerialsOwned, getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

/**
 * Shuffle an array using Fisher-Yates algorithm
 */
function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'addRewardsToMission.js <missionId> <tokenId> <serials>', [
		'<missionId> - Mission contract ID (e.g., 0.0.12345)',
		'<tokenId> - NFT token ID to add as rewards (e.g., 0.0.5678)',
		'<serials> - Serial numbers to add, options:',
		'    - Comma-separated list: 1,2,5,10',
		'    - "random:N" to pick N random serials from owned',
		'    - "random:N:start-end" to pick N random from range (e.g., random:10:1-100)',
		'    - "all" to add all owned serials',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenId = TokenId.fromString(args[1]);
	const serialsArg = args[2];

	// Get token info from mirror node
	const tokenInfo = await getTokenDetails(env, tokenId);
	if (!tokenInfo) {
		console.log('ERROR: Token not found:', tokenId.toString());
		process.exit(1);
	}

	console.log('Token Info:', tokenInfo.name, `(${tokenInfo.symbol})`);

	// Get list of owned serials from mirror node
	let ownedSerials = await getSerialsOwned(env, operatorId, tokenId);

	if (ownedSerials.length === 0) {
		console.log('ERROR: No serials found for token', tokenId.toString());
		process.exit(1);
	}

	console.log('Total owned serials:', ownedSerials.length);
	if (ownedSerials.length <= 50) {
		console.log('Owned serials:', ownedSerials.join(', '));
	}
	else {
		const minSerial = Math.min(...ownedSerials);
		const maxSerial = Math.max(...ownedSerials);
		console.log(`Serial range: ${minSerial} to ${maxSerial}`);
	}

	// Parse serials argument
	let serials = [];
	if (serialsArg === 'all') {
		serials = ownedSerials;
	}
	else if (serialsArg.startsWith('random:')) {
		const parts = serialsArg.split(':');
		const count = parseInt(parts[1]);

		// Apply range filter if specified
		if (parts[2]) {
			const [start, end] = parts[2].split('-').map(n => parseInt(n));
			ownedSerials = ownedSerials.filter(s => s >= start && s <= end);
			console.log(`Filtered to range ${start}-${end}: ${ownedSerials.length} serials`);
		}

		if (count > ownedSerials.length) {
			console.log(`ERROR: Requested ${count} serials but only ${ownedSerials.length} available`);
			process.exit(1);
		}

		// Shuffle multiple times for better randomization
		ownedSerials = shuffleArray(ownedSerials);
		ownedSerials = shuffleArray(ownedSerials);
		ownedSerials = shuffleArray(ownedSerials);
		ownedSerials = shuffleArray(ownedSerials);

		serials = ownedSerials.slice(0, count);
	}
	else {
		serials = parseCommaList(serialsArg).map(s => parseInt(s, 10));

		// Validate all serials are owned
		const notOwned = serials.filter(s => !ownedSerials.includes(s));
		if (notOwned.length > 0) {
			console.log('ERROR: The following serials are not owned:', notOwned.join(', '));
			process.exit(1);
		}
	}

	printHeader({
		scriptName: 'Add Rewards to Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Token': `${tokenId.toString()} - ${tokenInfo.name} (${tokenInfo.symbol})`,
			'Serials Count': serials.length,
			'Serials': serials.length <= 50 ? serials.join(', ') : `${serials.slice(0, 20).join(', ')}... and ${serials.length - 20} more`,
		},
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to add these reward serials to the mission?');

	// Set NFT allowance
	let result = await setNFTAllowanceAll(
		client,
		[tokenId],
		operatorId,
		contractId,
	);

	if (result !== 'SUCCESS') {
		console.log('Error setting NFT allowance:', result);
		return;
	}

	// Add rewards to mission
	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		GAS.ADMIN_CALL + serials.length * 100_000,
		'addRewardSerials',
		[tokenId.toSolidityAddress(), serials],
	);

	logResult(result, 'Added Reward Serials');
};

runScript(main);
