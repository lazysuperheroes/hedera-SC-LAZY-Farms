// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";

/// @title LazyDelegateRegistry - NFT Delegation for Staking Without Transfer
/// @author stowerling.eth / stowerling.hbar
/// @notice Allows NFT owners to delegate their tokens to another wallet for staking purposes without transferring ownership
/// @dev Supports both wallet-level delegation (all NFTs from a wallet) and token-level delegation (specific NFT serials)
/// Delegation becomes invalid if the NFT is transferred to a new owner
contract LazyDelegateRegistry is ILazyDelegateRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;
	using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableMap for EnumerableMap.UintToAddressMap;
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    /// @dev Maps wallet address to its designated delegate wallet
    mapping(address => address) private delegateWallet;
    /// @dev Maps delegate address to set of wallets that have delegated to it
    mapping(address => EnumerableSet.AddressSet) private delegatedTo;
    /// @dev Maps token address to (serial number -> delegate address) for NFT-level delegations
    mapping(address => EnumerableMap.UintToAddressMap) private delegatedNFT;
    /// @dev Maps delegate wallet to set of token addresses delegated to it (O(1) lookup)
    mapping(address => EnumerableSet.AddressSet)
        private delegateWalletToTokenSetMap;
    /// @dev Maps owner wallet to set of token addresses they have delegated (O(1) lookup)
    mapping(address => EnumerableSet.AddressSet)
        private walletToTokenDelegations;

	/// @dev Maps hash(wallet, token) to set of serial numbers delegated
	mapping(bytes32 => EnumerableSet.UintSet) private delegatedNFTSerialsByHash;
	/// @dev Maps hash(token, serial) to the original delegator/owner address
	mapping(bytes32 => address) private delegatedNFTSerialsOwnerByHash;

	/// @dev Set of all wallets that have active wallet-level delegations
    EnumerableSet.AddressSet private walletsWithDelegates;
    /// @dev Set of all token addresses that have at least one delegated serial
    EnumerableSet.AddressSet private tokensWithDelegates;

    /// @notice Total count of individual NFT serials currently delegated across all tokens
    uint256 public totalSerialsDelegated;

	/// @notice Delegate your wallet to another address for all NFT operations
	/// @dev Only one delegate per wallet is allowed. Calling again overwrites the previous delegate.
	/// This is a wallet-level delegation that affects all NFTs owned by the caller
	/// @param _delegate The address of the wallet to delegate to
    function delegateWalletTo(address _delegate) external {
        delegateWallet[msg.sender] = _delegate;
        delegatedTo[_delegate].add(msg.sender);
        walletsWithDelegates.add(msg.sender);

        emit WalletDelegated(msg.sender, _delegate, true);
    }

	/// @notice Revoke any existing wallet-level delegation
	/// @dev Removes the caller's delegate and cleans up all related mappings
	/// Completes silently if no delegation exists
    function revokeDelegateWallet() external {
        address currentDelegate = delegateWallet[msg.sender];
        delete delegateWallet[msg.sender];
        if (currentDelegate != address(0)) {
            delegatedTo[currentDelegate].remove(msg.sender);
            walletsWithDelegates.remove(msg.sender);
            emit WalletDelegated(msg.sender, currentDelegate, false);
        }
    }

	/// @notice Delegate specific NFT serials to a wallet for staking operations
	/// @dev Only the current owner can delegate. If serials were previously delegated, the old delegation is revoked first.
	/// Verifies ownership via IERC721.ownerOf() for each serial
	/// @param _delegate The address of the wallet to receive delegation rights
	/// @param _token The address of the NFT collection contract
	/// @param _serials Array of serial numbers to delegate
	function delegateNFT(
        address _delegate,
        address _token,
        uint256[] memory _serials
    ) public {
		// add the token to the list of tokens with delegates
		// returns false if the token is already in the list but we do not care
		tokensWithDelegates.add(_token);
		walletToTokenDelegations[msg.sender].add(_token);
		delegateWalletToTokenSetMap[_delegate].add(_token);
		bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, _token));
		bytes32 ownerTokenHash = keccak256(abi.encodePacked(msg.sender, _token));
		uint256 serialLength = _serials.length;
		for (uint256 i = 0; i < serialLength;) {
			uint256 _serial = _serials[i];
			address currentOwner = IERC721(_token).ownerOf(_serial);
			if (currentOwner != msg.sender) {
				revert LazyDelegateRegistryOnlyOwner(currentOwner, msg.sender);
			}
			// bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));

			// // this is the point where we need to check if the delegate is already set
			// (bool exists, address delegateTokenController) = delegatedNFT[_token]
			// 	.tryGet(_serial);
			// if (exists && delegateTokenController != address(0)) {
			// 	// find who delegated the token
			// 	address currentDelegator = delegatedNFTSerialsOwnerByHash[tokenSerialHash];
			// 	// remove the serial from the list for currentDelegator
			// 	bytes32 currentDelegatorTokenHash = keccak256(abi.encodePacked(currentDelegator, _token));
			// 	delegatedNFTSerialsByHash[currentDelegatorTokenHash].remove(_serial);
			// 	// and clean up entry if it was the last one
			// 	if (delegatedNFTSerialsByHash[currentDelegatorTokenHash].length() == 0) {
			// 		// tidy up the address set
			// 		walletToTokenDelegations[currentDelegator].remove(_token);
			// 	}

			// 	// unwind the delegate
			// 	bytes32 currentDelegateTokenHash = keccak256(abi.encodePacked(delegateTokenController, _token));
				
			// 	// remove the serial from the list of serials delegated to the delegate
			// 	delegatedNFTSerialsByHash[currentDelegateTokenHash].remove(_serial);
			// 	// and clean up entry if it was the last one
			// 	if (delegatedNFTSerialsByHash[currentDelegateTokenHash].length() == 0) {
			// 		// tidy up the address set
			// 		delegateWalletToTokenSetMap[delegateTokenController].remove(_token);
			// 	}

			// 	// post the world the delegation has been removed
			// 	emit TokenDelegated(_token, _serial, delegateTokenController, currentOwner, false);
			// }

			// remove the old delnpegation if it exists
			bool removed = _revokeDelegateNFT(ownerTokenHash, currentOwner, _token, _serial, false);
			if (!removed) {
				// if we failed to clean up then this is a fresh delegation
				totalSerialsDelegated++;
				// need to set the delegator of the token/serial
				bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = currentOwner;
			}

			// add the serial to the list of serials delegated by the owner
			// is the token/serial has moved to a new owner then the delegation is no longer valid
			// so we need to add here knowing it just costs gas and will not revert even if present
			delegatedNFTSerialsByHash[ownerTokenHash].add(_serial);

			delegatedNFT[_token].set(_serial, _delegate);
			
			// add the serial to the list of serials delegated
			delegatedNFTSerialsByHash[delegateTokenHash].add(_serial);

			emit TokenDelegated(_token, _serial, _delegate, currentOwner, true);

			unchecked { ++i; }
		}
    }


	/// @notice Revoke delegation for specific NFT serials
	/// @dev Only the current owner can revoke their delegation. Completes silently if no delegation exists.
	/// Verifies ownership before allowing revocation
	/// @param _token The address of the NFT collection contract
	/// @param _serials Array of serial numbers to revoke delegation for
    function revokeDelegateNFT(address _token, uint256[] memory _serials) public {
		bytes32 ownerTokenHash = keccak256(abi.encodePacked(msg.sender, _token));
		for (uint256 i = 0; i < _serials.length;) {
			uint256 serial = _serials[i];
			address currentOwner = IERC721(_token).ownerOf(serial);
			if (currentOwner != msg.sender) {
				revert LazyDelegateRegistryOnlyOwner(currentOwner, msg.sender);
			}
			
			_revokeDelegateNFT(ownerTokenHash, currentOwner, _token, serial, true);

			unchecked { ++i; }
		}
    }

	/// @notice Batch revoke delegations for multiple tokens and their serials
	/// @dev Helper function to revoke delegations across multiple NFT collections in one transaction
	/// @param _tokens Array of NFT collection contract addresses
	/// @param _serials Array of arrays, where each inner array contains serial numbers for the corresponding token
    function revokeDelegateNFTs(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            revokeDelegateNFT(_tokens[i], _serials[i]);
        }
    }

	/// @notice Internal function to handle revocation of NFT delegation
	/// @dev Used both for explicit revocation and for unwinding old delegations when re-delegating
	/// @param _ownerTokenHash The keccak256 hash of (owner address, token address)
	/// @param _currentOwner The current owner of the NFT
	/// @param _token The address of the NFT collection contract
	/// @param _serial The serial number of the NFT
	/// @param _fullRemoval If true, performs complete removal; if false, only tidies up for re-delegation
	/// @return _removed True if a delegation was found and removed, false if no delegation existed
	function _revokeDelegateNFT(bytes32 _ownerTokenHash, address _currentOwner, address _token, uint256 _serial, bool _fullRemoval) internal returns (bool _removed) {
		// get current delegate
		(bool found, address currentDelegate) = delegatedNFT[_token].tryGet(_serial);

		// check if there is a delegate
		// if so and no more instances of this token delegated to the delegate
		// then delete the delegate listing
		if (found && currentDelegate != address(0)) {
			bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));

			// find if we might have a hanging delegator
			address currentDelegator = delegatedNFTSerialsOwnerByHash[tokenSerialHash];
			bytes32 currentDelegatorTokenHash = keccak256(abi.encodePacked(currentDelegator, _token));

			// no point removing the serial as we are about to add it back
			if (_fullRemoval) {
				// decrement global counter only on full removal
				totalSerialsDelegated--;

				delegatedNFT[_token].remove(_serial);
				// check if there are any more serials of this token delegated
				if (delegatedNFT[_token].length() == 0) {
					// tidy up the address set
					tokensWithDelegates.remove(_token);
				}
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = address(0);

				delegatedNFTSerialsByHash[_ownerTokenHash].remove(_serial);

				if (delegatedNFTSerialsByHash[_ownerTokenHash].length() == 0) {
					// tidy up the address set
					walletToTokenDelegations[_currentOwner].remove(_token);
				}
			}
			else {
				delegatedNFTSerialsOwnerByHash[tokenSerialHash] = _currentOwner;
			}

			// unwind existing delegation
			bytes32 delegateTokenHash = keccak256(abi.encodePacked(currentDelegate, _token));
				delegatedNFTSerialsByHash[delegateTokenHash].remove(_serial);

			// check if the mapping has length = 0
			// if so then remove the mapping else just delete the serial
			if (delegatedNFTSerialsByHash[delegateTokenHash].length() == 0) {
				// tidy up the address set
				delegateWalletToTokenSetMap[currentDelegate].remove(_token);
			}

			// if we are doing a full removal then we need to tidy up the delegator
			// or if the delegator has changed
			if (_fullRemoval || currentDelegator != _currentOwner) {
				delegatedNFTSerialsByHash[currentDelegatorTokenHash].remove(_serial);
				if (delegatedNFTSerialsByHash[currentDelegatorTokenHash].length() == 0) {
					// tidy up the address set
					walletToTokenDelegations[currentDelegator].remove(_token);
				}
			}

			emit TokenDelegated(
				_token,
				_serial,
				currentDelegate,
				currentDelegator,
				false
			);
			return true;
		}
		return false;
	}

	/// @notice Batch delegate NFTs from multiple collections to a single delegate
	/// @dev Requires arrays to have matching lengths. Delegates all specified serials to the same delegate
	/// @param _delegate The address of the wallet to receive delegation rights
	/// @param _tokens Array of NFT collection contract addresses
	/// @param _serials Array of arrays, where each inner array contains serial numbers for the corresponding token
    function delegateNFTs(
        address _delegate,
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external {
		if (_tokens.length != _serials.length) {
			revert BadArgumentLength(_tokens.length, _serials.length);
		}
		uint256 tokenLength = _tokens.length;
        for (uint256 i = 0; i < tokenLength;) {
            delegateNFT(_delegate, _tokens[i], _serials[i]);
			unchecked { ++i; }
        }
    }

	/// @notice Get the wallet-level delegate for a given wallet
	/// @param _wallet The address of the wallet to check
	/// @return delegate The address of the delegate wallet, or address(0) if no delegation exists
    function getDelegateWallet(
        address _wallet
    ) external view returns (address delegate) {
        return delegateWallet[_wallet];
    }

	/// @notice Check if a proposed delegate is authorized to act on behalf of a wallet
	/// @param _actualWallet The address of the wallet to check delegation for
	/// @param _proposedDelegate The address of the proposed delegate to verify
	/// @return True if the wallet has delegated to the proposed delegate, false otherwise
    function checkDelegateWallet(
        address _actualWallet,
        address _proposedDelegate
    ) external view returns (bool) {
        return delegateWallet[_actualWallet] == _proposedDelegate;
    }

	/// @notice Check if a proposed delegate can act on a specific NFT
	/// @dev Checks hierarchy: 1) current owner, 2) wallet delegate, 3) token-level delegate
	/// Also validates that the delegation is still valid (owner hasn't changed)
	/// @param _proposedDelegate The address of the proposed delegate to verify
	/// @param _token The address of the NFT collection contract
	/// @param _serial The serial number of the NFT
	/// @return True if the proposed delegate is authorized to act on this NFT
    function checkDelegateToken(
        address _proposedDelegate,
        address _token,
        uint256 _serial
    ) external view returns (bool) {
        address currentOwner = IERC721(_token).ownerOf(_serial);
        // check if the wallet is delegated
        address delegate = delegateWallet[currentOwner];
        // check iif we have a delegate
        (bool exists, address delegateTokenController) = delegatedNFT[_token]
            .tryGet(_serial);
		// check if the delegation is still valid
        if (!exists || !checkNFTDelegationIsValid(_token, _serial)) {
            delegateTokenController = address(0);
        }
        // heirarchy:
		// 1. currentOwner
		// 2. delegateWallet
		// 3. delegateTokenController
        return
            currentOwner == _proposedDelegate ||
			delegate == _proposedDelegate ||
			delegateTokenController == _proposedDelegate;
    }

	/// @notice Get all wallets that have delegated to a specific delegate address
	/// @param _delegateWallet The address of the delegate wallet
	/// @return Array of wallet addresses that have delegated to this delegate
    function getWalletsDelegatedTo(
        address _delegateWallet
    ) external view returns (address[] memory) {
        return delegatedTo[_delegateWallet].values();
    }

	/// @notice Get the delegate address for a specific NFT serial
	/// @param _token The address of the NFT collection contract
	/// @param _serial The serial number of the NFT
	/// @return wallet The address of the delegate, or address(0) if not delegated
    function getNFTDelegatedTo(
        address _token,
        uint256 _serial
    ) external view returns (address wallet) {
        bool exists;
        (exists, wallet) = delegatedNFT[_token].tryGet(_serial);
        if (!exists) {
            return address(0);
        }
    }

	/// @notice Batch get delegate addresses for multiple NFTs across multiple collections
	/// @param _tokens Array of NFT collection contract addresses
	/// @param _serials Array of arrays, where each inner array contains serial numbers for the corresponding token
	/// @return delegateList Array of arrays containing delegate addresses (address(0) if not delegated)
    function getNFTListDelegatedTo(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external view returns (address[][] memory delegateList) {
        delegateList = new address[][](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            delegateList[i] = new address[](_serials[i].length);
            for (uint256 j = 0; j < _serials[i].length; j++) {
                (bool found, address delegate) = delegatedNFT[_tokens[i]]
                    .tryGet(_serials[i][j]);
                if (!found) {
                    delegate = address(0);
                } else {
                    delegateList[i][j] = delegate;
                }
            }
        }
    }

	/// @notice Check if a delegation is still valid (owner hasn't transferred the NFT)
	/// @dev Compares the recorded delegator with the current owner via IERC721.ownerOf()
	/// A delegation becomes stale if the NFT is transferred to a new owner
	/// @param _token The address of the NFT collection contract
	/// @param _serial The serial number of the NFT
	/// @return True if the delegation is still valid, false if the NFT has been transferred
	function checkNFTDelegationIsValid(
		address _token,
		uint256 _serial
	) public view returns (bool) {
		address currentOwner = IERC721(_token).ownerOf(_serial);
		
		// calculate the hash of the token and serial
		bytes32 tokenSerialHash = keccak256(abi.encodePacked(_token, _serial));
		// check if the owner that delegated the token
		// is still the owner of the token
		return delegatedNFTSerialsOwnerByHash[tokenSerialHash] == currentOwner;
	}

	/// @notice Batch check delegation validity for multiple NFTs across multiple collections
	/// @dev Batched version to reduce mirror node calls
	/// @param _tokens Array of NFT collection contract addresses
	/// @param _serials Array of arrays, where each inner array contains serial numbers for the corresponding token
	/// @return valid Array of arrays containing validity status for each NFT
	function checkNFTDelegationIsValidBatch(
		address[] memory _tokens,
		uint256[][] memory _serials
	) external view returns (bool[][] memory valid) {
		// create an array of arrays to match the size of the _serials array
		valid = new bool[][](_tokens.length);
		for (uint256 i = 0; i < _tokens.length; i++) {
			valid[i] = new bool[](_serials[i].length);
			for (uint256 j = 0; j < _serials[i].length; j++) {
				valid[i][j] = checkNFTDelegationIsValid(_tokens[i], _serials[i][j]);
			}
		}
	}

	/// @notice Get all NFTs delegated to a specific delegate wallet
	/// @param _delegate The address of the delegate wallet
	/// @return tokens Array of NFT collection contract addresses
	/// @return serials Array of arrays containing serial numbers for each token
    function getNFTsDelegatedTo(
        address _delegate
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials)
    {
        tokens = delegateWalletToTokenSetMap[_delegate].values();
        serials = new uint256[][](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
			bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, tokens[i]));
			serials[i] = delegatedNFTSerialsByHash[delegateTokenHash].values();
        }
    }

	/// @notice Get all NFTs delegated by a specific owner wallet
	/// @param _ownerWallet The address of the owner wallet
	/// @param _includeSerials If true, includes serial numbers; if false, returns empty serials array
	/// @return tokens Array of NFT collection contract addresses that have delegations
	/// @return serials Array of arrays containing serial numbers (if _includeSerials is true)
    function getDelegatedNFTsBy(
        address _ownerWallet,
        bool _includeSerials
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials)
    {
        tokens = walletToTokenDelegations[_ownerWallet].values();
        if (_includeSerials) {
            serials = new uint256[][](tokens.length);
            for (uint256 i = 0; i < tokens.length; i++) {
				bytes32 ownerTokenHash = keccak256(abi.encodePacked(_ownerWallet, tokens[i]));
				serials[i] = delegatedNFTSerialsByHash[ownerTokenHash].values();
            }
        } else {
            serials = new uint256[][](0);
        }
    }

	/// @notice Get all serial numbers of a specific token delegated to a delegate wallet
	/// @param _delegate The address of the delegate wallet
	/// @param _token The address of the NFT collection contract
	/// @return serials Array of serial numbers delegated to this delegate for this token
    function getSerialsDelegatedTo(
        address _delegate,
        address _token
    ) external view returns (uint256[] memory serials) {
        if (!delegateWalletToTokenSetMap[_delegate].contains(_token)) {
            return new uint256[](0);
        }

		bytes32 delegateTokenHash = keccak256(abi.encodePacked(_delegate, _token));

        return
            getSerialsDelegatedToRange(
                _delegate,
                _token,
                0,
                delegatedNFTSerialsByHash[delegateTokenHash].length()
            );
    }

	/// @notice Get a paginated range of serial numbers delegated to a delegate wallet
	/// @dev Use this when the full list may be too large to return in one call
	/// @param _delegate The address of the delegate wallet
	/// @param _token The address of the NFT collection contract
	/// @param _offset The starting index in the serial list
	/// @param _limit The maximum number of serials to return
	/// @return serials Array of serial numbers within the specified range
    function getSerialsDelegatedToRange(
        address _delegate,
        address _token,
        uint256 _offset,
        uint256 _limit
    ) public view returns (uint256[] memory serials) {
        serials = new uint256[](_limit);
		// get the serial list for the delegate and token
		uint256[] memory delegateTokenSerials = delegatedNFTSerialsByHash[keccak256(abi.encodePacked(_delegate, _token))].values();
		require(_offset + _limit <= delegateTokenSerials.length, "LDR: Range OOB");
		// fill serials array based on offset and limit
		for (uint256 j = _offset; j < _offset + _limit; j++) {
			serials[j] = delegateTokenSerials[j];
		}
    }

	/// @notice Get all serial numbers of a specific token delegated by an owner wallet
	/// @param _ownerWallet The address of the owner wallet
	/// @param _token The address of the NFT collection contract
	/// @return serials Array of serial numbers delegated by this owner for this token
    function getSerialsDelegatedBy(
        address _ownerWallet,
        address _token
    ) external view returns (uint256[] memory serials) {
        if (!walletToTokenDelegations[_ownerWallet].contains(_token)) {
            return new uint256[](0);
        }

		bytes32 ownerDelegateHash = keccak256(abi.encodePacked(_ownerWallet, _token));

        return
            getSerialsDelegatedByRange(
                _ownerWallet,
                _token,
                0,
                delegatedNFTSerialsByHash[ownerDelegateHash].length()
            );
    }

	/// @notice Get a paginated range of serial numbers delegated by an owner wallet
	/// @dev Use this when the full list may be too large to return in one call
	/// @param _ownerWallet The address of the owner wallet
	/// @param _token The address of the NFT collection contract
	/// @param _offset The starting index in the serial list
	/// @param _limit The maximum number of serials to return
	/// @return serials Array of serial numbers within the specified range
    function getSerialsDelegatedByRange(
        address _ownerWallet,
        address _token,
        uint256 _offset,
        uint256 _limit
    ) public view returns (uint256[] memory serials) {
        serials = new uint256[](_limit);
		// get the serial list for the delegate and token
		uint256[] memory ownerDelegateSerials = delegatedNFTSerialsByHash[keccak256(abi.encodePacked(_ownerWallet, _token))].values();
		require(_offset + _limit <= ownerDelegateSerials.length, "LDR: Range OOB");
		// fill serials array based on offset and limit
		for (uint256 j = 0; j < _limit; j++) {
			serials[j] = ownerDelegateSerials[_offset + j];
		}
    }

	/// @notice Get all token addresses that have at least one delegated serial
	/// @return Array of NFT collection contract addresses with active delegations
    function getTokensWithDelegates() external view returns (address[] memory) {
        return tokensWithDelegates.values();
    }

	/// @notice Get the total count of unique NFT collections with delegations
	/// @return Total number of token addresses with at least one delegated serial
    function getTotalTokensWithDelegates() external view returns (uint256) {
        return tokensWithDelegates.length();
    }

	/// @notice Get a paginated range of token addresses with delegations
	/// @dev Use this when the full list may be too large to return in one call
	/// @param _offset The starting index in the token list
	/// @param _limit The maximum number of tokens to return
	/// @return tokens Array of NFT collection contract addresses within the specified range
    function getTokensWithDelegatesRange(
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory tokens) {
		require(_offset + _limit <= tokensWithDelegates.length(), "LDR: Range OOB");
        tokens = new address[](_limit);
        for (uint256 i = 0; i < _limit; i++) {
            tokens[i] = tokensWithDelegates.at(_offset + i);
        }
    }

	/// @notice Get all wallet addresses that have wallet-level delegations
	/// @return Array of wallet addresses with active wallet-level delegations
    function getWalletsWithDelegates()
        external
        view
        returns (address[] memory)
    {
        return walletsWithDelegates.values();
    }

	/// @notice Get the total count of wallets with wallet-level delegations
	/// @return Total number of wallets with active wallet-level delegations
    function getTotalWalletsWithDelegates() external view returns (uint256) {
        return walletsWithDelegates.length();
    }

	/// @notice Get a paginated range of wallet addresses with wallet-level delegations
	/// @dev Use this when the full list may be too large to return in one call
	/// @param _offset The starting index in the wallet list
	/// @param _limit The maximum number of wallets to return
	/// @return wallets Array of wallet addresses within the specified range
    function getWalletsWithDelegatesRange(
        uint256 _offset,
        uint256 _limit
    ) external view returns (address[] memory wallets) {
		require(_offset + _limit <= walletsWithDelegates.length(), "LDR: Range OOB");
        wallets = new address[](_limit);
        for (uint256 i = 0; i < _limit; i++) {
            wallets[i] = walletsWithDelegates.at(_offset + i);
        }
    }
}
