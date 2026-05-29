const { createPublicClient, fallback, http, formatUnits } = require("viem");
const { bsc } = require("viem/chains");
const target = "0x7a65e586c9a8f501c36dde6e80838ddc6450c45b";
const PROXY = "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3";
const RPC_LIST = (process.env.BSC_RPC_URLS || [
  "https://bnb-mainnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc.blockpi.network/v1/rpc/3cdd4d74c303c44bfeda86bb6fc55e9d6e23341f",
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org"
].join(",")).split(",").map(s => s.trim()).filter(Boolean);
const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }
];
(async () => {
  const c = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const nowDay = await c.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  for (let d = nowDay - 30n; d < nowDay; d++) {
    const [v, s] = await Promise.all([
      c.readContract({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [target, d] }),
      c.readContract({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [target, d] }),
    ]);
    if (s || v > 0n) console.log(`day=${d} volume=${formatUnits(v,18)} settled=${s}`);
  }
})();