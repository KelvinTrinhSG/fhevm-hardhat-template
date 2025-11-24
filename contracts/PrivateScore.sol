// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PrivateScore (Encrypted Input Only)
/// @notice This contract REQUIRES encrypted score from frontend.
///         You MUST encrypt the score with the relayer before calling setScore().
contract PrivateScore is ZamaEthereumConfig {

    // Each player → encrypted score
    mapping(address => euint32) private _scores;

    /// @notice Get encrypted score (ciphertext handle)
    function getScore(address player) external view returns (euint32) {
        return _scores[player];
    }

    /// @notice Set score for a player using ONLY encrypted input.
    /// @param player Address whose score is updated
    /// @param encryptedScore Ciphertext handle from relayer
    /// @param proof Proof from relayer
    function setScore(
        address player,
        externalEuint32 encryptedScore,
        bytes calldata proof
    ) external {
        /// Import ciphertext into FHE-VM
        euint32 score = FHE.fromExternal(encryptedScore, proof);

        /// Save encrypted score
        _scores[player] = score;

        /// Contract can use this ciphertext in future ops
        FHE.allowThis(_scores[player]);

        /// Player can decrypt this ciphertext
        FHE.allow(_scores[player], player);

        /// Caller (backend) can decrypt — optional
        FHE.allow(_scores[player], msg.sender);
    }
}
