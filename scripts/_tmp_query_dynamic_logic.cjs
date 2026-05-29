const { createPublicClient, fallback, http, formatUnits, parseAbiItem } = require("viem");
const { bsc } = require("viem/chains");

const target = "0x7a65e586c9a8f501c36dde6e80838ddc6450c45b".toLowerCase();
const PROXY = "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3";
const RPC_LIST = (process.env.BSC_RPC_URLS || [
  "https://bnb-mainnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc.blockpi.network/v1/rpc/3cdd4d74c303c44bfeda86bb6fc55e9d6e23341f",
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org"
].join(",")).split(",").map(s => s.trim()).filter(Boolean);

const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
    { name: "whitelist40", type: "bool" }
  ] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isValidOnDay", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyDirectValidCount", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "eligibleGeneration", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "generationRateBps", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "getDirectReferrals", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address[]" }] }
];

(async () => {
  const client = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const dayNow = await client.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const day = dayNow - 1n;
  const u = await client.readContract({ address: PROXY, abi: ABI, functionName: "users", args: [target] });
  const ds = await client.readContract({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [target, day] });
  const iv = await client.readContract({ address: PROXY, abi: ABI, functionName: "isValidOnDay", args: [target, day] });
  const dvc = await client.readContract({ address: PROXY, abi: ABI, functionName: "dailyDirectValidCount", args: [target, day] });
  const eg = await client.readContract({ address: PROXY, abi: ABI, functionName: "eligibleGeneration", args: [target, day] });
  const settled = await client.readContract({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [target, day] });
  const directs = await client.readContract({ address: PROXY, abi: ABI, functionName: "getDirectReferrals", args: [target] });

  console.log("target=", target);
  console.log("currentLocalDay=", dayNow.toString(), "lastClosedDay=", day.toString());
  console.log("registered=", u[10], "referrer=", u[0]);
  console.log("whitelist40=", u[11], "directCount=", u[9].toString(), "getDirectReferrals.length=", directs.length);
  console.log("principalBalance=", formatUnits(u[1], 18), "principalStaked=", formatUnits(u[2], 18));
  console.log("rewardBalance=", formatUnits(u[3], 18), "totalDynamicReward=", formatUnits(u[7], 18));
  console.log("day", day.toString(), "dailyStakeVolume=", formatUnits(ds, 18), "isValidOnDay=", iv, "dailyDirectValidCount=", dvc.toString(), "eligibleGeneration=", eg.toString(), "dynamicRewardSettled=", settled);

  const rates = [];
  for (let i = 1; i <= 5; i++) {
    const r = await client.readContract({ address: PROXY, abi: ABI, functionName: "generationRateBps", args: [i] });
    rates.push(`${i}:${r}`);
  }
  const r40 = await client.readContract({ address: PROXY, abi: ABI, functionName: "generationRateBps", args: [40] });
  console.log("rateBps g1..g5=", rates.join(", "), "g40=", r40.toString());

  const EVT = parseAbiItem("event DynamicRewardSettled(address indexed source, address indexed upline, uint256 day, uint8 generation, uint256 volume, uint256 reward)");
  const latest = await client.getBlockNumber();
  const from = latest > 120000n ? latest - 120000n : 1n;
  const logs = await client.getLogs({ address: PROXY, event: EVT, args: { upline: target }, fromBlock: from, toBlock: latest });
  console.log("recent DynamicRewardSettled logs for target as upline=", logs.length, "(from block", from.toString(), "to", latest.toString(), ")");
  logs.slice(-10).forEach((l, idx) => {
    console.log(`#${idx + 1} day=${l.args.day} gen=${l.args.generation} volume=${formatUnits(l.args.volume, 18)} reward=${formatUnits(l.args.reward, 18)} source=${l.args.source}`);
  });
})();