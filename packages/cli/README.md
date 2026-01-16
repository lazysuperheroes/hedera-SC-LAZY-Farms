# @lazysuperheroes/farming-cli

Read-only CLI for querying Lazy Superheroes farming and staking contracts on Hedera. No private keys required - all queries use the public Hedera Mirror Node.

## Installation

```bash
npm install -g @lazysuperheroes/farming-cli
# or
yarn global add @lazysuperheroes/farming-cli
```

Or run directly with npx:

```bash
npx @lazysuperheroes/farming-cli info
```

## Quick Start

```bash
# System overview
lazy-farm info

# Check your staked NFTs
lazy-farm staked 0.0.YOUR_ACCOUNT

# View staking rewards info
lazy-farm rewards 0.0.YOUR_ACCOUNT

# List active missions
lazy-farm missions

# Check allowances
lazy-farm allowances 0.0.YOUR_ACCOUNT
```

## Commands

### `lazy-farm info`

Display system information and contract details.

```bash
lazy-farm info
```

Output:
```
Lazy Farming System - mainnet

┌──────────────────────┬───────────────┐
│ Network              │ mainnet       │
├──────────────────────┼───────────────┤
│ LAZY Token           │ 0.0.1311037   │
├──────────────────────┼───────────────┤
│ LAZY Symbol          │ LAZY          │
├──────────────────────┼───────────────┤
│ LAZY Total Supply    │ 249,132,140.7 │
├──────────────────────┼───────────────┤
│ NFT Staking Contract │ 0.0.7221488   │
├──────────────────────┼───────────────┤
│ Stakable Collections │ 40            │
├──────────────────────┼───────────────┤
│ Active Stakers       │ 83            │
├──────────────────────┼───────────────┤
│ Mission Factory      │ 0.0.8257122   │
├──────────────────────┼───────────────┤
│ Active Missions      │ 0             │
└──────────────────────┴───────────────┘
```

### `lazy-farm staked <account>`

Query staked NFTs for an account.

```bash
lazy-farm staked 0.0.123456
```

Shows all NFT collections and serial numbers staked by the account.

### `lazy-farm rewards <account>`

Query staking info and reward rates for an account.

```bash
lazy-farm rewards 0.0.123456
```

Displays staked collections, NFT counts, and configured reward rates.

### `lazy-farm allowances <account>`

Query token and NFT allowances for an account.

```bash
# All allowance types
lazy-farm allowances 0.0.123456

# Filter by type
lazy-farm allowances 0.0.123456 --type ft
lazy-farm allowances 0.0.123456 --type nft
lazy-farm allowances 0.0.123456 --type hbar
```

Options:
- `--type <type>` - Filter: `all`, `ft`, `nft`, `hbar` (default: `all`)

### `lazy-farm missions`

List all deployed missions.

```bash
lazy-farm missions
```

Shows mission addresses, available slots, and entry fees.

#### `lazy-farm missions details <mission>`

Get details for a specific mission.

```bash
lazy-farm missions details 0.0.789012
```

Output includes:
- Entry fee
- Duration
- Slots remaining
- Max participants
- Reward collection
- Active users

### `lazy-farm boost-levels`

Display gem boost level information.

```bash
lazy-farm boost-levels
```

Output:
```
Boost Levels - mainnet

Boost Manager: 0.0.8257105

┌───────┬──────┬───────────────────┬─────────────┐
│ Level │ Name │ Boost Reduction % │ Collections │
├───────┼──────┼───────────────────┼─────────────┤
│ 0     │ C    │ 5%                │ 9           │
├───────┼──────┼───────────────────┼─────────────┤
│ 1     │ R    │ 10%               │ 6           │
├───────┼──────┼───────────────────┼─────────────┤
│ 2     │ SR   │ 15%               │ 7           │
├───────┼──────┼───────────────────┼─────────────┤
│ 3     │ UR   │ 25%               │ 7           │
├───────┼──────┼───────────────────┼─────────────┤
│ 4     │ LR   │ 40%               │ 3           │
├───────┼──────┼───────────────────┼─────────────┤
│ 5     │ SPE  │ 20%               │ 2           │
└───────┴──────┴───────────────────┴─────────────┘
```

### `lazy-farm deployments`

Show deployment manifest information.

```bash
# List all contracts
lazy-farm deployments

# Verify contracts exist on network
lazy-farm deployments --verify
```

Options:
- `--verify` - Verify each contract exists on the network

## Global Options

All commands support these options:

| Option | Description |
|--------|-------------|
| `--testnet` | Use testnet instead of mainnet |
| `--json` | Output as JSON (for scripting) |
| `-h, --help` | Display help |
| `-V, --version` | Display version |

## JSON Output

Use `--json` for machine-readable output:

```bash
lazy-farm info --json
```

```json
{
  "Network": "mainnet",
  "LAZY Token": "0.0.1311037",
  "LAZY Symbol": "LAZY",
  "LAZY Total Supply": "249,132,140.7",
  "NFT Staking Contract": "0.0.7221488",
  "Stakable Collections": "40",
  "Active Stakers": "83",
  "Mission Factory": "0.0.8257122",
  "Active Missions": "0",
  "Boost Manager": "0.0.8257105",
  "Delegate Registry": "0.0.7221486",
  "Gas Station": "0.0.7221483"
}
```

## Mainnet Contracts

| Contract | Address |
|----------|---------|
| $LAZY Token | `0.0.1311037` |
| LAZYTokenCreator | `0.0.1311003` |
| LazyGasStation | `0.0.7221483` |
| LazyDelegateRegistry | `0.0.7221486` |
| LazyNFTStaking | `0.0.7221488` |
| MissionFactory | `0.0.8257122` |
| Mission Template | `0.0.8257118` |
| BoostManager | `0.0.8257105` |
| PRNG | `0.0.8257116` |

## Requirements

- Node.js 18+
- Internet connection (queries Hedera Mirror Node)

## Related Packages

- [@lazysuperheroes/farming-sdk](https://github.com/lazysuperheroes/hedera-SC-LAZY-Farms/tree/main/packages/sdk) - TypeScript SDK for programmatic integration

## License

MIT

## Links

- [Main Repository](https://github.com/lazysuperheroes/hedera-SC-LAZY-Farms)
- [Lazy Superheroes](https://lazysuperheroes.com)
- [Hedera Developer Docs](https://docs.hedera.com)
