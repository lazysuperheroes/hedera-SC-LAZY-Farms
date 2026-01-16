/**
 * Staked Command - Query staked NFTs for an account
 */

import { Command } from 'commander';
import { getContracts, type Network } from '../constants';
import { simulateContractCall, getTokenInfo } from '../mirror';
import { encodeCall, decodeResult, nftStakingInterface } from '../abi';
import { printTable, printHeader, printError, printWarning, type OutputOptions } from '../format';

interface StakedOptions extends OutputOptions {
  network: Network;
}

export function createStakedCommand(): Command {
  const cmd = new Command('staked')
    .description('Query staked NFTs for an account')
    .argument('<account>', 'Account ID (e.g., 0.0.12345)')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (account, options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runStaked(account, { network, json: options.json });
    });

  return cmd;
}

async function runStaked(account: string, options: StakedOptions): Promise<void> {
  const contracts = getContracts(options.network);

  if (!contracts.NFT_STAKING) {
    printError(`No contracts deployed on ${options.network}`);
    return;
  }

  try {
    // Convert account ID to EVM address
    const evmAddress = accountToEvmAddress(account);
    if (!evmAddress) {
      printError(`Could not convert account ${account} to EVM address`);
      return;
    }

    // Get staked NFTs
    const data = encodeCall(nftStakingInterface, 'getStakedNFTs', [evmAddress]);
    const result = await simulateContractCall(options.network, contracts.NFT_STAKING, data);

    if (!result) {
      printWarning('No staked NFTs found for this account');
      return;
    }

    const decoded = decodeResult(nftStakingInterface, 'getStakedNFTs', result);
    const tokens = (decoded as unknown[])[0] as string[];
    const serials = (decoded as unknown[])[1] as bigint[][];

    if (tokens.length === 0) {
      printWarning('No staked NFTs found for this account');
      if (options.json) {
        console.log(JSON.stringify({ account, stakedNFTs: [] }, null, 2));
      }
      return;
    }

    // Build output data
    const stakedData: Array<{
      Collection: string;
      Token: string;
      Serials: string;
      Count: number;
    }> = [];

    for (let i = 0; i < tokens.length; i++) {
      const tokenEvmAddress = tokens[i];
      const tokenSerials = serials[i].map((s) => Number(s));

      // Try to get token info
      const tokenId = evmAddressToAccountId(tokenEvmAddress);
      let tokenSymbol = tokenId;

      if (tokenId) {
        const info = await getTokenInfo(options.network, tokenId);
        if (info) {
          tokenSymbol = info.symbol || tokenId;
        }
      }

      stakedData.push({
        Collection: tokenSymbol || tokenEvmAddress,
        Token: tokenId || tokenEvmAddress,
        Serials: tokenSerials.slice(0, 10).join(', ') + (tokenSerials.length > 10 ? '...' : ''),
        Count: tokenSerials.length,
      });
    }

    if (options.json) {
      const jsonOutput = {
        account,
        network: options.network,
        stakedNFTs: tokens.map((t, i) => ({
          token: evmAddressToAccountId(t) || t,
          serials: serials[i].map((s) => Number(s)),
          count: serials[i].length,
        })),
        totalStaked: serials.reduce((sum, s) => sum + s.length, 0),
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      printHeader(`Staked NFTs - ${account}`);
      printTable(stakedData, ['Collection', 'Token', 'Serials', 'Count']);
      console.log(`\nTotal staked: ${serials.reduce((sum, s) => sum + s.length, 0)} NFTs across ${tokens.length} collection(s)`);
    }
  } catch (error) {
    printError(`Failed to fetch staked NFTs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function accountToEvmAddress(accountId: string): string | null {
  // If already EVM address, return as-is
  if (accountId.startsWith('0x')) {
    return accountId;
  }

  // Convert 0.0.12345 format to EVM address
  const parts = accountId.split('.');
  if (parts.length === 3) {
    const num = parseInt(parts[2]);
    return '0x' + num.toString(16).padStart(40, '0');
  }

  return null;
}

function evmAddressToAccountId(evmAddress: string): string | null {
  try {
    // Remove 0x prefix and parse as hex
    const hex = evmAddress.replace('0x', '');
    const num = parseInt(hex, 16);
    return `0.0.${num}`;
  } catch {
    return null;
  }
}
