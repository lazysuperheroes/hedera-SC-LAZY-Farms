/**
 * Missions Command - List and query mission details
 */

import { Command } from 'commander';
import { getContracts, type Network } from '../constants';
import { simulateContractCall, formatLazy } from '../mirror';
import { encodeCall, decodeResult, missionFactoryInterface, missionInterface } from '../abi';
import { printOutput, printTable, printHeader, printError, printWarning, type OutputOptions } from '../format';

interface MissionsOptions extends OutputOptions {
  network: Network;
}

interface MissionDetailsOptions extends OutputOptions {
  network: Network;
}

export function createMissionsCommand(): Command {
  const cmd = new Command('missions')
    .description('List and query missions')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runMissionsList({ network, json: options.json });
    });

  // Subcommand for mission details
  cmd
    .command('details <mission>')
    .description('Get details for a specific mission')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (mission, options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runMissionDetails(mission, { network, json: options.json });
    });

  return cmd;
}

async function runMissionsList(options: MissionsOptions): Promise<void> {
  const contracts = getContracts(options.network);

  if (!contracts.MISSION_FACTORY) {
    printError(`No contracts deployed on ${options.network}`);
    return;
  }

  try {
    // Get available slots (includes missions, slots, and costs)
    const data = encodeCall(missionFactoryInterface, 'getAvailableSlots');
    const result = await simulateContractCall(options.network, contracts.MISSION_FACTORY, data);

    if (!result) {
      printWarning('Could not fetch missions');
      return;
    }

    const decoded = decodeResult(missionFactoryInterface, 'getAvailableSlots', result);
    const missionAddresses = (decoded as unknown[])[0] as string[];
    const availableSlots = (decoded as unknown[])[1] as bigint[];
    const entryCosts = (decoded as unknown[])[2] as bigint[];

    if (missionAddresses.length === 0) {
      printWarning('No missions deployed');
      if (options.json) {
        console.log(JSON.stringify({ network: options.network, missions: [], count: 0 }, null, 2));
      }
      return;
    }

    // Build output data
    const missions: Array<{
      Index: number;
      Address: string;
      'Slots Available': string;
      'Entry Fee': string;
    }> = [];

    for (let i = 0; i < missionAddresses.length; i++) {
      const address = missionAddresses[i];
      const missionId = evmAddressToAccountId(address);

      missions.push({
        Index: i,
        Address: missionId || address,
        'Slots Available': availableSlots[i].toString(),
        'Entry Fee': formatLazy(availableSlots[i]) + ' $LAZY',
      });
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            network: options.network,
            totalCount: missionAddresses.length,
            missions: missions.map((m, i) => ({
              index: m.Index,
              address: m.Address,
              slotsAvailable: Number(availableSlots[i]),
              entryFee: Number(entryCosts[i]),
            })),
          },
          null,
          2
        )
      );
      return;
    }

    printHeader(`Missions - ${options.network}`);
    console.log(`Total missions: ${missionAddresses.length}\n`);
    printTable(missions, ['Index', 'Address', 'Slots Available', 'Entry Fee']);
  } catch (error) {
    printError(`Failed to fetch missions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runMissionDetails(missionId: string, options: MissionDetailsOptions): Promise<void> {
  try {
    const info = await getMissionInfo(options.network, missionId);

    if (!info) {
      printError(`Could not fetch mission info for ${missionId}`);
      return;
    }

    const data = {
      'Mission ID': missionId,
      'Entry Fee': formatLazy(info.entryFee) + ' $LAZY',
      'Slots Remaining': info.slotsRemaining.toString(),
      'Duration': `${info.duration} seconds (${(info.duration / 3600).toFixed(1)} hours)`,
      'Max Participants': info.maxParticipants.toString(),
      'Rewards Per User': info.rewardsPerUser.toString(),
      'Reward Collection': info.rewardCollection ? evmAddressToAccountId(info.rewardCollection) || info.rewardCollection : 'N/A',
      'Active Users': info.usersOnMission.toString(),
    };

    if (!options.json) {
      printHeader(`Mission Details`);
    }
    printOutput(data, [], options);
  } catch (error) {
    printError(`Failed to fetch mission details: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface MissionInfo {
  entryFee: bigint;
  slotsRemaining: bigint;
  duration: number;
  maxParticipants: number;
  rewardsPerUser: number;
  rewardCollection: string;
  usersOnMission: number;
}

async function getMissionInfo(network: Network, contractId: string): Promise<MissionInfo | null> {
  try {
    // Get entry fee
    const feeData = encodeCall(missionInterface, 'entryFee');
    const feeResult = await simulateContractCall(network, contractId, feeData);
    const entryFee = feeResult
      ? BigInt(String(decodeResult(missionInterface, 'entryFee', feeResult)))
      : 0n;

    // Get slots remaining
    const slotsData = encodeCall(missionInterface, 'getSlotsRemaining');
    const slotsResult = await simulateContractCall(network, contractId, slotsData);
    const slotsRemaining = slotsResult
      ? BigInt(String(decodeResult(missionInterface, 'getSlotsRemaining', slotsResult)))
      : 0n;

    // Get requirements (includes duration, max participants, etc.)
    const reqData = encodeCall(missionInterface, 'getRequirements');
    const reqResult = await simulateContractCall(network, contractId, reqData);

    let duration = 0;
    let maxParticipants = 0;
    let rewardsPerUser = 0;
    let rewardCollection = '';

    if (reqResult) {
      const decoded = decodeResult(missionInterface, 'getRequirements', reqResult) as [
        string[],
        bigint[],
        string,
        bigint,
        bigint,
        bigint,
        bigint
      ];
      rewardCollection = decoded[2];
      rewardsPerUser = Number(decoded[3]);
      duration = Number(decoded[4]);
      maxParticipants = Number(decoded[5]);
    }

    // Get users on mission
    const usersData = encodeCall(missionInterface, 'getUsersOnMission');
    const usersResult = await simulateContractCall(network, contractId, usersData);
    const usersOnMission = usersResult
      ? (decodeResult(missionInterface, 'getUsersOnMission', usersResult) as string[]).length
      : 0;

    return {
      entryFee,
      slotsRemaining,
      duration,
      maxParticipants,
      rewardsPerUser,
      rewardCollection,
      usersOnMission,
    };
  } catch {
    return null;
  }
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
