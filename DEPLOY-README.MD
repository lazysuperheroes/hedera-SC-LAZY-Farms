# Farms

1) setup env, reusing contracts as needed (e.g. LAZY token / SCT):
   LAZY_TOKEN_ID=0.0.1311037
   LAZY_SCT_CONTRACT_ID=0.0.1311003
   LAZY_GAS_STATION_CONTRACT_ID=0.0.7221483
   LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.7221486
   #BOOST_MANAGER_CONTRACT_ID= Needs to deploy
   #PRNG_CONTRACT_ID= Needs to deploy
   LAZY_BURN_PERCENT=50

2) run deployLazyFarms: D:\github\LazyFarms\smart-contracts> node .\scripts\deployments\deployLazyFarms.js
   -> use an account that is an admin for LGS [Using: 0.0.6284762]
   Boost Manager contract created with ID: 0.0.8257105 / 00000000000000000000000000000000007dfe51
   PRNG contract created with ID: 0.0.8257116 / 00000000000000000000000000000000007dfe5c
   Mission Template contract created with ID: 0.0.8257118 / 00000000000000000000000000000000007dfe5e
   Mission Factory Contract created with ID: 0.0.8257122 / 00000000000000000000000000000000007dfe62
   Boost Manager connected to Mission Factory: 0.0.6284762@1739112499.892523476
   Mission Factory added to Lazy Gas Station: 0.0.6284762@1739112503.838638815
   Boost Manager added to Lazy Gas Station: 0.0.6284762@1739112510.932167918
3) verify contracts with compiled code - **COMPLETE**

4) fund LGS (hbar and $LAZY) <-- already done
5) setup boost manager, deploy missions and get going:

*configureGemBoost.js* [defaults of 5/10/15/25/40/20 for C/R/SR/UR/LR/SPE already in place]
*configureLazyBoost.js* [default at 500 $LAZY -> moved to 2,500 $LAZY]
-) node .\scripts\interactions\configureLazyBoost.js 0.0.8257105 2500 10 50
-) $LAZY Boost Cost updated. Transaction ID: 0.0.6284762@1742640555.636093195

*addCollectionToBoostLevel.js*

node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 C 0.0.1492915,0.0.657800,0.0.657798,0.0.657779,0.0.657774,0.0.657768,0.0.657740,0.0.657731,0.0.657728

Gem 0.0.1492915 added to Level 0. Transaction ID: 0.0.6284762@1742636986.034415734
Gem 0.0.657800 added to Level 0. Transaction ID: 0.0.6284762@1742636991.069070999
Gem 0.0.657798 added to Level 0. Transaction ID: 0.0.6284762@1742636998.981718062
Gem 0.0.657779 added to Level 0. Transaction ID: 0.0.6284762@1742637008.369944974
Gem 0.0.657774 added to Level 0. Transaction ID: 0.0.6284762@1742637011.447833587
Gem 0.0.657768 added to Level 0. Transaction ID: 0.0.6284762@1742637018.585966803
Gem 0.0.657740 added to Level 0. Transaction ID: 0.0.6284762@1742637024.665073949
Gem 0.0.657731 added to Level 0. Transaction ID: 0.0.6284762@1742637032.316738211
Gem 0.0.657728 added to Level 0. Transaction ID: 0.0.6284762@1742637037.764651094

node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 R 0.0.1492932,0.0.657747,0.0.657750,0.0.657794,0.0.657813,0.0.657818

Gem 0.0.1492932 added to Level 1. Transaction ID: 0.0.6284762@1742637091.202717754
Gem 0.0.657747 added to Level 1. Transaction ID: 0.0.6284762@1742637105.275918148
Gem 0.0.657750 added to Level 1. Transaction ID: 0.0.6284762@1742637106.566645832
Gem 0.0.657794 added to Level 1. Transaction ID: 0.0.6284762@1742637113.564524287
Gem 0.0.657813 added to Level 1. Transaction ID: 0.0.6284762@1742637119.226374031
Gem 0.0.657818 added to Level 1. Transaction ID: 0.0.6284762@1742637125.076059731

