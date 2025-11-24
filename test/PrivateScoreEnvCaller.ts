import { ethers, fhevm, deployments } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import * as dotenv from "dotenv";

dotenv.config();

describe("PrivateScore (Env Caller)", function () {
  let contract: any;
  let contractAddress: string;
  let caller: any;

  // Load test parameters from ENV
  const PRIVATE_KEY = process.env.PRIVATE_KEY!;
  const WALLET_A = process.env.WALLET_A!;
  const WALLET_B = process.env.WALLET_B!;
  const SCORE_A = Number(process.env.SCORE_A!);
  const SCORE_B = Number(process.env.SCORE_B!);

  function log(msg: string) {
    console.log(`→ ${msg}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn("⚠ This test must run on Sepolia (not Mock FHEVM). Skipping.");
      this.skip();
    }

    // Create signer from PRIVATE_KEY
    caller = new ethers.Wallet(PRIVATE_KEY, ethers.provider);

    log(`Using signer: ${caller.address}`);

    try {
      const deployment = await deployments.get("PrivateScore");
      contractAddress = deployment.address;
      contract = await ethers.getContractAt("PrivateScore", contractAddress, caller);
      log(`Loaded PrivateScore at: ${contractAddress}`);
    } catch (e) {
      throw new Error(
        "❌ Could not load PrivateScore deployment. Run:\n" +
          "npx hardhat deploy --network sepolia --tags PrivateScore",
      );
    }
  });

  it("should store private scores for WALLET_A and WALLET_B", async function () {
    this.timeout(4 * 60_000);

    log(`Encrypting score ${SCORE_A} for ${WALLET_A}`);
    const encryptedA = await fhevm.createEncryptedInput(contractAddress, caller.address).add32(SCORE_A).encrypt();

    log("Calling setScore() for WALLET_A...");
    let tx = await contract.setScore(WALLET_A, encryptedA.handles[0], encryptedA.inputProof);
    await tx.wait();

    // -------- WALLET B --------
    log(`Encrypting score ${SCORE_B} for ${WALLET_B}`);
    const encryptedB = await fhevm.createEncryptedInput(contractAddress, caller.address).add32(SCORE_B).encrypt();

    log("Calling setScore() for WALLET_B...");
    tx = await contract.setScore(WALLET_B, encryptedB.handles[0], encryptedB.inputProof);
    await tx.wait();

    // ----- READ + DECRYPT WALLET A -----
    log("Reading encrypted score for WALLET_A...");
    const encA = await contract.getScore(WALLET_A);

    log("Decrypting WALLET_A score...");
    const clearA = await fhevm.userDecryptEuint(FhevmType.euint32, encA, contractAddress, caller);
    log(`WALLET_A decrypted score = ${clearA}`);

    // ----- READ + DECRYPT WALLET B -----
    log("Reading encrypted score for WALLET_B...");
    const encB = await contract.getScore(WALLET_B);

    log("Decrypting WALLET_B score...");
    const clearB = await fhevm.userDecryptEuint(FhevmType.euint32, encB, contractAddress, caller);
    log(`WALLET_B decrypted score = ${clearB}`);

    // ---- ASSERTIONS ----
    expect(clearA).to.eq(SCORE_A);
    expect(clearB).to.eq(SCORE_B);
    expect(clearA).to.not.eq(clearB);
  });
});
