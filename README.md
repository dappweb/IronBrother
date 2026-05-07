# 原力 CrudeTrust

BSC USDT staking DApp with on-chain accounting, five rotating project deposit wallets, Admin-approved withdrawals, a customer mobile UI, a simplified Admin console, and Cloudflare Pages deployment.

## Stack

- React + Vite + TypeScript
- RainbowKit + wagmi + viem
- Solidity + Hardhat
- OpenZeppelin Contracts
- Cloudflare Pages

## Local Setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set these values in `.env.local` for BSC Testnet:

```bash
VITE_BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id
VITE_USDT_ADDRESS=0xacD944e910952c020eb129C50921f180c62c3291
VITE_CRUDETRUST_CONTRACT_ADDRESS=
```

On BSC Testnet, use `TEST_USDT_ADDRESS` if you already have a test USDT token. If not set, the testnet deployment script deploys `MockUSDT` and writes the address to `deployments/bsc-testnet.json`.

## Business Flow

- User deposits call `deposit(amount, referrer)`. The contract transfers USDT directly from the user to one of five configured project deposit wallets in round-robin order, then records principal and the deposit order on-chain.
- Staking, static rewards, dynamic rewards, principal redemption, and reinvestment are accounting operations in the contract.
- User withdrawals call `requestWithdrawRewards(amount)` and create a pending withdrawal request. The reward balance is reserved until Admin approves or rejects it.
- Admin approval calls `approveWithdrawal(requestId)`. The Admin/payout wallet first approves USDT to the contract, then the approval transaction transfers the net amount to the user and the fee to `feeReceiver`.
- Admin rejection calls `rejectWithdrawal(requestId)` and restores the reserved reward balance.
- Super Admin can call `withdrawContractFunds(receiver, amount)` to transfer USDT held by the contract to a receiver address.

The BSC mainnet BEP-20 USDT address for production is:

```text
0x55d398326f99059fF775485246999027B3197955
```

## Contracts

Compile:

```bash
npm run compile
```

Test:

```bash
npm test
```

Deploy upgradeable proxy to BSC Testnet:

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=your-deployer-private-key
set TEST_USDT_ADDRESS=0xacD944e910952c020eb129C50921f180c62c3291
set FEE_RECEIVER=fee-receiver-address
set DEFAULT_REFERRER=default-referrer-address
set DEPOSIT_RECEIVERS=receiver1,receiver2,receiver3,receiver4,receiver5
npm run deploy:testnet
```

After deployment, set `VITE_CRUDETRUST_CONTRACT_ADDRESS` and `VITE_USDT_ADDRESS` in Cloudflare Pages and `.env.local`. `VITE_IRONBROTHER_CONTRACT_ADDRESS` is still accepted as a legacy fallback.

Upgrade the BSC Testnet proxy:

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=your-upgrader-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
set DEPOSIT_RECEIVERS=receiver1,receiver2,receiver3,receiver4,receiver5
set REGISTERED_USERS=user1,user2,user3
npm run upgrade:testnet
```

`REGISTERED_USERS` is optional. Use it after upgrading an existing proxy so `syncRegisteredUsers()` can seed the new on-chain user index used by Admin `getAllUsers()` reads. New registrations are indexed automatically.

Run the daily dynamic reward settlement bot after the UTC+8 local day has closed:

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=manager-or-super-admin-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
npm run bot:dynamic:settle:testnet
```

By default the bot settles the previous local day in batches of 50 indexed users. Override `DYNAMIC_SETTLEMENT_DAY`, `DYNAMIC_SETTLEMENT_BATCH_SIZE`, or `DYNAMIC_SETTLEMENT_START_CURSOR` when backfilling or resuming a stopped run. The bot wallet must have `MANAGER_ROLE`.

## Cloudflare Pages

Cloudflare Pages should build from the repository root. The failed log below means Pages built the old `main` commit that only contained `README.md`, so `/opt/buildhome/repo/package.json` did not exist. Push a full project commit to `main`, then configure two branch environments:

- Production environment: branch `main`
- Preview/test environment: branch `test`
- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`

Set these environment variables in both Cloudflare environments. Use production values for `main` and testnet values for `test`:

```text
VITE_BSC_TESTNET_RPC_URL
VITE_WALLETCONNECT_PROJECT_ID
VITE_USDT_ADDRESS
VITE_CRUDETRUST_CONTRACT_ADDRESS
```

Build command:

```bash
npm run build
```

Build output directory:

```text
dist
```

Deploy from CLI:

```bash
npm run deploy:pages
```

Deploy a specific branch environment from CLI:

```bash
npm run deploy:pages:main
npm run deploy:pages:test
```

## Notes

The smart contract cannot automatically run jobs by itself at 12:00, 17:00, or 00:00. Settlement is exposed as callable on-chain functions. The UI/Admin can trigger settlement transactions after the configured time windows, and the dynamic reward bot script can be scheduled by an external cron runner after the local day closes.
