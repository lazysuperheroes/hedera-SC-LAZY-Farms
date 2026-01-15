const fs = require('fs');
const { ethers, ZeroAddress } = require('ethers');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	Client,
	AccountId,
	PrivateKey,
	TokenId,
	ContractId,
	ContractFunctionParameters,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');

const {
	contractDeployFunction,
	contractExecuteFunction,
	contractExecuteQuery,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokensToAccount,
	mintNFT,
	sendNFT,
	sendHbar,
	setFTAllowance,
	sendNFTDefeatRoyalty,
	setNFTAllowanceAll,
	clearNFTAllowances,
	clearFTAllowances,
	setHbarAllowance,
	clearHbarAllowances,
} = require('../utils/hederaHelpers');
const { fail } = require('assert');
const { checkLastMirrorEvent, checkFTAllowances, checkMirrorBalance, checkHbarAllowances } = require('../utils/hederaMirrorHelpers');
const { sleep } = require('../utils/nodeHelpers');
require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}
const contractName = 'MissionFactory';
const lazyContractCreator = 'LAZYTokenCreator';
const boostManagerName = 'BoostManager';
const lazyGasStationName = 'LazyGasStation';
const prngName = 'PrngSystemContract';
const missionTemplateName = 'Mission';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const env = process.env.ENVIRONMENT ?? null;
const LAZY_BURN_PERCENT = process.env.LAZY_BURN_PERCENT ?? 25;
const LAZY_BOOST_COST = process.env.LAZY_BOOST_COST ?? 100;
const LAZY_BOOST_REDUCTION = process.env.LAZY_BOOST_REDUCTION ?? 10;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let factoryContractId, boostManagerId, prngId, missionTemplateId, ldrId;
let contractAddress;
let missionFactoryIface, lazyIface, missionIface, boostManagerIface, lazyGasStationIface, ldrIface;
let lazyTokenId;
let alicePK, aliceId;
let bobPK, bobId;
let client;
let lazySCT;
let ReqA_TokenId, ReqB_TokenId, ReqC_TokenId, RewardA_TokenId, RewardB_TokenId;
let missionA,
	missionB,
	missionC,
	missionD,
	missionE,
	missionF,
	missionG,
	missionH,
	missionI,
	missionJ,
	missionK;
let lazyGasStationId;

const operatorFtAllowances = [];
const operatorNftAllowances = [];

