import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

// Typechain type nếu bạn đã generate
import { PrivateScore } from "../types";

type Signers = {
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

describe("PrivateScoreSepolia", function () {
  let signers: Signers;
  let privateScore: PrivateScore;
  let privateScoreAddress: string;
  let step = 0;
  let steps = 0;

  function progress(msg: string) {
    console.log(`${++step}/${steps} ${msg}`);
  }

  before(async function () {
    // Nếu đang dùng mock FHEVM (hardhat local), bỏ qua bộ test này
    if (fhevm.isMock) {
      console.warn("This Hardhat test suite can only run on Sepolia Testnet");
      this.skip();
    }

    try {
      const deployment = await deployments.get("PrivateScore");
      privateScoreAddress = deployment.address;
      privateScore = (await ethers.getContractAt("PrivateScore", privateScoreAddress)) as PrivateScore;
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia --tags PrivateScore'";
      throw e;
    }

    const ethSigners = await ethers.getSigners();
    signers = {
      alice: ethSigners[0],
      bob: ethSigners[1],
    };
  });

  beforeEach(() => {
    step = 0;
    steps = 0;
  });

  it("should set and read back Alice's encrypted score", async function () {
    steps = 8;
    this.timeout(4 * 60_000); // 4 phút phòng Sepolia chậm

    const scoreAlice = 123;

    // 1) Encrypt score 123 cho Alice
    progress(`Encrypting '${scoreAlice}' for Alice...`);
    const encryptedAliceScore = await fhevm
      .createEncryptedInput(privateScoreAddress, signers.alice.address)
      .add32(scoreAlice)
      .encrypt();

    // 2) Gọi setScore cho Alice
    progress(
      `Calling setScore(Alice) PrivateScore=${privateScoreAddress} handle=${ethers.hexlify(
        encryptedAliceScore.handles[0],
      )} signer=${signers.alice.address}...`,
    );
    let tx = await privateScore
      .connect(signers.alice)
      .setScore(signers.alice.address, encryptedAliceScore.handles[0], encryptedAliceScore.inputProof);
    await tx.wait();

    // 3) Gọi getScore(Alice) để lấy ciphertext
    progress("Calling getScore(Alice)...");
    const encryptedScoreAlice = await privateScore.getScore(signers.alice.address);
    expect(encryptedScoreAlice).to.not.eq(ethers.ZeroHash);

    // 4) Decrypt lại để kiểm tra
    progress(`Decrypting Alice's score=${encryptedScoreAlice.toString()}...`);
    const clearScoreAlice = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedScoreAlice,
      privateScoreAddress,
      signers.alice,
    );
    progress(`Clear Alice score=${clearScoreAlice}`);

    expect(clearScoreAlice).to.eq(scoreAlice);
  });

  it("should store different private scores for Alice and Bob", async function () {
    steps = 12;
    this.timeout(4 * 60_000);

    const scoreAlice = 50;
    const scoreBob = 999;

    // Encrypt cho Alice
    progress(`Encrypting '${scoreAlice}' for Alice...`);
    const encryptedAliceScore = await fhevm
      .createEncryptedInput(privateScoreAddress, signers.alice.address)
      .add32(scoreAlice)
      .encrypt();

    progress("Calling setScore(Alice)...");
    let tx = await privateScore
      .connect(signers.alice)
      .setScore(signers.alice.address, encryptedAliceScore.handles[0], encryptedAliceScore.inputProof);
    await tx.wait();

    // Encrypt cho Bob
    progress(`Encrypting '${scoreBob}' for Bob...`);
    const encryptedBobScore = await fhevm
      .createEncryptedInput(privateScoreAddress, signers.bob.address)
      .add32(scoreBob)
      .encrypt();

    progress("Calling setScore(Bob)...");
    tx = await privateScore
      .connect(signers.bob)
      .setScore(signers.bob.address, encryptedBobScore.handles[0], encryptedBobScore.inputProof);
    await tx.wait();

    // Lấy encrypted score Alice
    progress("Calling getScore(Alice)...");
    const encryptedScoreAlice = await privateScore.getScore(signers.alice.address);
    // Decrypt về cho Alice
    progress("Decrypting Alice's score...");
    const clearScoreAlice = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedScoreAlice,
      privateScoreAddress,
      signers.alice,
    );
    progress(`Clear Alice score=${clearScoreAlice}`);

    // Lấy encrypted score Bob
    progress("Calling getScore(Bob)...");
    const encryptedScoreBob = await privateScore.getScore(signers.bob.address);
    // Decrypt về cho Bob
    progress("Decrypting Bob's score...");
    const clearScoreBob = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedScoreBob,
      privateScoreAddress,
      signers.bob,
    );
    progress(`Clear Bob score=${clearScoreBob}`);

    // Expect khác nhau & đúng giá trị
    expect(clearScoreAlice).to.eq(scoreAlice);
    expect(clearScoreBob).to.eq(scoreBob);
    expect(clearScoreAlice).to.not.eq(clearScoreBob);
  });
});
