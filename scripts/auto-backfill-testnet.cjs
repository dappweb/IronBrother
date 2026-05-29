/* eslint-disable */
// 自动扫描 + 自动补结算。扫指定天数范围，发现有未结算用户的 day 就用 Bot 私钥跑 botSettleDailyDynamicRewards。
const { createPublicClient, createWalletClient, fallback, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const BOT_PK = "0x2002871ae6cf871ca030706a785b53bba1e2b63cab5b61fe017b20315028e665";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const LOOKBACK = Number(process.env.LOOKBACK || 200);
const BATCH = 50n;

const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAllUsers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "botSettleDailyDynamicRewards", stateMutability: "nonpayable",
    inputs: [{ name: "day", type: "uint256" }, { name: "cursor", type: "uint256" }, { name: "limit", type: "uint256" }],
    outputs: [
      { name: "processed", type: "uint256" }, { name: "rewardedUsers", type: "uint256" },
      { name: "totalReward", type: "uint256" }, { name: "nextCursor", type: "uint256" }, { name: "finished", type: "bool" },
    ],
  },
];

(async () => {
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 20000, retryCount: 2 })));
  const pub = createPublicClient({ chain: bscTestnet, transport });
  const account = privateKeyToAccount(BOT_PK);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });

  const cur = await pub.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const users = await pub.readContract({ address: PROXY, abi: ABI, functionName: "getAllUsers" });
  console.log(`Bot=${account.address}`);
  console.log(`currentLocalDay=${cur}  users=${users.length}  LOOKBACK=${LOOKBACK}\n`);

  const daysToScan = [];
  for (let i = 1n; i <= BigInt(LOOKBACK); i++) daysToScan.push(cur - i);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function withRetry(fn, label) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try { return await fn(); }
      catch (e) {
        if (attempt === 6) throw e;
        const wait = 500 * attempt;
        console.error(`  [retry ${attempt}] ${label}: ${e.shortMessage || e.message}; wait ${wait}ms`);
        await sleep(wait);
      }
    }
  }

  const missingDays = [];
  for (const day of daysToScan) {
    const [settled, volumes] = await withRetry(() => Promise.all([
      pub.multicall({
        contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [u, day] })),
        allowFailure: false, batchSize: 200_000,
      }),
      pub.multicall({
        contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [u, day] })),
        allowFailure: false, batchSize: 200_000,
      }),
    ]), `scan day=${day}`);
    let needWork = 0;
    users.forEach((_, i) => { if (!settled[i] && volumes[i] > 0n) needWork++; });
    if (needWork > 0) {
      missingDays.push({ day, needWork });
      console.log(`  missing day=${day} pending=${needWork}`);
    }
    await sleep(80);
  }

  if (missingDays.length === 0) { console.log("\n✅ 没有遗漏的 day。"); return; }
  console.log(`\n[共 ${missingDays.length} 个 day 需要补结算]\n`);

  let totalTx = 0, totalProcessed = 0n, totalRewarded = 0n, totalReward = 0n;
  for (const { day } of missingDays) {
    let cursor = 0n;
    while (true) {
      const { request, result } = await pub.simulateContract({
        account, address: PROXY, abi: ABI,
        functionName: "botSettleDailyDynamicRewards", args: [day, cursor, BATCH],
      });
      const [processed, rewardedUsers, reward, nextCursor, finished] = result;
      if (processed === 0n) {
        cursor = nextCursor;
        if (finished) break;
        continue;
      }
      const hash = await wallet.writeContract(request);
      const r = await pub.waitForTransactionReceipt({ hash });
      totalTx++; totalProcessed += processed; totalRewarded += rewardedUsers; totalReward += reward;
      console.log(`  day=${day} cursor=${cursor}->${nextCursor} processed=${processed} rewarded=${rewardedUsers} reward=${reward} tx=${hash} block=${r.blockNumber}`);
      cursor = nextCursor;
      if (finished) break;
    }
  }
  console.log(`\n[合计] tx=${totalTx} processed=${totalProcessed} rewarded=${totalRewarded} reward=${(Number(totalReward) / 1e18).toFixed(4)} USDT`);
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