describe('Deployment', () => {
	it('Should deploy the contract and setup conditions', async () => {
		if (
			operatorKey === undefined ||
			operatorKey == null ||
			operatorId === undefined ||
			operatorId == null
		) {
			console.log(
				'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
			);
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromBytesED25519(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			// create an operator account on the local node and use this for testing as operator
			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		}
		else {
			console.log(
				'ERROR: Must specify either MAIN or TEST or LOCAL as environment in .env file',
			);
			return;
		}

		client.setOperator(operatorId, operatorKey);
		client.setDefaultMaxQueryPayment(new Hbar(2));
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		// moving account create up to fail fast is the service is busy.

		// create Alice account
		if (process.env.ALICE_ACCOUNT_ID && process.env.ALICE_PRIVATE_KEY) {
			aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID);
			alicePK = PrivateKey.fromStringED25519(process.env.ALICE_PRIVATE_KEY);
			console.log('\n-Using existing Alice:', aliceId.toString());
		}
		else {
			alicePK = PrivateKey.generateED25519();
			aliceId = await accountCreator(client, alicePK, 350);
			console.log(
				'Alice account ID:',
				aliceId.toString(),
				'\nkey:',
				alicePK.toString(),
			);
		}
		expect(aliceId.toString().match(addressRegex).length == 2).to.be.true;

		// create Bob account
		if (process.env.BOB_ACCOUNT_ID && process.env.BOB_PRIVATE_KEY) {
			bobId = AccountId.fromString(process.env.BOB_ACCOUNT_ID);
			bobPK = PrivateKey.fromStringED25519(process.env.BOB_PRIVATE_KEY);
			console.log('\n-Using existing Bob:', bobId.toString());
		}
		else {
			bobPK = PrivateKey.generateED25519();
			bobId = await accountCreator(client, bobPK, 100);
			console.log(
				'Bob account ID:',
				bobId.toString(),
				'\nkey:',
				bobPK.toString(),
			);
		}
		expect(bobId.toString().match(addressRegex).length == 2).to.be.true;

		// outside the if statement as we always need this abi
		// check if LAZY SCT has been deployed
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		// import ABIs
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyContractBytecode = lazyJson.bytecode;

		let lazyDeploySkipped = false;
		if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
			console.log(
				'\n-Using existing LAZY SCT:',
				process.env.LAZY_SCT_CONTRACT_ID,
			);
			lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);

			lazyDeploySkipped = true;

			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
			console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
		}
		else {
			const gasLimit = 4_800_000;

			console.log(
				'\n- Deploying contract...',
				lazyContractCreator,
				'\n\tgas@',
				gasLimit,
			);

			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode, gasLimit);

			console.log(
				`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
			);

			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				2_500_000_000,
				LAZY_DECIMAL,
				2_500_000_000,
				30,
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		const lazyGasStationJSON = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);
		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Gas Station:',
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
			lazyGasStationId = ContractId.fromString(
				process.env.LAZY_GAS_STATION_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 6_800_000;
			console.log(
				'\n- Deploying contract...',
				lazyGasStationName,
				'\n\tgas@',
				gasLimit,
			);

			const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

			const lazyGasStationParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazySCT.toSolidityAddress());

			[lazyGasStationId] = await contractDeployFunction(
				client,
				lazyGasStationBytecode,
				gasLimit,
				lazyGasStationParams,
			);

			console.log(
				`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`,
			);

			expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be
				.true;
		}

		const ldrJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		ldrIface = new ethers.Interface(ldrJson.abi);

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Delegate Registry:',
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
			ldrId = ContractId.fromString(
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 6_800_000;

			const ldrBytecode = ldrJson.bytecode;

			console.log('\n- Deploying contract...', lazyDelegateRegistryName, '\n\tgas@', gasLimit);

			[ldrId] = await contractDeployFunction(client, ldrBytecode, gasLimit);

			console.log(
				`Lazy Delegate Registry contract created with ID: ${ldrId} / ${ldrId.toSolidityAddress()}`,
			);

			expect(ldrId.toString().match(addressRegex).length == 2).to.be.true;
		}

		const boostManagerJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${boostManagerName}.sol/${boostManagerName}.json`,
			),
		);

		boostManagerIface = new ethers.Interface(boostManagerJson.abi);
		// deploy boost manager
		if (process.env.BOOST_MANAGER_CONTRACT_ID) {
			console.log(
				'\n-Using existing Boost Manager:',
				process.env.BOOST_MANAGER_CONTRACT_ID,
			);
			boostManagerId = ContractId.fromString(
				process.env.BOOST_MANAGER_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 6_800_000;
			console.log(
				'\n- Deploying contract...',
				boostManagerName,
				'\n\tgas@',
				gasLimit,
			);

			const boostManagerBytecode = boostManagerJson.bytecode;

			const boostManagerParams = new ContractFunctionParameters()
				.addAddress(lazyTokenId.toSolidityAddress())
				.addAddress(lazyGasStationId.toSolidityAddress())
				.addAddress(ldrId.toSolidityAddress())
				.addUint256(LAZY_BURN_PERCENT);

			[boostManagerId] = await contractDeployFunction(
				client,
				boostManagerBytecode,
				gasLimit,
				boostManagerParams,
			);

			console.log(
				`Boost Manager contract created with ID: ${boostManagerId} / ${boostManagerId.toSolidityAddress()}`,
			);
		}

		expect(boostManagerId.toString().match(addressRegex).length == 2).to.be.true;

		// deploy PRNG
		if (process.env.PRNG_CONTRACT_ID) {
			console.log('\n-Using existing PRNG:', process.env.PRNG_CONTRACT_ID);
			prngId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		}
		else {
			const gasLimit = 6_800_000;
			console.log('\n- Deploying contract...', prngName, '\n\tgas@', gasLimit);
			const prngJson = JSON.parse(
				fs.readFileSync(
					`./artifacts/contracts/${prngName}.sol/${prngName}.json`,
				),
			);

			const prngBytecode = prngJson.bytecode;

			[prngId] = await contractDeployFunction(client, prngBytecode, gasLimit);

			console.log(
				`PRNG contract created with ID: ${prngId} / ${prngId.toSolidityAddress()}`,
			);
		}

		expect(prngId.toString().match(addressRegex).length == 2).to.be.true;

		const gasLimit = 6_800_000;

		// deploy mission template
		const missionTemplateJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${missionTemplateName}.sol/${missionTemplateName}.json`,
			),
		);

		// import ABI
		missionIface = ethers.Interface.from(missionTemplateJson.abi);

		const missionTemplateBytecode = missionTemplateJson.bytecode;

		console.log(
			'\n- Deploying contract...',
			missionTemplateName,
			'\n\tgas@',
			gasLimit,
		);

		[missionTemplateId] = await contractDeployFunction(
			client,
			missionTemplateBytecode,
			gasLimit,
		);

		console.log(
			`Mission Template contract created with ID: ${missionTemplateId} / ${missionTemplateId.toSolidityAddress()}`,
		);

		expect(missionTemplateId.toString().match(addressRegex).length == 2).to.be.true;

		// now deploy main contract
		const missionFactoryJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		// import ABI
		missionFactoryIface = ethers.Interface.from(missionFactoryJson.abi);

		const contractBytecode = missionFactoryJson.bytecode;

		console.log(
			'\n- Deploying contract...',
			contractName,
			'\n\tgas@',
			gasLimit,
		);

		const constructorParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(boostManagerId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(missionTemplateId.toSolidityAddress())
			.addAddress(prngId.toSolidityAddress())
			.addAddress(ldrId.toSolidityAddress());

		[factoryContractId, contractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		expect(factoryContractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log(`Mission Factory Contract created with ID: ${factoryContractId} / ${contractAddress}`);

		// update the Boost Manager with the mission factory contract
		const rslt = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setMissionFactory',
			[factoryContractId.toSolidityAddress()],
		);
		expect(rslt[0].status.toString()).to.be.equal('SUCCESS');

		console.log('\n-Testing:', contractName);

		// mint NFTs from the 3rd part Alice Account
		// ensure royalties in place
		/*
			3 x Requirement NFTs of 18 serials
			 -> test pool with single requirement NFT
				  -> open serials + restricted serials
			 -> test pool with multiple requirement NFTs
				  -> open serials + restricted serials
			2 x Reward NFTs of 8 serials
				-> test pool with single reward NFT
				-> test pool with multiple reward NFTs
		*/

		const reqSize = 25;
		const rewardSize = 25;

		client.setOperator(aliceId, alicePK);
		let [result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Req NFT A',
			'ReqA',
			reqSize,
		);
		expect(result).to.be.equal('SUCCESS');
		ReqA_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Req NFT B',
			'ReqB',
			reqSize,
		);
		expect(result).to.be.equal('SUCCESS');
		ReqB_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Req NFT C',
			'ReqC',
			reqSize,
		);
		expect(result).to.be.equal('SUCCESS');
		ReqC_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Reward NFT A',
			'RewardA',
			rewardSize,
		);
		expect(result).to.be.equal('SUCCESS');
		RewardA_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'Reward NFT B',
			'RewardB',
			rewardSize,
		);
		expect(result).to.be.equal('SUCCESS');
		RewardB_TokenId = tokenId;

		// configure the boost manager
		// use setLazyBoostCost to set the cost of boosting a mission
		// use setLazyBurnPercent to set the % of $LAZY to burn on boost
		client.setOperator(operatorId, operatorKey);

		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setLazyBoostCost',
			[LAZY_BOOST_COST],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// use setLazyBoostReduction for 10 percent reduction
		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setLazyBoostReduction',
			[LAZY_BOOST_REDUCTION],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// use setGemBoostReduction to set boost 0 at 5, 2 at 15 and 4 at 40
		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setGemBoostReduction',
			[0, 5],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setGemBoostReduction',
			[2, 15],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setGemBoostReduction',
			[4, 40],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'setLazyBurnPercentage',
			[LAZY_BURN_PERCENT],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// addCollectionToBoostLevel for the 3 requirement NFTs (doubling up their purpose)
		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			1_300_000,
			'addCollectionToBoostLevel',
			[0, ReqA_TokenId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// SR grade
		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			1_300_000,
			'addCollectionToBoostLevel',
			[2, ReqB_TokenId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// LR Grade
		[result] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			1_300_000,
			'addCollectionToBoostLevel',
			[4, ReqC_TokenId.toSolidityAddress()],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// associate the FTs & NFT to operator
		client.setOperator(operatorId, operatorKey);
		const operatorTokensToAssociate = [];
		if (!lazyDeploySkipped) {
			operatorTokensToAssociate.push(lazyTokenId);
		}
		operatorTokensToAssociate.push(
			ReqA_TokenId,
			ReqB_TokenId,
			ReqC_TokenId,
			RewardA_TokenId,
			RewardB_TokenId,
		);

		result = await associateTokensToAccount(
			client,
			operatorId,
			operatorKey,
			operatorTokensToAssociate,
		);

		expect(result).to.be.equal('SUCCESS');

		// associate the token for Alice
		// alice has the NFTs already associated

		// check the balance of lazy tokens for Alice from mirror node
		const aliceLazyBalance = await checkMirrorBalance(
			env,
			aliceId,
			lazyTokenId,
		);

		if (!aliceLazyBalance) {
			result = await associateTokensToAccount(client, aliceId, alicePK, [
				lazyTokenId,
			]);
			expect(result).to.be.equal('SUCCESS');
		}

		// check the balance of lazy tokens for Bob from mirror node
		const bobLazyBalance = await checkMirrorBalance(env, bobId, lazyTokenId);

		const bobTokensToAssociate = [];
		if (!bobLazyBalance) {
			bobTokensToAssociate.push(lazyTokenId);
		}

		bobTokensToAssociate.push(
			ReqA_TokenId,
			ReqB_TokenId,
			ReqC_TokenId,
			RewardA_TokenId,
			RewardB_TokenId,
		);

		// associate the tokens for Bob
		result = await associateTokensToAccount(client, bobId, bobPK, bobTokensToAssociate);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to all accounts
		client.setOperator(operatorId, operatorKey);
		result = await sendLazy(operatorId, 6000);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(aliceId, 9000);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(bobId, 9000);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to the Lazy Gas Station
		result = await sendLazy(lazyGasStationId, 2500);
		expect(result).to.be.equal('SUCCESS');
		// send 1 hbar to the Lazy Gas Station
		result = await sendHbar(client, operatorId, AccountId.fromString(lazyGasStationId.toString()), 1, HbarUnit.Hbar);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to the mission factory to test that method
		result = await sendLazy(factoryContractId, 10);
		expect(result).to.be.equal('SUCCESS');

		// add the Mission Factory to the lazy gas station as an authorizer
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addAuthorizer',
			[factoryContractId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding factory to LGS:', result);
			fail();
		}

		// check the GasStationAccessControlEvent on the mirror node
		await sleep(7500);
		const lgsEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(lgsEvent.toSolidityAddress().toLowerCase()).to.be.equal(factoryContractId.toSolidityAddress());

		// add the Boost Manager to the lazy gas station as a contract user
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addContractUser',
			[boostManagerId.toSolidityAddress()],
		);

		console.log('Adding Boost Manager to LGS:', result[0]?.status.toString(), result[2]?.transactionId?.toString());

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding boost manager to LGS:', result);
			fail();
		}

		/*
		TODO: remove this
		result = await sendLazy(factoryContractId, 1000);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(boostManagerId, 1000);

		// send $LAZY to the boost manager
		result = await sendLazy(boostManagerId, 20);
		expect(result).to.be.equal('SUCCESS');
		*/

		client.setOperator(aliceId, alicePK);
		// send the Rewards to the operator
		let serials = [...Array(rewardSize).keys()].map((x) => ++x);
		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			RewardA_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			RewardB_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		// send requirements 1-5 to Operator and 6-10 to Bob
		serials = [...Array(reqSize).keys()].map((x) => ++x);
		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			ReqA_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			ReqB_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			operatorId,
			ReqC_TokenId,
			serials.slice(0, 5),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			ReqA_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			ReqB_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			bobId,
			ReqC_TokenId,
			serials.slice(5, 10),
		);
		expect(result).to.be.equal('SUCCESS');
	});

	it('Should check access permission for Mission Factory', async () => {
		// bob can't touch sensitive methods
		client.setOperator(bobId, bobPK);

		// get laztToken used
		const lazyToken = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'lazyToken',
		);
		// strip the 0x
		expect(lazyToken[0].toString().slice(2).toLowerCase()).to.be.equal(
			lazyTokenId.toSolidityAddress(),
		);

		// check the boost manager
		const boostManager = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'boostManager',
		);
		expect(boostManager[0].toString().slice(2).toLowerCase()).to.be.equal(
			boostManagerId.toSolidityAddress(),
		);

		// check the PRNG
		const prng = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'prngGenerator',
		);
		expect(prng[0].toString().slice(2).toLowerCase()).to.be.equal(prngId.toSolidityAddress());

		// check the lazyGS
		const lazyGSAddr = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'lazyGasStation',
		);
		expect(lazyGSAddr[0].toString().slice(2).toLowerCase()).to.be.equal(lazyGasStationId.toSolidityAddress());

		// check the mission template
		const missionTemplate = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'missionTemplate',
		);
		expect(missionTemplate[0].toString().slice(2).toLowerCase()).to.be.equal(
			missionTemplateId.toSolidityAddress(),
		);

		// test isAdmin for Bob expecting false
		const isAdmin = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isAdmin',
			[bobId.toSolidityAddress()],
		);
		expect(isAdmin[0]).to.be.false;

		// test isDeployer for Bob expecting false
		const isDeployer = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isDeployer',
			[bobId.toSolidityAddress()],
		);
		expect(isDeployer[0]).to.be.false;

		// get the missions object (expect it to be empty)
		const missions = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'missions',
			[bobId.toSolidityAddress()],
		);
		// TODO: check the missions object
		console.log('missions public getter for bob - expect null');
		console.dir(missions, { depth: 3 });

		// get the creators object (expect it to be empty)
		const creators = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'creators',
			[bobId.toSolidityAddress()],
		);
		// TODO: check the creators object
		console.log('creators public getter for bob - expect null');
		console.dir(creators, { depth: 3 });

		// test getDeployedMissions expecting it to be empty
		const deployedMissions = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			200_000,
			'getDeployedMissions',
		);
		expect(deployedMissions[0].length).to.be.equal(0);

		// test getAvailableSlots expecting both returned arrays to be empty
		const availableSlots = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			200_000,
			'getAvailableSlots',
		);
		expect(availableSlots[0].length).to.be.equal(0);
		expect(availableSlots[1].length).to.be.equal(0);

		// test getLiveMissions expecting all three returned arrays to be empty
		const liveMissions = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			200_000,
			'getLiveMissions',
			[bobId.toSolidityAddress()],
		);
		expect(liveMissions[0].length).to.be.equal(0);
		expect(liveMissions[1].length).to.be.equal(0);
		expect(liveMissions[2].length).to.be.equal(0);

		let expectedErrorCount = 0;
		let otherErrorCount = 0;
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'setLazyToken',
				[lazyTokenId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(1);

		// test updateLGS expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'updateLGS',
				[lazySCT.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(2);

		// test updateDeployers expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'updateDeployers',
				[[operatorId.toSolidityAddress()], true],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(3);

		// test updateBoostManager expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'updateBoostManager',
				[boostManagerId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(4);

		// test addAdmin expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(5);

		// test removeAdmin expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'removeAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(6);

		// test deployMission expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'deployMission',
				[
					100,
					50,
					[ReqA_TokenId.toSolidityAddress()],
					[RewardA_TokenId.toSolidityAddress()],
					10,
					Math.floor(new Date().getTime() / 1000) + 3600,
					1,
					1,
				],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(7);

		// test updateMissionTemplate expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'updateMissionTemplate',
				[missionTemplateId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(8);

		// test updateMissionPause expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'updateMissionPause',
				[[missionTemplateId.toSolidityAddress()], true],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(9);

		// test setMissionStart expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'setMissionStart',
				[[missionTemplateId.toSolidityAddress()], 0],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(10);

		// test broadcastMissionJoined expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'broadcastMissionJoined',
				[missionTemplateId.toSolidityAddress(), 0],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(11);

		// test broadcastMissionComplete
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'broadcastMissionComplete',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(12);

		// test broadcastSlotsRemaining
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'broadcastSlotsRemaining',
				[100],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.be.equal(13);

		// test broadcastMissionBoost expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'broadcastMissionBoost',
				[
					missionTemplateId.toSolidityAddress(),
					bobId.toSolidityAddress(),
					50,
					Math.floor(new Date().getTime() / 1000) + 3600,
					3600,
					2,
				],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result:', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.equal(14);

		// test closeMission expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				200_000,
				'closeMission',
				[missionTemplateId.toSolidityAddress()],
			);
			console.log(result);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (close mission error)', result);
			}
		}
		catch (e) {
			console.log(e);
			otherErrorCount++;
		}
		expect(expectedErrorCount).to.equal(15);

		// test updatePrngContract	 expecting an error
		try {
			const result = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				null,
				'updatePrngContract',
				[prngId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (update prng)', result);
			}
		}
		catch {
			otherErrorCount++;
		}
		console.log('expectedErrorCount:', expectedErrorCount);
		console.log('otherErrorCount:', otherErrorCount);

		expect(expectedErrorCount).to.be.equal(16);
		expect(otherErrorCount).to.be.equal(0);
	});

	it('Should check admin access permission', async () => {
		// use updateDeployers to add Alice as a deployer
		client.setOperator(operatorId, operatorKey);
		let [result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updateDeployers',
			[[aliceId.toSolidityAddress()], true],
		);

		// test isDeployer for Alice expecting true
		let isDeployer = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isDeployer',
			[aliceId.toSolidityAddress()],
		);
		expect(isDeployer[0]).to.be.true;

		// use addAdmin to add Bob as an admin
		result = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'addAdmin',
			[bobId.toSolidityAddress()],
		);

		// test isAdmin for Bob expecting true
		let isAdmin = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isAdmin',
			[bobId.toSolidityAddress()],
		);
		expect(isAdmin[0]).to.be.true;

		// switch to Bob and remove Alice as a deployer
		client.setOperator(bobId, bobPK);
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updateDeployers',
			[[aliceId.toSolidityAddress()], false],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test isDeployer for Alice expecting false
		isDeployer = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isDeployer',
			[aliceId.toSolidityAddress()],
		);
		expect(isDeployer[0]).to.be.false;

		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'removeAdmin',
			[bobId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test isAdmin for Bob expecting false
		isAdmin = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'isAdmin',
			[bobId.toSolidityAddress()],
		);
		expect(isAdmin[0]).to.be.false;

		// test operator can't remove himself as the Admin (as sole admin)
		client.setOperator(operatorId, operatorKey);
		result = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'removeAdmin',
			[operatorId.toSolidityAddress()],
		);
		expect(result[0]?.status).to.be.equal('REVERT: Last Admin');

		// test updateBoostManager
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updateBoostManager',
			[boostManagerId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test updateMissionTemplate
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updateMissionTemplate',
			[missionTemplateId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test updatePrngContract
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updatePrngContract',
			[prngId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test LGS update
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'updateLGS',
			[lazyGasStationId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');
	});

	it('Should check Access controls for Boost Manager', async () => {
		client.setOperator(bobId, bobPK);

		// getGemCollections
		const gemCollections = await contractExecuteQuery(
			boostManagerId,
			boostManagerIface,
			client,
			500_000,
			'getGemCollections',
		);
		expect(gemCollections[0].length).to.be.greaterThanOrEqual(3);

		let expectedErrorCount = 0;
		let otherErrorCount = 0;

		// test setLazyBoostCost
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				200_000,
				'setLazyBoostCost',
				[10],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(1);

		// setGemBoostReduction
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'setGemBoostReduction',
				[1, 12],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(2);

		// setLazyBoostReduction
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'setLazyBoostReduction',
				[LAZY_BOOST_REDUCTION],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(3);

		// setMissionFactory
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'setMissionFactory',
				[factoryContractId.toSolidityAddress()],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(4);

		// addCollectionToBoostLevel
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'addCollectionToBoostLevel',
				[1, ReqA_TokenId.toSolidityAddress()],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(5);

		// removeCollectionFromBoostLevel
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'removeCollectionFromBoostLevel',
				[0, ReqA_TokenId.toSolidityAddress()],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log(result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(6);

		// setLazyBurnPercentage
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'setLazyBurnPercentage',
				[LAZY_BURN_PERCENT],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				console.log(result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(7);

		// addAdmin
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				console.log(result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		expect(expectedErrorCount).to.be.equal(8);

		// removeAdmin
		try {
			const result = await contractExecuteFunction(
				boostManagerId,
				boostManagerIface,
				client,
				300_000,
				'removeAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status == 'REVERT: Permission Denied - Not Admin') {
				expectedErrorCount++;
			}
			else {
				console.log(result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		console.log('expectedErrorCount:', expectedErrorCount, 'otherErrorCount:', otherErrorCount);
		expect(expectedErrorCount).to.be.equal(9);
		expect(otherErrorCount).to.be.equal(0);
	});

	it('Should check Access controls for Lazy Gas Station', async () => {
		client.setOperator(bobId, bobPK);

		// bob can't add an admin
		let expectedErrorCount = 0;
		let otherErrorCount = 0;

		// retrieveLazy
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'retrieveLazy',
				[bobId.toSolidityAddress(), 100],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('retreiveLazy Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('retrieveLazy Error:', e);
			otherErrorCount++;
		}

		// transferHbar
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'transferHbar',
				[operatorId.toSolidityAddress(), 1],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('TransferHbar Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('TransferHbar Error:', e);
			otherErrorCount++;
		}

		// addAdmin
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'addAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('AddAdmin Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('AddAdmin Error:', e);
			otherErrorCount++;
		}

		// addAuthorizer
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'addAuthorizer',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('AddAuthorizer Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('AddAuthorizer Error:', e);
			otherErrorCount++;
		}

		// removeAuthorizer
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAuthorizer',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('RemoveAuthorizer Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('RemoveAuthorizer Error:', e);
			otherErrorCount++;
		}

		// addContractUser
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'addContractUser',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('AddContractUser Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('AddContractUser Error:', e);
			otherErrorCount++;
		}

		// removeContractUser
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeContractUser',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('RemoveContractUser Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('RemoveContractUser Error:', e);
			otherErrorCount++;
		}

		// removeAdmin
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAdmin',
				[bobId.toSolidityAddress()],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('RemoveAdmin Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('RemoveAdmin Error:', e);
			otherErrorCount++;
		}

		// use operator to ensure an admin can't do it either
		client.setOperator(operatorId, operatorKey);
		// refillLazy
		try {
			const result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'refillLazy',
				[100],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('RefillLazy Unexpected Result:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('RefillLazy Error:', e);
			otherErrorCount++;
		}

		// operator succeeds on adding an admin
		client.setOperator(operatorId, operatorKey);

		// addAdmin
		let result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'addAdmin',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('addAdmin error:', result);
			otherErrorCount++;
		}

		// check the event was emitted to the mirrors
		await sleep(7500);
		const mirrorEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(mirrorEvent.toSolidityAddress().toLowerCase()).to.be.equal(bobId.toSolidityAddress());


		// removeAdmin
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'removeAdmin',
			[bobId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('remove admin error', result);
			otherErrorCount++;
		}

		// expect a fail as you try and remove the final admin
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'removeAdmin',
			[operatorId.toSolidityAddress()],
		);
		// expect a revert "Last Admin"
		if (result[0]?.status?.name == 'LastAdmin') {
			expectedErrorCount++;
		}
		else {
			console.log('removeAdmin (last admin) error:', result);
			otherErrorCount++;
		}

		// check the length of the admins array = 1
		const admins = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAdmins',
		);

		expect(admins[0].length).to.be.equal(1);
		expect(admins[0][0].toString().slice(2).toLowerCase()).to.be.equal(operatorId.toSolidityAddress());

		// check the length of the authorizers array = 1 (factoryContractId)
		const authorizers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAuthorizers',
		);

		expect(authorizers[0].length).to.be.equal(1);
		expect(authorizers[0][0].toString().slice(2).toLowerCase()).to.be.equal(factoryContractId.toSolidityAddress());

		// check no contract users
		const contractUsers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getContractUsers',
		);

		expect(contractUsers[0].length).to.be.equal(1);
		expect(contractUsers[0][0].toString().slice(2).toLowerCase()).to.be.equal(boostManagerId.toSolidityAddress());

		// test addContractUser blocks EOA
		try {
			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'addContractUser',
				[operatorId.toSolidityAddress()],
			);
			if (result[0]?.status?.name == 'BadInput') {
				expectedErrorCount++;
			}
			else {
				console.log('addContractUser error:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log('addContractUser error (catch):', e);
			otherErrorCount++;
		}

		// add boostManagerId as a contract user
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'addContractUser',
			[boostManagerId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('addContractUser error:', result);
			otherErrorCount++;
		}

		// send some HBAR to the contract
		result = await sendHbar(client, operatorId, AccountId.fromString(lazyGasStationId.toString()), 1);
		expect(result).to.be.equal('SUCCESS');

		// test transferHbar
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'transferHbar',
			[operatorId.toSolidityAddress(), 1],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('transfer hbar error', result);
			otherErrorCount++;
		}

		// test retrieveLazy
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			300_000,
			'retrieveLazy',
			[operatorId.toSolidityAddress(), 2],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('retrieveLazy error', result);
			otherErrorCount++;
		}
		console.log('LGS expectedErrorCount:', expectedErrorCount, 'otherErrorCount:', otherErrorCount);

		expect(expectedErrorCount).to.be.equal(11);
		expect(otherErrorCount).to.be.equal(0);
	});
});

describe('Launch Missions', () => {
	it('Mission A: Should deploy a mission with a single requirement NFT and single reward (3 slots) - fixed cost', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 3_000_000;
		const params = [
			90,
			11,
			[ReqA_TokenId.toSolidityAddress()],
			[RewardA_TokenId.toSolidityAddress()],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			if (contractExecuteRx.status.toString() != 'SUCCESS') {
				console.log('Mission A deployment:', contractExecuteRx, contractResults);
			}
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionA = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionA);
		}
		console.log('Mission A: ', missionA.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// check the mission is paused
		const paused = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isPaused',
		);
		expect(paused[0]).to.be.true;

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId], operatorId, AccountId.fromString(`0.0.${missionA.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionA.num}`) });

		// check the LGS for a GasStationAccessControlEvent on the mirror nodes
		await sleep(7500);
		const lgsEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(lgsEvent.toSolidityAddress().toLowerCase()).to.be.equal(missionA.toSolidityAddress());

		// adding serials only requires operator to have $LAZY associated (as pmt against the NFTs)

		// addRewardSerials to the mission
		const result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [1, 2, 3]],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('addRewardSerials error:', result);
			fail();
		}

		// get the entry fee
		const entryFee = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.equal(11);

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionA,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionA, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Check access controls for Mission A', async () => {
		// act as operator
		client.setOperator(operatorId, operatorKey);

		const gasLim = 1_000_000;

		let expectedErrorCount = 0;
		let otherErrorCount = 0;
		let result;

		// test addRewardSerials can't add reward B
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'addRewardSerials',
				[RewardB_TokenId.toSolidityAddress(), [1, 2, 3]],
			);
			if (result[0]?.status.name == 'BadArgument') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log('Unexpected:', result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// Alice can't setStartTimestamp
		client.setOperator(aliceId, alicePK);
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'setStartTimestamp',
				[Math.floor(new Date().getTime() / 1000) + 300],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log('Unexpected:', result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// Alice can find the rewards using getRewards
		const rewardsTx = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			400_000,
			'getRewards',
		);
		// expect rewardsTx[0] to have an array of the rewards collection of length 1 and an array of arrays of corresponding serials
		expect(rewardsTx.length).to.be.equal(2);
		expect(rewardsTx[0].length).to.be.equal(1);
		expect(rewardsTx[0][0].slice(2).toLowerCase()).to.be.equal(RewardA_TokenId.toSolidityAddress());
		expect(rewardsTx[1][0].length).to.be.equal(3);
		expect(Number(rewardsTx[1][0][0])).to.be.equal(1);
		expect(Number(rewardsTx[1][0][1])).to.be.equal(2);
		expect(Number(rewardsTx[1][0][2])).to.be.equal(3);

		// check getRequirements
		// return an array of requirements collections, an array of booleans corresponding to whether serials are limited and an array of arrays of corresponding serials (empty if not limited)
		const requirementsTx = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			400_000,
			'getRequirements',
		);

		expect(requirementsTx.length).to.be.equal(3);
		expect(requirementsTx[0].length).to.be.equal(1);
		expect(requirementsTx[0][0].slice(2).toLowerCase()).to.be.equal(
			ReqA_TokenId.toSolidityAddress(),
		);
		expect(requirementsTx[1].length).to.be.equal(1);
		expect(requirementsTx[1][0]).to.be.false;
		expect(requirementsTx[2].length).to.be.equal(1);
		expect(Number(requirementsTx[2][0].length)).to.be.equal(0);

		// call claimRewards expecting an error
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'claimRewards',
			);
			if (result[0]?.status == 'REVERT: No mission active') {
				expectedErrorCount++;
			}
			else {
				console.log(result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// get the entry fee
		const entryFee = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.equal(11);

		// call leaveMission expecting an error
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'leaveMission',
			);
			if (result[0]?.status == 'REVERT: No mission active') {
				expectedErrorCount++;
			}
			else {
				console.log(result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// call reduceStakingPeriod expecting an error
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'reduceStakingPeriod',
				[aliceId.toSolidityAddress(), 250],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		//  call closeMission expecting an error
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'closeMission',
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// call withdrawRewards expecting an error
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'withdrawRewards',
				[RewardA_TokenId.toSolidityAddress(), [1, 2, 3]],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected:', result);
				otherErrorCount++;
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// check Alice can't change Pause state
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'updatePauseStatus',
				[false],
			);
			if (result[0]?.status.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				otherErrorCount++;
				console.log('Unexpected:', result);
			}
		}
		catch (e) {
			console.log(e.toString());
			otherErrorCount++;
		}

		// check Alice is not an admin using isAdmin
		let isAdmin = await contractExecuteQuery(
			factoryContractId,
			missionIface,
			client,
			null,
			'isAdmin',
			[aliceId.toSolidityAddress()],
		);
		expect(isAdmin[0]).to.be.false;

		// operator adds Alice as Admin
		client.setOperator(operatorId, operatorKey);
		[result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'addAdmin',
			[aliceId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		client.setOperator(aliceId, alicePK);
		// check Alice is not an admin using isAdmin
		isAdmin = await contractExecuteQuery(
			factoryContractId,
			missionIface,
			client,
			null,
			'isAdmin',
			[aliceId.toSolidityAddress()],
		);
		expect(isAdmin[0]).to.be.true;

		// let Alice change Pause state
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'updatePauseStatus',
			[false],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the mission is not paused
		let paused = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isPaused',
		);
		expect(paused[0]).to.be.false;

		// revert the pause state
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'updatePauseStatus',
			[true],
		);

		paused = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isPaused',
		);

		expect(paused[0]).to.be.true;

		client.setOperator(operatorId, operatorKey);
		// remove Alice as Admin
		let rtn = 0;
		[result, rtn] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'removeAdmin',
			[aliceId.toSolidityAddress()],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		console.log('Admin removed:', rtn);
		// send 10 hbar to contract and check it can be removed as no active participants
		result = await sendHbar(
			client,
			operatorId,
			AccountId.fromString(`0.0.${missionA.num}`),
			1,
			HbarUnit.Hbar,
		);
		expect(result).to.be.equal('SUCCESS');

		// retreive funds using transferHbar
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			null,
			'transferHbar',
			[operatorId.toSolidityAddress(), Number(new Hbar(1).toTinybars())],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// send 10 $LAZY to contract and check it can be removed as no active participants
		result = await sendLazy(missionA, 10);
		expect(result).to.be.equal('SUCCESS');

		// retreive funds using retrieveLazy
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			null,
			'retrieveLazy',
			[operatorId.toSolidityAddress(), 10],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		console.log('expectedErrorCount:', expectedErrorCount, 'otherErrorCount:', otherErrorCount);
		expect(expectedErrorCount).to.be.equal(8);
		expect(otherErrorCount).to.be.equal(0);
	});

	it('Mission B: Should deploy a mission with a single requirement NFT and single reward (2 slots) - reducing cost with time', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 3_000_000;
		const params = [
			3,
			20,
			[ReqA_TokenId.toSolidityAddress()],
			[RewardA_TokenId.toSolidityAddress()],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionB = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionB);
		}
		console.log('Mission B: ', missionB.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// check the mission is paused
		const paused = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'isPaused',
		);
		expect(paused[0]).to.be.true;

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId], operatorId, AccountId.fromString(`0.0.${missionB.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionB.num}`) });

		/**
		 * TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionB, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		const result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [4, 5]],
		);
		expect(result[0].status.toString()).to.be.equal('SUCCESS');

		// get the entry fee
		const entryFee = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.equal(20);

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionB,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(2);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(2);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionB, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission C: Should deploy a mission with a single requirement NFT and two rewards 1 per farmer (3 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 4_000_000;
		const params = [
			3,
			15,
			[ReqA_TokenId.toSolidityAddress()],
			[
				RewardA_TokenId.toSolidityAddress(),
				RewardB_TokenId.toSolidityAddress(),
			],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionC = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionC);
		}
		console.log('Mission C: ', missionC.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionC.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionC.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionC.num}`) });

		/**
		 * TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionC, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [7, 8]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [1]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionC,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionC, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission D: Should deploy a mission with a single requirement NFT and two rewards 2 per farmer (3 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 4_000_000;
		const params = [
			3,
			16,
			[ReqA_TokenId.toSolidityAddress()],
			[
				RewardA_TokenId.toSolidityAddress(),
				RewardB_TokenId.toSolidityAddress(),
			],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			2,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionD = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionD);
		}
		console.log('Mission D: ', missionC.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionD.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionD.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionD.num}`) });

		/** TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionD, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [9, 10]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [2, 3, 4, 5]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionD,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionD, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission E: Should deploy a mission with a three requirement NFTs (of 3 types allowed) and single reward (3 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 5_000_000;
		const params = [
			3,
			17,
			[
				ReqA_TokenId.toSolidityAddress(),
				ReqB_TokenId.toSolidityAddress(),
				ReqC_TokenId.toSolidityAddress(),
			],
			[RewardB_TokenId.toSolidityAddress()],
			15,
			Math.floor(new Date().getTime() / 1000) + 900,
			3,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionE = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionE);
		}
		console.log('Mission E: ', missionE.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionE.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionE.num}`) });

		/** TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionE, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		const [result] = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [6, 7, 8]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionE,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionE, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission F: Should deploy a mission with a three requirement NFTs (of 3 types allowed) and two rewards 1 per farmer (3 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 6_000_000;
		const params = [
			3,
			18,
			[
				ReqA_TokenId.toSolidityAddress(),
				ReqB_TokenId.toSolidityAddress(),
				ReqC_TokenId.toSolidityAddress(),
			],
			[
				RewardB_TokenId.toSolidityAddress(),
				RewardA_TokenId.toSolidityAddress(),
			],
			15,
			Math.floor(new Date().getTime() / 1000) + 900,
			3,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionF = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionF);
		}
		console.log('Mission F: ', missionF.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionF.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });

		/** TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionF, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [9, 10]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [11]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionF,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionF, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission G: Should deploy a mission with a three requirement NFTs (of 3 types allowed) and two rewards 2 per farmer (3 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 6_000_000;
		const params = [
			3,
			19,
			[
				ReqA_TokenId.toSolidityAddress(),
				ReqB_TokenId.toSolidityAddress(),
				ReqC_TokenId.toSolidityAddress(),
			],
			[
				RewardB_TokenId.toSolidityAddress(),
				RewardA_TokenId.toSolidityAddress(),
			],
			15,
			Math.floor(new Date().getTime() / 1000) + 900,
			3,
			2,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionG = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionG);
		}
		console.log('Mission G: ', missionG.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionG.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionG.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionG.num}`) });

		/** TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionG, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [11, 12, 13]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [12, 13, 14]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(3);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionG,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(3);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionG, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission H: Should deploy a mission with a one requirement NFT (two of required) and two rewards 2 per farmer (8 slots)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 4_000_000;
		const params = [
			3,
			22,
			[ReqC_TokenId.toSolidityAddress()],
			[
				RewardB_TokenId.toSolidityAddress(),
				RewardA_TokenId.toSolidityAddress(),
			],
			20,
			Math.floor(new Date().getTime() / 1000) + 900,
			2,
			2,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionH = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionH);
		}
		console.log('Mission H: ', missionH.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionH.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionH.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionH.num}`) });

		/** TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionH, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionH,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [14, 15, 16, 17, 18, 19, 20, 21]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionH,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [15, 16, 17, 18, 19, 20, 21, 22]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionH,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(8);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionH,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(8);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(8);

		// send $LAZY to the mmission for staking
		const status = await sendLazy(missionH, 20);
		expect(status).to.be.equal('SUCCESS');
	});

	it('Mission I: Should deploy a mission with a two requirement NFTs (A and/or B) bound to defined serials (Such that only Alice will be able to enter)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 5_000_000;
		const params = [
			3,
			25,
			[ReqB_TokenId.toSolidityAddress(), ReqA_TokenId.toSolidityAddress()],
			[
				RewardB_TokenId.toSolidityAddress(),
				RewardA_TokenId.toSolidityAddress(),
			],
			20,
			Math.floor(new Date().getTime() / 1000) + 900,
			2,
			2,
		];

		const [contractExecuteRx, contractResults, record] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);

		if (contractExecuteRx.status.toString() !== 'SUCCESS') {
			console.log(contractExecuteRx, contractResults);
		}

		console.log('Mission I Tx: ', record?.transactionId.toString());

		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionI = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionI);
		}
		console.log('Mission I: ', missionI.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionI.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });

		/**
		 * TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionI, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [22]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [23]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionI,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(1);

		// addRequirementSerials to the mission
		// first try a collection not configured and expect a revert
		result = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'addRequirementSerials',
			[ReqC_TokenId.toSolidityAddress(), [1]],
		);
		expect(result[0]?.status.name).to.be.equal('BadArgument');

		// now add the collection
		// adding 1 token for each of Operator and Bob but not enough to enter given the requirement of 2 items of collateral
		[result] = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'addRequirementSerials',
			[ReqB_TokenId.toSolidityAddress(), [11, 12, 13, 14, 15, 16, 1, 6]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// test removeRequirementSerials
		[result] = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'removeRequirementSerials',
			[ReqB_TokenId.toSolidityAddress(), [15, 13]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the requirements at mission level using getRequirements
		const requirementsTx = await contractExecuteQuery(
			missionI,
			missionIface,
			client,
			null,
			'getRequirements',
		);

		expect(requirementsTx.length).to.be.equal(3);
		expect(requirementsTx[0].length).to.be.equal(2);
		expect(requirementsTx[0][0].slice(2).toLowerCase()).to.be.equal(
			ReqB_TokenId.toSolidityAddress(),
		);
		expect(requirementsTx[0][1].slice(2).toLowerCase()).to.be.equal(
			ReqA_TokenId.toSolidityAddress(),
		);
		expect(requirementsTx[1].length).to.be.equal(2);
		expect(requirementsTx[1][0]).to.be.true;
		expect(requirementsTx[1][1]).to.be.false;
		expect(requirementsTx[2][0].length).to.be.equal(6);
		console.log('limited to serials', requirementsTx[2][0], 'for', requirementsTx[0][0]);

		await sleep(7500);

		// check mirror node for Event publish at Mission level
		let mirrorSlots = await checkLastMirrorEvent(
			env,
			missionI,
			missionIface,
			0,
		);
		expect(Number(mirrorSlots)).to.be.equal(1);

		// check mirror node for Event publish at Factory level
		mirrorSlots = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
		);
		expect(Number(mirrorSlots)).to.be.equal(1);
	});

	it('Mission J: Should deploy a mission with a one requirement NFT with 1 rewards per farmer (and send additional collateral incorrectly)', async () => {
		// deployMission
		client.setOperator(operatorId, operatorKey);
		const gasLim = 4_000_000;
		const params = [
			30,
			8,
			[ReqA_TokenId.toSolidityAddress()],
			[
				RewardA_TokenId.toSolidityAddress(),
				RewardB_TokenId.toSolidityAddress(),
			],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionJ = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionJ);
		}
		console.log('Mission J: ', missionJ.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');

		// approve the NFTs to be spent by the mission using setNFTAllowanceAll
		const approvalTx = await setNFTAllowanceAll(client, [RewardA_TokenId, RewardB_TokenId], operatorId, AccountId.fromString(`0.0.${missionJ.num}`));
		expect(approvalTx).to.be.equal('SUCCESS');

		// add the allowance to list of allowances
		operatorNftAllowances.push({ tokenId: RewardA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionJ.num}`) });
		operatorNftAllowances.push({ tokenId: RewardB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionJ.num}`) });

		/**
		 * TODO: Remove now that we have a LGS
		// need to send some $LAZY to the contract for NFT staking
		const lazySend = await sendLazy(missionJ, 10);
		expect(lazySend).to.be.equal('SUCCESS');
		*/

		// addRewardSerials to the mission
		let [result] = await contractExecuteFunction(
			missionJ,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardA_TokenId.toSolidityAddress(), [24]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionJ,
			missionIface,
			client,
			gasLim,
			'addRewardSerials',
			[RewardB_TokenId.toSolidityAddress(), [23]],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		const serials = [25];
		// send serials 25 of RewardA and RewardB back to Alice
		result = await sendNFTDefeatRoyalty(
			client,
			operatorId,
			aliceId,
			alicePK,
			RewardA_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFTDefeatRoyalty(
			client,
			operatorId,
			aliceId,
			alicePK,
			RewardB_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		client.setOperator(aliceId, alicePK);
		// Alice minted the Rewards so can transfer them to the mission using hedera native transfer
		// transfer 25 of RewardA and RewardB to Mission J
		result = await sendNFT(
			client,
			aliceId,
			AccountId.fromString(`0.0.${missionJ.num}`),
			RewardA_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		result = await sendNFT(
			client,
			aliceId,
			AccountId.fromString(`0.0.${missionJ.num}`),
			RewardB_TokenId,
			serials,
		);
		expect(result).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionJ,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// the extra collateral should not show as slots.
	});

	it('Mission K: Should deploy a mission with Requirement & Rewards as same token', async () => {
		// test is only about deployment - usage already tested in previous missions
		client.setOperator(operatorId, operatorKey);
		const gasLim = 3_000_000;
		const params = [
			3,
			26,
			[ReqA_TokenId.toSolidityAddress()],
			[ReqA_TokenId.toSolidityAddress()],
			10,
			Math.floor(new Date().getTime() / 1000) + 900,
			1,
			1,
		];

		const [contractExecuteRx, contractResults] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'deployMission',
			params,
		);
		try {
			const missionContract = ContractId.fromEvmAddress(0, 0, contractResults[0]);
			// wait for the contract to be created and populated to mirrors
			await sleep(7500);
			missionK = await missionContract.populateAccountNum(client);
		}
		catch (e) {
			console.log(e, missionK);
		}
		console.log('Mission K: ', missionK.toString());

		expect(contractExecuteRx.status.toString()).to.be.equal('SUCCESS');
	});
});

