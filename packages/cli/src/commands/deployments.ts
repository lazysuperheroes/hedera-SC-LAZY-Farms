/**
 * Deployments Command - Show deployment manifest information
 */

import { Command } from 'commander';
import { MAINNET_CONTRACTS, TESTNET_CONTRACTS, type Network } from '../constants';
import { getContractInfo } from '../mirror';
import { printOutput, printTable, printHeader, printError, type OutputOptions } from '../format';

interface DeploymentsOptions extends OutputOptions {
  network: Network;
  verify?: boolean;
}

export function createDeploymentsCommand(): Command {
  const cmd = new Command('deployments')
    .description('Show deployment manifest information')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--verify', 'Verify contracts exist on network')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runDeployments({ network, verify: options.verify, json: options.json });
    });

  return cmd;
}

async function runDeployments(options: DeploymentsOptions): Promise<void> {
  const contracts = options.network === 'mainnet' ? MAINNET_CONTRACTS : TESTNET_CONTRACTS;

  const deployments: Array<{
    Contract: string;
    Address: string;
    Status: string;
  }> = [];

  for (const [name, address] of Object.entries(contracts)) {
    let status = address ? 'Configured' : 'Not deployed';

    if (options.verify && address) {
      const exists = await verifyContract(options.network, address);
      status = exists ? 'Verified' : 'Not found';
    }

    deployments.push({
      Contract: formatContractName(name),
      Address: address || 'N/A',
      Status: status,
    });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          network: options.network,
          verified: options.verify ?? false,
          contracts: Object.fromEntries(
            Object.entries(contracts).map(([name, address]) => [
              formatContractName(name),
              {
                address: address || null,
                status: deployments.find((d) => d.Contract === formatContractName(name))?.Status ?? 'Unknown',
              },
            ])
          ),
        },
        null,
        2
      )
    );
    return;
  }

  printHeader(`Deployments - ${options.network}`);
  if (options.verify) {
    console.log('(Contracts verified against network)\n');
  }
  printTable(deployments, ['Contract', 'Address', 'Status']);
}

async function verifyContract(network: Network, contractId: string): Promise<boolean> {
  try {
    const info = await getContractInfo(network, contractId);
    return info !== null;
  } catch {
    return false;
  }
}

function formatContractName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
