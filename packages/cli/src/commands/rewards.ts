/**
 * Rewards Command - Query staking info and reward rates for an account
 * Note: Actual pending rewards require backend signature verification,
 * so this command shows stake info and rate configuration instead.
 */

import { Command } from 'commander';
import { getContracts, type Network } from '../constants';
import { simulateContractCall, getTokenInfo } from '../mirror';
import { encodeCall, decodeResult, nftStakingInterface } from '../abi';
import { printOutput, printHeader, printError, printWarning, type OutputOptions } from '../format';

interface RewardsOptions extends OutputOptions {
  network: Network;
}

export function createRewardsCommand(): Command {
  const cmd = new Command('rewards')
    .description('Query staking info and reward rates for an account')
    .argument('<account>', 'Account ID (e.g., 0.0.12345)')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (account, options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runRewards(account, { network, json: options.json });
    });

  return cmd;
}

async function runRewards(account: string, options: RewardsOptions): Promise<void> {
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
    const stakedData = encodeCall(nftStakingInterface, 'getStakedNFTs', [evmAddress]);
    const stakedResult = await simulateContractCall(options.network, contracts.NFT_STAKING, stakedData);

    if (!stakedResult) {
      printWarning('No staking info found for this account');
      return;
    }

    const decoded = decodeResult(nftStakingInterface, 'getStakedNFTs', stakedResult);
    const tokens = (decoded as unknown[])[0] as string[];
    const serials = (decoded as unknown[])[1] as bigint[][];

    const totalStaked = serials.reduce((sum, s) => sum + s.length, 0);

    if (totalStaked === 0) {
      printWarning('No staked NFTs found for this account');
      if (options.json) {
        console.log(JSON.stringify({ account, totalStaked: 0, collections: 0 }, null, 2));
      }
      return;
    }

    // Get reward rates
    const baseRateData = encodeCall(nftStakingInterface, 'getBaseRewardRate', [evmAddress]);
    const baseRateResult = await simulateContractCall(options.network, contracts.NFT_STAKING, baseRateData);
    const baseRate = baseRateResult
      ? BigInt(String(decodeResult(nftStakingInterface, 'getBaseRewardRate', baseRateResult)))
      : null;

    const boostRateData = encodeCall(nftStakingInterface, 'getActiveBoostRate', [evmAddress]);
    const boostRateResult = await simulateContractCall(options.network, contracts.NFT_STAKING, boostRateData);
    const boostRate = boostRateResult
      ? BigInt(String(decodeResult(nftStakingInterface, 'getActiveBoostRate', boostRateResult)))
      : null;

    // Get collection names
    const collectionNames: string[] = [];
    for (const token of tokens) {
      const tokenId = evmAddressToAccountId(token);
      if (tokenId) {
        const info = await getTokenInfo(options.network, tokenId);
        collectionNames.push(info?.symbol || tokenId);
      } else {
        collectionNames.push(token);
      }
    }

    const output = {
      Account: account,
      'EVM Address': evmAddress,
      'Total Staked NFTs': totalStaked.toString(),
      'Collections Staked': tokens.length.toString(),
      'Collection Names': collectionNames.join(', '),
      'Base Reward Rate': baseRate !== null ? baseRate.toString() : 'N/A',
      'Active Boost Rate': boostRate !== null ? boostRate.toString() : 'N/A',
      Note: 'Pending rewards require backend signature verification',
    };

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            account,
            evmAddress,
            totalStaked,
            collections: tokens.length,
            collectionNames,
            baseRate: baseRate?.toString() ?? null,
            boostRate: boostRate?.toString() ?? null,
          },
          null,
          2
        )
      );
      return;
    }

    printHeader(`Staking Info - ${options.network}`);
    printOutput(output, [], options);
  } catch (error) {
    printError(`Failed to fetch staking info: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function accountToEvmAddress(accountId: string): string | null {
  if (accountId.startsWith('0x')) {
    return accountId;
  }

  const parts = accountId.split('.');
  if (parts.length === 3) {
    const num = parseInt(parts[2]);
    return '0x' + num.toString(16).padStart(40, '0');
  }

  return null;
}

function evmAddressToAccountId(evmAddress: string): string | null {
  try {
    const hex = evmAddress.replace('0x', '');
    const num = parseInt(hex, 16);
    return `0.0.${num}`;
  } catch {
    return null;
  }
}
