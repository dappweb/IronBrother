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
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isValidOnDay", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }
];
(async () => {
  const client = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const nowDay = await client.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const start = nowDay > 365n ? nowDay - 365n : 1n;
  let nonZero = 0;
  let settledTrue = 0;
  for (let d = start; d < nowDay; d++) {
    const [v, s, valid] = await Promise.all([
      client.readContract({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [target, d] }),
      client.readContract({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [target, d] }),
      client.readContract({ address: PROXY, abi: ABI, functionName: "isValidOnDay", args: [target, d] }),
    ]);
    if (v > 0n) {
      nonZero++;
      console.log(`volume>0 day=${d} volume=${formatUnits(v,18)} valid=${valid} settled=${s}`);
    }
    if (s) settledTrue++;
  }
  console.log(`scan done. dayRange=[${start},${nowDay-1n}] nonZeroDays=${nonZero} settledTrueDays=${settledTrue}`);
})();