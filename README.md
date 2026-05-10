# 原力 CrudeTrust

基于 BSC USDT 的质押 DApp。项目包含链上记账合约、五个项目收款钱包轮转入金、管理员审核提现、用户移动端界面、简化后台管理界面，以及 Cloudflare Pages 部署配置。

## 技术栈

- React + Vite + TypeScript
- RainbowKit + wagmi + viem
- Solidity + Hardhat
- OpenZeppelin Contracts
- Cloudflare Pages

## 本地启动

```bash
npm install
copy .env.example .env.local
npm run dev
```

BSC Testnet 本地开发需要在 `.env.local` 配置：

```bash
VITE_BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id
VITE_USDT_ADDRESS=0xacD944e910952c020eb129C50921f180c62c3291
VITE_CRUDETRUST_CONTRACT_ADDRESS=
```

如果测试网已有测试 USDT，可设置 `TEST_USDT_ADDRESS`。如果不设置，测试网部署脚本会自动部署 `MockUSDT`，并把地址写入 `deployments/bsc-testnet.json`。

## 业务流程

- 用户入金调用 `deposit(amount, referrer)`。合约把 USDT 从用户钱包直接转到五个项目收款钱包之一，并按轮转规则记录本金和入金订单。
- 质押、静态收益、动态收益、本金赎回、复投都是合约内部记账操作。
- 用户提现调用 `requestWithdrawRewards(amount)` 创建待审核提现单，申请金额会先从可用收益中冻结。
- 管理员通过 `approveWithdrawal(requestId)` 审核提现。管理员/出款钱包需要先授权 USDT 给合约，审核交易会把净额转给用户，把手续费转给 `feeReceiver`。
- 管理员通过 `rejectWithdrawal(requestId)` 驳回提现，冻结的收益会返还到用户可用收益。
- 超级管理员可调用 `withdrawContractFunds(receiver, amount)` 把合约内持有的 USDT 转到指定地址。

BSC 主网 BEP-20 USDT 地址：

```text
0x55d398326f99059fF775485246999027B3197955
```

## 合约命令

编译合约：

```bash
npm run compile
```

运行测试：

```bash
npm test
```

部署 BSC Testnet 可升级代理合约：

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=your-deployer-private-key
set TEST_USDT_ADDRESS=0xacD944e910952c020eb129C50921f180c62c3291
set FEE_RECEIVER=fee-receiver-address
set DEFAULT_REFERRER=default-referrer-address
set DEPOSIT_RECEIVERS=receiver1,receiver2,receiver3,receiver4,receiver5
npm run deploy:testnet
```

部署后，把 `VITE_CRUDETRUST_CONTRACT_ADDRESS` 和 `VITE_USDT_ADDRESS` 配到 Cloudflare Pages 和本地 `.env.local`。`VITE_IRONBROTHER_CONTRACT_ADDRESS` 仍作为旧字段兼容。

升级 BSC Testnet 代理合约：

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=your-upgrader-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
set DEPOSIT_RECEIVERS=receiver1,receiver2,receiver3,receiver4,receiver5
set REGISTERED_USERS=user1,user2,user3
npm run upgrade:testnet
```

`REGISTERED_USERS` 是可选项。升级旧代理合约时可用它调用 `syncRegisteredUsers()`，把旧用户写入新的链上用户索引，方便后台 `getAllUsers()` 读取。新注册用户会自动进入索引。

## 动态奖励结算 Bot

智能合约本身不能自动在每天 00:00 执行任务。动态奖励结算由外部 bot 钱包发起链上交易，调用 `botSettleDailyDynamicRewards(day, cursor, limit)`，按用户索引分批结算已结束的 UTC+8 本地日。

### 执行前检查

- bot 钱包必须有 `MANAGER_ROLE`，否则交易会被合约拒绝。
- bot 钱包必须有足够 BNB 支付 gas。
- 主网需要 `BSC_RPC_URL`，测试网需要 `BSC_TESTNET_RPC_URL`。
- `PRIVATE_KEY` 使用 bot 钱包私钥，放在未提交的 `.env.local` 或系统环境变量中，不要提交到仓库。
- `deployments/bsc.json` 或 `deployments/bsc-testnet.json` 里必须有 `ironBrotherProxy`。每日封装脚本会优先从部署文件读取代理合约地址。
- 如果是升级旧合约后第一次使用 bot，需要确认用户索引已经同步，否则 bot 只能遍历索引内用户。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `BSC_RPC_URL` | BSC 主网 RPC，主网执行必填 |
| `BSC_TESTNET_RPC_URL` | BSC Testnet RPC，测试网执行必填 |
| `PRIVATE_KEY` | bot 钱包私钥，钱包需要 `MANAGER_ROLE` |
| `IRONBROTHER_PROXY` | 合约代理地址。直接运行 Hardhat bot 时必填；每日封装脚本会从 `deployments/*.json` 自动设置 |
| `DYNAMIC_SETTLEMENT_DAY` | 指定要结算的本地日编号。默认结算前一个 UTC+8 本地日 |
| `DYNAMIC_SETTLEMENT_BATCH_SIZE` | 每笔交易处理的用户数，默认 `50`，不能超过合约 `MAX_BOT_SETTLEMENT_BATCH`，当前最大 `100` |
| `DYNAMIC_SETTLEMENT_START_CURSOR` | 从指定用户索引位置开始，用于失败后续跑 |
| `DYNAMIC_SETTLEMENT_MAX_BATCHES` | 单次脚本最多发送多少批交易，默认 `10000`，防止异常无限循环 |

### 手动执行一次

