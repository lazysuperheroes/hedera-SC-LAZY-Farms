// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

/**
 * @title ILazyDelegateRegistry
 * @notice Interface for NFT delegation without ownership transfer
 * @dev Allows NFT owners to delegate usage rights to another wallet without
 * transferring the NFT. Useful for staking/farming with cold wallets or
 * lending NFT utility to others. Supports both wallet-level and token-level delegation.
 */
interface ILazyDelegateRegistry {

    /**
     * @notice Emitted when wallet-level delegation changes
     * @param _wallet Owner wallet address
     * @param _delegate Delegate wallet address
     * @param _delegated True if delegating, false if revoking
     */
    event WalletDelegated(address _wallet, address _delegate, bool _delegated);

    /**
     * @notice Emitted when token-level delegation changes
     * @param _token NFT collection address
     * @param _serial Token serial number
     * @param _delegate Address receiving delegation
     * @param _owner Original NFT owner
     * @param _delegated True if delegating, false if revoking
     */
    event TokenDelegated(
        address _token,
        uint256 _serial,
        address _delegate,
        address _owner,
        bool _delegated
    );

    /**
     * @notice Thrown when caller is not the NFT owner
     * @param _owner Actual owner address
     * @param _delegate Address that attempted the action
     */
    error LazyDelegateRegistryOnlyOwner(address _owner, address _delegate);

    /**
     * @notice Thrown when array lengths don't match in batch operations
     * @param _expected Expected array length
     * @param _actual Actual array length provided
     */
	error BadArgumentLength(uint256 _expected, uint256 _actual);

    /**
     * @notice Delegate another wallet to act on caller's behalf (wallet-level)
     * @dev Only one delegate wallet can be set per owner. Overwrites previous delegation.
     * @param _delegate Address to grant delegation rights
     */
    function delegateWalletTo(address _delegate) external;

    /**
     * @notice Remove wallet-level delegation
     * @dev Caller revokes their current wallet delegate
     */
    function revokeDelegateWallet() external;

    /**
     * @notice Get the delegate wallet for an owner
     * @param _wallet Owner wallet to query
     * @return delegate Delegate address or zero address if none set
     */
    function getDelegateWallet(
        address _wallet
    ) external view returns (address delegate);

    /**
     * @notice Check if a wallet is delegated to another
     * @param _actualWallet Owner wallet address
     * @param _proposedDelegate Address to check delegation for
     * @return True if _proposedDelegate is delegated by _actualWallet
     */
    function checkDelegateWallet(
        address _actualWallet,
        address _proposedDelegate
    ) external view returns (bool);

    /**
     * @notice Check if delegate can act on behalf of a specific NFT
     * @dev Two-stage check: (1) Is token delegated to _proposedDelegate or another wallet?
     * (2) If another wallet, can _proposedDelegate act on behalf of that wallet?
     * @param _proposedDelegate Address to check delegation for
     * @param _token NFT collection address
     * @param _serial Token serial number
     * @return True if _proposedDelegate can use this NFT
     */
    function checkDelegateToken(
        address _proposedDelegate,
        address _token,
        uint256 _serial
    ) external view returns (bool);

    /**
     * @notice Get all wallets that have delegated to a specific wallet
     * @param _delegateWallet Address to query delegations for
     * @return Array of wallet addresses that have delegated to _delegateWallet
     */
    function getWalletsDelegatedTo(
        address _delegateWallet
    ) external view returns (address[] memory);

    /**
     * @notice Delegate specific NFT serials to another wallet
     * @dev Caller must own the NFTs. Allows delegation even while NFT is in a contract.
     * @param _delegate Address to receive delegation rights
     * @param _token NFT collection address
     * @param _serials Array of serial numbers to delegate
     */
    function delegateNFT(
        address _delegate,
        address _token,
        uint256[] memory _serials
    ) external;