describe('Join Missions', () => {
	it('Check the missions are visible from the factory', async () => {
		// get the list of deployed missions using getDeployedMissions
		const deployedMissions = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			300_000,
			'getDeployedMissions',
		);
		expect(deployedMissions[0].length).to.be.equal(11);
		for (let a = 0; a < 10; a++) {
			const missionName = matchMission(deployedMissions[0][a]);
			console.log(missionName, deployedMissions[0][a]);
			if (!missionName) {
				console.log('check - Mission not found', deployedMissions[0][a]);
				fail('Mission not found');
			}
		}

		// new getAvailableSlots
		const availableSlots = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			700_000,
			'getAvailableSlots',
		);

		// uint256[], address[], unit256[]
		expect(availableSlots.length).to.be.equal(3);
		expect(availableSlots[0].length).to.be.equal(11);
		expect(availableSlots[1].length).to.be.equal(11);
		expect(availableSlots[2].length).to.be.equal(11);
		for (let a = 0; a < 10; a++) {
			const missionName = matchMission(availableSlots[0][a]);
			if (!missionName) {
				fail('Mission not found');
			}
			console.log(
				`${Number(availableSlots[1][a])} Slots available for ${missionName} @ ${Number(availableSlots[2][a]) / LAZY_DECIMAL
				} $LAZY`,
			);
		}
	});

	it('Check missions are visible via mirror node', async () => {
		// call getDeployedMissions via mirror node using readOnlyEVMFromMirrorNode
		let encodedCommand = missionFactoryIface.encodeFunctionData(
			'getDeployedMissions',
			[],
		);

		let mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			factoryContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const deployedMissions = missionFactoryIface.decodeFunctionResult(
			'getDeployedMissions',
			mirrorResponse,
		);

		expect(deployedMissions[0].length).to.be.equal(11);
		for (let a = 0; a < 10; a++) {
			const missionName = matchMission(deployedMissions[0][a]);
			if (!missionName) {
				console.log('check - Mission not found', deployedMissions[0][a]);
				fail('Mission not found');
			}
		}

		// call getAvailableSlots via mirror node using readOnlyEVMFromMirrorNode
		encodedCommand = missionFactoryIface.encodeFunctionData(
			'getAvailableSlots',
			[],
		);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			factoryContractId,
			encodedCommand,
			operatorId,
			false,
		);

		const availableSlots = missionFactoryIface.decodeFunctionResult(
			'getAvailableSlots',
			mirrorResponse,
		);

		// uint256[], address[], unit256[]
		expect(availableSlots.length).to.be.equal(3);
		expect(availableSlots[0].length).to.be.equal(11);
		expect(availableSlots[1].length).to.be.equal(11);
		expect(availableSlots[2].length).to.be.equal(11);
		for (let a = 0; a < 10; a++) {
			const missionName = matchMission(availableSlots[0][a]);
			if (!missionName) {
				fail('Mission not found');
			}
			console.log(
				`${Number(availableSlots[1][a])} Slots available for ${missionName} @ ${Number(availableSlots[2][a]) / LAZY_DECIMAL
				} $LAZY`,
			);
		}
	});

	it('Check mission A is paused by default, then unpause all missions', async () => {
		client.setOperator(operatorId, operatorKey);
		// check the mission is paused
		const paused = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isPaused',
		);
		expect(Boolean(paused[0])).to.be.true;

		const gasLim = 1_200_000;

		try {
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[1]]],
			);

			expect(result[0]?.status).to.be.equal('REVERT: Mission paused');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: Mission paused');
		}

		// unpause all missions via the factory
		const [result] = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'updateMissionPause',
			[
				[
					missionA.toSolidityAddress(),
					missionB.toSolidityAddress(),
					missionC.toSolidityAddress(),
					missionD.toSolidityAddress(),
					missionE.toSolidityAddress(),
					missionF.toSolidityAddress(),
					missionG.toSolidityAddress(),
					missionH.toSolidityAddress(),
					missionI.toSolidityAddress(),
					missionJ.toSolidityAddress(),
				],
				false,
			],
		);
		if (result.status.toString() != 'SUCCESS') {
			console.log('check - PAUSE:', result);
		}
		expect(result.status.toString()).to.be.equal('SUCCESS');
	});

	it('Operator, Alice and Bob to enter Mission A (include error tests)', async () => {
		client.setOperator(operatorId, operatorKey);

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.equal(11);

		const fee = Number(entryFee[0]);

		// set allowance to LGS
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set allowance for NFTs to mission A
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionA.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionA.num}`) });

		result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			1_800_000,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[1]]],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('check: (operator enters mission A)', result);
		}

		console.log('Operator enters mission A:', result[2]?.transactionId?.toString());

		expect(result[0].status.toString()).to.be.equal('SUCCESS');

		// check the events were emitted at both the contract and factory level
		// factory level: MissionJoinedFactory
		// Mission level: MissionJoined
		await sleep(7500);
		const missionJoined = await checkLastMirrorEvent(
			env,
			missionA,
			missionIface,
			0,
			true,
		);
		expect(missionJoined.toSolidityAddress()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		const missionJoinedFactory = await checkLastMirrorEvent(
			env,
			factoryContractId,
			missionFactoryIface,
			1,
			true,
		);
		expect(missionJoinedFactory.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());


		client.setOperator(aliceId, alicePK);

		// try and enter without an allowance to check you get a revert
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				1_800_000,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[11]]],
			);

			// this is an insufficient allowance error but as the error is from LGS
			// the decode (vs Mission interface) does not work. We could contort the methed to pass
			// additional interfaces for error decoding but for now we will just check the status
			if (result[0]?.status) {
				console.log('check: (Alice enters mission A)', result);
				throw new Error('Alice enters mission A');
			}
		}
		catch (e) {
			console.log(e);
			fail('Alice enters mission A');
		}

		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance for Alice
		result = await setNFTAllowanceAll(
			client,
			[ReqB_TokenId, ReqA_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionA.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// try entering with incorrect collateral
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				1_800_000,
				'enterMission',
				[[ReqB_TokenId.toSolidityAddress()], [[11]]],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Collection not included');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: Collection not included');
		}

		// try entering with incorrect amount of collateral
		try {
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				2_000_000,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[12, 13]]],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Invalid requirement number');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: Invalid requirement number');
		}

		// now enter the mission correctly
		result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			1_800_000,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[11]]],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('check: (Alice enters mission A)', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		client.setOperator(bobId, bobPK);

		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance for Bob
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionA.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			1_800_000,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[6]]],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('check: (Bob enters mission A)', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the number of slots available
		const slots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(0);
	});

	it('Testing secondary requirement or reward collection addition', async () => {
		client.setOperator(operatorId, operatorKey);

		// try adding a requirement collection
		const gasLim = 1_200_000;
		let result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'addRequirementAndRewardCollections',
			[[ReqC_TokenId.toSolidityAddress()], []],
		);

		expect(result[0]?.status.name).to.be.equal('UsersOnMission');

		// try adding a reward collection to Mission B expecting success
		result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'addRequirementAndRewardCollections',
			[[], [RewardB_TokenId.toSolidityAddress()]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('check: (addRewardCollection)', result);
		}
	});

	it('Tests the NFTs are delegated back to the users', async () => {
		// check the NFTs are delegated back to the users
		let result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), ReqA_TokenId.toSolidityAddress(), 1],
		);

		expect(result[0]).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[aliceId.toSolidityAddress(), ReqA_TokenId.toSolidityAddress(), 11],
		);

		expect(result[0]).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[bobId.toSolidityAddress(), ReqA_TokenId.toSolidityAddress(), 6],
		);

		expect(result[0]).to.be.true;
	});

	it('Test factory level methods for user (getUsersMissionParticipation / getUsersBoostStatus)', async () => {
		// getUsersMissionParticipation for Alice in MissionA via the factory
		const aliceParticipation = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'getUsersMissionParticipation',
			[aliceId.toSolidityAddress(), missionA.toSolidityAddress()],
		);
		// address[], uint56[][], uint256, uint256, bool
		expect(aliceParticipation.length).to.be.equal(5);
		expect(aliceParticipation[0].length).to.be.equal(1);
		expect(
			aliceParticipation[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(aliceParticipation[1].length).to.be.equal(1);
		expect(aliceParticipation[1][0].length).to.be.equal(1);
		expect(Number(aliceParticipation[1][0][0])).to.be.equal(11);
		console.log(
			'Alice Entered: ',
			aliceParticipation[2],
			'Finish: ',
			aliceParticipation[3],
		);
		expect(
			Number(aliceParticipation[3]) - Number(aliceParticipation[2]),
		).to.be.equal(90);
		expect(Boolean(aliceParticipation[4])).to.be.false;

		// getUsersMissionParticipation for Bob in MissionA via the factory
		const bobParticipation = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'getUsersMissionParticipation',
			[bobId.toSolidityAddress(), missionA.toSolidityAddress()],
		);

		// address[], uint56[][], uint256, uint256, bool
		expect(bobParticipation.length).to.be.equal(5);
		expect(bobParticipation[0].length).to.be.equal(1);
		expect(
			bobParticipation[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(bobParticipation[1].length).to.be.equal(1);
		expect(bobParticipation[1][0].length).to.be.equal(1);
		expect(Number(bobParticipation[1][0][0])).to.be.equal(6);
		console.log(
			'Bob Entered: ',
			bobParticipation[2],
			'Finish: ',
			bobParticipation[3],
		);
		expect(
			Number(bobParticipation[3]) - Number(bobParticipation[2]),
		).to.be.equal(90);
		expect(Boolean(bobParticipation[4])).to.be.false;
	});

	it('Test mission level methods for user', async () => {
		const timeStamp = Math.floor(new Date().getTime() / 1000);

		// check getRequirements for mission A
		const requirements = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getRequirements',
		);
		// address[], bool[], uint256[][]
		expect(requirements.length).to.be.equal(3);
		expect(requirements[0].length).to.be.equal(1);
		expect(
			requirements[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(requirements[1].length).to.be.equal(1);
		expect(Boolean(requirements[1][0])).to.be.false;
		expect(requirements[2].length).to.be.equal(1);
		expect(requirements[2][0].length).to.be.equal(0);

		// getRequirements from the mirror node
		let encodedCommand = missionIface.encodeFunctionData('getRequirements', []);

		let mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		const mirrorRequirements = missionIface.decodeFunctionResult(
			'getRequirements',
			mirrorResponse,
		);

		// address[], bool[], uint256[][]
		expect(mirrorRequirements.length).to.be.equal(3);
		expect(mirrorRequirements[0].length).to.be.equal(1);
		expect(
			mirrorRequirements[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(mirrorRequirements[1].length).to.be.equal(1);
		expect(Boolean(mirrorRequirements[1][0])).to.be.false;
		expect(mirrorRequirements[2].length).to.be.equal(1);
		expect(mirrorRequirements[2][0].length).to.be.equal(0);

		// getUserEndAndBoost for operator
		const operatorEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);
		// uint256, bool
		expect(operatorEndAndBoost.length).to.be.equal(2);
		expect(Number(operatorEndAndBoost[0])).to.be.greaterThan(timeStamp);
		expect(Boolean(operatorEndAndBoost[1])).to.be.false;

		// getUserEndAndBoost from Mirror Node for Alice
		encodedCommand = missionIface.encodeFunctionData('getUserEndAndBoost', [
			aliceId.toSolidityAddress(),
		]);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			aliceId,
			false,
		);

		const aliceEndAndBoost = missionIface.decodeFunctionResult(
			'getUserEndAndBoost',
			mirrorResponse,
		);

		// uint256, bool
		expect(aliceEndAndBoost.length).to.be.equal(2);
		expect(Number(aliceEndAndBoost[0])).to.be.greaterThan(timeStamp);
		expect(Boolean(aliceEndAndBoost[1])).to.be.false;

		// claimRewards for Alice but fails as she has not finished the mission
		client.setOperator(aliceId, alicePK);
		const gasLim = 1_200_000;
		try {
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'claimRewards',
				[],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Mission not finished');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: Mission not finished');
		}

		// check getMissionParticipation for Bob
		const bobParticipation = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getMissionParticipation',
			[bobId.toSolidityAddress()],
		);
		// address[], unit256[][], unit256, unit256, bool
		expect(bobParticipation.length).to.be.equal(5);
		expect(bobParticipation[0].length).to.be.equal(1);
		expect(
			bobParticipation[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(bobParticipation[1].length).to.be.equal(1);
		expect(bobParticipation[1][0].length).to.be.equal(1);
		expect(Number(bobParticipation[1][0][0])).to.be.equal(6);
		const bobStart = Number(bobParticipation[2]);
		expect(bobStart).to.be.lessThanOrEqual(timeStamp);
		const bobEnd = Number(bobParticipation[3]);
		expect(Boolean(bobParticipation[4])).to.be.false;

		// getMissionParticipation from the mirror node for Bob
		encodedCommand = missionIface.encodeFunctionData(
			'getMissionParticipation',
			[bobId.toSolidityAddress()],
		);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		const mirrorBobParticipation = missionIface.decodeFunctionResult(
			'getMissionParticipation',
			mirrorResponse,
		);

		// address[], unit256[][], unit256, unit256, bool
		expect(mirrorBobParticipation.length).to.be.equal(5);
		expect(mirrorBobParticipation[0].length).to.be.equal(1);
		expect(
			mirrorBobParticipation[0][0].slice(2).toLowerCase(),
		).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(mirrorBobParticipation[1].length).to.be.equal(1);
		expect(mirrorBobParticipation[1][0].length).to.be.equal(1);
		expect(Number(mirrorBobParticipation[1][0][0])).to.be.equal(6);
		expect(Number(mirrorBobParticipation[2])).to.be.equal(bobStart);
		expect(Number(mirrorBobParticipation[3])).to.be.equal(bobEnd);
		expect(Boolean(mirrorBobParticipation[4])).to.be.false;

		// check Alice isParticipant
		const aliceParticipant = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isParticipant',
			[aliceId.toSolidityAddress()],
		);
		expect(Boolean(aliceParticipant[0])).to.be.true;

		// check Bob isParticipant via mirror node
		encodedCommand = missionIface.encodeFunctionData('isParticipant', [
			bobId.toSolidityAddress(),
		]);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		const bobParticipant = missionIface.decodeFunctionResult(
			'isParticipant',
			mirrorResponse,
		);
		expect(Boolean(bobParticipant[0])).to.be.true;

		// check Alice is not an admin
		const aliceAdmin = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'isAdmin',
			[aliceId.toSolidityAddress()],
		);

		expect(Boolean(aliceAdmin[0])).to.be.false;

		// check Bob is not an admin via mirror node
		encodedCommand = missionIface.encodeFunctionData('isAdmin', [
			bobId.toSolidityAddress(),
		]);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		// decode the result
		const bobAdmin = missionIface.decodeFunctionResult('isAdmin', mirrorResponse);
		console.log('Bob Admin:', bobAdmin);
		expect(Boolean(bobAdmin[0])).to.be.false;

		// getSlotsRemaining
		const slots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(0);

		// getSlotsRemaining via mirror node

		encodedCommand = missionIface.encodeFunctionData('getSlotsRemaining', []);

		mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		const mirrorSlots = missionIface.decodeFunctionResult(
			'getSlotsRemaining',
			mirrorResponse,
		);

		expect(Number(mirrorSlots[0])).to.be.equal(0);

	});

	it('Test access controls at Mission level - user', async () => {
		let expectedErrorCount = 0;
		let unexpectErrorCount = 0;

		try {
			// send 5 tinyBar to mission
			client.setOperator(aliceId, alicePK);
			let result = await sendHbar(
				client,
				aliceId,
				AccountId.fromString(`0.0.${missionA.num}`),
				5,
				HbarUnit.Tinybar,
			);
			expect(result).to.be.equal('SUCCESS');

			// execute transferHbar on mission to send the tinybar back
			const gasLim = 500_000;
			result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'transferHbar',
				[aliceId.toSolidityAddress(), 5],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result (transfer hbar):', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// try withdrawRewards
		try {
			client.setOperator(aliceId, alicePK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'withdrawRewards',
				[RewardA_TokenId.toSolidityAddress(), [1]],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result (withdraw rewards):', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// test closeMission
		try {
			client.setOperator(aliceId, alicePK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'closeMission',
				[],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result (test close):', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// test reduceStakingPeriod as operator (still expect failure as not the boost manager)
		try {
			client.setOperator(operatorId, operatorKey);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'reduceStakingPeriod',
				[operatorId.toSolidityAddress(), 50],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (reduceStakingPeriod)', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// try setStartTimestamp as Alice
		try {
			client.setOperator(aliceId, alicePK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'setStartTimestamp',
				[50],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (setStartTimestamp)', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// try updatePauseStatus as Alice
		try {
			client.setOperator(aliceId, alicePK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'updatePauseStatus',
				[true],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (updatePauseStatus as Alice)', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// test addRequirementSerials as Bob
		try {
			client.setOperator(bobId, bobPK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'addRequirementSerials',
				[ReqA_TokenId.toSolidityAddress(), [1]],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (addRequirementSerials as Bob)', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// test removeRequirementSerials as Bob
		try {
			client.setOperator(bobId, bobPK);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'removeRequirementSerials',
				[ReqA_TokenId.toSolidityAddress(), [1]],
			);
			if (result[0]?.status?.name == 'PermissionDenied') {
				expectedErrorCount++;
			}
			else {
				console.log('Unexpected Result: (removeRequirementSerials as Bob)', result);
				unexpectErrorCount++;
			}
		}
		catch (e) {
			console.log(e);
			unexpectErrorCount++;
		}

		// test initialize can't be called again as Operator
		try {
			client.setOperator(operatorId, operatorKey);
			const gasLim = 500_000;
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'initialize',
				[
					60,
					100,
					[ReqA_TokenId.toSolidityAddress()],
					[RewardA_TokenId.toSolidityAddress()],
					5,
					Math.floor(new Date().getTime() / 1000) + 1000,
					operatorId.toSolidityAddress(),
					operatorId.toSolidityAddress(),
					1,
					1,
				],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Already initialized');
			expectedErrorCount++;
		}
		catch (e) {
			if (e.toString() === 'REVERT: Already initialized') {
				expectedErrorCount++;
			}
			else {
				console.log(e);
				unexpectErrorCount++;
			}
		}
		console.log('Expected Errors:', expectedErrorCount, 'Unexpected Errors:', unexpectErrorCount);
		expect(expectedErrorCount).to.be.equal(9);
		expect(unexpectErrorCount).to.be.equal(0);
	});

	it('Test access controls at Mission level - admin', async () => {
		// send 5 tinyBar to mission
		client.setOperator(operatorId, operatorKey);
		let result = await sendHbar(
			client,
			operatorId,
			AccountId.fromString(`0.0.${missionA.num}`),
			5,
			HbarUnit.Tinybar,
		);
		expect(result).to.be.equal('SUCCESS');

		// expect revert - execute transferHbar on mission to send the tinybar back
		const gasLim = 500_000;
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'transferHbar',
			[operatorId.toSolidityAddress(), 5],
		);
		expect(result?.status?.name).to.be.equal('UsersOnMission');

		// now send to mission B (nobody in it so should work)
		result = await sendHbar(
			client,
			operatorId,
			AccountId.fromString(`0.0.${missionB.num}`),
			5,
			HbarUnit.Tinybar,
		);

		expect(result).to.be.equal('SUCCESS');

		// execute transferHbar on mission to send the tinybar back
		[result] = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'transferHbar',
			[operatorId.toSolidityAddress(), 5],
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');
	});

	it('Test Boost mechanic - Alice with Gem, Operator with Lazy', async () => {
		client.setOperator(operatorId, operatorKey);
		// get the boostManager for the mission
		const boostManager = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'boostManager',
		);

		expect(boostManager[0].toString().slice(2).toLowerCase()).to.be.equal(boostManagerId.toSolidityAddress().toLowerCase());
		// get the $LAZY cost to boost a mission from public variable lazyBoostCost
		const lazyBoostCost = await contractExecuteQuery(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'lazyBoostCost',
		);

		expect(Number(lazyBoostCost[0])).to.be.equal(LAZY_BOOST_COST);

		// get the users end time and boost status for Operator
		const operatorEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		const timeStamp = Math.floor(new Date().getTime() / 1000);
		const operatorEnd = Number(operatorEndAndBoost[0]);
		expect(operatorEndAndBoost.length).to.be.equal(2);
		expect(operatorEnd).to.be.greaterThan(timeStamp);
		expect(Boolean(operatorEndAndBoost[1])).to.be.false;

		const command = lazyGasStationIface.encodeFunctionData('isContractUser', [boostManagerId.toSolidityAddress()]);

		const res = await readOnlyEVMFromMirrorNode(
			env,
			lazyGasStationId,
			command,
			operatorId,
			false,
		);

		const isContractUser = lazyGasStationIface.decodeFunctionResult('isContractUser', res);

		console.log('Is Contract User:', isContractUser);

		// now boost with $LAZY
		// set $LAZY allowance to the Gas Station
		let result = await setFTAllowance(client, lazyTokenId, operatorId, AccountId.fromString(lazyGasStationId.toString()), LAZY_BOOST_COST);
		expect(result).to.be.equal('SUCCESS');

		const gasLim = 800_000;
		result = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			gasLim,
			'boostWithLazy',
			[missionA.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('check: (Operator boosts mission A)', result);
			const encodedCommand = lazyGasStationIface.encodeFunctionData('getContractUsers', []);

			result = await readOnlyEVMFromMirrorNode(
				env,
				lazyGasStationId,
				encodedCommand,
				operatorId,
				false,
			);

			const contractUsers = lazyGasStationIface.decodeFunctionResult(
				'getContractUsers',
				result,
			);

			console.log('Contract Users:', contractUsers);
		}

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');

		// output the transaction ID
		console.log('Operator Boost with Lazy:', result[2]?.transactionId?.toString());

		// check the return object -> uint256 end
		const newOperatorEnd = Number(result[1][0]);
		expect(newOperatorEnd).to.be.lessThan(operatorEnd);

		// check the correct value is at the Mission level with getUserEndAndBoost
		const newOperatorEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		expect(newOperatorEndAndBoost.length).to.be.equal(2);
		expect(Number(newOperatorEndAndBoost[0])).to.be.equal(newOperatorEnd);
		expect(Boolean(newOperatorEndAndBoost[1])).to.be.true;

		// $LAZY now swept to Mission factory but test those permissions
		// check with Bob to ensure access permissions block him
		client.setOperator(bobId, bobPK);
		try {
			const bobResult = await contractExecuteFunction(
				factoryContractId,
				missionFactoryIface,
				client,
				gasLim,
				'retrieveLazy',
				[operatorId.toSolidityAddress(), 1000],
			);
			expect(bobResult[0]?.status?.name).to.be.equal('PermissionDenied');
		}
		catch {
			fail('Bob should not get to pull Lazy');
		}

		// check operator can pull Lazy (as admin)
		client.setOperator(operatorId, operatorKey);
		const operatorRes = await contractExecuteFunction(
			factoryContractId,
			missionFactoryIface,
			client,
			gasLim,
			'retrieveLazy',
			[operatorId.toSolidityAddress(), 1],
		);

		if (operatorRes[0]?.status?.toString() != 'SUCCESS') {
			console.log('check: (Operator pulls Lazy)', operatorRes);
		}

		expect(operatorRes[0]?.status.toString()).to.be.equal('SUCCESS');

		client.setOperator(aliceId, alicePK);
		// check Alice boost status
		const aliceEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);
		expect(aliceEndAndBoost.length).to.be.equal(2);
		expect(aliceEnd).to.be.greaterThan(timeStamp);
		expect(Boolean(aliceEndAndBoost[1])).to.be.false;

		// now boost with Gem using boostWithGemCards
		// gem NFT for Alice is ReqC_TokenId ID 25
		// check the boost level for the gem NFT using getBoostLevel on the boostManager
		const aliceBoostLevel = await contractExecuteQuery(
			boostManagerId,
			boostManagerIface,
			client,
			null,
			'getBoostLevel',
			[ReqC_TokenId.toSolidityAddress(), 25],
		);

		expect(Number(aliceBoostLevel[0])).to.be.equal(4);

		// set an allowance for the NFT to the boostManager
		result = await setNFTAllowanceAll(client, [ReqC_TokenId], aliceId, AccountId.fromString(boostManagerId.toString()));

		expect(result).to.be.equal('SUCCESS');

		const [aliceBoostResult, aliceBoostReturnObj, record] = await contractExecuteFunction(
			boostManagerId,
			boostManagerIface,
			client,
			1_500_000,
			'boostWithGemCards',
			[missionA.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 25],
		);

		if (aliceBoostResult?.status?.toString() != 'SUCCESS') {
			console.log('check: (Alice boosts mission A w/ gem)', aliceBoostResult, aliceBoostReturnObj);
		}

		console.log('Alice Boost with gem:', record?.transactionId?.toString());

		expect(aliceBoostResult.status.toString()).to.be.equal('SUCCESS');

		// check the return object -> uint256 end
		const newAliceEnd = Number(aliceBoostReturnObj[0]);
		expect(newAliceEnd).to.be.lessThan(aliceEnd);

		// check the correct value is at the Mission level with getUserEndAndBoost
		const newAliceEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		expect(newAliceEndAndBoost.length).to.be.equal(2);
		expect(Number(newAliceEndAndBoost[0])).to.be.equal(newAliceEnd);
		expect(Boolean(newAliceEndAndBoost[1])).to.be.true;
	});

	it('Test Boost Manager delegates the collateral back to the users', async () => {
		// check the NFTs are delegated back to the users
		const result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[aliceId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 25],
		);

		expect(result[0]).to.be.true;

	});

	it('Test Boost status methods', async () => {
		// excute as Alice to ensure no permissions issues
		client.setOperator(aliceId, alicePK);
		// test getUsersBoostInfo for Alice
		const aliceBoostInfo = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUsersBoostInfo',
			[aliceId.toSolidityAddress()],
		);

		// uint8, address, uint256
		expect(aliceBoostInfo.length).to.be.equal(3);
		expect(Number(aliceBoostInfo[0])).to.be.equal(2);
		expect(aliceBoostInfo[1].slice(2).toLowerCase()).to.be.equal(ReqC_TokenId.toSolidityAddress().toLowerCase());
		expect(Number(aliceBoostInfo[2])).to.be.equal(25);

		// test getUsersBoostInfo for Bob
		const bobBoostInfo = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUsersBoostInfo',
			[bobId.toSolidityAddress()],
		);

		// uint8, address, uint256
		expect(bobBoostInfo.length).to.be.equal(3);
		expect(Number(bobBoostInfo[0])).to.be.equal(0);
		expect(bobBoostInfo[1].toString()).to.be.equal(ZeroAddress.toString());
		expect(Number(bobBoostInfo[2])).to.be.equal(0);

		// test getUsersBoostInfo for Operator
		const operatorBoostInfo = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUsersBoostInfo',
			[operatorId.toSolidityAddress()],
		);

		// uint8, address, uint256
		expect(operatorBoostInfo.length).to.be.equal(3);
		expect(Number(operatorBoostInfo[0])).to.be.equal(1);
		expect(operatorBoostInfo[1].toString()).to.be.equal(ZeroAddress.toString());
		expect(Number(operatorBoostInfo[2])).to.be.equal(0);

		// test getMissionParticipation for Alice
		const aliceParticipation = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getMissionParticipation',
			[aliceId.toSolidityAddress()],
		);

		// address[], unit256[][], unit256, unit256, bool
		expect(aliceParticipation.length).to.be.equal(5);
		expect(aliceParticipation[0].length).to.be.equal(1);
		expect(aliceParticipation[0][0].slice(2).toLowerCase()).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(aliceParticipation[1].length).to.be.equal(1);
		expect(aliceParticipation[1][0].length).to.be.equal(1);
		expect(Number(aliceParticipation[1][0][0])).to.be.equal(11);
		const timeStamp = Math.floor(new Date().getTime() / 1000);
		const aliceStart = Number(aliceParticipation[2]);
		expect(aliceStart).to.be.lessThanOrEqual(timeStamp);
		const aliceEnd = Number(aliceParticipation[3]);
		expect(aliceEnd).to.be.greaterThan(aliceStart);
		expect(Boolean(aliceParticipation[4])).to.be.true;

		// now test getUserEndAndBoost for Alice
		const aliceEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		expect(aliceEndAndBoost.length).to.be.equal(2);
		expect(Number(aliceEndAndBoost[0])).to.be.equal(aliceEnd);
		expect(Boolean(aliceEndAndBoost[1])).to.be.true;

		// test getMissionParticipation for Bob
		const bobParticipation = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getMissionParticipation',
			[bobId.toSolidityAddress()],
		);

		// address[], unit256[][], unit256, unit256, bool
		expect(bobParticipation.length).to.be.equal(5);
		expect(bobParticipation[0].length).to.be.equal(1);
		expect(bobParticipation[0][0].slice(2).toLowerCase()).to.be.equal(ReqA_TokenId.toSolidityAddress().toLowerCase());
		expect(bobParticipation[1].length).to.be.equal(1);
		expect(bobParticipation[1][0].length).to.be.equal(1);
		expect(Number(bobParticipation[1][0][0])).to.be.equal(6);
		const bobStart = Number(bobParticipation[2]);
		expect(bobStart).to.be.lessThanOrEqual(timeStamp);
		const bobEnd = Number(bobParticipation[3]);
		expect(bobEnd).to.be.greaterThan(bobStart);
		expect(Boolean(bobParticipation[4])).to.be.false;

		// now test getUserEndAndBoost for Bob
		const bobEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		expect(bobEndAndBoost.length).to.be.equal(2);
		expect(Number(bobEndAndBoost[0])).to.be.equal(bobEnd);
		expect(Boolean(bobEndAndBoost[1])).to.be.false;

	});

	it('Bob exits Mission A', async () => {
		// check slots available from mirror node
		const encodedCommand = missionIface.encodeFunctionData(
			'getSlotsRemaining',
			[],
		);

		const mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			missionA,
			encodedCommand,
			operatorId,
			false,
		);

		let slots = missionIface.decodeFunctionResult(
			'getSlotsRemaining',
			mirrorResponse,
		);

		expect(Number(slots[0])).to.be.equal(0);

		client.setOperator(bobId, bobPK);

		// Legacy 1.0 - old mode using $LAZY
		// will need to have an allowance of 0.1 $LAZY to exit the mission
		// NB: allowance to the mission contract not the gas station
		// await setFTAllowance(client, lazyTokenId, bobId, AccountId.fromString(`0.0.${missionA.num}`), 1);
		// V2.0 - now allowance of 1 tinybar to exit the mission
		await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionA.num}`), 1);

		// calls leaveMission() before complete
		const result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			1_000_000,
			'leaveMission',
			[],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (leaveMission A):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// should not be a slot available
		slots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(1);
	});

	it('Checks the delegation of the NFTs to Bob is removed', async () => {
		// check the NFTs are delegated back to the users
		const result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'getNFTDelegatedTo',
			[ReqA_TokenId.toSolidityAddress(), 6],
		);

		expect(result[0].toString()).to.be.equal(ZeroAddress.toString());
	});

	it('Close fails due to existing users', async () => {
		// test out getUsersOnMission expecting to see Operator and Alice
		const users = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUsersOnMission',
		);

		expect(users[0].length).to.be.equal(2);
		const userList = [operatorId.toSolidityAddress(), aliceId.toSolidityAddress()];
		// not g'tee on ordering so check both
		expect(userList.includes(users[0][0].slice(2).toLowerCase())).to.be.true;
		expect(userList.includes(users[0][1].slice(2).toLowerCase())).to.be.true;

		// as Operator (admin) try and close the mission but expect failure given participants still exist
		client.setOperator(operatorId, operatorKey);
		const gasLim = 800_000;
		try {
			const result = await contractExecuteFunction(
				missionA,
				missionIface,
				client,
				gasLim,
				'closeMission',
				[],
			);
			expect(result[0]?.status?.name).to.be.equal('UsersOnMission');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('UsersOnMission');
		}
	});

	it('Operator & Alice claims rewards', async () => {
		// check the time remaining for the Operator
		client.setOperator(operatorId, operatorKey);
		const operatorEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		const timeStamp = Math.floor(new Date().getTime() / 1000);
		const operatorEnd = Number(operatorEndAndBoost[0]);

		const timeToWait = operatorEnd - timeStamp;
		console.log('Operator - to claim mission A - Time to wait:', timeToWait, 'seconds', operatorEnd, timeStamp);
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// check the slots available
		const openingSlots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		// LEGACY 1.0 - old mode using $LAZY
		// set $LAZY allowance for transfer
		// allowance is to the Mission not Gas Station for NFT movement
		// FUTURE: when hbar fees are in place this will look cleaner vs 2 x FT allowances
		// await setFTAllowance(client, lazyTokenId, operatorId, AccountId.fromString(`0.0.${missionA.num}`), 3);
		// V2.0 - now allowance of 3 tinybar to claim rewards
		await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionA.num}`), 3);

		// call claimRewards for Operator
		const gasLim = 1_500_000;
		let result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0].status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (claimRewards A):', result);
			fail('Operator failed to claim rewards');
		}

		console.log('Operator - claimed mission A - tx id:', result[2].transactionId.toString());

		// check the slots available
		const stageOneSlots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(stageOneSlots[0])).to.be.equal(Number(openingSlots[0]));

		await sleep(7500);

		// check the mission exit event is broadcast to mirror nodes
		let completedUser = await checkLastMirrorEvent(env, missionA, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check at factory level
		let factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check the time remaining for Alice
		const aliceEndAndBoost = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set $LAZY allowance for transfer
		client.setOperator(aliceId, alicePK);
		// LEGACY 1.0 - old mode using $LAZY
		// await setFTAllowance(client, lazyTokenId, aliceId, AccountId.fromString(`0.0.${missionA.num}`), 3);
		// // also set an FT allowance to BoostManager for the Gem retrieval
		// await setFTAllowance(client, lazyTokenId, aliceId, AccountId.fromString(boostManagerId.toString()), 3);
		// V2.0 - now allowance of 3 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionA.num}`), 3);
		expect(result).to.be.equal('SUCCESS');

		result = await setHbarAllowance(client, aliceId, AccountId.fromString(boostManagerId.toString()), 3);
		expect(result).to.be.equal('SUCCESS');

		// call claimRewards for Alice
		[result] = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the slots available
		const stageTwoSlots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(stageTwoSlots[0])).to.be.equal(Number(stageOneSlots[0]));

		await sleep(7500);

		// check the mission exit event is broadcast to mirror nodes
		completedUser = await checkLastMirrorEvent(env, missionA, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());

		// check at factory level
		factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());
	});

	it('Admin closes pulling rewards Bob never claimed', async () => {
		// send 5 tinyBar to mission
		client.setOperator(operatorId, operatorKey);
		let result = await sendHbar(
			client,
			operatorId,
			AccountId.fromString(`0.0.${missionA.num}`),
			5,
			HbarUnit.Tinybar,
		);

		expect(result).to.be.equal('SUCCESS');

		// send 6 $LAZY to the mission
		await sendLazy(AccountId.fromString(`0.0.${missionA.num}`), 6);

		// use getUsersOnMission expecting to see 0 users
		const users = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getUsersOnMission',
		);

		expect(users[0].length).to.be.equal(0);

		// check the slots available expecting 1
		const openingSlots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(openingSlots[0])).to.be.equal(1);

		// call closeMission as Operator
		const gasLim = 1_000_000;
		result = await contractExecuteFunction(
			missionA,
			missionIface,
			client,
			gasLim,
			'closeMission',
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Unexpected Result (closeMission A):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the slots available expecting 0
		const slots = await contractExecuteQuery(
			missionA,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(0);
	});

	it('Check mission A is no longer visible from the factory', async () => {
		// get getDeployedMissions() from mission factory and check no value is equal to MissionA
		const deployedMissions = await contractExecuteQuery(
			factoryContractId,
			missionFactoryIface,
			client,
			null,
			'getDeployedMissions',
		);

		expect(deployedMissions[0].length).to.be.equal(10);
		for (let i = 0; i < deployedMissions[0].length; i++) {
			expect(deployedMissions[0][i].slice(2).toLowerCase()).to.not.be.equal(missionA.toSolidityAddress().toLowerCase());
		}
	});

	it('Set mission B to have a start time (factory and direct) and check it blocks entry, then test decending price', async () => {
		client.setOperator(operatorId, operatorKey);
		// check getDecrementDetails for the mission via query
		let decrementDetails = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'getDecrementDetails',
		);
		expect(decrementDetails.length).to.be.equal(2);
		expect(Number(decrementDetails[0])).to.be.equal(0);
		expect(Number(decrementDetails[1])).to.be.equal(0);

		let entryFee = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.equal(20);

		// set the auction details using setDecreasingEntryFee
		const gasLim = 800_000;

		// set startTimestamp to be 3 seconds in the future
		const startTimestamp = Math.floor(new Date().getTime() / 1000) + 8;

		let [result] = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'setDecreasingEntryFee',
			[startTimestamp, 2, 1, 1],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// now there is a start time should be unable to enter the mission until the start time
		try {
			result = await contractExecuteFunction(
				missionB,
				missionIface,
				client,
				1_500_000,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[2]]],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Mission not open yet');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: Mission not open yet');
		}

		// check again to ensure the setter worked
		decrementDetails = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'getDecrementDetails',
		);
		expect(decrementDetails.length).to.be.equal(2);
		expect(Number(decrementDetails[0])).to.be.equal(1);
		expect(Number(decrementDetails[1])).to.be.equal(startTimestamp);

		await sleep(7500);

		// check getDecrementDetails for the mission via mirror node
		const encodedCommand = missionIface.encodeFunctionData(
			'getDecrementDetails',
			[],
		);

		const mirrorResponse = await readOnlyEVMFromMirrorNode(
			env,
			ContractId.fromString(`0.0.${missionB.num}`),
			encodedCommand,
			operatorId,
			false,
		);

		decrementDetails = missionIface.decodeFunctionResult(
			'getDecrementDetails',
			mirrorResponse,
		);
		console.log('DEBUG Decrement Details:', decrementDetails);
		expect(decrementDetails.length).to.be.equal(2);
		expect(Number(decrementDetails[0])).to.be.equal(1);
		expect(Number(decrementDetails[1])).to.be.equal(startTimestamp);

		// calc seconds until start time
		const secondsUntilStart = startTimestamp - Math.floor(new Date().getTime() / 1000);
		// wait 3 seconds extra to ensure mission is open and fee is decreasing
		await sleep((secondsUntilStart + 3) * 1000);

		// set the NFT allowance for the mission
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionB.num}`),
		);
		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionB.num}`) });

		// get the entry fee and expect it to be <= 18
		entryFee = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'entryFee',
		);
		expect(Number(entryFee[0])).to.be.lessThanOrEqual(19);

		// set allowance
		const fee = Number(entryFee[0]);
		result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		// allowance is less than starting amount hence proving the auction works

		expect(result).to.be.equal('SUCCESS');

		// now enter the mission
		result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			1_500_000,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[2]]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (enterMission B):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');
	});

	it('Operator tries to enter the mission again (but should be blocked)', async () => {
		client.setOperator(operatorId, operatorKey);

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// NFT allowance already in place

		const gasLim = 1_500_000;

		try {
			result = await contractExecuteFunction(
				missionB,
				missionIface,
				client,
				gasLim,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[3]]],
			);
			expect(result[0]?.status.toString()).to.be.equal('REVERT: Already joined');
		}
		catch (e) {
			console.log(e);
			fail('Operator should not be able to enter the mission again');
		}
	});

	it('Alice and Bob try to enter Mission B (Bob fails on slots) and Alice claims rewards', async () => {
		// Alice enters Mission B
		client.setOperator(aliceId, alicePK);
		const gasLim = 1_500_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionB.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[12]]],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice enterMission B):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionB,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(0);

		// Bob tries to enter but fails on slots
		client.setOperator(bobId, bobPK);
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionB.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		try {
			result = await contractExecuteFunction(
				missionB,
				missionIface,
				client,
				gasLim,
				'enterMission',
				[[ReqA_TokenId.toSolidityAddress()], [[7]]],
			);
			expect(result[0]?.status).to.be.equal('REVERT: No more slots available');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: No more slots available');
		}

		// Bob tries leaveMission but fails as not a participant
		try {
			result = await contractExecuteFunction(
				missionB,
				missionIface,
				client,
				gasLim,
				'leaveMission',
				[],
			);
			expect(result[0]?.status).to.be.equal('REVERT: No mission active');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: No mission active');
		}

		// Bob tries to claimRewards but fails as not a participant
		try {
			result = await contractExecuteFunction(
				missionB,
				missionIface,
				client,
				gasLim,
				'claimRewards',
				[],
			);
			expect(result[0]?.status).to.be.equal('REVERT: No mission active');
		}
		catch (e) {
			console.log(e);
			expect(e.toString()).to.be.equal('REVERT: No mission active');
		}

		// wait 3 seconds then Operator and Alice claim rewards
		await sleep(4000);

		// Operator claims rewards
		client.setOperator(operatorId, operatorKey);
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionB.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionB.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'claimRewards',
			[],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Operator claimRewards B):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the mission completion event is broadcast to mirror nodes
		await sleep(7500);

		// check the mission completion event is broadcast to mirror nodes
		const completedUser = await checkLastMirrorEvent(env, missionB, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check at factory level
		const factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// Alice claims rewards
		client.setOperator(aliceId, alicePK);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionB.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionB.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionB,
			missionIface,
			client,
			gasLim,
			'claimRewards',
			[],
		);
		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice claimRewards B):', result);
		}
		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
	});

	it('Operator, Alice and Bob enter Mission C and claim rewards', async () => {
		// Operator enters Mission C
		client.setOperator(operatorId, operatorKey);
		const gasLim = 1_500_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionC.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionC.num}`) });

		// using ReqA serial 1 again to check it was pulled back
		[result] = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[1]]],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// Alice enters Mission C
		client.setOperator(aliceId, alicePK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionC.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[11]]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice enterMission C):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterAlice = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterAlice[0])).to.be.equal(1);

		// Bob enters Mission C
		client.setOperator(bobId, bobPK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionC.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[6]]],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Bob enterMission C):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterBob = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterBob[0])).to.be.equal(0);

		// check time until mission ends for Operator
		client.setOperator(operatorId, operatorKey);
		const operatorEndAndBoost = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		let timeStamp = Math.floor(new Date().getTime() / 1000);
		const operatorEnd = Number(operatorEndAndBoost[0][0]);

		const timeToWait = operatorEnd - timeStamp;
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionC.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionC.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Operator
		result = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (claimRewards C):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the mission completion event is broadcast to mirror nodes
		await sleep(7500);
		let completedUser = await checkLastMirrorEvent(env, missionC, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check at factory level
		let factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(operatorId.toSolidityAddress().toLowerCase());

		// check time until mission ends for Alice
		client.setOperator(aliceId, alicePK);
		const aliceEndAndBoost = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0][0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionC.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionC.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Alice
		[result] = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the mission completion event is broadcast to mirror nodes
		await sleep(7500);
		completedUser = await checkLastMirrorEvent(env, missionC, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());

		// check at factory level
		factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(aliceId.toSolidityAddress().toLowerCase());

		// check time until mission ends for Bob
		client.setOperator(bobId, bobPK);
		const bobEndAndBoost = await contractExecuteQuery(
			missionC,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		const bobEnd = Number(bobEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const bobTimeToWait = bobEnd - timeStamp;
		if (bobTimeToWait > 0) await sleep(bobTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionC.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionC.num}`), 4);

		// claim rewards for Bob
		result = await contractExecuteFunction(
			missionC,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (claimRewards C for Bob):', result);
			fail('Bob failed to claim rewards for mission C');
		}

		// check the mission completion event is broadcast to mirror nodes
		await sleep(7500);
		completedUser = await checkLastMirrorEvent(env, missionC, missionIface, 0, true);
		expect(completedUser.toSolidityAddress().toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());

		// check at factory level
		factoryUser = await checkLastMirrorEvent(env, factoryContractId, missionFactoryIface, 1, true);
		expect(factoryUser.toSolidityAddress().toLowerCase()).to.be.equal(bobId.toSolidityAddress().toLowerCase());
	});

	it('Operator, Alice and Bob enter Mission D and claim rewards', async () => {
		// Operator enters Mission D
		client.setOperator(operatorId, operatorKey);
		const gasLim = 1_500_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionD.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionD.num}`) });

		// using ReqA serial 1 again to check it was pulled back
		result = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[1]]],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (enterMission D):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// Alice enters Mission D
		client.setOperator(aliceId, alicePK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionD.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[11]]],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterAlice = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterAlice[0])).to.be.equal(1);

		// Bob enters Mission D
		client.setOperator(bobId, bobPK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionD.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress()], [[6]]],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterBob = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterBob[0])).to.be.equal(0);

		// check time until mission ends for Operator
		client.setOperator(operatorId, operatorKey);
		const operatorEndAndBoost = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		let timeStamp = Math.floor(new Date().getTime() / 1000);
		const operatorEnd = Number(operatorEndAndBoost[0]);

		const timeToWait = operatorEnd - timeStamp;
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionD.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionD.num}`), 4);

		// claim rewards for Operator
		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Alice
		client.setOperator(aliceId, alicePK);
		const aliceEndAndBoost = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionD.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionD.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Alice
		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Bob
		client.setOperator(bobId, bobPK);
		const bobEndAndBoost = await contractExecuteQuery(
			missionD,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		const bobEnd = Number(bobEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const bobTimeToWait = bobEnd - timeStamp;
		if (bobTimeToWait > 0) await sleep(bobTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionD.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionD.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Bob
		[result] = await contractExecuteFunction(
			missionD,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');
	});

	it('Operator, Alice and Bob enter Mission E and claim rewards', async () => {
		// Operator enters Mission E
		client.setOperator(operatorId, operatorKey);
		const gasLim = 3_000_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId, ReqB_TokenId, ReqC_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionE.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionE.num}`) });

		// enter using serial 3 of ReqA, ReqB and ReqC
		result = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqA_TokenId.toSolidityAddress(),
					ReqB_TokenId.toSolidityAddress(),
					ReqC_TokenId.toSolidityAddress(),
				],
				[[3], [3], [3]],
			],
		);

		if (result[0]?.status?.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Operator enterMission E):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// Alice enters Mission E
		client.setOperator(aliceId, alicePK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqC_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionE.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 12, 13 and 14 of ReqC
		[result] = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[ReqC_TokenId.toSolidityAddress()],
				[[12, 13, 14]],
			],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterAlice = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterAlice[0])).to.be.equal(1);

		// Bob enters Mission E
		client.setOperator(bobId, bobPK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqB_TokenId, ReqC_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionE.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 6 and 7 of ReqB and serial 8 of ReqC
		[result] = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqB_TokenId.toSolidityAddress(),
					ReqC_TokenId.toSolidityAddress(),
				],
				[[6, 7], [8]],
			],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterBob = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterBob[0])).to.be.equal(0);

		// check time until mission ends for Operator
		client.setOperator(operatorId, operatorKey);

		const operatorEndAndBoost = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		let timeStamp = Math.floor(new Date().getTime() / 1000);

		const operatorEnd = Number(operatorEndAndBoost[0]);

		const timeToWait = operatorEnd - timeStamp;
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionE.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionE.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Operator
		result = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Operator claimRewards E):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Alice
		client.setOperator(aliceId, alicePK);

		const aliceEndAndBoost = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionE.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionE.num}`), 4);

		// claim rewards for Alice
		result = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice claimRewards E):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Bob
		client.setOperator(bobId, bobPK);

		const bobEndAndBoost = await contractExecuteQuery(
			missionE,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		const bobEnd = Number(bobEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const bobTimeToWait = bobEnd - timeStamp;
		if (bobTimeToWait > 0) await sleep(bobTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionE.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionE.num}`), 4);

		// claim rewards for Bob
		result = await contractExecuteFunction(
			missionE,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Bob claimRewards E):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');
	});

	it('Check token delegation after the multi collateral entry to Mission E', async () => {
		// check the token delegation
		let result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), ReqA_TokenId.toSolidityAddress(), 3],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), ReqB_TokenId.toSolidityAddress(), 3],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[operatorId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 3],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[aliceId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 12],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[aliceId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 13],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[aliceId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 14],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[bobId.toSolidityAddress(), ReqC_TokenId.toSolidityAddress(), 8],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[bobId.toSolidityAddress(), ReqB_TokenId.toSolidityAddress(), 6],
		);

		expect(Boolean(result[0])).to.be.true;

		result = await contractExecuteQuery(
			ldrId,
			ldrIface,
			client,
			null,
			'checkDelegateToken',
			[bobId.toSolidityAddress(), ReqB_TokenId.toSolidityAddress(), 7],
		);

		expect(Boolean(result[0])).to.be.true;
	});


	it('Operator, Alice and Bob enter Mission F and claim rewards', async () => {
		// Operator enters Mission F
		client.setOperator(operatorId, operatorKey);
		const gasLim = 1_800_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId, ReqC_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionF.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });
		operatorNftAllowances.push({ tokenId: ReqC_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });

		// enter using serial 2 and 3 of ReqC, and serial 1 of ReqA
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqC_TokenId.toSolidityAddress(),
					ReqA_TokenId.toSolidityAddress(),
				],
				[[2, 3], [1]],
			],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Operator enterMission F):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		console.log('Operator entered Mission F - tx id:', result[2]?.transactionId?.toString());

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// Alice enters Mission F
		client.setOperator(aliceId, alicePK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqB_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionF.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 12, 13 and 14 of ReqB
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[ReqB_TokenId.toSolidityAddress()],
				[[12, 13, 14]],
			],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice enterMission F):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterAlice = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterAlice[0])).to.be.equal(1);

		// Bob enters Mission F
		client.setOperator(bobId, bobPK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId, ReqB_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionF.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 6 and 7 of ReqA and serial 8 of ReqB
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqA_TokenId.toSolidityAddress(),
					ReqB_TokenId.toSolidityAddress(),
				],
				[[6, 7], [8]],
			],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Bob enterMission F):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterBob = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterBob[0])).to.be.equal(0);

		// check time until mission ends for Operator
		client.setOperator(operatorId, operatorKey);

		const operatorEndAndBoost = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		let timeStamp = Math.floor(new Date().getTime() / 1000);

		const operatorEnd = Number(operatorEndAndBoost[0][0]);

		const timeToWait = operatorEnd - timeStamp;
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionF.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionF.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Operator
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Operator claimRewards F):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Alice
		client.setOperator(aliceId, alicePK);

		const aliceEndAndBoost = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionF.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionF.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Alice
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Alice claimRewards F):', result);
		}
		expect(result[0].status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Bob
		client.setOperator(bobId, bobPK);

		const bobEndAndBoost = await contractExecuteQuery(
			missionF,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		const bobEnd = Number(bobEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const bobTimeToWait = bobEnd - timeStamp;
		if (bobTimeToWait > 0) await sleep(bobTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionF.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionF.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionF.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionF.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Bob
		result = await contractExecuteFunction(
			missionF,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('Unexpected Result (Bob claimRewards F):', result);
		}
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');
	});

	it('Operator, Alice and Bob enter Mission G and claim rewards', async () => {
		// Operator enters Mission G
		client.setOperator(operatorId, operatorKey);
		const gasLim = 1_800_000;

		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionG.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 2, 3, 4 of ReqA sent 'awkwardly'
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqA_TokenId.toSolidityAddress(),
					ReqA_TokenId.toSolidityAddress(),
					ReqA_TokenId.toSolidityAddress(),
				],
				[[2], [3], [4]],
			],
		);
		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Operator Failed to enter G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slots = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// Alice enters Mission G
		client.setOperator(aliceId, alicePK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionG.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 12, 13 and 14 of ReqA
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[ReqA_TokenId.toSolidityAddress()],
				[[12, 13, 14]],
			],
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Alice Failed to enter G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterAlice = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterAlice[0])).to.be.equal(1);

		// Bob enters Mission G
		client.setOperator(bobId, bobPK);

		// set allowance
		result = await setFTAllowance(
			client,
			lazyTokenId,
			bobId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqC_TokenId, ReqA_TokenId],
			bobId,
			AccountId.fromString(`0.0.${missionG.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		// enter using serial 6 and 7 of ReqC and serial 8 of ReqA
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[
				[
					ReqC_TokenId.toSolidityAddress(),
					ReqA_TokenId.toSolidityAddress(),
				],
				[[6, 7], [8]],
			],
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Bob Failed to enter G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check slots remaining
		const slotsAfterBob = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfterBob[0])).to.be.equal(0);

		// check time until mission ends for Operator
		client.setOperator(operatorId, operatorKey);

		const operatorEndAndBoost = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[operatorId.toSolidityAddress()],
		);

		// uint256, bool
		let timeStamp = Math.floor(new Date().getTime() / 1000);

		const operatorEnd = Number(operatorEndAndBoost[0]);

		const timeToWait = operatorEnd - timeStamp;
		if (timeToWait > 0) await sleep(timeToWait * 1000);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionG.num}`),
		// 	20,
		// );
		// V2.0 - now allowance of 20 tinybar to claim rewards
		result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionG.num}`), 20);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Operator
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);
		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Operator Failed to claim rewards G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Alice
		client.setOperator(aliceId, alicePK);

		const aliceEndAndBoost = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[aliceId.toSolidityAddress()],
		);

		// uint256, bool
		const aliceEnd = Number(aliceEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const aliceTimeToWait = aliceEnd - timeStamp;
		if (aliceTimeToWait > 0) await sleep(aliceTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionG.num}`),
		// 	10,
		// );
		// V2.0 - now allowance of 10 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionG.num}`), 10);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Alice
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Alice Failed to claim rewards G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the time remaining for Bob
		client.setOperator(bobId, bobPK);

		const bobEndAndBoost = await contractExecuteQuery(
			missionG,
			missionIface,
			client,
			null,
			'getUserEndAndBoost',
			[bobId.toSolidityAddress()],
		);

		// uint256, bool
		const bobEnd = Number(bobEndAndBoost[0]);
		timeStamp = Math.floor(new Date().getTime() / 1000);

		const bobTimeToWait = bobEnd - timeStamp;
		if (bobTimeToWait > 0) await sleep(bobTimeToWait * 1000);

		// set allowance
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	bobId,
		// 	AccountId.fromString(`0.0.${missionG.num}`),
		// 	10,
		// );
		// V2.0 - now allowance of 10 tinybar to claim rewards
		result = await setHbarAllowance(client, bobId, AccountId.fromString(`0.0.${missionG.num}`), 10);

		expect(result).to.be.equal('SUCCESS');

		// claim rewards for Bob
		result = await contractExecuteFunction(
			missionG,
			missionIface,
			client,
			gasLim,
			'claimRewards',
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Bob Failed to claim rewards G:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');
	});

	it('Operator closes out Mision H to prove bulk transfer', async () => {
		// operator calls closeMission
		client.setOperator(operatorId, operatorKey);
		// check slotsRemaining
		const slots = await contractExecuteQuery(
			missionH,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(8);

		const gasLim = 2_000_000;

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// let result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionH.num}`),
		// 	20,
		// );
		// V2.0 - now allowance of 20 tinybar to claim rewards
		let result = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionH.num}`), 20);

		expect(result).to.be.equal('SUCCESS');

		result = await contractExecuteFunction(
			missionH,
			missionIface,
			client,
			gasLim,
			'closeMission',
		);
		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to close H:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

		// check the slots are now 0
		const slotsAfter = await contractExecuteQuery(
			missionH,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfter[0])).to.be.equal(0);
	});

	it('Operator and Alice try to enter Mission I - only Alice can due to serial lock', async () => {
		client.setOperator(operatorId, operatorKey);
		// check the mission entry fee
		const entryFee = await contractExecuteQuery(
			missionI,
			missionIface,
			client,
			null,
			'entryFee',
		);

		const fee = Number(entryFee[0]);

		// set allowance
		let result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			fee,
		);
		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId, ReqB_TokenId],
			operatorId,
			AccountId.fromString(`0.0.${missionI.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		operatorNftAllowances.push({ tokenId: ReqA_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });
		operatorNftAllowances.push({ tokenId: ReqB_TokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });

		const gasLim = 1_800_000;
		try {
			result = await contractExecuteFunction(
				missionI,
				missionIface,
				client,
				gasLim,
				'enterMission',
				[[ReqB_TokenId.toSolidityAddress()], [[1, 5]]],
			);
			expect(result[0]?.status).to.be.equal('REVERT: Serials not authorized');
		}
		catch (e) {
			console.log('error entry to I', result);
			console.log(e);
			fail('Operator should not be able to enter Mission I due to serial lock');
		}

		console.log('Operator failed to enter Mission I as expected - tx id:', result[2]?.transactionId?.toString());

		// now try with Alice
		client.setOperator(aliceId, alicePK);
		result = await setFTAllowance(
			client,
			lazyTokenId,
			aliceId,
			lazyGasStationId,
			fee,
		);

		expect(result).to.be.equal('SUCCESS');

		// set NFT allowance
		result = await setNFTAllowanceAll(
			client,
			[ReqA_TokenId, ReqB_TokenId],
			aliceId,
			AccountId.fromString(`0.0.${missionI.num}`),
		);

		expect(result).to.be.equal('SUCCESS');

		[result] = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'enterMission',
			[[ReqA_TokenId.toSolidityAddress(), ReqB_TokenId.toSolidityAddress()], [[16], [16]]],
		);

		expect(result.status.toString()).to.be.equal('SUCCESS');

		// check the slots remaining
		const slots = await contractExecuteQuery(
			missionI,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(0);

		await sleep(7500);

		// set $LAZY allowance for transfer
		// LEGACY 1.0 - old mode using $LAZY
		// result = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	aliceId,
		// 	AccountId.fromString(`0.0.${missionI.num}`),
		// 	4,
		// );
		// V2.0 - now allowance of 4 tinybar to claim rewards
		result = await setHbarAllowance(client, aliceId, AccountId.fromString(`0.0.${missionI.num}`), 4);

		expect(result).to.be.equal('SUCCESS');

		// Alice claims rewards
		client.setOperator(aliceId, alicePK);
		result = await contractExecuteFunction(
			missionI,
			missionIface,
			client,
			gasLim,
			'claimRewards',
			[],
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Alice Failed to claim rewards I:', result);
		expect(result[0]?.status.toString()).to.be.equal('SUCCESS');

	});

	it('Mission J: test removal of collateral inc. items not uploaded via SC method', async () => {
		client.setOperator(operatorId, operatorKey);

		// ensure small allowance of $LAZY for the transfer
		// LEGACY 1.0 - old mode using $LAZY
		// const lazyFtAllowanceSet = await setFTAllowance(
		// 	client,
		// 	lazyTokenId,
		// 	operatorId,
		// 	AccountId.fromString(`0.0.${missionJ.num}`),
		// 	5,
		// );
		// V2.0 - now allowance of 5 tinybar to claim rewards
		const lazyFtAllowanceSet = await setHbarAllowance(client, operatorId, AccountId.fromString(`0.0.${missionJ.num}`), 5);

		expect(lazyFtAllowanceSet).to.be.equal('SUCCESS');

		// call getRewards to check only 2 rewards in the mission
		const gasLim = 800_000;
		const rewards = await contractExecuteQuery(
			missionJ,
			missionIface,
			client,
			null,
			'getRewards',
		);

		// address[], uint256[][]
		expect(rewards[0].length).to.be.equal(2);
		// expect 2 addresss with 1 serial each
		expect(rewards[1][0].length).to.be.equal(1);
		expect(rewards[1][1].length).to.be.equal(1);
		// check the serials are 23 or 24
		expect(Number(rewards[1][0][0])).to.be.lessThan(25);
		expect(Number(rewards[1][1][0])).to.be.lessThan(25);

		// use the withdrawRewards method to remove the RewardA serial 25
		let result = await contractExecuteFunction(
			missionJ,
			missionIface,
			client,
			gasLim,
			'withdrawRewards',
			[RewardA_TokenId.toSolidityAddress(), [25]],
		);
		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to withdraw from J:', result);
		expect(result[0].status.toString()).to.be.equal('SUCCESS');

		// get slots remaining
		const slots = await contractExecuteQuery(
			missionJ,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slots[0])).to.be.equal(2);

		// close the mission
		result = await contractExecuteFunction(
			missionJ,
			missionIface,
			client,
			gasLim,
			'closeMission',
		);

		if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to close J:', result);
		expect(result[0].status.toString()).to.be.equal('SUCCESS');

		// check the slots are now 0
		const slotsAfter = await contractExecuteQuery(
			missionJ,
			missionIface,
			client,
			null,
			'getSlotsRemaining',
		);

		expect(Number(slotsAfter[0])).to.be.equal(0);

		// check the rewards are now 0
		const rewardsAfter = await contractExecuteQuery(
			missionJ,
			missionIface,
			client,
			null,
			'getRewards',
		);

		// expect empty array
		console.log('J closed Rewards:', rewardsAfter);
		expect(rewardsAfter[0].length).to.be.equal(0);
	});
});

