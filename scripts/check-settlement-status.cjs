/* eslint-disable */
const { createPublicClient, http, formatUnits } = require("viem");
const { bsc } = require("viem/chains");

const { fallback } = require("viem");
const PROXY = "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3";
const RPC_LIST = (process.env.BSC_RPC_URLS || [
  "https://bnb-mainnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc.blockpi.network/v1/rpc/3cdd4d74c303c44bfeda86bb6fc55e9d6e23341f",
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAllUsers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "users", stateMutability: "view", inputs: [{ type: "address" }], outputs: [
    { name: "referrer", type: "address" },
    { name: "principalBalance", type: "uint256" },
    { name: "principalStaked", type: "uint256" },
    { name: "rewardBalance", type: "uint256" },
    { name: "totalDeposited", type: "uint256" },
    { name: "totalStaked", type: "uint256" },
    { name: "totalStaticReward", type: "uint256" },
    { name: "totalDynamicReward", type: "uint256" },
    { name: "totalWithdrawn", type: "uint256" },
    { name: "directCount", type: "uint256" },
    { name: "registered", type: "bool" },
    { name: "whitelist40", type: "bool" },
  ] },
];

(async () => {
  const client = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const day = (await client.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" })) - 1n;
  const users = await client.readContract({ address: PROXY, abi: ABI, functionName: "getAllUsers" });
  console.log(`targetDay=${day}  totalRegisteredUsers=${users.length}`);

  const settledFlags = await client.multicall({
    contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [u, day] })),
    allowFailure: false,
    batchSize: 200_000,
  });
  const volumes = await client.multicall({
    contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [u, day] })),
    allowFailure: false,
    batchSize: 200_000,
  });
  const accounts = await client.multicall({
    contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "users", args: [u] })),
    allowFailure: false,
    batchSize: 200_000,
  });

  let settled = 0, unsettled = 0, withStake = 0, withReward = 0;
  let totalRewardBalance = 0n;
  const unsettledList = [];
  const rewardList = [];

  users.forEach((u, i) => {
    if (settledFlags[i]) settled++; else { unsettled++; unsettledList.push({ user: u, stake: formatUnits(volumes[i], 18) }); }
    if (volumes[i] > 0n) withStake++;
    const rb = accounts[i][3];
    if (rb > 0n) {
      withReward++;
      totalRewardBalance += rb;
      rewardList.push({ user: u, reward: formatUnits(rb, 18) });
    }
  });

  console.log(`\n[Day ${day} 动态结算标记]`);
  console.log(`  已结算 settled=true : ${settled}`);
  console.log(`  未结算 settled=false: ${unsettled}`);
  console.log(`  当日有质押的用户数 (dailyStakeVolume>0): ${withStake}`);
  if (unsettledList.length) {
    console.log(`  未结算明细:`);
    unsettledList.slice(0, 50).forEach((r) => console.log(`    ${r.user}  当日质押=${r.stake}`));
    if (unsettledList.length > 50) console.log(`    ...还有 ${unsettledList.length - 50} 个`);
  }

  console.log(`\n[rewardBalance 余额（用户可领取的静态+动态累计）]`);
  console.log(`  有余额用户: ${withReward}`);
  console.log(`  合计可领: ${formatUnits(totalRewardBalance, 18)} USDT`);
  if (rewardList.length) {
    console.log(`  Top 10 未领:`);
    rewardList.sort((a, b) => Number(b.reward) - Number(a.reward)).slice(0, 10).forEach((r) =>
      console.log(`    ${r.user}  ${r.reward} USDT`)
    );
  }
})().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exit(1);
});

