// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ILazyNFTStaking } from "../interfaces/ILazyNFTStaking.sol";

library LazyStakingSignatureVerifier {
	function getMessageHash(
		address _sender,
		uint _boostRate,
		ILazyNFTStaking.Stake[] memory _stakes,
		uint _nonce
	) internal pure returns (bytes32) {
		// create a bytes32 array with the length of the stakes array
		bytes32[] memory stakesBytes32 = new bytes32[](_stakes.length);
		// iterate over the stakes array and convert each stake to bytes32
		for (uint i = 0; i < _stakes.length; i++) {
			stakesBytes32[i] = keccak256(abi.encodePacked(_stakes[i].collection, _stakes[i].serials, _stakes[i].rewards));
		}
		// return the keccak256 hash of the to address, amount, stakes array, and nonce
		return keccak256(abi.encodePacked(_sender, _boostRate, stakesBytes32, _nonce));
	}

	function verify(
		address _signer,
		address _sender,
		uint _boostRate,
		ILazyNFTStaking.Stake[] memory _stakes,
		bytes memory signature,
		uint _nonce
	) internal pure returns (bool) {
		bytes32 messageHash = getMessageHash(_sender, _boostRate, _stakes, _nonce);
		bytes32 ethSignedMessageHash = ECDSA.toEthSignedMessageHash(messageHash);

		return ECDSA.recover(ethSignedMessageHash, signature) == _signer;
	}
}