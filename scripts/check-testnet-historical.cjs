/* eslint-disable */
// 扫描测试网历史天，找出还有未结算用户的 day
const { createPublicClient, fallback, http } = require("viem");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const LOOKBACK_DAYS = Number(process.env.LOOKBACK || 96); // 30min/day → 96 = 2 天

const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAllUsers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
];

(async () => {
  const client = createPublicClient({ chain: bscTestnet, transport: fallback(RPCS.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const cur = await client.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const users = await client.readContract({ address: PROXY, abi: ABI, functionName: "getAllUsers" });
  console.log(`currentLocalDay=${cur}  users=${users.length}  scanning last ${LOOKBACK_DAYS} days (excl current)`);

  // 目标日 = cur-1 ... cur-LOOKBACK_DAYS
  const days = [];
  for (let i = 1n; i <= BigInt(LOOKBACK_DAYS); i++) days.push(cur - i);

  const rows = [];
  for (const day of days) {
    const settled = await client.multicall({
      contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [u, day] })),
      allowFailure: false, batchSize: 200_000,
    });
    const volumes = await client.multicall({
      contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [u, day] })),
      allowFailure: false, batchSize: 200_000,
    });
    let unsettled = 0, unsettledWithStake = 0;
    const list = [];
    users.forEach((u, i) => {
      if (!settled[i]) {
        unsettled++;
        if (volumes[i] > 0n) { unsettledWithStake++; list.push(u); }
      }
    });
    rows.push({ day: day.toString(), unsettled, unsettledWithStake, list });
  }

  console.log(`\nday              未结算用户数   其中当日有质押(实际需要发奖的)`);
  rows.forEach((r) => console.log(`  ${r.day.padStart(8)}    ${String(r.unsettled).padStart(6)}        ${String(r.unsettledWithStake).padStart(6)}`));

  const needWork = rows.filter((r) => r.unsettledWithStake > 0);
  console.log(`\n[需要补结算的 day 数] ${needWork.length}`);
  needWork.forEach((r) => {
    console.log(`  day=${r.day}  待结算用户=${r.unsettledWithStake}`);
    r.list.slice(0, 5).forEach((u) => console.log(`    ${u}`));
    if (r.list.length > 5) console.log(`    ...还有 ${r.list.length - 5} 个`);
  });
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
