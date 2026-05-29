/* eslint-disable */
const { createPublicClient, fallback, http, formatUnits, parseAbiItem } = require("viem");
const { bsc } = require("viem/chains");

const PROXY = "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3";
const RPC_LIST = (process.env.BSC_RPC_URLS || [
  "https://bnb-mainnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc.blockpi.network/v1/rpc/3cdd4d74c303c44bfeda86bb6fc55e9d6e23341f",
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const EVT = parseAbiItem(
  "event DynamicRewardBotSettled(address indexed operator, uint256 indexed day, uint256 cursor, uint256 processed, uint256 rewardedUsers, uint256 totalReward, uint256 nextCursor, bool finished)"
);

(async () => {
  const client = createPublicClient({ chain: bsc, transport: fallback(RPC_LIST.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) });
  const latest = await client.getBlockNumber();
  // BSC ~3s/block → 1 day ≈ 28800 blocks; pull last ~7 days
  const fromBlock = latest - 80000n;
  const STEP = 500n;
  const logs = [];
  for (let start = fromBlock; start <= latest; start += STEP + 1n) {
    const end = start + STEP > latest ? latest : start + STEP;
    let tries = 0;
    while (true) {
      try {
        const chunk = await client.getLogs({ address: PROXY, event: EVT, fromBlock: start, toBlock: end });
        logs.push(...chunk);
        break;
      } catch (e) {
        tries++;
        if (tries > 5) {
          console.error(`  giving up ${start}-${end}: ${e.shortMessage || e.message}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500 * tries));
      }
    }
  }

  console.log(`Scanned blocks ${fromBlock}..${latest}, found ${logs.length} DynamicRewardBotSettled events.\n`);
  // group by day
  const byDay = new Map();
  for (const lg of logs) {
    const d = lg.args.day.toString();
    const e = byDay.get(d) || { day: d, batches: 0, processed: 0n, rewardedUsers: 0n, totalReward: 0n, txs: new Set() };
    e.batches += 1;
    e.processed += lg.args.processed;
    e.rewardedUsers += lg.args.rewardedUsers;
    e.totalReward += lg.args.totalReward;
    e.txs.add(lg.transactionHash);
    byDay.set(d, e);
  }
  const days = [...byDay.values()].sort((a, b) => Number(b.day) - Number(a.day));
  for (const d of days) {
    console.log(`Day ${d.day}:`);
    console.log(`  批次(emit次数): ${d.batches}`);
    console.log(`  链上交易数:     ${d.txs.size}`);
    console.log(`  processed合计:  ${d.processed}`);
    console.log(`  获奖用户合计:   ${d.rewardedUsers}`);
    console.log(`  发放奖励合计:   ${formatUnits(d.totalReward, 18)} USDT`);
  }
})().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exit(1);
});
