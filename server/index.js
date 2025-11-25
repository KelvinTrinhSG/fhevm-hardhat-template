/* eslint-disable */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ENV
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RELAYER_URL = process.env.RELAYER_URL;

// Provider + signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// ABI
const raw = JSON.parse(fs.readFileSync("./abi/PrivateScore.json", "utf8"));
const abi = raw.abi;
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

// ===================================================
// 1) Encrypt via Relayer REST API
// ===================================================
async function relayerEncrypt(value) {
  const payload = {
    userAddress: signer.address,
    contractAddress: CONTRACT_ADDRESS,
    data: [{ type: "uint32", value }],
  };

  const res = await axios.post(`${RELAYER_URL}/v1/encrypt`, payload);
  return res.data;
}

// ===================================================
// 2) User Decrypt via Relayer REST API
// ===================================================
async function relayerUserDecrypt(ciphertext) {
  // Step A: get ephemeral NaCl keypair
  const keyRes = await axios.get(`${RELAYER_URL}/v1/generate-keypair`);
  const { privateKey, publicKey } = keyRes.data;

  // Step B: Sign decrypt request using EIP-712
  const start = Math.floor(Date.now() / 1000).toString();
  const duration = "7";

  const eip712Payload = {
    publicKey,
    contractAddresses: [CONTRACT_ADDRESS],
    startTimestamp: start,
    durationDays: duration,
  };

  const typedData = (await axios.post(`${RELAYER_URL}/v1/create-eip712`, eip712Payload)).data;

  const signature = await signer.signTypedData(typedData.domain, typedData.types, typedData.message);

  // Step C: call relayer user decrypt
  const decryptPayload = {
    ciphertexts: [{ handle: ciphertext, contractAddress: CONTRACT_ADDRESS }],
    privateKey,
    publicKey,
    signature: signature.replace("0x", ""),
    contractAddresses: [CONTRACT_ADDRESS],
    userAddress: signer.address,
    startTimestamp: start,
    durationDays: duration,
  };

  const out = await axios.post(`${RELAYER_URL}/v1/user-decrypt`, decryptPayload);
  return out.data[ciphertext];
}

// ===================================================
// GET decrypted score
// ===================================================
app.get("/score/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;

    const ciphertext = await contract.getScore(wallet);

    if (!ciphertext || ciphertext === ethers.ZeroHash) return res.json({ wallet, score: null });

    const score = await relayerUserDecrypt(ciphertext);

    res.json({ wallet, score: Number(score) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================
// POST set encrypted score
// ===================================================
app.post("/score", async (req, res) => {
  try {
    const { wallet, score } = req.body;
    if (!wallet || score === undefined) return res.status(400).json({ error: "wallet + score required" });

    const encrypted = await relayerEncrypt(score);

    const tx = await contract.setScore(wallet, encrypted.handles[0], encrypted.inputProof);

    await tx.wait();

    res.json({ wallet, score, txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});
