/* eslint-disable */
// Verify a list of days are all settled (no pending users).
const { createPublicClient, fallback, http } = require("viem");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const DAYS = (process.env.DAYS || "988270,988252,988250,988249,988122,988120,988116")
  .split(",").map((s) => BigInt(s.trim()));

const ABI = [
  { type: "function", name: "getAllUsers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
];

(async () => {
  const pub = createPublicClient({ chain: bscTestnet, transport: fallback(RPCS.map((u) => http(u, { timeout: 25000 }))) });
  const users = await pub.readContract({ address: PROXY, abi: ABI, functionName: "getAllUsers" });
  for (const day of DAYS) {
    const [settled, vols] = await Promise.all([
      pub.multicall({ contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [u, day] })), allowFailure: false }),
      pub.multicall({ contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [u, day] })), allowFailure: false }),
    ]);
    let pending = 0;
    users.forEach((_, i) => { if (!settled[i] && vols[i] > 0n) pending++; });
    console.log(`day=${day} pending=${pending}`);
  }
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
