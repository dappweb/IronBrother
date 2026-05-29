/* eslint-disable */
// Scan-only (no settle) over a wide range, with retry + throttle.
const { createPublicClient, fallback, http } = require("viem");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const LOOKBACK = Number(process.env.LOOKBACK || 1500);

const ABI = [
  { type: "function", name: "currentLocalDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAllUsers", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "dynamicRewardSettled", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "dailyStakeVolume", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label) {
  for (let i = 1; i <= 8; i++) {
    try { return await fn(); }
    catch (e) { if (i === 8) throw e; await sleep(500 * i); }
  }
}

(async () => {
  const pub = createPublicClient({ chain: bscTestnet, transport: fallback(RPCS.map((u) => http(u, { timeout: 30000, retryCount: 3 }))) });
  const cur = await pub.readContract({ address: PROXY, abi: ABI, functionName: "currentLocalDay" });
  const users = await pub.readContract({ address: PROXY, abi: ABI, functionName: "getAllUsers" });
  console.log(`currentLocalDay=${cur} users=${users.length} LOOKBACK=${LOOKBACK}`);
  const missing = [];
  for (let i = 1n; i <= BigInt(LOOKBACK); i++) {
    const day = cur - i;
    const [settled, vols] = await withRetry(() => Promise.all([
      pub.multicall({ contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dynamicRewardSettled", args: [u, day] })), allowFailure: false }),
      pub.multicall({ contracts: users.map((u) => ({ address: PROXY, abi: ABI, functionName: "dailyStakeVolume", args: [u, day] })), allowFailure: false }),
    ]), `day=${day}`);
    let p = 0;
    users.forEach((_, k) => { if (!settled[k] && vols[k] > 0n) p++; });
    if (p > 0) { missing.push(day); console.log(`MISSING day=${day} pending=${p}`); }
    await sleep(100);
  }
  console.log(`\nDONE missing=${missing.length} list=${missing.join(",")}`);
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
