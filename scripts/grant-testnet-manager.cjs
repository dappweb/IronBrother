/* eslint-disable */
const { createPublicClient, createWalletClient, fallback, http, keccak256, toBytes } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { bscTestnet } = require("viem/chains");

const PROXY = "0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E";
const BOT = "0xAC25dA7FdEEEaDf2943EBF505Fa9739CBD111bD8";
const OWNER_PK = "0x4f3b2b7388daa9fbafede197e8c629cb7882a3af942a87aa0988dde7d73d03d2";
const RPCS = [
  "https://bnb-testnet.g.alchemy.com/v2/-by17354ypCETJmw_4GZI",
  "https://bsc-testnet-rpc.publicnode.com",
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
];

const ABI = [
  { type: "function", name: "MANAGER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
];

(async () => {
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 15000, retryCount: 2 })));
  const pub = createPublicClient({ chain: bscTestnet, transport });
  const account = privateKeyToAccount(OWNER_PK);
  console.log("Owner:", account.address);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });

  const role = await pub.readContract({ address: PROXY, abi: ABI, functionName: "MANAGER_ROLE" });
  console.log("MANAGER_ROLE:", role);

  const already = await pub.readContract({ address: PROXY, abi: ABI, functionName: "hasRole", args: [role, BOT] });
  console.log("Bot already has role:", already);
  if (already) { console.log("Nothing to do."); return; }

  const hash = await wallet.writeContract({ address: PROXY, abi: ABI, functionName: "grantRole", args: [role, BOT] });
  console.log("grantRole tx:", hash);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log("status:", r.status, "block:", r.blockNumber);
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
