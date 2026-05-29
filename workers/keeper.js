import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";

function resolveChain(env) {
  const id = String(env.CHAIN_ID || "56");
  if (id === "97") return bscTestnet;
  return bsc;
}

const IRONBROTHER_ABI = [
  {
    type: "function",
    name: "currentLocalDay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_BOT_SETTLEMENT_BATCH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "settlementCycle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "botSettleDailyDynamicRewards",
    stateMutability: "nonpayable",
    inputs: [
      { name: "day", type: "uint256" },
      { name: "cursor", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "processed", type: "uint256" },
      { name: "rewardedUsers", type: "uint256" },
      { name: "totalReward", type: "uint256" },
      { name: "nextCursor", type: "uint256" },
      { name: "finished", type: "bool" },
    ],
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

function asPositiveBigInt(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${name} must be positive`);
  return parsed;
}

function buildTransport(env) {
  const raw = env.BSC_RPC_URLS || env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
  const urls = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return urls.length > 1
    ? fallback(urls.map((u) => http(u, { timeout: 15000, retryCount: 2 })))
    : http(urls[0], { timeout: 15000, retryCount: 2 });
}

function normalizePrivateKey(value) {
  if (!value) throw new Error("PRIVATE_KEY secret is required");
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function runSettlement(env) {
  const proxy = env.IRONBROTHER_PROXY;
  if (!proxy) throw new Error("IRONBROTHER_PROXY is required");

  const batchSize = asPositiveBigInt(env.DYNAMIC_SETTLEMENT_BATCH_SIZE, 50n, "DYNAMIC_SETTLEMENT_BATCH_SIZE");
  const maxBatches = Number(asPositiveBigInt(env.DYNAMIC_SETTLEMENT_MAX_BATCHES, 10000n, "DYNAMIC_SETTLEMENT_MAX_BATCHES"));
  const account = privateKeyToAccount(normalizePrivateKey(env.PRIVATE_KEY));
  const transport = buildTransport(env);
  const chain = resolveChain(env);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  const currentLocalDay = await publicClient.readContract({
    address: proxy,
    abi: IRONBROTHER_ABI,
    functionName: "currentLocalDay",
  });
  const day = currentLocalDay - 1n;
  const maxBatchSize = await publicClient.readContract({
    address: proxy,
    abi: IRONBROTHER_ABI,
    functionName: "MAX_BOT_SETTLEMENT_BATCH",
  });
  if (batchSize > maxBatchSize) {
    throw new Error(`DYNAMIC_SETTLEMENT_BATCH_SIZE must be <= ${maxBatchSize}`);
  }

  let cursor = 0n;
  let processedTotal = 0n;
  let rewardedUsersTotal = 0n;
  let rewardTotal = 0n;
  const transactions = [];

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const { request, result } = await publicClient.simulateContract({
      account,
      address: proxy,
      abi: IRONBROTHER_ABI,
      functionName: "botSettleDailyDynamicRewards",
      args: [day, cursor, batchSize],
    });
    const [processed, rewardedUsers, totalReward, nextCursor, finished] = result;

    if (processed === 0n) {
      // No work in this slice – skip the on-chain tx to save gas. Continue the cursor
      // walk so we eventually reach `finished=true` even when the entire user array is
      // already settled.
      cursor = nextCursor;
      if (finished) {
        return {
          ok: true,
          day,
          operator: account.address,
          processed: processedTotal,
          rewardedUsers: rewardedUsersTotal,
          totalReward: rewardTotal,
          finished: true,
          transactions,
          note:
            transactions.length === 0
              ? "No indexed users required settlement for this day."
              : undefined,
        };
      }
      continue;
    }

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    transactions.push({
      hash,
      blockNumber: receipt.blockNumber,
      cursor,
      nextCursor,
      processed,
      rewardedUsers,
      totalReward,
    });

    processedTotal += processed;
    rewardedUsersTotal += rewardedUsers;
    rewardTotal += totalReward;
    cursor = nextCursor;

    if (finished) {
      return {
        ok: true,
        day,
        operator: account.address,
        processed: processedTotal,
        rewardedUsers: rewardedUsersTotal,
        totalReward: rewardTotal,
        finished,
        transactions,
      };
    }
  }

  throw new Error(`Stopped after ${maxBatches} batches. Resume from cursor ${cursor}.`);
}

async function previewStatus(env) {
  const proxy = env.IRONBROTHER_PROXY;
  if (!proxy) throw new Error("IRONBROTHER_PROXY is required");
  const transport = buildTransport(env);
  const publicClient = createPublicClient({ chain: resolveChain(env), transport });

  const account = env.PRIVATE_KEY ? privateKeyToAccount(normalizePrivateKey(env.PRIVATE_KEY)) : null;
  const operator = account?.address ?? null;

  const [currentLocalDay, maxBatchSize, settlementCycle, operatorBalance] = await Promise.all([
    publicClient.readContract({ address: proxy, abi: IRONBROTHER_ABI, functionName: "currentLocalDay" }),
    publicClient.readContract({ address: proxy, abi: IRONBROTHER_ABI, functionName: "MAX_BOT_SETTLEMENT_BATCH" }),
    publicClient.readContract({ address: proxy, abi: IRONBROTHER_ABI, functionName: "settlementCycle" }),
    operator ? publicClient.getBalance({ address: operator }) : Promise.resolve(0n),
  ]);

  const targetDay = currentLocalDay > 0n ? currentLocalDay - 1n : 0n;
  const batchSize = asPositiveBigInt(env.DYNAMIC_SETTLEMENT_BATCH_SIZE, 50n, "DYNAMIC_SETTLEMENT_BATCH_SIZE");

  let preview = null;
  if (operator && targetDay > 0n) {
    try {
      const { result } = await publicClient.simulateContract({
        account: operator,
        address: proxy,
        abi: IRONBROTHER_ABI,
        functionName: "botSettleDailyDynamicRewards",
        args: [targetDay, 0n, batchSize],
      });
      const [processed, rewardedUsers, totalReward, nextCursor, finished] = result;
      preview = { processed, rewardedUsers, totalReward, nextCursor, finished };
    } catch (error) {
      preview = { error: error?.shortMessage || error?.message || String(error) };
    }
  }

  return {
    ok: true,
    proxy,
    operator,
    operatorBalance,
    currentLocalDay,
    targetDay,
    settlementCycle,
    batchSize,
    maxBatchSize,
    schedules: ["5 16 * * *", "*/30 * * * *"],
    preview,
  };
}

async function sendAlert(env, payload) {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
    });
  } catch (error) {
    console.error("alert webhook failed", error?.message || error);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, worker: "ironbrother-keeper", proxy: env.IRONBROTHER_PROXY });
    }

    if (url.pathname === "/status") {
      try {
        return json(await previewStatus(env));
      } catch (error) {
        return json({ ok: false, error: error?.message || String(error) }, 500);
      }
    }

    if (url.pathname === "/run") {
      if (!env.KEEPER_AUTH_TOKEN || url.searchParams.get("token") !== env.KEEPER_AUTH_TOKEN) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      try {
        return json(await runSettlement(env));
      } catch (error) {
        return json({ ok: false, error: error?.message || String(error) }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runSettlement(env).then(
        (result) => {
          console.log("scheduled settlement result", JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
          if (!result.finished) {
            return sendAlert(env, { kind: "dynamic-settlement-not-finished", result });
          }
        },
        (error) => {
          console.error("scheduled settlement failed", error?.stack || error?.message || error);
          return sendAlert(env, {
            kind: "dynamic-settlement-error",
            error: error?.message || String(error),
          });
        },
      ),
    );
  },
};