    /**
     * @notice Batch delegate multiple NFTs from different collections
     * @dev Caller must own all NFTs. Arrays must have matching lengths.
     * @param _delegate Address to receive delegation rights
     * @param _tokens Array of NFT collection addresses
     * @param _serials 2D array of serial numbers per collection
     */
    function delegateNFTs(
        address _delegate,
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external;

    /**
     * @notice Get the delegate address for a specific NFT
     * @param _token NFT collection address
     * @param _serial Token serial number
     * @return Address that has delegation rights (zero if none)
     */
    function getNFTDelegatedTo(
        address _token,
        uint256 _serial
    ) external view returns (address);

    /**
     * @notice Batch get delegates for multiple NFTs
     * @param _tokens Array of NFT collection addresses
     * @param _serials 2D array of serial numbers per collection
     * @return 2D array of delegate addresses per token/serial
     */
    function getNFTListDelegatedTo(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external view returns (address[][] memory);

    /**
     * @notice Revoke delegation for specific NFT serials
     * @dev Only callable by original owner who created the delegation
     * @param _token NFT collection address
     * @param _serial Array of serial numbers to revoke
     */
    function revokeDelegateNFT(address _token, uint256[] memory _serial) external;

    /**
     * @notice Batch revoke delegations for multiple NFTs
     * @dev Arrays must have matching lengths
     * @param _tokens Array of NFT collection addresses
     * @param _serials 2D array of serial numbers per collection
     */
    function revokeDelegateNFTs(
        address[] memory _tokens,
        uint256[][] memory _serials
    ) external;

    /**
     * @notice Get all NFTs delegated to a specific wallet
     * @param _delegate Address to query delegations for
     * @return tokens Array of NFT collection addresses
     * @return serials 2D array of serial numbers per collection
     */
    function getNFTsDelegatedTo(
        address _delegate
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials);

    /**
     * @notice Get all NFTs delegated by a specific owner
     * @param _ownerWallet Owner address to query
     * @param _includeSerials If true, return serial arrays; false for just collections
     * @return tokens Array of NFT collection addresses
     * @return serials 2D array of serial numbers (empty if _includeSerials is false)
     */
    function getDelegatedNFTsBy(
        address _ownerWallet,
        bool _includeSerials
    )
        external
        view
        returns (address[] memory tokens, uint256[][] memory serials);

    /**
     * @notice Get serials delegated to a wallet for a specific collection
     * @param _delegate Delegate wallet address
     * @param _token NFT collection address
     * @return serials Array of serial numbers delegated to _delegate
     */
    function getSerialsDelegatedTo(
        address _delegate,
        address _token
    ) external view returns (uint256[] memory serials);

    /**
     * @notice Get serials delegated by an owner for a specific collection
     * @param _ownerWallet Owner wallet address
     * @param _token NFT collection address
     * @return serials Array of serial numbers delegated by owner
     */
    function getSerialsDelegatedBy(
        address _ownerWallet,
        address _token
    ) external view returns (uint256[] memory serials);

    /**
     * @notice Get serials delegated by owner with pagination
     * @param _ownerWallet Owner wallet address
     * @param _token NFT collection address
     * @param _from Starting index (0-based)
     * @param _to Ending index (exclusive)
     * @return serials Paginated array of serial numbers
     */
    function getSerialsDelegatedByRange(
        address _ownerWallet,
        address _token,
        uint256 _from,
        uint256 _to
    ) external view returns (uint256[] memory serials);

    /**
     * @notice Get all token collections that have active delegations
     * @return tokens Array of collection addresses with delegations
     */
    function getTokensWithDelegates()
        external
        view
        returns (address[] memory tokens);

    /**
     * @notice Get token collections with delegations (paginated)
     * @param _from Starting index (0-based)
     * @param _to Ending index (exclusive)
     * @return tokens Paginated array of collection addresses
     */
    function getTokensWithDelegatesRange(
        uint256 _from,
        uint256 _to
    ) external view returns (address[] memory tokens);

    /**
     * @notice Get total count of token collections with delegations
     * @return Total number of collections with active delegations
     */
    function getTotalTokensWithDelegates() external view returns (uint256);

    /**
     * @notice Get all wallets that have active delegations
     * @return wallets Array of wallet addresses with delegations
     */
    function getWalletsWithDelegates()
        external
        view
        returns (address[] memory wallets);

    /**
     * @notice Get wallets with delegations (paginated)
     * @param _from Starting index (0-based)
     * @param _to Ending index (exclusive)
     * @return wallets Paginated array of wallet addresses
     */
    function getWalletsWithDelegatesRange(
        uint256 _from,
        uint256 _to
    ) external view returns (address[] memory wallets);

    /**
     * @notice Get total count of wallets with delegations
     * @return Total number of wallets with active delegations
     */
    function getTotalWalletsWithDelegates() external view returns (uint256);
}
