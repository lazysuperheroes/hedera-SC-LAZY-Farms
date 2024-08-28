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
LAZY_TOKEN_ID=
LAZY_SCT_CONTRACT_ID=
LAZY_DECIMALS=1 [should probably just look this up! like this to make testing easier deploying a contract if not specified]
LAZY_BURN_PERCENT=0
LAZY_STAKING_DISTRIBUTION_PERIOD=
LAZY_STAKING_BOOST_CAP=
LAZY_STAKING_PERIOD_FOR_BONUS=
LAZY_STAKING_HODL_BONUS=
LAZY_STAKING_MAX_BONUS_PERIODS=
LAZY_MAX_SUPPLY= [whole units exclude decimal]
LAZY_HALF_AFTER= [whole units exclude decimal]

2) run deployLazyNFTStaking: D:\github\LazyFarms\smart-contracts> node .\scripts\deployments\deployLazyNFTStaking.js
-> use an account that is an admin for LGS

3) verify contracts with compiled code

4) setup:

addStakableCollection.js -> add new
updateStakeableCollection.js -> adjust the base rates
setStakingBoostRateCap.js
setStakingBurnPercentage.js