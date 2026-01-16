/**
 * Mirror Node Query Utilities
 * Read-only queries to Hedera mirror node REST API
 */

import axios, { AxiosError } from 'axios';
import { MIRROR_URLS, DECIMALS, type Network } from './constants';

function getBaseUrl(network: Network): string {
  return MIRROR_URLS[network];
}

/**
 * Generic mirror node fetch with error handling
 */
async function fetchMirror<T>(network: Network, path: string): Promise<T | null> {
  const url = `${getBaseUrl(network)}${path}`;
  try {
    const response = await axios.get<T>(url, { timeout: 10000 });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Mirror node error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Account information
 */
export interface AccountInfo {
  account: string;
  balance: {
    balance: number;
    timestamp: string;
    tokens: Array<{
      token_id: string;
      balance: number;
    }>;
  };
  evm_address: string;
  alias: string | null;
}

export async function getAccountInfo(network: Network, accountId: string): Promise<AccountInfo | null> {
  return fetchMirror<AccountInfo>(network, `/api/v1/accounts/${accountId}`);
}

/**
 * Token information
 */
export interface TokenInfo {
  token_id: string;
  symbol: string;
  name: string;
  decimals: string;
  total_supply: string;
  max_supply: string;
  treasury_account_id: string;
  type: string;
}

export async function getTokenInfo(network: Network, tokenId: string): Promise<TokenInfo | null> {
  return fetchMirror<TokenInfo>(network, `/api/v1/tokens/${tokenId}`);
}

/**
 * Token balance for account
 */
interface TokenBalanceResponse {
  tokens: Array<{
    token_id: string;
    balance: number;
  }>;
}

export async function getTokenBalance(network: Network, accountId: string, tokenId: string): Promise<number | null> {
  const data = await fetchMirror<TokenBalanceResponse>(
    network,
    `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`
  );
  if (!data?.tokens?.length) return null;
  const token = data.tokens.find((t) => t.token_id === tokenId);
  return token?.balance ?? null;
}

/**
 * NFTs owned by account
 */
export interface NFTInfo {
  account_id: string;
  serial_number: number;
  token_id: string;
  spender: string | null;
  delegating_spender: string | null;
  metadata: string;
}

interface NFTsResponse {
  nfts: NFTInfo[];
  links: { next: string | null };
}

export async function getNFTsOwned(
  network: Network,
  accountId: string,
  tokenId: string
): Promise<NFTInfo[]> {
  const allNfts: NFTInfo[] = [];
  let path: string | null = `/api/v1/tokens/${tokenId}/nfts?account.id=${accountId}&limit=100`;

  while (path) {
    const data: NFTsResponse | null = await fetchMirror<NFTsResponse>(network, path);
    if (!data) break;
    allNfts.push(...data.nfts);
    path = data.links.next ? data.links.next : null;
  }

  return allNfts;
}

/**
 * Token allowances
 */
export interface FTAllowance {
  owner: string;
  spender: string;
  token_id: string;
  amount: number;
  amount_granted: number;
}

interface FTAllowancesResponse {
  allowances: FTAllowance[];
  links: { next: string | null };
}

export async function getFTAllowances(network: Network, accountId: string): Promise<FTAllowance[]> {
  const all: FTAllowance[] = [];
  let path: string | null = `/api/v1/accounts/${accountId}/allowances/tokens?limit=100`;

  while (path) {
    const data: FTAllowancesResponse | null = await fetchMirror<FTAllowancesResponse>(network, path);
    if (!data) break;
    all.push(...data.allowances);
    path = data.links.next ? data.links.next : null;
  }

  return all;
}

export async function getFTAllowance(
  network: Network,
  accountId: string,
  tokenId: string,
  spenderId: string
): Promise<number | null> {
  const allowances = await getFTAllowances(network, accountId);
  const found = allowances.find((a) => a.token_id === tokenId && a.spender === spenderId);
  return found?.amount ?? null;
}

/**
 * NFT allowances (approvedForAll)
 */
export interface NFTAllowance {
  owner: string;
  spender: string;
  token_id: string;
  approved_for_all: boolean;
}

interface NFTAllowancesResponse {
  allowances: NFTAllowance[];
  links: { next: string | null };
}

export async function getNFTAllowances(network: Network, accountId: string): Promise<NFTAllowance[]> {
  const all: NFTAllowance[] = [];
  let path: string | null = `/api/v1/accounts/${accountId}/allowances/nfts?limit=100`;

  while (path) {
    const data: NFTAllowancesResponse | null = await fetchMirror<NFTAllowancesResponse>(network, path);
    if (!data) break;
    all.push(...data.allowances);
    path = data.links.next ? data.links.next : null;
  }

  return all;
}

/**
 * HBAR allowances
 */
export interface HbarAllowance {
  owner: string;
  spender: string;
  amount: number;
  amount_granted: number;
}

interface HbarAllowancesResponse {
  allowances: HbarAllowance[];
  links: { next: string | null };
}

export async function getHbarAllowances(network: Network, accountId: string): Promise<HbarAllowance[]> {
  const all: HbarAllowance[] = [];
  let path: string | null = `/api/v1/accounts/${accountId}/allowances/crypto?limit=100`;

  while (path) {
    const data: HbarAllowancesResponse | null = await fetchMirror<HbarAllowancesResponse>(network, path);
    if (!data) break;
    all.push(...data.allowances);
    path = data.links.next ? data.links.next : null;
  }

  return all;
}

/**
 * Contract information
 */
export interface ContractInfo {
  contract_id: string;
  evm_address: string;
  admin_key: unknown;
  bytecode: string;
  runtime_bytecode: string;
}

export async function getContractInfo(network: Network, contractId: string): Promise<ContractInfo | null> {
  return fetchMirror<ContractInfo>(network, `/api/v1/contracts/${contractId}`);
}

/**
 * Contract call (read-only via mirror node)
 * Note: This uses the mirror node's contract call simulation endpoint
 */
export interface ContractCallResult {
  result: string;
}

/**
 * Convert Hedera ID (0.0.123456) to EVM/Solidity address
 * The entity number becomes the last bytes of the 20-byte address
 */
function hederaIdToEvmAddress(hederaId: string): string {
  // If already an EVM address, return as-is
  if (hederaId.startsWith('0x')) {
    return hederaId;
  }

  // Parse 0.0.123456 format
  const parts = hederaId.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid Hedera ID format: ${hederaId}`);
  }

  const entityNum = parseInt(parts[2], 10);
  if (isNaN(entityNum)) {
    throw new Error(`Invalid entity number in Hedera ID: ${hederaId}`);
  }

  // Convert to 40-character hex (20 bytes), padded with zeros
  return '0x' + entityNum.toString(16).padStart(40, '0');
}

export async function simulateContractCall(
  network: Network,
  contractId: string,
  data: string
): Promise<string | null> {
  const url = `${getBaseUrl(network)}/api/v1/contracts/call`;
  const evmAddress = hederaIdToEvmAddress(contractId);

  try {
    const response = await axios.post<ContractCallResult>(
      url,
      {
        block: 'latest',
        data,
        estimate: false,
        to: evmAddress,
      },
      { timeout: 15000 }
    );
    return response.data.result;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(`Contract call failed: ${error.response?.data?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Format token amount with decimals
 */
export function formatTokenAmount(amount: number | bigint, decimals: number): string {
  const divisor = Math.pow(10, decimals);
  const value = Number(amount) / divisor;
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Format $LAZY amount (1 decimal)
 */
export function formatLazy(amount: number | bigint): string {
  return formatTokenAmount(amount, DECIMALS.LAZY);
}

/**
 * Format HBAR amount (8 decimals, tinybars to HBAR)
 */
export function formatHbar(tinybars: number | bigint): string {
  return formatTokenAmount(tinybars, DECIMALS.HBAR);
}
