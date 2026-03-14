/**
 * Rotate the off-chain signing wallet for the LazyNFTStaking contract.
 *
 * The "signing wallet" (stored on-chain as `systemWallet`) is the ECDSA key
 * used by the back-end to sign reward proofs that authorise every stake and
 * unstake transaction.  Rotating it is a **critical operational action**:
 *
 *   1. Once the on-chain wallet is updated, the old key can no longer produce
 *      valid signatures — any pending/in-flight proofs signed with the old key
 *      will be rejected by the contract.
 *   2. The new private key must be deployed to every service that calls
 *      `generateStakingRewardProof()` *before* or *immediately after* the
 *      on-chain rotation, or users will be unable to stake/unstake.
 *
 * Usage:
 *   node setStakingSigningWallet.js 0.0.STAKING_CONTRACT_ID [options]
 *
 * Options:
 *   --generate       Generate a fresh ECDSA key pair (default if no SIGNING_KEY in .env)
 *   --encrypt        AES-256-GCM encrypt the saved .key file with a passphrase
 *   --output <path>  Where to save the key file (default: ./signingWallet_<timestamp>.key)
 *   --no-save        Skip saving the key to a file (print to console only)
 *   --multisig       Execute via multi-signature flow
 *   --threshold <n>  Multisig threshold
 *   --signers <ids>  Comma-separated signer account IDs
 *
 * Supports --multisig flag for multi-signature execution.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readlineSync = require('readline-sync');
const { ContractId, PrivateKey } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const {
	parseArgs,
	printHeader,
	runScript,
	confirmOrExit,
	logResult,
	getMultisigOptions,
	contractExecuteWithMultisig,
} = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

// ─── Encryption helpers ────────────────────────────────────────────────────────

/**
 * Encrypt a string with AES-256-GCM using a passphrase.
 * Key is derived via scrypt so the file is safe to store at rest.
 * File format (all hex):  salt:iv:authTag:ciphertext
 */
function encryptKey(plaintext, passphrase) {
	const salt = crypto.randomBytes(32);
	const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15 });
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	let encrypted = cipher.update(plaintext, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const authTag = cipher.getAuthTag().toString('hex');
	return [salt.toString('hex'), iv.toString('hex'), authTag, encrypted].join(':');
}

/**
 * Decrypt an AES-256-GCM encrypted key file produced by encryptKey().
 */
function decryptKey(blob, passphrase) {
	const [saltHex, ivHex, authTagHex, ciphertext] = blob.split(':');
	const salt = Buffer.from(saltHex, 'hex');
	const iv = Buffer.from(ivHex, 'hex');
	const authTag = Buffer.from(authTagHex, 'hex');
	const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15 });
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}

// ─── CLI flag helpers ──────────────────────────────────────────────────────────

function hasFlag(flag) {
	return process.argv.includes(flag);
}

