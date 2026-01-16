/**
 * Output Formatting Utilities
 */

import Table from 'cli-table3';
import chalk from 'chalk';

export interface OutputOptions {
  json?: boolean;
}

/**
 * Print data as table or JSON based on options
 */
export function printOutput(
  data: Record<string, unknown>[] | Record<string, unknown>,
  headers: string[],
  options: OutputOptions
): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    printTable(data, headers);
  } else {
    printKeyValue(data);
  }
}

/**
 * Print array data as table
 */
export function printTable(data: Record<string, unknown>[], headers: string[]): void {
  if (data.length === 0) {
    console.log(chalk.yellow('No data found.'));
    return;
  }

  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const row of data) {
    table.push(headers.map((h) => String(row[h] ?? '')));
  }

  console.log(table.toString());
}

/**
 * Print object as key-value pairs
 */
export function printKeyValue(data: Record<string, unknown>): void {
  const table = new Table({
    style: { head: [], border: [] },
  });

  for (const [key, value] of Object.entries(data)) {
    table.push([chalk.cyan(key), String(value ?? '')]);
  }

  console.log(table.toString());
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green('✓ ') + message);
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.error(chalk.red('✗ ') + message);
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow('! ') + message);
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(chalk.blue('i ') + message);
}

/**
 * Print section header
 */
export function printHeader(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}
