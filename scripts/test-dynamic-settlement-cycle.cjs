const hre = require("hardhat");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];

function parsePositiveInt(value, fallback, name) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function formatToken(value) {
  return hre.ethers.formatUnits(value, 18);
}

function userDynamicReward(userTuple) {
  return userTuple[7];
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTx(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label}: ${tx.hash}`);
  return tx.wait();
}

async function restoreTestConfig(contract, originalCycle, originalSessionConfig) {
  if ((await contract.settlementCycle()) !== originalCycle) {
    await waitForTx("restore settlement cycle", contract.setSettlementCycle(originalCycle));
  }

  const currentSessionConfig = [
    await contract.morningStart(),
    await contract.morningEnd(),
    await contract.afternoonStart(),
    await contract.afternoonEnd(),
  ];
  const sessionNeedsRestore = currentSessionConfig.some((value, index) => value !== originalSessionConfig[index]);
  if (sessionNeedsRestore) {
    await waitForTx(
      "restore session times",
      contract.setSessionTimes(
        originalSessionConfig[0],
        originalSessionConfig[1],
        originalSessionConfig[2],
        originalSessionConfig[3],
      ),
    );
  }
}

async function waitUntilDayClosed(contract, day, pollMs) {
  for (;;) {
    const currentDay = await contract.currentLocalDay();
    if (currentDay > day) return currentDay;
    const latest = await hre.ethers.provider.getBlock("latest");
    console.log(`Waiting for settlement cycle to close: current=${currentDay.toString()} target>${day.toString()} blockTime=${latest.timestamp}`);
    await wait(pollMs);
  }
}

async function waitForCycleMargin(cycleSeconds, pollMs) {
  const cycle = BigInt(cycleSeconds);
  for (;;) {
    const latest = await hre.ethers.provider.getBlock("latest");
    const localSecond = Number((BigInt(latest.timestamp) + 8n * 60n * 60n) % cycle);
    if (localSecond < cycleSeconds - 30) {
      return localSecond;
    }
    console.log(`Waiting for next test cycle before staking: localSecond=${localSecond}/${cycleSeconds}`);
    await wait(pollMs);
  }
}

async function main() {
  const proxyAddress =
    process.env.IRONBROTHER_PROXY ||
    process.env.VITE_CRUDETRUST_CONTRACT_ADDRESS ||
    process.env.VITE_IRONBROTHER_CONTRACT_ADDRESS;
  if (!proxyAddress || !hre.ethers.isAddress(proxyAddress)) {
    throw new Error("Set IRONBROTHER_PROXY to the deployed proxy address");
  }

  const cycleSeconds = parsePositiveInt(process.env.DYNAMIC_TEST_SETTLEMENT_CYCLE_SECONDS, 120, "DYNAMIC_TEST_SETTLEMENT_CYCLE_SECONDS");
  if (cycleSeconds < 60 || cycleSeconds > 24 * 60 * 60) {
    throw new Error("DYNAMIC_TEST_SETTLEMENT_CYCLE_SECONDS must be between 60 and 86400");
  }
  const halfCycle = Math.floor(cycleSeconds / 2);
  if (halfCycle <= 0 || halfCycle >= cycleSeconds) {
    throw new Error("Invalid settlement cycle");
  }

  const stakeAmount = hre.ethers.parseUnits(process.env.DYNAMIC_TEST_STAKE_AMOUNT || "1000", 18);
  const childBnbTopUp = hre.ethers.parseEther(process.env.DYNAMIC_TEST_CHILD_BNB || "0.02");
  const pollMs = parsePositiveInt(process.env.DYNAMIC_TEST_POLL_MS, 5_000, "DYNAMIC_TEST_POLL_MS");
  const restoreConfig = process.env.DYNAMIC_TEST_RESTORE_CONFIG !== "false";

  const [admin] = await hre.ethers.getSigners();
  const randomChild = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const child = process.env.DYNAMIC_TEST_CHILD_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.DYNAMIC_TEST_CHILD_PRIVATE_KEY, hre.ethers.provider)
    : randomChild;

  const ironBrother = await hre.ethers.getContractAt("IronBrother", proxyAddress, admin);
  const usdtAddress = await ironBrother.usdt();
  const usdtAdmin = await hre.ethers.getContractAt(ERC20_ABI, usdtAddress, admin);
  const usdtChild = usdtAdmin.connect(child);
  const originalCycle = await ironBrother.settlementCycle();
  const originalSessionConfig = [
    await ironBrother.morningStart(),
    await ironBrother.morningEnd(),
    await ironBrother.afternoonStart(),
    await ironBrother.afternoonEnd(),
  ];

  console.log("Dynamic reward cycle test");
  console.log("Contract:", proxyAddress);
  console.log("Admin/upline:", admin.address);
  console.log("Child/source:", child.address);
  console.log("USDT:", usdtAddress);
  console.log("Settlement cycle seconds:", cycleSeconds);
  console.log("Stake amount:", formatToken(stakeAmount));
  console.log("Restore config after test:", restoreConfig);

  try {
    const adminBefore = await ironBrother.users(admin.address);
    const totalDynamicBefore = await ironBrother.totalDynamicRewardCredited();

    if ((await ironBrother.settlementCycle()) !== BigInt(cycleSeconds)) {
      await waitForTx("setSettlementCycle", ironBrother.setSettlementCycle(cycleSeconds));
    }

    const sessionConfig = [
      await ironBrother.morningStart(),
      await ironBrother.morningEnd(),
      await ironBrother.afternoonStart(),
      await ironBrother.afternoonEnd(),
    ];
    const desiredSessionConfig = [0n, BigInt(halfCycle), BigInt(halfCycle), BigInt(cycleSeconds)];
    const sessionNeedsUpdate = sessionConfig.some((value, index) => value !== desiredSessionConfig[index]);
    if (sessionNeedsUpdate) {
      await waitForTx("setSessionTimes", ironBrother.setSessionTimes(0, halfCycle, halfCycle, cycleSeconds));
    }

    const childBnb = await hre.ethers.provider.getBalance(child.address);
    if (childBnb < childBnbTopUp / 4n) {
      await waitForTx("fund child BNB", admin.sendTransaction({ to: child.address, value: childBnbTopUp }));
    }

    const childUsdt = await usdtAdmin.balanceOf(child.address);
    if (childUsdt < stakeAmount) {
      await waitForTx("fund child USDT", usdtAdmin.transfer(child.address, stakeAmount - childUsdt));
    }

    const allowance = await usdtChild.allowance(child.address, proxyAddress);
    if (allowance < stakeAmount) {
      await waitForTx("child approve", usdtChild.approve(proxyAddress, stakeAmount));
    }

    await waitForTx("child deposit", ironBrother.connect(child).deposit(stakeAmount, admin.address));

    await waitForCycleMargin(cycleSeconds, pollMs);

    const session = await ironBrother.currentSession();
    if (session[0] === 0n || session[0] === 0) {
      throw new Error("Staking window is closed after setting test session times");
    }

    const day = await ironBrother.currentLocalDay();
    const nextStakeOrderId = await ironBrother.nextStakeOrderId();
    await waitForTx("child stake", ironBrother.connect(child).stake(stakeAmount));

    const volume = await ironBrother.dailyStakeVolume(child.address, day);
    const directValid = await ironBrother.dailyDirectValidCount(admin.address, day);
    if (volume < stakeAmount || directValid < 1n) {
      throw new Error(`Test setup failed: volume=${formatToken(volume)} directValid=${directValid.toString()}`);
    }

    const closedDay = await waitUntilDayClosed(ironBrother, day, pollMs);
    console.log("Cycle closed:", { settledDay: day.toString(), currentDay: closedDay.toString() });

    const botReceipt = await waitForTx("botSettleDailyDynamicRewards", ironBrother.botSettleDailyDynamicRewards(day, 0, 100));
    await waitForTx("settleStake", ironBrother.settleStake(nextStakeOrderId));

    const adminAfter = await ironBrother.users(admin.address);
    const totalDynamicAfter = await ironBrother.totalDynamicRewardCredited();
    const rewardDelta = userDynamicReward(adminAfter) - userDynamicReward(adminBefore);
    const totalDynamicDelta = totalDynamicAfter - totalDynamicBefore;

    const parsedEvents = botReceipt.logs
      .map((log) => {
        try {
          return ironBrother.interface.parseLog(log);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);
    const dynamicEvents = parsedEvents.filter((event) => event.name === "DynamicRewardSettled");
    const botEvents = parsedEvents.filter((event) => event.name === "DynamicRewardBotSettled");

    console.log("DynamicRewardSettled events:", dynamicEvents.map((event) => ({
      source: event.args.source,
      upline: event.args.upline,
      day: event.args.day.toString(),
      generation: event.args.generation.toString(),
      volume: formatToken(event.args.volume),
      reward: formatToken(event.args.reward),
    })));
    console.log("DynamicRewardBotSettled events:", botEvents.map((event) => ({
      processed: event.args.processed.toString(),
      rewardedUsers: event.args.rewardedUsers.toString(),
      totalReward: formatToken(event.args.totalReward),
      finished: event.args.finished,
    })));

    if (rewardDelta <= 0n || totalDynamicDelta <= 0n || dynamicEvents.length === 0) {
      throw new Error(`Dynamic reward test failed: rewardDelta=${formatToken(rewardDelta)} totalDynamicDelta=${formatToken(totalDynamicDelta)}`);
    }

    console.log("Dynamic reward test passed:", {
      upline: admin.address,
      source: child.address,
      day: day.toString(),
      rewardDelta: formatToken(rewardDelta),
      totalDynamicDelta: formatToken(totalDynamicDelta),
    });
  } finally {
    if (restoreConfig) {
      await restoreTestConfig(ironBrother, originalCycle, originalSessionConfig);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