node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 SR 0.0.1492943,0.0.657811,0.0.657807,0.0.657727,0.0.657723,0.0.657716,0.0.657714

Gem 0.0.1492943 added to Level 2. Transaction ID: 0.0.6284762@1742637172.243311639
Gem 0.0.657811 added to Level 2. Transaction ID: 0.0.6284762@1742637175.093609912
Gem 0.0.657807 added to Level 2. Transaction ID: 0.0.6284762@1742637179.817853456
Gem 0.0.657727 added to Level 2. Transaction ID: 0.0.6284762@1742637187.605519008
Gem 0.0.657723 added to Level 2. Transaction ID: 0.0.6284762@1742637190.660292755
Gem 0.0.657716 added to Level 2. Transaction ID: 0.0.6284762@1742637195.702324554
Gem 0.0.657714 added to Level 2. Transaction ID: 0.0.6284762@1742637200.574628181

node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 UR 0.0.1492970,0.0.657711,0.0.657713,0.0.657718,0.0.657721,0.0.657745,0.0.657746

Gem 0.0.1492970 added to Level 3. Transaction ID: 0.0.6284762@1742637251.612817249
Gem 0.0.657711 added to Level 3. Transaction ID: 0.0.6284762@1742637257.981511461
Gem 0.0.657713 added to Level 3. Transaction ID: 0.0.6284762@1742637260.616959873
Gem 0.0.657718 added to Level 3. Transaction ID: 0.0.6284762@1742637268.909117589
Gem 0.0.657721 added to Level 3. Transaction ID: 0.0.6284762@1742637269.176235657
Gem 0.0.657745 added to Level 3. Transaction ID: 0.0.6284762@1742637275.639234124
Gem 0.0.657746 added to Level 3. Transaction ID: 0.0.6284762@1742637285.957045759

node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 LR 0.0.1492981,0.0.657822,0.0.657826 

Gem 0.0.1492981 added to Level 4. Transaction ID: 0.0.6284762@1742637328.363921542
Gem 0.0.657822 added to Level 4. Transaction ID: 0.0.6284762@1742637334.375133987
Gem 0.0.657826 added to Level 4. Transaction ID: 0.0.6284762@1742637336.602461733

 node .\scripts\interactions\addCollectionToBoostLevel.js 0.0.8257105 SPE 0.0.1492959,0.0.657829

Gem 0.0.1492959 added to Level 5. Transaction ID: 0.0.6284762@1742637386.154357308
Gem 0.0.657829 added to Level 5. Transaction ID: 0.0.6284762@1742637388.178146326

node .\scripts\interactions\getBoostManagerInfo.js 0.0.8257105  

`Cost to boost with FT: 500 LAZY ( 0.0.1311037 )`
`Consumable boost reduces your time remaining by: 10 %`
`Fee Burn Percentage: 50 %`
`Mission Factory: 0.0.8257122`
`Live Boosts: 0`
`Gem Collections: 0.0.1492915, 0.0.657800, 0.0.657798, 0.0.657779, 0.0.657774, 0.0.657768, 0.0.657740, 0.0.657731, 0.0.657728, 0.0.1492932, 0.0.657747, 0.0.657750, 0.0.657794, 0.0.657813, 0.0.657818, 0.0.1492943, 0.0.657811, 0.0.657807, 0.0.657727, 0.0.657723, 0.0.657716, 0.0.657714, 0.0.1492970, 0.0.657711, 0.0.657713, 0.0.657718, 0.0.657721, 0.0.657745, 0.0.657746, 0.0.1492981, 0.0.657822, 0.0.657826, 0.0.1492959, 0.0.657829`

addRequirementAndRewardCollectionsToMission.js
addRewardsToMission.js
adjustRequirementSerials.js

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