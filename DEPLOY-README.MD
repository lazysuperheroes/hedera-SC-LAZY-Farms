# Farms
1) setup env, reusing contracts as needed (e.g. LAZY token / SCT):
LAZY_TOKEN_ID=
LAZY_SCT_CONTRACT_ID=
LAZY_GAS_STATION_CONTRACT_ID=
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=
BOOST_MANAGER_CONTRACT_ID=
PRNG_CONTRACT_ID=
LAZY_BURN_PERCENT= (defaults to 25% if not set)

2) run deployLazyFarms: D:\github\LazyFarms\smart-contracts> node .\scripts\deployments\deployLazyFarms.js
-> use an account that is an admin for LGS

3) verify contracts with compiled code

4) fund LGS (hbar and $LAZY)

5) setup boost manager, deploy missions and get going:

addCollectionToBoostLevel.js
addRequirementAndRewardCollectionsToMission.js
addRewardsToMission.js
adjustRequirementSerials.js
configureGemBoost.js
configureLazyBoost.js
deployMission.js

===
# Staking
1) setup env
SIGNING_WALLET= [ECDSA key!! if not specified will be generated]
LAZY_TOKEN_ID=0.0.1311037
LAZY_SCT_CONTRACT_ID=0.0.1311003
LAZY_DECIMALS=1 [should probably just look this up! like this to make testing easier deploying a contract if not specified]
## Burn Percentage for staking = 0 [for boost missions = 50]%
LAZY_BURN_PERCENT=0
## Lazy earnt per day
LAZY_STAKING_DISTRIBUTION_PERIOD=86400
## Initial Cap on Boost %
LAZY_STAKING_BOOST_CAP=50
## number of periods (days) to kick in HODL bonus
LAZY_STAKING_PERIOD_FOR_BONUS=30
## HODL bonus per period
LAZY_STAKING_HODL_BONUS=25
## max number of HODL bonuses
LAZY_STAKING_MAX_BONUS_PERIODS=8
## Defaults to 250_000_000 / 50_000_000 for $LAZY but can override
LAZY_MAX_SUPPLY= [whole units exclude decimal]
LAZY_HALF_AFTER= [whole units exclude decimal]

2) run deployLazyNFTStaking: D:\github\LazyFarms\smart-contracts> node .\scripts\deployments\deployLazyNFTStaking.js
-> use an account that is an admin for LGS

Deployed on 29th-Sep-2024
Lazy Gas Station contract created with ID: 0.0.7221483 / 00000000000000000000000000000000006e30eb
Lazy Delegate Registry contract created with ID: 0.0.7221486 / 00000000000000000000000000000000006e30ee
Lazy NFT Staking Contract created with ID: 0.0.7221488 / 00000000000000000000000000000000006e30f0
Lazy NFT Staking added to Lazy Gas Station: 0.0.6284762@1727601288.693762511

-Collection(s): 0.0.768753, 0.0.1693200, 0.0.1992037, 0.0.805923, 0.0.564539, 0.0.848553, 0.0.1195780, 0.0.838959
-Token: 0.0.768753 Symbol: Lazy Superheroes - Gen 1 Name: Lazy Superheroes - Gen 1 Max Reward Rate: 100 LAZY
-Token: 0.0.1693200 Symbol: LSHM Name: Lazy Superheroes - Gen 1 Mutants Max Reward Rate: 50 LAZY
-Token: 0.0.1992037 Symbol: LSD Name: Lazy Super Dogs Max Reward Rate: 20 LAZY
-Token: 0.0.805923 Symbol: HashHorses Name: Hash Horses Max Reward Rate: 20 LAZY
-Token: 0.0.564539 Symbol: IPFS://bafkreie625ucklhyqwxqvopoc3aa6dmliji3xwagr3tfkziew3m2xdnd3i Name: Hash Horse #0 - Golden Horse - UR Max Reward Rate: 20 LAZY
-Token: 0.0.848553 Symbol: Lazy Superheroes - Gen 2 Name: Lazy Superheroes - Gen 2 Max Reward Rate: 45 LAZY
-Token: 0.0.1195780 Symbol: MOBS Name: The Mobsters Max Reward Rate: 0 LAZY
-Token: 0.0.838959 Symbol: MEERK Name: Meerkat Gang Max Reward Rate: 0 LAZY
Collections now stakeable. Transaction ID: 0.0.6284762@1727607005.390084793

3) verify contracts with compiled code

4) setup:

addStakableCollection.js -> add new
updateStakeableCollection.js -> adjust the base rates
setStakingBoostRateCap.js
setStakingBurnPercentage.js