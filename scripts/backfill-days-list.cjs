/* eslint-disable */
// Backfill a hardcoded list of days via Bot.
const { createPublicClient, createWalletClient, fallback, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const BOT_PK = "0x2002871ae6cf871ca030706a785b53bba1e2b63cab5b61fe017b20315028e665";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const DAYS = (process.env.DAYS || "988270,988252,988250,988249,988122,988120,988116")
  .split(",").map((s) => BigInt(s.trim())).filter((b) => b > 0n);

const ABI = [{
  type: "function", name: "botSettleDailyDynamicRewards", stateMutability: "nonpayable",
  inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" }],
}];

(async () => {
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 25000, retryCount: 3 })));
  const pub = createPublicClient({ chain: bscTestnet, transport });
  const account = privateKeyToAccount(BOT_PK);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });
  console.log(`Bot=${account.address}  days=${DAYS.join(",")}`);
  let totalTx = 0, totalReward = 0n;
  for (const day of DAYS) {
    let cursor = 0n;
    while (true) {
      const { request, result } = await pub.simulateContract({
        account, address: PROXY, abi: ABI,
        functionName: "botSettleDailyDynamicRewards", args: [day, cursor, 50n],
      });
      const [processed, rewardedUsers, reward, nextCursor, finished] = result;
      if (processed > 0n) {
        const hash = await wallet.writeContract(request);
        const r = await pub.waitForTransactionReceipt({ hash });
        totalTx++; totalReward += reward;
        console.log(`  day=${day} cursor=${cursor}->${nextCursor} processed=${processed} rewarded=${rewardedUsers} reward=${reward} tx=${hash} block=${r.blockNumber}`);
      }
      cursor = nextCursor;
      if (finished) break;
    }
  }
  console.log(`\n[合计] tx=${totalTx} reward=${(Number(totalReward) / 1e18).toFixed(4)} USDT`);
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
