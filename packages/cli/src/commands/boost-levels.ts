/**
 * Boost Levels Command - Display gem boost level information
 */

import { Command } from 'commander';
import { getContracts, GEM_LEVEL_NAMES, lookupGemLevel, type Network } from '../constants';
import { simulateContractCall } from '../mirror';
import { encodeCall, decodeResult, boostManagerInterface } from '../abi';
import { printTable, printHeader, printError, type OutputOptions } from '../format';

interface BoostLevelsOptions extends OutputOptions {
  network: Network;
}

export function createBoostLevelsCommand(): Command {
  const cmd = new Command('boost-levels')
    .description('Display gem boost level information')
    .option('--testnet', 'Use testnet instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const network: Network = options.testnet ? 'testnet' : 'mainnet';
      await runBoostLevels({ network, json: options.json });
    });

  return cmd;
}

async function runBoostLevels(options: BoostLevelsOptions): Promise<void> {
  const contracts = getContracts(options.network);

  if (!contracts.BOOST_MANAGER) {
    printError(`No contracts deployed on ${options.network}`);
    return;
  }

  try {
    const levels: Array<{
      Level: string;
      Name: string;
      'Boost Reduction %': string;
      'Collections': string;
    }> = [];

    // Fetch info for each gem level (0-5)
    for (let level = 0; level < GEM_LEVEL_NAMES.length; level++) {
      const info = await getBoostData(options.network, contracts.BOOST_MANAGER, level);

      if (info) {
        levels.push({
          Level: level.toString(),
          Name: lookupGemLevel(level),
          'Boost Reduction %': info.boostReduction.toString() + '%',
          'Collections': info.collections.length.toString(),
        });
      }
    }

    if (levels.length === 0) {
      printError('Could not fetch boost level data');
      return;
    }

    if (options.json) {
      const jsonData = await Promise.all(
        Array.from({ length: GEM_LEVEL_NAMES.length }, (_, level) =>
          getBoostData(options.network, contracts.BOOST_MANAGER, level).then((info) => ({
            level,
            name: lookupGemLevel(level),
            boostReduction: info?.boostReduction ?? 0,
            collections: info?.collections.map((c) => evmAddressToAccountId(c) || c) ?? [],
          }))
        )
      );

      console.log(
        JSON.stringify(
          {
            network: options.network,
            boostManager: contracts.BOOST_MANAGER,
            levels: jsonData,
          },
          null,
          2
        )
      );
      return;
    }

    printHeader(`Boost Levels - ${options.network}`);
    console.log(`Boost Manager: ${contracts.BOOST_MANAGER}\n`);
    printTable(levels, ['Level', 'Name', 'Boost Reduction %', 'Collections']);
  } catch (error) {
    printError(`Failed to fetch boost levels: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface BoostData {
  collections: string[];
  serialLocked: boolean[];
  serials: bigint[][];
  boostReduction: number;
}

async function getBoostData(
  network: Network,
  contractId: string,
  level: number
): Promise<BoostData | null> {
  try {
    const data = encodeCall(boostManagerInterface, 'getBoostData', [level]);
    const result = await simulateContractCall(network, contractId, data);

    if (!result) {
      return null;
    }

    const decoded = decodeResult(boostManagerInterface, 'getBoostData', result) as [
      string[],
      boolean[],
      bigint[][],
      bigint
    ];

    return {
      collections: decoded[0],
      serialLocked: decoded[1],
      serials: decoded[2],
      boostReduction: Number(decoded[3]),
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
