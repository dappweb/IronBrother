/* eslint-disable */
const { createPublicClient, createWalletClient, fallback, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const BOT_PK = "0x2002871ae6cf871ca030706a785b53bba1e2b63cab5b61fe017b20315028e665";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
];
const DAYS = [988888n, 988885n, 988881n, 988878n, 988877n, 988876n, 988843n, 988842n];
const BATCH = 50n;

const ABI = [
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
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 15000, retryCount: 2 })));
  const pub = createPublicClient({ chain: bscTestnet, transport });
  const account = privateKeyToAccount(BOT_PK);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });
  console.log("Bot:", account.address);

  for (const day of DAYS) {
    console.log(`\n=== Day ${day} ===`);
    let cursor = 0n;
    while (true) {
      const { request, result } = await pub.simulateContract({
        account, address: PROXY, abi: ABI,
        functionName: "botSettleDailyDynamicRewards", args: [day, cursor, BATCH],
      });
      const [processed, rewardedUsers, totalReward, nextCursor, finished] = result;
      if (processed === 0n) {
        cursor = nextCursor;
        if (finished) { console.log(`  finished, no work`); break; }
        continue;
      }
      const hash = await wallet.writeContract(request);
      const r = await pub.waitForTransactionReceipt({ hash });
      console.log(`  cursor=${cursor} -> ${nextCursor}  processed=${processed}  rewarded=${rewardedUsers}  total=${totalReward}  tx=${hash}  block=${r.blockNumber}`);
      cursor = nextCursor;
      if (finished) break;
    }
  }
  console.log("\nAll historical days settled.");
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
