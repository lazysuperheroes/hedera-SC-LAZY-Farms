/**
 * Display deployment manifest information
 * Usage: node scripts/deployments/showDeployments.js [network]
 */
const fs = require('fs');
const path = require('path');

const network = process.argv[2] || process.env.ENVIRONMENT?.toLowerCase() || 'mainnet';
const manifestPath = path.join(__dirname, '../../deployments', `${network}.json`);

if (!fs.existsSync(manifestPath)) {
	console.error(`No deployment manifest found for network: ${network}`);
	console.error(`Expected path: ${manifestPath}`);
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

console.log('\n' + '='.repeat(70));
console.log(`  LAZY FARMS DEPLOYMENT MANIFEST - ${manifest.network.toUpperCase()}`);
console.log('='.repeat(70));

console.log(`\nNetwork:     ${manifest.network} (Chain ID: ${manifest.chainId})`);
console.log(`Version:     ${manifest.version}`);
console.log(`Deployer:    ${manifest.deployer || 'N/A'}`);
console.log(`Description: ${manifest.description}`);

console.log('\n' + '-'.repeat(70));
console.log('  DEPLOYED CONTRACTS');
console.log('-'.repeat(70));

const contracts = Object.entries(manifest.contracts).filter(([key]) => !key.startsWith('_'));

if (contracts.length === 0) {
	console.log('\n  No contracts deployed yet.\n');
}
else {
	// Calculate column widths
	const maxNameLen = Math.max(...contracts.map(([, c]) => c.name?.length || 0), 20);

	console.log(`\n  ${'Name'.padEnd(maxNameLen)}  ${'Contract ID'.padEnd(14)}  ${'Source'}`);
	console.log(`  ${'-'.repeat(maxNameLen)}  ${'-'.repeat(14)}  ${'-'.repeat(30)}`);

	for (const [key, contract] of contracts) {
		const name = (contract.name || key).padEnd(maxNameLen);
		const id = (contract.contractId || 'N/A').padEnd(14);
		const source = contract.sourcePath || '-';
		console.log(`  ${name}  ${id}  ${source}`);
	}
}

// Show dependencies graph
console.log('\n' + '-'.repeat(70));
console.log('  CONTRACT DEPENDENCIES');
console.log('-'.repeat(70) + '\n');

for (const [key, contract] of contracts) {
	if (contract.dependencies && contract.dependencies.length > 0) {
		console.log(`  ${contract.name || key}:`);
		for (const dep of contract.dependencies) {
			const depContract = manifest.contracts[dep];
			const depId = depContract?.contractId || '?';
			console.log(`    └─ ${dep} (${depId})`);
		}
	}
}

// Show known issues
const contractsWithIssues = contracts.filter(([, c]) => c.knownIssues?.length > 0);
if (contractsWithIssues.length > 0) {
	console.log('\n' + '-'.repeat(70));
	console.log('  KNOWN ISSUES');
	console.log('-'.repeat(70) + '\n');

	for (const [key, contract] of contractsWithIssues) {
		console.log(`  ${contract.name || key}:`);
		for (const issue of contract.knownIssues) {
			console.log(`    [${issue.severity}] ${issue.type}: ${issue.description}`);
			if (issue.workaround) {
				console.log(`      Workaround: ${issue.workaround}`);
			}
		}
	}
}

// Show roles
const hasRoles = Object.values(manifest.roles || {}).some(arr => Array.isArray(arr) && arr.length > 0);
if (hasRoles) {
	console.log('\n' + '-'.repeat(70));
	console.log('  ADMINISTRATIVE ROLES');
	console.log('-'.repeat(70) + '\n');

	if (manifest.roles.factoryAdmins?.length > 0) {
		console.log('  Factory Admins:');
		for (const admin of manifest.roles.factoryAdmins) {
			console.log(`    - ${admin.address}${admin.name ? ` (${admin.name})` : ''}`);
		}
	}

	if (manifest.roles.factoryDeployers?.length > 0) {
		console.log('  Factory Deployers:');
		for (const deployer of manifest.roles.factoryDeployers) {
			console.log(`    - ${deployer.address}${deployer.name ? ` (${deployer.name})` : ''}`);
		}
	}

	if (manifest.roles.stakingAdmins?.length > 0) {
		console.log('  Staking Admins:');
		for (const admin of manifest.roles.stakingAdmins) {
			console.log(`    - ${admin.address}${admin.name ? ` (${admin.name})` : ''}`);
		}
	}
}

// Metadata
console.log('\n' + '-'.repeat(70));
console.log('  METADATA');
console.log('-'.repeat(70));
console.log(`\n  Solidity:     ${manifest.metadata?.solidityVersion || 'N/A'}`);
console.log(`  Optimizer:    ${manifest.metadata?.optimizerRuns || 'N/A'} runs`);
console.log(`  Last Updated: ${manifest.metadata?.lastUpdated || 'N/A'}`);

console.log('\n' + '='.repeat(70) + '\n');