describe('Clean-up', () => {
	it('removes allowances from Operator', async () => {
		client.setOperator(operatorId, operatorKey);
		let result = await clearNFTAllowances(client, operatorNftAllowances);
		expect(result).to.be.equal('SUCCESS');

		// clean up the LGS authorizations
		// getContractUsers()
		const lgsContractUsers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getContractUsers',
		);

		for (let i = 0; i < lgsContractUsers[0].length; i++) {
			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeContractUser',
				[lgsContractUsers[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to remove LGS contract user:', result);
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}

		// getAuthorizers()
		const lgsAuthorizers = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAuthorizers',
		);

		for (let i = 0; i < lgsAuthorizers[0].length; i++) {
			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAuthorizer',
				[lgsAuthorizers[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to remove LGS authorizer:', result);
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}

		// getAdmins()
		const lgsAdmins = await contractExecuteQuery(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'getAdmins',
		);

		for (let i = 0; i < lgsAdmins[0].length; i++) {
			if (lgsAdmins[0][i].slice(2).toLowerCase() == operatorId.toSolidityAddress()) {
				console.log('Skipping removal of Operator as LGS admin');
				continue;
			}

			result = await contractExecuteFunction(
				lazyGasStationId,
				lazyGasStationIface,
				client,
				300_000,
				'removeAdmin',
				[lgsAdmins[0][i]],
			);

			if (result[0]?.status.toString() !== 'SUCCESS') console.log('Failed to remove LGS admin:', result);
			expect(result[0].status.toString()).to.be.equal('SUCCESS');
		}


		// ensure mirrors have caught up
		await sleep(7500);

		const outstandingAllowances = [];
		// get the FT allowances for operator
		const mirrorFTAllowances = await checkFTAllowances(env, operatorId);
		for (let a = 0; a < mirrorFTAllowances.length; a++) {
			const allowance = mirrorFTAllowances[a];
			// console.log('FT Allowance found:', allowance.token_id, allowance.owner, allowance.spender);
			if (allowance.token_id == lazyTokenId.toString() && allowance.amount > 0) outstandingAllowances.push(allowance.spender);
		}

		// console.log('Outstanding FT Allowances:', outstandingAllowances);

		// if the contract was created reset any $LAZY allowance for the operator
		// LEGACY $LAZY for staking
		// if (outstandingAllowances.includes(`0.0.${missionA.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionA.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionB.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionB.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionC.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionC.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionD.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionD.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionE.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionE.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionF.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionG.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionG.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionH.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionH.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionI.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });
		// if (outstandingAllowances.includes(`0.0.${missionJ.num}`)) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(`0.0.${missionJ.num}`) });
		// if (outstandingAllowances.includes(factoryContractId.toString())) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(factoryContractId.toString()) });
		// if (outstandingAllowances.includes(boostManagerId.toString())) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(boostManagerId.toString()) });
		if (outstandingAllowances.includes(lazyGasStationId.toString())) operatorFtAllowances.push({ tokenId: lazyTokenId, owner: operatorId, spender: AccountId.fromString(lazyGasStationId.toString()) });

		result = await clearFTAllowances(client, operatorFtAllowances);
		expect(result).to.be.equal('SUCCESS');

		// check the Hbar allownaces
		const mirrorHbarAllowances = await checkHbarAllowances(env, operatorId);
		const oustandingHbarAllowances = [];
		for (let a = 0; a < mirrorHbarAllowances.length; a++) {
			const allowance = mirrorHbarAllowances[a];
			// console.log('Hbar Allowance found:', allowance.owner, allowance.spender);
			if (allowance.amount > 0) oustandingHbarAllowances.push(allowance.spender);
		}

		const operatorHbarAllowances = [];
		if (oustandingHbarAllowances.includes(`0.0.${missionA.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionA.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionB.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionB.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionC.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionC.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionD.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionD.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionE.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionE.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionF.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionF.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionG.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionG.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionH.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionH.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionI.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionI.num}`) });
		if (oustandingHbarAllowances.includes(`0.0.${missionJ.num}`)) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(`0.0.${missionJ.num}`) });
		if (oustandingHbarAllowances.includes(factoryContractId.toString())) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(factoryContractId.toString()) });
		if (oustandingHbarAllowances.includes(boostManagerId.toString())) operatorHbarAllowances.push({ owner: operatorId, spender: AccountId.fromString(boostManagerId.toString()) });

		result = await clearHbarAllowances(client, operatorHbarAllowances);
		expect(result).to.be.equal('SUCCESS');
	});
});


