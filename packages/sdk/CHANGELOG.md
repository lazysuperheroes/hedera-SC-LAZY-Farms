# Changelog

## 1.2.0

### Changed (signing behaviour)
- **`generateStakingRewardProof` (and `client.generateRewardProof`) now require stakes in signing
  layout.** In each entry, every serial after the first must exceed
  max(the collection's on-chain `getMaxBaseRate`, every rate in the entry). Multi-serial entries
  therefore need the caps, passed as `options.maxBaseRates`. Stakes that aren't in layout are
  refused with an error that points to the helper. `options.allowUnsafeLayout` skips the check;
  use it only when signing for your own account, never on behalf of other users.
- Submit to `stake()` / `unstake()` exactly the entries that were signed.

### Added
- `layoutStakesForSigning(stakes, maxBaseRates?)`: merges serials per collection and lays them out
  for signing. Without a cap, each serial gets its own entry.
- `assertStakesSigningLayout(stakes, maxBaseRates?)`: the check the signer applies.
- Types `MaxBaseRates`, `StakingProofOptions`.
- JSDoc: for ECDSA accounts with an EVM alias, pass the alias address as `sender`, since the contract
  binds `msg.sender`.

## 1.1.0

Aligns the SDK with the audit-fixed Mission template (2026-07).

### Fixed
- **`enterMission` now encodes correctly.** It previously passed a single address and a flat
  serials array, but the contract signature is `enterMission(address[] collections, uint256[][] serials)`.
  The single-collection ergonomic API is unchanged; the args are now wrapped internally.
- **`claimMissionRewards` now calls the participant `claimRewards()`** instead of the admin-only
  `withdrawRewards` (which reverts for normal users and is gated on there being no active participants).

### Added
- **Custom-error decoding.** Mission/factory reverts are custom errors (e.g. `OnlyEOA`,
  `NoSlotsAvailable`, `AlreadyJoined`) rather than `Error(string)`. `TransactionResult` now carries
  an `errorName` field with the decoded error name, and `error` holds a readable message.

### Changed
- **`GAS.MISSION_CLAIM` raised `1_500_000 → 2_500_000`** — the claim now performs a PRNG draw,
  a reward-NFT transfer, and `leaveMission` in one call.
- Updated the refreshed `abi/Mission.json` to the audit-fixed ABI.

### ⚠️ Breaking / behavioural notes
- **Mission entry must originate from an EOA.** The contract now reverts `OnlyEOA` when
  `enterMission` is called from a contract (anti reward-grinding). Do not route entry through a
  contract / multicall / smart-wallet.
- **Zero-fee missions are enterable.** A mission with `entryFee == 0` (free/promo, or a
  decreasing-fee auction that decayed to 0) no longer bricks entry — skip fee approval when the fee is 0.
- **Revert reasons changed shape** from `Error(string)` to custom errors. Consumers that string-match
  on revert *messages* should switch to `TransactionResult.errorName`.
- **`MAINNET_CONTRACTS.MISSION_TEMPLATE` now points at the audit-fixed template `0.0.10646220`**
  (redeployed 2026-07-15 via `scripts/deployments/configureFarms-NewMissionTemplate.js`, factory
  repointed and Sourcify-verified). The `MISSION_FACTORY` address is unchanged.
