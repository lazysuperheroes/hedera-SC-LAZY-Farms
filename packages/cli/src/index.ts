#!/usr/bin/env node
/**
 * Lazy Farming CLI
 * Read-only query tool for Lazy Superheroes farming and staking on Hedera
 */

import { Command } from 'commander';
import { createInfoCommand } from './commands/info';
import { createRewardsCommand } from './commands/rewards';
import { createStakedCommand } from './commands/staked';
import { createAllowancesCommand } from './commands/allowances';
import { createMissionsCommand } from './commands/missions';
import { createBoostLevelsCommand } from './commands/boost-levels';
import { createDeploymentsCommand } from './commands/deployments';

const program = new Command();

program
  .name('lazy-farm')
  .description('Read-only CLI for querying Lazy Superheroes farming and staking contracts on Hedera')
  .version('1.0.0');

// Register commands
program.addCommand(createInfoCommand());
program.addCommand(createRewardsCommand());
program.addCommand(createStakedCommand());
program.addCommand(createAllowancesCommand());
program.addCommand(createMissionsCommand());
program.addCommand(createBoostLevelsCommand());
program.addCommand(createDeploymentsCommand());

program.parse();
