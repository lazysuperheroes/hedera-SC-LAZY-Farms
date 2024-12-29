const {
	ContractId,
	AccountId,
	Client,
} = require('@hashgraph/sdk');
require('dotenv').config();
const { ethers } = require('ethers');
const { default: axios } = require('axios');

const operatorId = process.env.ACCOUNT_ID ?? '0.0.888';
let env = process.env.ENVIRONMENT ?? null;

const main = async () => {

	const args = process.argv.slice(2);
	if ((args.length != 1) || getArgFlag('h')) {
		console.log('Usage: calculateClaimedLazy.js 0.0.LSC');
		console.log('       LSC is the Lazy Staking Contract address');
		return;
	}

	const secureTradeContract = args[0];

	if (!secureTradeContract) {
		console.log('ERROR: No secure trade contract provided');
		return;
	}


	const contractId = ContractId.fromString(secureTradeContract);

	console.log('\n-Using ENIVRONMENT:', env, 'operatorId:', operatorId, 'contractId:', contractId.toString());

	const stcIface = new ethers.Interface(
		[
			'event ClaimedRewards(address _user, uint256 _rewardAmount, uint256 _burnPercentage)',
		],
	);

	// Call the function to fetch logs
	const lazyClaimedEvents = await getLazyClaimedViaEventsFromMirror(contractId, stcIface);

	console.log('INFO: Total claimed events:', lazyClaimedEvents.length);

	let totalClaimed = 0;
	// convert to a map of user to total claimed
	const userToClaimed = new Map();
	lazyClaimedEvents.forEach(event => {
		const user = event.user;
		const rewardAmount = event.rewardAmount;

		totalClaimed += rewardAmount;

		const userTotalClaimed = userToClaimed.get(user) ?? 0;
		userToClaimed.set(user, userTotalClaimed + rewardAmount);
	});

	console.log('INFO: Total users:', userToClaimed.size);

	// sort the users by total claimed and output the top 25
	const sortedUsers = [...userToClaimed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
	console.log('INFO: Top 25 users:');
	const hederaClient = Client.forName(env);
	const acctMap = new Map();
	// populate the account numbers
	await Promise.all(sortedUsers.map(async (entry) => {
		const accountId = await AccountId.fromString(entry[0]).populateAccountNum(hederaClient);
		acctMap.set(entry[0], `${accountId.shard}.${accountId.realm}.${accountId.num}`);
	}));

	// now output the sorted users with rank
	sortedUsers.forEach((entry, index) => {
		console.log(`${index + 1}: ${acctMap.get(entry[0])}: ${formatLazyAmount(entry[1])}`);
	});

	// output the results
	console.log('INFO: Total claimed:', formatLazyAmount(totalClaimed));

};

async function getLazyClaimedViaEventsFromMirror(contractId, iface) {
	const baseUrl = getBaseURL();

	let url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100`;
	// console.log('INFO: Fetching logs from:', url);

	const claimEvents = [];

	do {
		const response = await axios.get(url);
		const jsonResponse = response.data;
		jsonResponse.logs.forEach(log => {
			// decode the event data
			if (log.data == '0x') return;

			const event = iface.parseLog({ topics: log.topics, data: log.data });
			if (!event) return;

			/**
			 * event ClaimedRewards(
					address _user,
					uint256 _rewardAmount,
					uint256 _burnPercentage
				);
			 */

			switch (event.name) {
			case 'ClaimedRewards':
				claimEvents.push({ user: event.args._user, rewardAmount: Number(event.args._rewardAmount), burnPercentage: Number(event.args._burnPercentage) });
				break;
			default:
				break;
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

function getArgFlag(flag) {
	return process.argv.includes(`--${flag}`);
}

function getBaseURL() {
	switch (env.toLowerCase()) {
	case 'mainnet':
		return 'https://mainnet-public.mirrornode.hedera.com';
	case 'main':
		env = 'mainnet';
		return 'https://mainnet.mirrornode.hedera.com';
	case 'test':
		env = 'testnet';
		return 'https://testnet.mirrornode.hedera.com';
	case 'testnet':
		return 'https://testnet.mirrornode.hedera.com';
	case 'preview':
		env = 'previewnet';
		return 'https://previewnet.mirrornode.hedera.com';
	case 'previewnet':
		return 'https://previewnet.mirrornode.hedera.com';
	case 'local':
		return 'http://localhost:5551';
	default:
		throw new Error(`Unknown environment: ${env}`);
	}
}

main()
	.then(() => {
		console.log('INFO: Completed @', new Date().toUTCString());
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

const formatLazyAmount = (amount) => {
	return (amount / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
