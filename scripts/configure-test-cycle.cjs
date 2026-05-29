const fs = require("fs");
const path = require("path");
require("./load-env.cjs");
const { ethers } = require("ethers");

const TARGET_CHAIN_ID = 97n;
const TARGET_SETTLEMENT_CYCLE = 30n * 60n;
const TARGET_MORNING_START = 0n;
const TARGET_MORNING_END = 15n * 60n;
const TARGET_AFTERNOON_START = 15n * 60n;
const TARGET_AFTERNOON_END = 30n * 60n;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8"));
}

function resolveRpcUrl() {
  return (
    process.env.BSC_TESTNET_RPC_URL ||
    process.env.VITE_BSC_TESTNET_RPC_URL ||
    process.env.BSC_RPC_URL ||
    process.env.VITE_BSC_RPC_URL
  );
}

async function waitAndLog(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label} tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label} confirmed in block: ${receipt.blockNumber}`);
}

async function main() {
  const deployment = readJson(path.join("deployments", "bsc-testnet.json"));
  const artifact = readJson(path.join("artifacts", "contracts", "IronBrother.sol", "IronBrother.json"));
  const rpcUrl = resolveRpcUrl();
  const privateKey = process.env.PRIVATE_KEY;
  const contractAddress =
    process.env.IRONBROTHER_PROXY ||
    process.env.VITE_IRONBROTHER_CONTRACT_ADDRESS ||
    deployment.ironBrotherProxy;

  if (!rpcUrl) {
    throw new Error("Missing BSC testnet RPC URL. Set BSC_TESTNET_RPC_URL or VITE_BSC_TESTNET_RPC_URL.");
  }
  if (!privateKey) {
    throw new Error("Missing PRIVATE_KEY. Set the super admin wallet private key in .env.local before running this script.");
  }
  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`Invalid IronBrother proxy address: ${contractAddress}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== TARGET_CHAIN_ID) {
    throw new Error(`Expected BSC Testnet chainId ${TARGET_CHAIN_ID}, got ${network.chainId}`);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const ironBrother = new ethers.Contract(contractAddress, artifact.abi, wallet);
  const adminRole = await ironBrother.DEFAULT_ADMIN_ROLE();
  const hasAdminRole = await ironBrother.hasRole(adminRole, wallet.address);
  if (!hasAdminRole) {
    throw new Error(`Signer ${wallet.address} is not the IronBrother super admin`);
  }

  const currentSettlementCycle = await ironBrother.settlementCycle();
  const currentMorningStart = await ironBrother.morningStart();
  const currentMorningEnd = await ironBrother.morningEnd();
  const currentAfternoonStart = await ironBrother.afternoonStart();
  const currentAfternoonEnd = await ironBrother.afternoonEnd();

  console.log("IronBrother test cycle configuration");
  console.log("Proxy:", contractAddress);
  console.log("Signer:", wallet.address);
  console.log("Target settlement cycle:", TARGET_SETTLEMENT_CYCLE.toString());
  console.log("Target sessions:", [
    TARGET_MORNING_START,
    TARGET_MORNING_END,
    TARGET_AFTERNOON_START,
    TARGET_AFTERNOON_END,
  ].map((value) => value.toString()).join(", "));

  if (currentSettlementCycle !== TARGET_SETTLEMENT_CYCLE) {
    await waitAndLog("setSettlementCycle", ironBrother.setSettlementCycle(TARGET_SETTLEMENT_CYCLE));
  } else {
    console.log("setSettlementCycle skipped: already configured");
  }

  const sessionsMatch =
    currentMorningStart === TARGET_MORNING_START &&
    currentMorningEnd === TARGET_MORNING_END &&
    currentAfternoonStart === TARGET_AFTERNOON_START &&
    currentAfternoonEnd === TARGET_AFTERNOON_END;

  if (!sessionsMatch) {
    await waitAndLog(
      "setSessionTimes",
      ironBrother.setSessionTimes(
        Number(TARGET_MORNING_START),
        Number(TARGET_MORNING_END),
        Number(TARGET_AFTERNOON_START),
        Number(TARGET_AFTERNOON_END),
      ),
    );
  } else {
    console.log("setSessionTimes skipped: already configured");
  }

  const [session, settleAt] = await ironBrother.currentSession();
  console.log("Final settlement cycle:", (await ironBrother.settlementCycle()).toString());
  console.log("Final sessions:", [
    await ironBrother.morningStart(),
    await ironBrother.morningEnd(),
    await ironBrother.afternoonStart(),
    await ironBrother.afternoonEnd(),
  ].map((value) => value.toString()).join(", "));
  console.log("Current local day:", (await ironBrother.currentLocalDay()).toString());
  console.log("Current session:", session.toString());
  console.log("Current session settleAt:", settleAt.toString());
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
