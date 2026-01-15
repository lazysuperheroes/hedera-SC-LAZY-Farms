// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title TokenStaker - Core Staking Module for NFT Movement via HTS
/// @author stowerling.eth / stowerling.hbar
/// @notice Base contract that handles the movement of NFTs between users and staking contracts
/// @dev Provides primitives for HTS token association and NFT transfers with optional delegation
/// Uses 1 tinybar transfers for royalty handling, making it compatible with any NFT collection

import { HederaResponseCodes } from "./HederaResponseCodes.sol";
import { HederaTokenService } from "./HederaTokenService.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

import { ILazyGasStation } from "./interfaces/ILazyGasStation.sol";
import { ILazyDelegateRegistry } from "./interfaces/ILazyDelegateRegistry.sol";

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenStaker is HederaTokenService {
	using SafeCast for uint256;
	using SafeCast for int256;

	/// @notice Thrown when contract initialization (token association) fails
	error FailedToInitialize();
	/// @notice Thrown when function arguments are invalid (e.g., too many serials)
	error BadArguments();
	/// @notice Thrown when an NFT transfer via HTS cryptoTransfer fails
	/// @param _direction Whether the transfer was for staking or withdrawal
	error NFTTransferFailed(TransferDirection _direction);
	/// @notice Thrown when a single token association via HTS fails
	error AssociationFailed();
	/// @notice Thrown when a batch token association via HTS fails
	error BatchAssociationFailed();

	/// @notice Direction of NFT transfer
	/// @dev STAKING moves NFTs from user to contract, WITHDRAWAL moves from contract to user
    enum TransferDirection {
        STAKING,
        WITHDRAWAL
    }

	/// @notice The $LAZY token contract address for gas refills
    address public lazyToken;
	/// @notice Reference to the LazyGasStation for $LAZY and HBAR refills
	ILazyGasStation public lazyGasStation;
	/// @notice Reference to the LazyDelegateRegistry for NFT delegation management
	ILazyDelegateRegistry public lazyDelegateRegistry;
	/// @dev Maximum number of NFTs that can be transferred in a single HTS transaction
    uint256 private constant MAX_NFTS_PER_TX = 8;

	/// @dev Modifier that automatically refills $LAZY and HBAR from the gas station if balances are low
	/// Checks if $LAZY balance < 20 and HBAR balance < 20 tinybars, and refills 50 of each if needed
	modifier refill() {
		// check the $LAZY balance of the contract and refill if necessary
		if(IERC20(lazyToken).balanceOf(address(this)) < 20) {
			lazyGasStation.refillLazy(50);
		}
		// check the balance of the contract and refill if necessary
		if(address(this).balance < 20) {
			lazyGasStation.refillHbar(50);
		}
		_;
	}

	/// @notice Initialize contract references and associate with the $LAZY token
	/// @dev Must be called by inheriting contracts during initialization
	/// Associates this contract with the $LAZY token via HTS
	/// @param _lazyToken The address of the $LAZY token contract
	/// @param _lazyGasStation The address of the LazyGasStation contract
	/// @param _lazyDelegateRegistry The address of the LazyDelegateRegistry contract
    function initContracts(address _lazyToken, address _lazyGasStation, address _lazyDelegateRegistry) internal {
        lazyToken = _lazyToken;
		lazyGasStation = ILazyGasStation(_lazyGasStation);
		lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);

        int256 response = HederaTokenService.associateToken(
            address(this),
            lazyToken
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert FailedToInitialize();
        }
    }

	/// @notice Transfer NFTs between user and contract for staking/unstaking operations
	/// @dev Uses HTS cryptoTransfer with 1 tinybar for royalty handling
	/// Limited to MAX_NFTS_PER_TX (8) NFTs per call. Handles delegation automatically if enabled
	/// @param _direction STAKING (user to contract) or WITHDRAWAL (contract to user)
	/// @param _collectionAddress The NFT collection contract address
	/// @param _serials Array of serial numbers to transfer (max 8)
	/// @param _transferInitiator The user address (source for staking, destination for withdrawal)
	/// @param _delegate If true, manage delegation via LazyDelegateRegistry
    function moveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
		bool _delegate
    ) internal {
        if(_serials.length > 8) revert BadArguments();
        address receiverAddress;
        address senderAddress;
		bool isHbarApproval;

        if (_direction == TransferDirection.STAKING) {
            receiverAddress = address(this);
            senderAddress = _transferInitiator;
        } else {
            receiverAddress = _transferInitiator;
            senderAddress = address(this);
			isHbarApproval = true;
        }

        // hbar moves sit seperate from NFT moves (max 8 NFTs + 2 hbar legs +1/-1 tiny bar)
        IHederaTokenService.TokenTransferList[]
            memory _transfers = new IHederaTokenService.TokenTransferList[](
                _serials.length
            );

		// prep the hbar transfer
		IHederaTokenService.TransferList memory _hbarTransfer;
		_hbarTransfer.transfers = new IHederaTokenService.AccountAmount[](2);

        _hbarTransfer.transfers[0].accountID = receiverAddress;
		_hbarTransfer.transfers[0].amount = -1;
		_hbarTransfer.transfers[0].isApproval = isHbarApproval;

		_hbarTransfer.transfers[1].accountID = senderAddress;
		_hbarTransfer.transfers[1].amount = 1;

		if(_delegate && _direction == TransferDirection.WITHDRAWAL) {
			// order matters, we can only do this BEFORE transfer as contract must hold the NFTs
			lazyDelegateRegistry.revokeDelegateNFT(_collectionAddress, _serials);
		}

        // transfer NFT
        for (uint256 i = 0; i < _serials.length; i++) {
            IHederaTokenService.NftTransfer memory _nftTransfer;
            _nftTransfer.senderAccountID = senderAddress;
            _nftTransfer.receiverAccountID = receiverAddress;
			_nftTransfer.isApproval = !isHbarApproval;

            if (_serials[i] == 0) {
                continue;
            }
            _transfers[i].token = _collectionAddress;


            _transfers[i]
                .nftTransfers = new IHederaTokenService.NftTransfer[](1);

            _nftTransfer.serialNumber = SafeCast.toInt64(int256(_serials[i]));
            _transfers[i].nftTransfers[0] = _nftTransfer;
        }

        int256 response = HederaTokenService.cryptoTransfer(_hbarTransfer, _transfers);

        if (response != HederaResponseCodes.SUCCESS) {
			// could be $LAZY or serials causing the issue. Check $LAZY balance of contract first
            revert NFTTransferFailed(_direction);
        }

		if(_delegate && _direction == TransferDirection.STAKING) {
			// order matters, we can only do this AFTER transfer as contract must hold the NFTs
			lazyDelegateRegistry.delegateNFT(senderAddress, _collectionAddress, _serials);
		}
    }

	/// @notice Associate this contract with a single HTS token
	/// @dev Safe association that succeeds if already associated
	/// @param tokenId The token address to associate with this contract
    function tokenAssociate(address tokenId) public {
        int256 response = HederaTokenService.associateToken(
            address(this),
            tokenId
        );

        if (!(response == SUCCESS || response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT)) {
            revert AssociationFailed();
        }
    }

	/// @notice Associate this contract with multiple HTS tokens in a single transaction
	/// @dev More gas efficient than individual associations, but fails if any token is already associated
	/// Use safeBatchTokenAssociate for safer batch operations
	/// @param tokenIds Array of token addresses to associate with this contract
    function batchTokenAssociate(address[] memory tokenIds) public {
        int256 response = HederaTokenService.associateTokens(
            address(this),
            tokenIds
        );

        if (response != HederaResponseCodes.SUCCESS) {
            revert BatchAssociationFailed();
        }
    }

	/// @notice Safely associate multiple tokens by associating each individually
	/// @dev Less gas efficient than batchTokenAssociate but handles already-associated tokens gracefully
	/// @param tokenIds Array of token addresses to associate with this contract
	function safeBatchTokenAssociate(address[] memory tokenIds) public {
		uint256 tokenArrayLength = tokenIds.length;
		for(uint256 i = 0; i < tokenArrayLength;) {
			tokenAssociate(tokenIds[i]);
			unchecked {	++i; }
		}
	}

	/// @notice Associate tokens that are not in an existing list of associated tokens
	/// @dev Compares against a known list to skip already-associated tokens
	/// More efficient than safeBatchTokenAssociate when you know which tokens are already associated
	/// @param tokenIds Array of token addresses to potentially associate
	/// @param existingTokenIds Array of token addresses already associated (to skip)
	function noClashBatchTokenAssociate(address[] memory tokenIds, address[] memory existingTokenIds) public {
		uint256 tokenArrayLength = tokenIds.length;
		uint256 existingTokenArrayLength = existingTokenIds.length;
		for(uint256 i = 0; i < tokenArrayLength;) {
			bool clash = false;
			for(uint256 j = 0; j < existingTokenArrayLength;) {
				if(tokenIds[i] == existingTokenIds[j]) {
					clash = true;
					break;
				}
				unchecked {	++j; }
			}
			if(!clash) {
				tokenAssociate(tokenIds[i]);
			}
			unchecked {	++i; }
		}
	}

	/// @notice Transfer multiple NFTs in batches of MAX_NFTS_PER_TX (8)
	/// @dev Automatically splits large transfers into multiple HTS transactions
	/// Uses refill modifier to ensure sufficient $LAZY and HBAR for operations
	/// @param _direction STAKING (user to contract) or WITHDRAWAL (contract to user)
	/// @param _collectionAddress The NFT collection contract address
	/// @param _serials Array of serial numbers to transfer (can exceed 8)
	/// @param _transferInitiator The user address (source for staking, destination for withdrawal)
	/// @param _delegate If true, manage delegation via LazyDelegateRegistry for each batch
    function batchMoveNFTs(
        TransferDirection _direction,
        address _collectionAddress,
        uint256[] memory _serials,
        address _transferInitiator,
		bool _delegate
    ) internal refill() {
        // check the number of serials and send in batchs of 8
        for (
            uint256 outer = 0;
            outer < _serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (_serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (_serials.length - outer);
            uint256[] memory serials = new uint256[](batchSize);
            for (
                uint256 inner = 0;
                ((outer + inner) < _serials.length) &&
                    (inner < MAX_NFTS_PER_TX);
                inner++
            ) {
                if (outer + inner < _serials.length) {
                    serials[inner] = _serials[outer + inner];
                }
            }
            moveNFTs(
                _direction,
                _collectionAddress,
                serials,
                _transferInitiator,
				_delegate
            );
        }
    }
}