function getFlagValue(flag) {
	const idx = process.argv.indexOf(flag);
	if (idx === -1 || idx + 1 >= process.argv.length) return null;
	return process.argv[idx + 1];
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const main = async () => {
	// We only require the operator — the signing key is optional because
	// the user may choose to generate a fresh one.
	const { client, operatorId, signingKey: envSigningKey, env } = createHederaClient({
		requireOperator: true,
		requireSigningKey: false,
	});

	const args = parseArgs(1, 'setStakingSigningWallet.js 0.0.SSS [--generate] [--encrypt] [--output path] [--no-save]', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'--generate    Generate a fresh ECDSA key pair (default if no SIGNING_KEY in .env)',
		'--encrypt     AES-256-GCM encrypt the .key file with a passphrase',
		'--output <p>  Custom output path for the key file',
		'--no-save     Do not save to file — only print to console',
	]);

	const contractId = ContractId.fromString(args[0]);
	const wantGenerate = hasFlag('--generate');
	const wantEncrypt = hasFlag('--encrypt');
	const wantNoSave = hasFlag('--no-save');
	const customOutput = getFlagValue('--output');

	// ── Decide on the new signing key ──────────────────────────────────────────

	let newSigningKey;
	let keySource;

	if (wantGenerate || !envSigningKey) {
		if (!wantGenerate && !envSigningKey) {
			console.log('\n  No SIGNING_KEY found in .env — will generate a fresh ECDSA key pair.\n');
		}
		newSigningKey = PrivateKey.generateECDSA();
		keySource = 'generated';
	}
	else {
		newSigningKey = envSigningKey;
		keySource = '.env SIGNING_KEY';
	}

	const newPublicEvmAddress = newSigningKey.publicKey.toEvmAddress();

	// ── Print header ───────────────────────────────────────────────────────────

	printHeader({
		scriptName: 'Rotate Staking Signing Wallet',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Key source': keySource,
			'New signing key (EVM)': `0x${newPublicEvmAddress}`,
		},
	});

	// ── Explain what is about to happen ────────────────────────────────────────

	console.log('╔══════════════════════════════════════════════════════════════════╗');
	console.log('║  SIGNING WALLET ROTATION — PLEASE READ CAREFULLY               ║');
	console.log('╠══════════════════════════════════════════════════════════════════╣');
	console.log('║                                                                ║');
	console.log('║  The "system wallet" is the ECDSA key pair whose public        ║');
	console.log('║  address is stored on-chain.  The back-end uses the private    ║');
	console.log('║  key to sign reward proofs for every stake/unstake call.       ║');
	console.log('║                                                                ║');
	console.log('║  After rotation:                                               ║');
	console.log('║    • The OLD key can no longer sign valid proofs.              ║');
	console.log('║    • Any in-flight proofs signed with the old key will FAIL.   ║');
	console.log('║    • The new private key must be deployed to all services      ║');
	console.log('║      that call generateStakingRewardProof() immediately.       ║');
	console.log('║                                                                ║');
	console.log('║  Signatures expire after 120 seconds, so the switchover        ║');
	console.log('║  window is tight.  Coordinate with your team.                  ║');
	console.log('║                                                                ║');
	console.log('╚══════════════════════════════════════════════════════════════════╝');

	// ── Fetch current on-chain wallet ──────────────────────────────────────────

	const lnsIface = loadInterface('LazyNFTStaking');

	const encodedCommand = lnsIface.encodeFunctionData('systemWallet', []);

	let oldSystemWallet = null;
	try {
		const osw = await readOnlyEVMFromMirrorNode(env, contractId, encodedCommand, operatorId, false);
		// Mirror node may return a short error code (e.g. "0x0000000000006453") instead
		// of a valid ABI-encoded address (66+ hex chars).  Guard against that.
		if (osw && osw.length >= 66) {
			oldSystemWallet = lnsIface.decodeFunctionResult('systemWallet', osw)[0].toString();
		}
		else {
			console.log(`\n  WARNING: Mirror node returned an unexpected value (${osw}).`);
			console.log('  Could not read current systemWallet — the contract may not be');
			console.log('  deployed at this address, or the mirror node is not yet synced.');
		}
	}
	catch (err) {
		console.log('\n  WARNING: Failed to read current systemWallet from mirror node.');
		console.log('  ' + err.message);
	}

	if (oldSystemWallet) {
		console.log('\n  Current on-chain systemWallet :', oldSystemWallet);
	}
	else {
		console.log('\n  Current on-chain systemWallet : (unknown)');
	}
	console.log('  New signing key (EVM address) : 0x' + newPublicEvmAddress);

	if (oldSystemWallet && oldSystemWallet.toLowerCase() === ('0x' + newPublicEvmAddress).toLowerCase()) {
		console.log('\n  The new key matches the current on-chain wallet — nothing to change.');
		process.exit(0);
	}

	// ── Save / export the private key ──────────────────────────────────────────

	if (keySource === 'generated') {
		// DER-encoded (codebase standard)
		const derPrivateKey = newSigningKey.toString();
		// raw 32-byte hex (for ethers.js)
		const rawPrivateKey = newSigningKey.toStringRaw();

		console.log('\n  ── New Key Details ──────────────────────────────────────────');
		console.log('  Private key (DER)     : ' + derPrivateKey);
		console.log('  Private key (raw hex) : ' + rawPrivateKey);
		console.log('  Public key  (EVM)     : 0x' + newPublicEvmAddress);
		console.log('  ────────────────────────────────────────────────────────────');
		console.log('  DER format is used in .env (SIGNING_KEY / SIGNING_WALLET).');
		console.log('  Raw hex is used by ethers.js (LazyNFTStakingHelper).');
		console.log('  PROTECT THIS KEY — anyone who holds it can sign reward proofs.');

		if (!wantNoSave) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
			const defaultFilename = `signingWallet_${timestamp}.key`;
			const outputPath = customOutput || path.join(process.cwd(), defaultFilename);

			// Build the plaintext key file with all formats for reference.
			// DER is listed first — it's the format used by .env and clientFactory.
			const plaintextContent = [
				'# Lazy NFT Staking — ECDSA Signing Wallet',
				`# Generated: ${new Date().toISOString()}`,
				`# Contract:  ${contractId.toString()}`,
				'#',
				'# DER format — use this in .env as SIGNING_KEY or SIGNING_WALLET',
				`DER=${derPrivateKey}`,
				'#',
				'# Raw hex — use this with ethers.js (e.g. new ethers.Wallet("0x" + raw))',
				`RAW=${rawPrivateKey}`,
				'#',
				'# Public key EVM address (stored on-chain as systemWallet)',
				`EVM=0x${newPublicEvmAddress}`,
				'',
			].join('\n');

			if (wantEncrypt) {
				const pass1 = readlineSync.question('  Enter encryption passphrase: ', { hideEchoBack: true });
				const pass2 = readlineSync.question('  Confirm passphrase: ', { hideEchoBack: true });

				if (pass1 !== pass2) {
					console.log('\n  Passphrases do not match — aborting.');
					process.exit(1);
				}
				if (pass1.length < 8) {
					console.log('\n  Passphrase must be at least 8 characters — aborting.');
					process.exit(1);
				}

				const encrypted = encryptKey(derPrivateKey, pass1);
				fs.writeFileSync(outputPath, encrypted, { mode: 0o600 });
				console.log(`\n  Key saved (AES-256-GCM encrypted, DER key): ${outputPath}`);

				// Verification round-trip
				const verify = decryptKey(fs.readFileSync(outputPath, 'utf8'), pass1);
				if (verify !== derPrivateKey) {
					console.log('  ERROR: Decryption verification failed — file may be corrupt.');
					process.exit(1);
				}
				console.log('  Decryption verified — file is intact.');
			}
			else {
				fs.writeFileSync(outputPath, plaintextContent, { mode: 0o600 });
				console.log(`\n  Key saved (plaintext, all formats): ${outputPath}`);
			}
		}
		else {
			console.log('\n  --no-save flag set — key was NOT written to disk.');
			console.log('  Make sure you have copied it from the console output above.');
		}
	}

	// ── Final confirmation ─────────────────────────────────────────────────────

	console.log('');
	confirmOrExit('Proceed with on-chain signing wallet rotation?');

	// ── Execute contract call ──────────────────────────────────────────────────

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		null,
		'setSystemWallet',
		[newSigningKey.publicKey.toEvmAddress()],
		multisigOptions,
	);

	logResult(result, 'System Wallet rotated successfully');

	// ── Post-rotation checklist ────────────────────────────────────────────────

	console.log('\n╔══════════════════════════════════════════════════════════════════╗');
	console.log('║  POST-ROTATION CHECKLIST                                       ║');
	console.log('╠══════════════════════════════════════════════════════════════════╣');
	console.log('║                                                                ║');
	console.log('║  1. Deploy the new SIGNING_KEY to your back-end / API server   ║');
	console.log('║     so that generateStakingRewardProof() uses the new key.     ║');
	console.log('║                                                                ║');
	console.log('║  2. Update your .env file:                                     ║');
	console.log('║       SIGNING_KEY=<new private key hex>                        ║');
	console.log('║                                                                ║');
	console.log('║  3. Verify by running a test stake/unstake transaction.        ║');
	console.log('║                                                                ║');
	console.log('║  4. Securely archive or destroy the old private key.           ║');
	console.log('║                                                                ║');
	console.log('║  5. If you saved an encrypted .key file, store the             ║');
	console.log('║     passphrase separately (password manager, vault, etc.).     ║');
	console.log('║                                                                ║');
	console.log('╚══════════════════════════════════════════════════════════════════╝');
};

runScript(main);
