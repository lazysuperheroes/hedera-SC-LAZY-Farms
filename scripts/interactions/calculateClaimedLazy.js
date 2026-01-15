/**
 * Calculate total $LAZY claimed from staking contract events
 * Refactored to use shared utilities
 */
const { ContractId, AccountId, Client } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { default: axios } = require('axios');
const { getBaseURL } = require('../../utils/hederaMirrorHelpers');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	const args = parseArgs(1, 'calculateClaimedLazy.js 0.0.LSC', [
		'LSC is the Lazy Staking Contract address',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Calculate Claimed $LAZY',
		env,
		contractId: contractId.toString(),
	});

	const stcIface = new ethers.Interface([
		'event ClaimedRewards(address _user, uint256 _rewardAmount, uint256 _burnPercentage)',
	]);

	// Fetch and parse events from mirror node
	const lazyClaimedEvents = await getLazyClaimedViaEventsFromMirror(contractId, stcIface);

	console.log('INFO: Total claimed events:', lazyClaimedEvents.length);

	let totalClaimed = 0;
	// Convert to a map of user to total claimed
	const userToClaimed = new Map();
	lazyClaimedEvents.forEach(event => {
		const user = event.user;
		const rewardAmount = event.rewardAmount;

		totalClaimed += rewardAmount;

		const userTotalClaimed = userToClaimed.get(user) ?? 0;
		userToClaimed.set(user, userTotalClaimed + rewardAmount);
	});

	console.log('INFO: Total users:', userToClaimed.size);

	// Sort users by total claimed and output the top 25
	const sortedUsers = [...userToClaimed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
	console.log('INFO: Top 25 users:');

	const hederaClient = Client.forName(env);
	const acctMap = new Map();

	// Populate the account numbers
	await Promise.all(sortedUsers.map(async (entry) => {
		const accountId = await AccountId.fromString(entry[0]).populateAccountNum(hederaClient);
		acctMap.set(entry[0], `${accountId.shard}.${accountId.realm}.${accountId.num}`);
	}));

	// Output the sorted users with rank
	sortedUsers.forEach((entry, index) => {
		console.log(`${index + 1}: ${acctMap.get(entry[0])}: ${formatLazyAmount(entry[1])}`);
	});

	// Output the results
	console.log('INFO: Total claimed:', formatLazyAmount(totalClaimed));
};

/**
 * Fetch ClaimedRewards events from mirror node
 * @param {ContractId} contractId
 * @param {ethers.Interface} iface
 * @returns {Promise<Array>} Array of claim events
 */
async function getLazyClaimedViaEventsFromMirror(contractId, iface) {
	const baseUrl = getBaseURL(env);
	let url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100`;

	const claimEvents = [];

	do {
		const response = await axios.get(url);
		const jsonResponse = response.data;
		jsonResponse.logs.forEach(log => {
			// Decode the event data
			if (log.data == '0x') return;

			const event = iface.parseLog({ topics: log.topics, data: log.data });
			if (!event) return;

			if (event.name === 'ClaimedRewards') {
				claimEvents.push({
					user: event.args._user,
					rewardAmount: Number(event.args._rewardAmount),
					burnPercentage: Number(event.args._burnPercentage),
				});
			}
		});

		if (!jsonResponse.links.next) {
			break;
		}
		url = `${baseUrl}${jsonResponse.links.next}`;
	}
	while (url);

	return claimEvents;
}

/**
 * Format $LAZY amount for display (1 decimal = 10 units)
 * @param {number} amount - Raw amount in smallest units
 * @returns {string} Formatted amount
 */
const formatLazyAmount = (amount) => {
	return (amount / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

runScript(main);
