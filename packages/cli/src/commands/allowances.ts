/**
 * Allowances Command - Query token and NFT allowances for an account
 */

import { Command } from 'commander';
import { getContracts, type Network } from '../constants';
import { getFTAllowances, getNFTAllowances, getHbarAllowances, formatLazy, formatHbar } from '../mirror';
import { printOutput, printTable, printHeader, printError, printWarning, type OutputOptions } from '../format';

interface AllowancesOptions extends OutputOptions {
  network: Network;
  type?: 'all' | 'ft' | 'nft' | 'hbar';
}

export function createAllowancesCommand(): Command {
  const cmd = new Command('allowances')
    .description('Query token and NFT allowances for an account')
    .argument('<account>', 'Account ID (e.g., 0.0.12345)')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--type <type>', 'Filter by type: all, ft, nft, hbar (default: all)', 'all')
    .option('--json', 'Output as JSON')
    .action(async (account, options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runAllowances(account, { network, type: options.type, json: options.json });
    });

  return cmd;
}

async function runAllowances(account: string, options: AllowancesOptions): Promise<void> {
  const contracts = getContracts(options.network);
  const type = options.type ?? 'all';

  try {
    const results: {
      ftAllowances?: Array<{ Token: string; Spender: string; Amount: string; 'Is Contract': string }>;
      nftAllowances?: Array<{ Token: string; Spender: string; 'Approved For All': string; 'Is Contract': string }>;
      hbarAllowances?: Array<{ Spender: string; Amount: string; 'Is Contract': string }>;
    } = {};

    // Fungible token allowances
    if (type === 'all' || type === 'ft') {
      const ftAllowances = await getFTAllowances(options.network, account);
      results.ftAllowances = ftAllowances.map((a) => ({
        Token: a.token_id,
        Spender: a.spender,
        Amount: formatLazy(a.amount),
        'Is Contract': isKnownContract(a.spender, contracts) || '',
      }));
    }

    // NFT allowances
    if (type === 'all' || type === 'nft') {
      const nftAllowances = await getNFTAllowances(options.network, account);
      results.nftAllowances = nftAllowances.map((a) => ({
        Token: a.token_id,
        Spender: a.spender,
        'Approved For All': a.approved_for_all ? 'Yes' : 'No',
        'Is Contract': isKnownContract(a.spender, contracts) || '',
      }));
    }

    // HBAR allowances
    if (type === 'all' || type === 'hbar') {
      const hbarAllowances = await getHbarAllowances(options.network, account);
      results.hbarAllowances = hbarAllowances.map((a) => ({
        Spender: a.spender,
        Amount: formatHbar(a.amount) + ' HBAR',
        'Is Contract': isKnownContract(a.spender, contracts) || '',
      }));
    }

    if (options.json) {
      console.log(JSON.stringify({ account, network: options.network, ...results }, null, 2));
      return;
    }

    printHeader(`Allowances - ${account}`);

    if (results.ftAllowances !== undefined) {
      console.log('\nFungible Token Allowances:');
      if (results.ftAllowances.length === 0) {
        printWarning('No FT allowances found');
      } else {
        printTable(results.ftAllowances, ['Token', 'Spender', 'Amount', 'Is Contract']);
      }
    }

    if (results.nftAllowances !== undefined) {
      console.log('\nNFT Allowances:');
      if (results.nftAllowances.length === 0) {
        printWarning('No NFT allowances found');
      } else {
        printTable(results.nftAllowances, ['Token', 'Spender', 'Approved For All', 'Is Contract']);
      }
    }

    if (results.hbarAllowances !== undefined) {
      console.log('\nHBAR Allowances:');
      if (results.hbarAllowances.length === 0) {
        printWarning('No HBAR allowances found');
      } else {
        printTable(results.hbarAllowances, ['Spender', 'Amount', 'Is Contract']);
      }
    }
  } catch (error) {
    printError(`Failed to fetch allowances: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isKnownContract(
  spenderId: string,
  contracts: Record<string, string>
): string {
  for (const [name, id] of Object.entries(contracts)) {
    if (id === spenderId) {
      return name.replace(/_/g, ' ');
    }
  }
  return '';
}
