const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "logs");
const STATE_FILE = path.join(STATE_DIR, "dynamic-settlement-state.json");

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn("Failed to persist settlement state:", error?.message || error);
  }
}

function parsePositiveInt(value, fallback, name) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeBigInt(value, fallback, name) {
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function formatToken(value) {
  return hre.ethers.formatUnits(value, 18);
}

async function main() {
  const proxyAddress =
    process.env.IRONBROTHER_PROXY ||
    process.env.VITE_CRUDETRUST_CONTRACT_ADDRESS ||
    process.env.VITE_IRONBROTHER_CONTRACT_ADDRESS;
  if (!proxyAddress || !hre.ethers.isAddress(proxyAddress)) {
    throw new Error("Set IRONBROTHER_PROXY to the deployed proxy address");
  }

  const [operator] = await hre.ethers.getSigners();
  const ironBrother = await hre.ethers.getContractAt("IronBrother", proxyAddress);
  const currentLocalDay = await ironBrother.currentLocalDay();
  const day = process.env.DYNAMIC_SETTLEMENT_DAY
    ? parseNonNegativeBigInt(process.env.DYNAMIC_SETTLEMENT_DAY, 0n, "DYNAMIC_SETTLEMENT_DAY")
    : currentLocalDay - 1n;
  const batchSize = BigInt(parsePositiveInt(process.env.DYNAMIC_SETTLEMENT_BATCH_SIZE, 50, "DYNAMIC_SETTLEMENT_BATCH_SIZE"));
  const maxBatches = parsePositiveInt(process.env.DYNAMIC_SETTLEMENT_MAX_BATCHES, 10_000, "DYNAMIC_SETTLEMENT_MAX_BATCHES");

  const state = loadState();
  const stateKey = `${proxyAddress.toLowerCase()}:${day.toString()}`;
  const persistedCursor = state[stateKey]?.nextCursor;
  let cursor = parseNonNegativeBigInt(
    process.env.DYNAMIC_SETTLEMENT_START_CURSOR ?? persistedCursor,
    0n,
    "DYNAMIC_SETTLEMENT_START_CURSOR",
  );

  if (day >= currentLocalDay) {
    throw new Error(`Dynamic settlement day ${day} is not closed. Current local day is ${currentLocalDay}.`);
  }

  const maxBatchSize = await ironBrother.MAX_BOT_SETTLEMENT_BATCH();
  if (batchSize > maxBatchSize) {
    throw new Error(`DYNAMIC_SETTLEMENT_BATCH_SIZE must be <= ${maxBatchSize.toString()}`);
  }

  console.log("Dynamic reward settlement bot");
  console.log("Contract:", proxyAddress);
  console.log("Operator:", operator.address);
  console.log("Local day:", day.toString());
  console.log("Batch size:", batchSize.toString());

  let processedTotal = 0n;
  let rewardedUsersTotal = 0n;
  let rewardTotal = 0n;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const preview = await ironBrother.botSettleDailyDynamicRewards.staticCall(day, cursor, batchSize);
    const processed = preview[0];
    const rewardedUsers = preview[1];
    const totalReward = preview[2];
    const nextCursor = preview[3];
    const finished = preview[4];

    if (processed === 0n) {
      // No work in this slice – skip the on-chain tx to avoid wasting gas.
      console.log(
        `Batch ${batch + 1}: skip (no pending users) cursor=${cursor.toString()} next=${nextCursor.toString()} finished=${finished}`,
      );
      cursor = nextCursor;
      state[stateKey] = { nextCursor: cursor.toString(), finished, updatedAt: new Date().toISOString() };
      saveState(state);
      if (finished) {
        console.log("Finished:", {
          processed: processedTotal.toString(),
          rewardedUsers: rewardedUsersTotal.toString(),
          reward: formatToken(rewardTotal),
          nextCursor: cursor.toString(),
        });
        return;
      }
      continue;
    }

    const tx = await ironBrother.botSettleDailyDynamicRewards(day, cursor, batchSize);
    await tx.wait();

    processedTotal += processed;
    rewardedUsersTotal += rewardedUsers;
    rewardTotal += totalReward;

    console.log(
      `Batch ${batch + 1}: tx=${tx.hash} cursor=${cursor.toString()} next=${nextCursor.toString()} processed=${processed.toString()} rewarded=${rewardedUsers.toString()} reward=${formatToken(totalReward)}`
    );

    cursor = nextCursor;
    state[stateKey] = { nextCursor: cursor.toString(), finished, updatedAt: new Date().toISOString() };
    saveState(state);
    if (finished) {
      console.log("Finished:", {
        processed: processedTotal.toString(),
        rewardedUsers: rewardedUsersTotal.toString(),
        reward: formatToken(rewardTotal),
        nextCursor: cursor.toString(),
      });
      return;
    }
  }

  state[stateKey] = { nextCursor: cursor.toString(), finished: false, updatedAt: new Date().toISOString() };
  saveState(state);
  throw new Error(`Stopped after DYNAMIC_SETTLEMENT_MAX_BATCHES=${maxBatches}. Resume with DYNAMIC_SETTLEMENT_START_CURSOR=${cursor.toString()}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
