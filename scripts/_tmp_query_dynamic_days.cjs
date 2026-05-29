const { createPublicClient, fallback, http, formatUnits } = require("viem");
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
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "eligibleGeneration", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint8" }] }
];

(async () => {
  const client = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const dayNow = await client.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const u = await client.readContract({ address: PROXY, abi: ABI, functionName: "users", args: [target] });

  console.log("target=", target);
  console.log("currentLocalDay=", dayNow.toString());
  console.log("totalStaked=", formatUnits(u[5],18), "totalStaticReward=", formatUnits(u[6],18), "totalDynamicReward=", formatUnits(u[7],18));

  let cursor = u[0];
  let gen = 1;
  console.log("\nUpline chain (max 10):");
  while (cursor && cursor !== "0x0000000000000000000000000000000000000000" && gen <= 10) {
    const up = await client.readContract({ address: PROXY, abi: ABI, functionName: "users", args: [cursor] });
    const eg = await client.readContract({ address: PROXY, abi: ABI, functionName: "eligibleGeneration", args: [cursor, dayNow - 1n] });
    console.log(`  gen${gen} ${cursor} directCount=${up[9].toString()} whitelist40=${up[11]} eligible(lastDay)=${eg.toString()}`);
    cursor = up[0];
    gen++;
  }

  console.log("\nRecent day scan (last 14 closed days):");
  for (let d = dayNow - 1n; d >= dayNow - 14n; d--) {
    const v = await client.readContract({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [target, d] });
    const valid = await client.readContract({ address: PROXY, abi: ABI, functionName: "isValidOnDay", args: [target, d] });
    const set = await client.readContract({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [target, d] });
    if (v > 0n || valid || !set) {
      console.log(`  day=${d} volume=${formatUnits(v,18)} isValid=${valid} settled=${set}`);
    }
  }
})();