测试网手动执行：

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=manager-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
npm run bot:dynamic:settle:testnet
```

主网手动执行：

```bash
set BSC_RPC_URL=https://your-bsc-mainnet-rpc
set PRIVATE_KEY=manager-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
npm run bot:dynamic:settle:bsc
```

脚本会先用 `staticCall` 预估当前批次结果，再发送正式交易。每一批都会输出交易哈希、当前 cursor、下一 cursor、处理用户数、获得奖励用户数和奖励总额。看到 `Finished` 表示当天所有已索引用户处理完毕。

### 使用每日封装脚本

每日封装脚本 `scripts/run-daily-dynamic-settlement.ps1` 会读取 `.env.local` / `.env`，从部署文件取代理合约地址，设置批量参数，并把执行日志写到 `logs/settlement`。

主网执行一次：

```powershell
$env:BSC_RPC_URL="https://your-bsc-mainnet-rpc"
$env:PRIVATE_KEY="manager-private-key"
npm run bot:dynamic:settle:bsc:daily
```

测试网执行一次：

```powershell
$env:BSC_TESTNET_RPC_URL="https://your-bsc-testnet-rpc"
$env:PRIVATE_KEY="manager-private-key"
npm run bot:dynamic:settle:testnet:daily
```

也可以直接调用脚本并调整批量参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-daily-dynamic-settlement.ps1 -Network bsc -BatchSize 50 -MaxBatches 10000
```

日志文件路径格式：

```text
logs/settlement/{network}-dynamic-settlement-{yyyyMMdd-HHmmss}.log
```

### 安装每日凌晨定时任务

Windows 定时任务由 `scripts/install-daily-dynamic-settlement-task.ps1` 创建或更新。默认每天机器本地时间 `00:05` 执行。

主网安装：

```powershell
npm run bot:dynamic:schedule:bsc
```

测试网安装：

```powershell
npm run bot:dynamic:schedule:testnet
```

自定义执行时间和批量参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-daily-dynamic-settlement-task.ps1 -Network bsc -At 00:10 -BatchSize 50 -MaxBatches 10000
```

如果服务器系统时区不是 UTC+8，要把 `-At` 调整到 UTC+8 零点之后。例如服务器使用 UTC 时间，UTC+8 的 `00:05` 对应 UTC 前一天 `16:05`。

安装后可用 Windows 命令查看任务：

```powershell
Get-ScheduledTask -TaskName "IronBrother Daily Dynamic Settlement"
Get-ScheduledTaskInfo -TaskName "IronBrother Daily Dynamic Settlement"
```

### 补跑和续跑

补跑指定本地日：

```bash
set DYNAMIC_SETTLEMENT_DAY=20580
npm run bot:dynamic:settle:bsc
```

从失败位置续跑：

```bash
set DYNAMIC_SETTLEMENT_DAY=20580
set DYNAMIC_SETTLEMENT_START_CURSOR=350
npm run bot:dynamic:settle:bsc
```

如果日志最后提示 `Resume with DYNAMIC_SETTLEMENT_START_CURSOR=...`，按提示设置 cursor 后重新执行即可。已经结算过的用户会被合约跳过，不会重复发放同一天动态奖励。

### 常见问题

- `day not closed`：要结算的本地日还没结束，等 UTC+8 零点之后再执行，或检查 `DYNAMIC_SETTLEMENT_DAY` 是否设置错。
- `AccessControlUnauthorizedAccount` 或权限错误：bot 钱包没有 `MANAGER_ROLE`，需要超级管理员授权。
- `invalid batch size`：`DYNAMIC_SETTLEMENT_BATCH_SIZE` 不能为 0，也不能超过合约最大批量，当前最大 `100`。
- `insufficient funds`：bot 钱包 BNB 不足，补充 gas 后续跑。
- RPC 超时或中断：查看 `logs/settlement` 最新日志，使用日志里的 next cursor 或报错提示续跑。

### 测试网短周期冒烟测试

测试网可运行短周期动态奖励测试：

```bash
set BSC_TESTNET_RPC_URL=https://bnb-testnet.g.alchemy.com/v2/your-key
set PRIVATE_KEY=super-admin-private-key
set IRONBROTHER_PROXY=deployed-proxy-address
npm run test:dynamic:cycle:testnet
```

该测试会临时把结算周期设置为 `DYNAMIC_TEST_SETTLEMENT_CYCLE_SECONDS`，默认 `120` 秒；注册一个下级钱包，质押测试 USDT，等待周期结束，执行 bot 结算，再默认恢复原结算周期和场次配置。只有明确需要保留短周期时才设置 `DYNAMIC_TEST_RESTORE_CONFIG=false`。

## Cloudflare Pages

Cloudflare Pages 应从仓库根目录构建。两个分支环境建议如下：

- 生产环境：`main`
- 预览/测试环境：`test`
- Root directory：`/`
- Build command：`npm run build`
- Build output directory：`dist`

两个 Cloudflare 环境都需要设置以下变量。`main` 使用生产值，`test` 使用测试网值：

```text
VITE_BSC_TESTNET_RPC_URL
VITE_WALLETCONNECT_PROJECT_ID
VITE_USDT_ADDRESS
VITE_CRUDETRUST_CONTRACT_ADDRESS
```

本地构建：

```bash
npm run build
```

CLI 部署：

```bash
npm run deploy:pages
```

按分支环境部署：

```bash
npm run deploy:pages:main
npm run deploy:pages:test
```

## 备注

智能合约不能自己自动执行 12:00、17:00 或 00:00 的任务。所有结算都暴露为可调用的链上函数，可由 UI/Admin 在指定时间窗口后触发，也可由动态奖励 bot 在 UTC+8 本地日结束后自动定时触发。
