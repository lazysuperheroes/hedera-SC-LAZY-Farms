Lazy NFT Staking
================

N.B. setting for rates are designed in whole units of $LAZY

Info Use Case:
* total items staked [public variable totalItemsStaked]
* all users staking -> getStakingUsers()
* number of collection X staked -> getNumStakedNFTs()
* get the serials of a collection staked -> getStakedSerials()
* get total $LAZY accured but unpaid [get all staking users, call calculateRewards() per user]
* get total time spent HODL'ing [get all staking users, call calculateRewards() per user where userLastClaim is last claim or entry time whichever is more recent]




Farms
=====
Events
--> when someone stake something (what, when, from, to, fees)
--> when someone unstake something (what, when, from, to, fees)
--> when someone sign something (what, when, from, to, fees) ** query calls

---
* initialize a mission
* with number of rewards = 1
	- load collateral:
		-- 1 item
		-- 3 items
		-- 8 items
		-- 10 items
* with number of rewards = 2
	- load collateral:
		-- 1 item
		-- 3 items
		-- 8 items
		-- 10 items
* test 'addRequirementSerials' to limit serials used for entry
* test entry to mission requiring:
		-- 1 item
		-- 3 items
		-- 8 items
		-- 10 items
* test the random reward getting:
		-- 2 rewards when only 2 items remain
		-- 4 rewards when 6 items remain
		-- 1 reward from 10 items
* test withdrawal of collateral
		-- when full
		-- when 1 slot of spare collateral
		-- an uneven amount when rewards set  to 2
		-- then add more back.

Solidity Contracts:
ExpiryHelper.sol
KeyHelper.sol
AddrArrayLib.sol
LAZYTokenCreator.sol

only exist to support self mint of $LAZY token for testing

----

Serials ReqA/B/C
Operator 1-5
Bob 6-10
Alice 11-25

Boost:
ReqA_TokenId -> Common
ReqB_TokenId -> SR
ReqC_TokenId -> LR

Mission A - Any ReqA
Reward A [1, 2, 3]
dur 90 secs
cost: 1.1 $LAZY

Mission B - Any ReqA
Reward A [4, 5]
dur 3 seconds
cost 2 $LAZY
**two slots only**

Mission C - Any ReqA
Reward A [7, 8]
Reward B [1]
dur 3 seconds
cost 1.5 $LAZY

Mission D - Any ReqA
Reward A [9, 10]
Reward B [2, 3, 4, 5]
dur 3 seconds
cost 1.6 $LAZY


Mission E - Any 3 of ReqA/B/C
Reward B [6, 7, 8]
dur 3 seconds
cost 1.7 $LAZY

Mission F - Any 3 of ReqA/B/C
Reward A [11]
Reward B [9, 10]
dur 3 seconds
cost 1.8 $LAZY

Mission G - Any 3 of ReqA/B/C
Reward A [12, 13, 14]
Reward B [11, 12, 13]
dur 3 seconds
cost 1.9 $LAZY

Mission H - 2 x ReqC
Reward A [15-22]
Reward B [14-21]
dur 30 seconds
cost 2.2 $LAZY

Mission I - needs 2 requirements from: ReqB 11, 12, 13, 14, 1 or 6
Reward A [23]
Reward B [22]
dur 3 seconds
cost 2.5 $LAZY

Mission J - single requirement for entry
Reward A [24]
Reward B [23]
dur 30 seconds
cost 0.8 $LAZY
**DIRECT SEND REWARDS -> RewardA serials 25**


**$LAZY moves**
Missions route $LAZY not burnt to the Mission Factory
BoostManagers keep the $LAZY not burnt [method for ADMINS to pull it] as they need some on hand for staking
On closing a mission any $LAZY and hbar will be sent to the Factory. 

Mission has a transferHbar and retieveLazy method but only works when no active participants [could be cut to save space if needed]
BoostManager & Mission Factory have transferHbar and retieveLazy methods