/**
 * Helper function to encpapsualte minting an FT
 * @param {string} tokenName
 * @param {string} tokenSymbol
 * @param {string} tokenMemo
 * @param {number} tokenInitalSupply
 * @param {number} tokenDecimal
 * @param {number} tokenMaxSupply
 * @param {number} payment
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment,
) {
	const gasLim = 800000;
	// call associate method
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment,
	);
	const tokenIdSolidityAddr =
		createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

/**
 * Use the LSCT to send $LAZY out
 * @param {AccountId} receiverId
 * @param {*} amt
 */
async function sendLazy(receiverId, amt) {
	const [result] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	return result.status.toString();
}

function matchMission(_mission) {
	const mission = _mission.toString().slice(2).toLowerCase();
	switch (mission) {
	case missionA.toSolidityAddress():
		return 'Mission A';
	case missionB.toSolidityAddress():
		return 'Mission B';
	case missionC.toSolidityAddress():
		return 'Mission C';
	case missionD.toSolidityAddress():
		return 'Mission D';
	case missionE.toSolidityAddress():
		return 'Mission E';
	case missionF.toSolidityAddress():
		return 'Mission F';
	case missionG.toSolidityAddress():
		return 'Mission G';
	case missionH.toSolidityAddress():
		return 'Mission H';
	case missionI.toSolidityAddress():
		return 'Mission I';
	case missionJ.toSolidityAddress():
		return 'Mission J';
	case missionK.toSolidityAddress():
		return 'Mission K';
	default:
		return null;
	}
}
