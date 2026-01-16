/**
 * Info Command - Display system information and contract details
 */

import { Command } from 'commander';
import { getContracts, type Network } from '../constants';
import { getTokenInfo, simulateContractCall, formatLazy } from '../mirror';
import { encodeCall, decodeResult, nftStakingInterface, missionFactoryInterface } from '../abi';
import { printOutput, printHeader, printError, type OutputOptions } from '../format';

interface InfoOptions extends OutputOptions {
  network: Network;
}

export function createInfoCommand(): Command {
  const cmd = new Command('info')
    .description('Display system information and contract details')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runInfo({ network, json: options.json });
    });

  return cmd;
}

async function runInfo(options: InfoOptions): Promise<void> {
  const contracts = getContracts(options.network);

  if (!contracts.LAZY_TOKEN) {
    printError(`No contracts deployed on ${options.network}`);
    return;
  }

  try {
    // Get $LAZY token info
    const lazyInfo = await getTokenInfo(options.network, contracts.LAZY_TOKEN);

    // Get staking stats
    const stakingStats = await getStakingStats(options.network, contracts.NFT_STAKING);

    // Get mission count
    const missionCount = await getMissionCount(options.network, contracts.MISSION_FACTORY);

    const data = {
      Network: options.network,
      'LAZY Token': contracts.LAZY_TOKEN,
      'LAZY Symbol': lazyInfo?.symbol ?? 'N/A',
      'LAZY Total Supply': lazyInfo ? formatLazy(parseInt(lazyInfo.total_supply)) : 'N/A',
      'NFT Staking Contract': contracts.NFT_STAKING,
      'Stakable Collections': stakingStats.collectionCount?.toString() ?? 'N/A',
      'Active Stakers': stakingStats.stakerCount?.toString() ?? 'N/A',
      'Mission Factory': contracts.MISSION_FACTORY,
      'Active Missions': missionCount?.toString() ?? 'N/A',
      'Boost Manager': contracts.BOOST_MANAGER,
      'Delegate Registry': contracts.DELEGATE_REGISTRY,
      'Gas Station': contracts.GAS_STATION,
    };

    if (!options.json) {
      printHeader(`Lazy Farming System - ${options.network}`);
    }
    printOutput(data, [], options);
  } catch (error) {
    printError(`Failed to fetch info: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface StakingStats {
  collectionCount: number | null;
  stakerCount: number | null;
}

async function getStakingStats(network: Network, contractId: string): Promise<StakingStats> {
  const stats: StakingStats = {
    collectionCount: null,
    stakerCount: null,
  };

  try {
    // Get stakable collections count
    const collectionsData = encodeCall(nftStakingInterface, 'getStakableCollections');
    const collectionsResult = await simulateContractCall(network, contractId, collectionsData);
    if (collectionsResult) {
      const decoded = decodeResult(nftStakingInterface, 'getStakableCollections', collectionsResult);
      const collections = (decoded as unknown[])[0] as string[];
      stats.collectionCount = collections.length;
    }

    // Get staking users count
    const usersData = encodeCall(nftStakingInterface, 'getStakingUsers');
    const usersResult = await simulateContractCall(network, contractId, usersData);
    if (usersResult) {
      const decoded = decodeResult(nftStakingInterface, 'getStakingUsers', usersResult);
      const users = (decoded as unknown[])[0] as string[];
      stats.stakerCount = users.length;
    }
  } catch {
    // Silent fail - stats will show N/A
  }

  return stats;
}

async function getMissionCount(network: Network, contractId: string): Promise<number | null> {
  try {
    const data = encodeCall(missionFactoryInterface, 'getDeployedMissions');
    const result = await simulateContractCall(network, contractId, data);
    if (result) {
      const decoded = decodeResult(missionFactoryInterface, 'getDeployedMissions', result);
      const missions = (decoded as unknown[])[0] as string[];
      return missions.length;
    }
  } catch {
    // Silent fail
  }
  return null;
}
