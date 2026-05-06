import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Coins,
  Gift,
  Landmark,
  LockKeyhole,
  PauseCircle,
  Repeat2,
  Send,
  Settings,
  Shield,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Address, Hash, Hex } from 'viem';
import { zeroAddress } from 'viem';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { bscTestnet } from 'wagmi/chains';
import { useQueryClient } from '@tanstack/react-query';

import { erc20Abi, ironBrotherAbi } from './abi/ironBrother';
import { BSC_USDT_ADDRESS, IRONBROTHER_CONTRACT_ADDRESS, isContractConfigured } from './config/contracts';
import { bpsToPercent, dateTime, parseTokenInput, safeAddress, shortAddress, token } from './lib/format';
import { mockDashboard, mockOrders, mockTeam, mockUser } from './lib/mock';

type NavKey = 'home' | 'stake' | 'wallet' | 'team' | 'profile';

type UserTuple = readonly [
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean,
];

const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hex;
const CONTRACT_ADDRESS = IRONBROTHER_CONTRACT_ADDRESS ?? zeroAddress;

function userFromTuple(data: unknown) {
  const tuple = data as UserTuple | undefined;
  if (!tuple) {
    return {
      referrer: zeroAddress,
      ...mockUser,
    };
  }

  return {
    referrer: tuple[0],
    principalBalance: tuple[1],
    principalStaked: tuple[2],
    rewardBalance: tuple[3],
    totalDeposited: tuple[4],
    totalStaked: tuple[5],
    totalStaticReward: tuple[6],
    totalDynamicReward: tuple[7],
    totalWithdrawn: tuple[8],
    directCount: tuple[9],
    registered: tuple[10],
    whitelist40: tuple[11],
  };
}

function App() {
  const isAdminRoute = window.location.pathname.startsWith('/admin');

  return isAdminRoute ? <AdminConsole /> : <CustomerApp />;
}

function useIronBrotherData() {
  const { address } = useAccount();
  const enabled = isContractConfigured && Boolean(address);
  const accountAddress = address ?? zeroAddress;

  const userQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'users',
    args: [accountAddress],
    query: { enabled },
  });

  const availableQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'availablePrincipal',
    args: [accountAddress],
    query: { enabled },
  });

  const maturedQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'maturedUnredeemedPrincipal',
    args: [accountAddress],
    query: { enabled },
  });

  const sessionQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentSession',
    query: { enabled: isContractConfigured },
  });

  const yieldQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'yieldBps',
    query: { enabled: isContractConfigured },
  });

  const withdrawFeeQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'withdrawFee',
    query: { enabled: isContractConfigured },
  });

  const principalOrderIdsQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getUserPrincipalOrderIds',
    args: [accountAddress],
    query: { enabled },
  });

  const stakeOrderIdsQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getUserStakeOrderIds',
    args: [accountAddress],
    query: { enabled },
  });

  const account = userFromTuple(userQuery.data);
  const sessionTuple = sessionQuery.data as readonly [number, bigint] | undefined;

  return {
    account,
    availablePrincipal: (availableQuery.data as bigint | undefined) ?? 800n * 10n ** 18n,
    maturedUnredeemed: (maturedQuery.data as bigint | undefined) ?? 200n * 10n ** 18n,
    currentSession: Number(sessionTuple?.[0] ?? 1),
    sessionSettleAt: sessionTuple?.[1] ?? 0n,
    yieldBps: (yieldQuery.data as bigint | undefined) ?? 100n,
    withdrawFee: (withdrawFeeQuery.data as bigint | undefined) ?? 10n * 10n ** 18n,
    principalOrderIds: (principalOrderIdsQuery.data as readonly bigint[] | undefined) ?? [],
    stakeOrderIds: (stakeOrderIdsQuery.data as readonly bigint[] | undefined) ?? [],
  };
}

function useTxRunner() {
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<{ label: string; hash?: Hash; status: 'idle' | 'wallet' | 'pending' | 'confirmed' | 'failed'; error?: string }>({
    label: '',
    status: 'idle',
  });

  async function runTx(label: string, request: () => Promise<Hash>) {
    if (!publicClient) {
      setTx({ label, status: 'failed', error: 'RPC 未就绪' });
      return;
    }

    try {
      setTx({ label, status: 'wallet' });
      const hash = await request();
      setTx({ label, hash, status: 'pending' });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setTx({ label, hash, status: receipt.status === 'success' ? 'confirmed' : 'failed' });
      await queryClient.invalidateQueries();
    } catch (error) {
      setTx({
        label,
        status: 'failed',
        error: error instanceof Error ? error.message : '交易失败',
      });
    }
  }

  return { tx, runTx, writeContractAsync };
}

function CustomerApp() {
  const [nav, setNav] = useState<NavKey>('home');
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const data = useIronBrotherData();
  const wrongNetwork = isConnected && chainId !== bscTestnet.id;

  return (
    <div className="app-shell">
      <header className="mobile-frame top-frame">
        <div className="topbar">
          <div>
            <p className="eyebrow">IronBrother</p>
            <h1>Hi, {shortAddress(address)}</h1>
          </div>
          <ConnectButton accountStatus="avatar" chainStatus="icon" showBalance={false} />
        </div>
        {!isContractConfigured && (
          <div className="notice warning">
            合约地址未配置，当前展示 Demo 数据。部署后设置 VITE_IRONBROTHER_CONTRACT_ADDRESS 即可启用真实交易。
          </div>
        )}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            切换到 BSC Testnet
          </button>
        )}
      </header>

      <main className="mobile-frame content-frame">
        {nav === 'home' && <HomeScreen data={data} />}
        {nav === 'stake' && <StakeScreen data={data} disabled={!isConnected || wrongNetwork || !isContractConfigured} />}
        {nav === 'wallet' && <WalletScreen data={data} disabled={!isConnected || wrongNetwork || !isContractConfigured} />}
        {nav === 'team' && <TeamScreen data={data} />}
        {nav === 'profile' && <ProfileScreen address={address} data={data} />}
      </main>

      <nav className="mobile-frame bottom-nav" aria-label="主导航">
        <NavButton icon={<Landmark />} label="首页" active={nav === 'home'} onClick={() => setNav('home')} />
        <NavButton icon={<Coins />} label="质押" active={nav === 'stake'} onClick={() => setNav('stake')} />
        <NavButton icon={<Wallet />} label="钱包" active={nav === 'wallet'} onClick={() => setNav('wallet')} />
        <NavButton icon={<Users />} label="团队" active={nav === 'team'} onClick={() => setNav('team')} />
        <NavButton icon={<UserRound />} label="我的" active={nav === 'profile'} onClick={() => setNav('profile')} />
      </nav>
    </div>
  );
}

function HomeScreen({ data }: { data: ReturnType<typeof useIronBrotherData> }) {
  const sessionLabel = data.currentSession === 1 ? '上午场' : data.currentSession === 2 ? '下午场' : '休息中';

  return (
    <section className="screen-stack">
      <div className="asset-card glow">
        <div className="card-row">
          <span>本金钱包</span>
          <LockKeyhole size={18} />
        </div>
        <strong>{token(data.account.principalBalance)} U</strong>
        <small>可质押 {token(data.availablePrincipal)} U</small>
      </div>

      <div className="quick-grid">
        <MetricCard label="收益钱包" value={`${token(data.account.rewardBalance)} U`} trend={`今日收益率 ${bpsToPercent(data.yieldBps)} / 次`} />
        <MetricCard label="到期未赎回" value={`${token(data.maturedUnredeemed)} U`} trend="到期订单需手动赎回" />
      </div>

      <div className="action-grid">
        <ActionPill icon={<ArrowDownToLine />} label="入金" />
        <ActionPill icon={<Coins />} label="质押" />
        <ActionPill icon={<Repeat2 />} label="复投" />
        <ActionPill icon={<ArrowUpRight />} label="提现" />
      </div>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Today</p>
            <h2>质押场次</h2>
          </div>
          <span className="status-chip">{sessionLabel}</span>
        </div>
        <div className="session-list">
          <SessionRow title="上午场" time="09:00-12:00" state={data.currentSession === 1 ? '可质押' : '待开放'} amount="每钱包每日 1 单" />
          <SessionRow title="下午场" time="14:00-17:00" state={data.currentSession === 2 ? '可质押' : '待开放'} amount="每钱包每日 1 单" />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>最新订单</h2>
          <span>{data.principalOrderIds.length || mockOrders.length} 笔</span>
        </div>
        {mockOrders.map((order) => (
          <OrderRow key={String(order.id)} label={order.label} amount={order.amount} status={order.status} time={order.time} />
        ))}
      </section>
    </section>
  );
}

function StakeScreen({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [amount, setAmount] = useState('400');
  const parsedAmount = useMemo(() => {
    try {
      return parseTokenInput(amount);
    } catch {
      return 0n;
    }
  }, [amount]);
  const estimatedReward = (parsedAmount * data.yieldBps) / 10_000n;

  return (
    <section className="screen-stack">
      <section className="panel pay-panel">
        <div className="section-title centered">
          <span />
          <h2>质押</h2>
          <Clock3 size={18} />
        </div>
        <label className="amount-field">
          <span>质押金额</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          <small>可质押 {token(data.availablePrincipal)} U</small>
        </label>

        <div className="calc-grid">
          <MetricCard label="单次收益率" value={bpsToPercent(data.yieldBps)} trend="后台可调 0.5%-5%" />
          <MetricCard label="预计收益" value={`+${token(estimatedReward)} U`} trend={`结算时间 ${dateTime(data.sessionSettleAt)}`} />
        </div>

        <button
          className="primary-button"
          disabled={disabled || parsedAmount <= 0n}
          onClick={() =>
            runTx('确认质押', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'stake',
                args: [parsedAmount],
              }),
            )
          }
        >
          确认质押
        </button>
        <TxStatus tx={tx} />
      </section>
    </section>
  );
}

function WalletScreen({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  return (
    <section className="screen-stack">
      <DepositPanel disabled={disabled} />
      <WalletActions data={data} disabled={disabled} />
      <section className="panel">
        <div className="section-title">
          <h2>本金订单</h2>
          <span>{data.principalOrderIds.length || mockOrders.length} 笔</span>
        </div>
        {mockOrders.map((order) => (
          <OrderRow key={String(order.id)} label={order.label} amount={order.amount} status={order.status} time={order.time} />
        ))}
      </section>
    </section>
  );
}

function DepositPanel({ disabled }: { disabled: boolean }) {
  const { address } = useAccount();
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [amount, setAmount] = useState('200');
  const [referrer, setReferrer] = useState('');
  const parsedAmount = useMemo(() => {
    try {
      return parseTokenInput(amount);
    } catch {
      return 0n;
    }
  }, [amount]);

  const allowanceQuery = useReadContract({
    address: BSC_USDT_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? zeroAddress, CONTRACT_ADDRESS],
    query: { enabled: Boolean(isContractConfigured && address && parsedAmount > 0n) },
  });
  const allowance = (allowanceQuery.data as bigint | undefined) ?? 0n;
  const needsApproval = parsedAmount > 0n && allowance < parsedAmount;

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">BEP-20 USDT</p>
          <h2>链上入金</h2>
        </div>
        <span className="status-chip">BSC</span>
      </div>
      <div className="form-grid">
        <label>
          入金金额
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          邀请人地址
          <input value={referrer} onChange={(event) => setReferrer(event.target.value)} placeholder="可选" />
        </label>
      </div>
      <div className="split-buttons">
        <button
          className="secondary-button"
          disabled={disabled || !needsApproval}
          onClick={() =>
            runTx('授权 USDT', () =>
              writeContractAsync({
                address: BSC_USDT_ADDRESS,
                abi: erc20Abi,
                functionName: 'approve',
                args: [CONTRACT_ADDRESS, parsedAmount],
              }),
            )
          }
        >
          授权 USDT
        </button>
        <button
          className="primary-button"
          disabled={disabled || parsedAmount <= 0n || needsApproval}
          onClick={() =>
            runTx('确认入金', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'deposit',
                args: [parsedAmount, safeAddress(referrer)],
              }),
            )
          }
        >
          确认入金
        </button>
      </div>
      <TxStatus tx={tx} />
    </section>
  );
}

function WalletActions({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [reinvestAmount, setReinvestAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('120');
  const [redeemId, setRedeemId] = useState('1');
  const [stakeId, setStakeId] = useState('1');

  const reinvestParsed = useMemo(() => {
    try {
      return parseTokenInput(reinvestAmount);
    } catch {
      return 0n;
    }
  }, [reinvestAmount]);
  const withdrawParsed = useMemo(() => {
    try {
      return parseTokenInput(withdrawAmount);
    } catch {
      return 0n;
    }
  }, [withdrawAmount]);
  const netWithdrawal = withdrawParsed > data.withdrawFee ? withdrawParsed - data.withdrawFee : 0n;

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Reward wallet</p>
          <h2>收益钱包</h2>
        </div>
        <strong>{token(data.account.rewardBalance)} U</strong>
      </div>
      <div className="calc-grid">
        <MetricCard label="静态累计" value={`${token(data.account.totalStaticReward)} U`} trend="质押按次结算" />
        <MetricCard label="动态累计" value={`${token(data.account.totalDynamicReward)} U`} trend="每日 0 点后可结算" />
      </div>
      <div className="form-grid">
        <label>
          复投金额
          <input value={reinvestAmount} onChange={(event) => setReinvestAmount(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          提现金额
          <input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" />
        </label>
      </div>
      <p className="helper-line">提现手续费 {token(data.withdrawFee)} U，预计到账 {token(netWithdrawal)} U</p>
      <div className="split-buttons">
        <button
          className="secondary-button"
          disabled={disabled || reinvestParsed <= 0n}
          onClick={() =>
            runTx('收益复投', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'reinvest',
                args: [reinvestParsed],
              }),
            )
          }
        >
          复投
        </button>
        <button
          className="primary-button"
          disabled={disabled || withdrawParsed <= 0n}
          onClick={() =>
            runTx('收益提现', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'withdrawRewards',
                args: [withdrawParsed],
              }),
            )
          }
        >
          提现
        </button>
      </div>
      <div className="form-grid">
        <label>
          赎回订单 ID
          <input value={redeemId} onChange={(event) => setRedeemId(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          结算质押 ID
          <input value={stakeId} onChange={(event) => setStakeId(event.target.value)} inputMode="numeric" />
        </label>
      </div>
      <div className="split-buttons">
        <button
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            runTx('赎回本金', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'redeemPrincipal',
                args: [BigInt(redeemId || '0')],
              }),
            )
          }
        >
          赎回本金
        </button>
        <button
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            runTx('结算质押', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'settleStake',
                args: [BigInt(stakeId || '0')],
              }),
            )
          }
        >
          结算质押
        </button>
      </div>
      <TxStatus tx={tx} />
    </section>
  );
}

function TeamScreen({ data }: { data: ReturnType<typeof useIronBrotherData> }) {
  return (
    <section className="screen-stack">
      <div className="asset-card">
        <div className="card-row">
          <span>当前可拿代数</span>
          <Gift size={18} />
        </div>
        <strong>{data.account.whitelist40 ? '40 代' : '10 代'}</strong>
        <small>直推人数 {data.account.directCount.toString()}，有效账户按日统计</small>
      </div>
      <div className="quick-grid">
        <MetricCard label="团队业绩" value="18,600 U" trend="入金和复投计入，赎回扣减" />
        <MetricCard label="动态奖励" value={`${token(data.account.totalDynamicReward)} U`} trend="按下级质押流水结算" />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>直推列表</h2>
          <span>{mockTeam.length} 人</span>
        </div>
        {mockTeam.map((item) => (
          <div className="list-row" key={item.address}>
            <div className="row-icon"><Users size={17} /></div>
            <div>
              <strong>{item.address}</strong>
              <small>今日流水 {item.volume}</small>
            </div>
            <span className={item.status === '有效账户' ? 'amount-positive' : 'amount-muted'}>{item.status}</span>
          </div>
        ))}
      </section>
    </section>
  );
}

function ProfileScreen({ address, data }: { address?: Address; data: ReturnType<typeof useIronBrotherData> }) {
  return (
    <section className="screen-stack">
      <section className="panel profile-panel">
        <div className="avatar-large">{address ? address.slice(2, 4).toUpperCase() : 'IB'}</div>
        <h2>{shortAddress(address)}</h2>
        <p>上级 {shortAddress(data.account.referrer)}</p>
      </section>
      <section className="panel">
        <InfoLine label="USDT 合约" value={shortAddress(BSC_USDT_ADDRESS)} />
        <InfoLine label="业务合约" value={isContractConfigured ? shortAddress(CONTRACT_ADDRESS) : '未配置'} />
        <InfoLine label="网络" value="BSC Testnet" />
        <InfoLine label="语言" value="中文繁体 / English / 日本語 / 한국어 / Tiếng Việt / Malay" />
      </section>
    </section>
  );
}

function AdminConsole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongNetwork = isConnected && chainId !== bscTestnet.id;
  const { switchChain } = useSwitchChain();
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [yieldPercent, setYieldPercent] = useState('1');
  const [feeAmount, setFeeAmount] = useState('10');
  const [targetAddress, setTargetAddress] = useState('');
  const [dynamicUser, setDynamicUser] = useState('');
  const [dynamicDay, setDynamicDay] = useState('');

  const dashboard = useAdminDashboard();
  const role = useAdminRole(address);

  const canEdit = isContractConfigured && role.isSuperAdmin;
  const readOnly = isContractConfigured && role.isManager && !role.isSuperAdmin;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div>
          <p className="eyebrow">IronBrother</p>
          <h1>Admin</h1>
        </div>
        <a href="/">客户页面</a>
        <span className="side-active">数据看板</span>
        <span>用户管理</span>
        <span>本金订单</span>
        <span>质押订单</span>
        <span>收益流水</span>
        <span>团队关系</span>
        <span>合约配置</span>
        <span>权限管理</span>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">BSC Contract Console</p>
            <h1>链上管理面板</h1>
          </div>
          <ConnectButton accountStatus="address" chainStatus="full" showBalance={false} />
        </header>

        {!isContractConfigured && <div className="notice warning">未配置合约地址，后台展示 Demo 数据，写操作已禁用。</div>}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            切换到 BSC Testnet
          </button>
        )}
        {readOnly && <div className="notice">当前钱包是 Manager，只能查看数据，不能修改合约配置。</div>}

        <section className="admin-grid">
          <AdminCard icon={<Users />} label="总用户" value={dashboard.totalUsers.toString()} />
          <AdminCard icon={<ArrowDownToLine />} label="总入金" value={`${token(dashboard.totalDepositedAmount)} U`} />
          <AdminCard icon={<Wallet />} label="当前本金" value={`${token(dashboard.totalPrincipalBalance)} U`} />
          <AdminCard icon={<Gift />} label="当前收益" value={`${token(dashboard.totalRewardBalance)} U`} />
          <AdminCard icon={<BarChart3 />} label="质押流水" value={`${token(dashboard.totalStakedVolume)} U`} />
          <AdminCard icon={<Coins />} label="静态收益" value={`${token(dashboard.totalStaticRewardCredited)} U`} />
          <AdminCard icon={<Users />} label="动态奖励" value={`${token(dashboard.totalDynamicRewardCredited)} U`} />
          <AdminCard icon={<Send />} label="提现总额" value={`${token(dashboard.totalWithdrawnAmount)} U`} />
        </section>

        <section className="admin-columns">
          <div className="admin-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Owner / Admin</p>
                <h2>合约配置</h2>
              </div>
              <Settings size={20} />
            </div>
            <div className="form-grid">
              <label>
                单次收益率 %
                <input value={yieldPercent} onChange={(event) => setYieldPercent(event.target.value)} />
              </label>
              <label>
                提现手续费 U
                <input value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} />
              </label>
            </div>
            <div className="split-buttons">
              <button
                className="primary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('设置收益率', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'setYieldBps',
                      args: [BigInt(Math.round(Number(yieldPercent) * 100))],
                    }),
                  )
                }
              >
                保存收益率
              </button>
              <button
                className="secondary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('设置提现手续费', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'setWithdrawFee',
                      args: [parseTokenInput(feeAmount)],
                    }),
                  )
                }
              >
                保存手续费
              </button>
            </div>
            <div className="split-buttons">
              <button
                className="secondary-button danger-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('暂停合约', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'pause',
                    }),
                  )
                }
              >
                <PauseCircle size={17} />
                暂停
              </button>
              <button
                className="secondary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('恢复合约', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'unpause',
                    }),
                  )
                }
              >
                <CheckCircle2 size={17} />
                恢复
              </button>
            </div>
          </div>

          <div className="admin-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Roles</p>
                <h2>权限与白名单</h2>
              </div>
              <Shield size={20} />
            </div>
            <label>
              钱包地址
              <input value={targetAddress} onChange={(event) => setTargetAddress(event.target.value)} placeholder="0x..." />
            </label>
            <div className="button-stack">
              <button
                className="secondary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('设置 40 代白名单', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'setWhitelist40',
                      args: [safeAddress(targetAddress), true],
                    }),
                  )
                }
              >
                设为 40 代白名单
              </button>
              <button
                className="secondary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('设置 Manager', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'setManager',
                      args: [safeAddress(targetAddress), true],
                    }),
                  )
                }
              >
                设为 Manager
              </button>
              <button
                className="secondary-button"
                disabled={!canEdit}
                onClick={() =>
                  runTx('设置 Admin', () =>
                    writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'setAdmin',
                      args: [safeAddress(targetAddress), true],
                    }),
                  )
                }
              >
                设为 Admin
              </button>
            </div>
          </div>
        </section>

        <section className="admin-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Daily settlement</p>
              <h2>动态奖励结算</h2>
            </div>
            <Clock3 size={20} />
          </div>
          <div className="form-grid">
            <label>
              用户地址
              <input value={dynamicUser} onChange={(event) => setDynamicUser(event.target.value)} placeholder="0x..." />
            </label>
            <label>
              本地日编号
              <input value={dynamicDay} onChange={(event) => setDynamicDay(event.target.value)} placeholder="例如 20579" />
            </label>
          </div>
          <button
            className="primary-button compact"
            disabled={!isContractConfigured || wrongNetwork || !dynamicDay}
            onClick={() =>
              runTx('结算动态奖励', () =>
                writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleDynamicRewardForUser',
                  args: [safeAddress(dynamicUser), BigInt(dynamicDay || '0')],
                }),
              )
            }
          >
            结算该用户动态奖励
          </button>
          <TxStatus tx={tx} />
        </section>
      </main>
    </div>
  );
}

function useAdminDashboard() {
  const query = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalUsers' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalDepositedAmount' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalPrincipalBalance' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalRewardBalance' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalStakedVolume' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalStaticRewardCredited' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalDynamicRewardCredited' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalWithdrawnAmount' },
    ],
    query: { enabled: isContractConfigured },
  });

  const pick = (index: number, fallback: bigint) => {
    const result = query.data?.[index];
    return result?.status === 'success' ? (result.result as bigint) : fallback;
  };

  return {
    totalUsers: pick(0, mockDashboard.totalUsers),
    totalDepositedAmount: pick(1, mockDashboard.totalDepositedAmount),
    totalPrincipalBalance: pick(2, mockDashboard.totalPrincipalBalance),
    totalRewardBalance: pick(3, mockDashboard.totalRewardBalance),
    totalStakedVolume: pick(4, mockDashboard.totalStakedVolume),
    totalStaticRewardCredited: pick(5, mockDashboard.totalStaticRewardCredited),
    totalDynamicRewardCredited: pick(6, mockDashboard.totalDynamicRewardCredited),
    totalWithdrawnAmount: pick(7, mockDashboard.totalWithdrawnAmount),
  };
}

function useAdminRole(address?: Address) {
  const managerRoleQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'MANAGER_ROLE',
    query: { enabled: isContractConfigured },
  });
  const managerRole = (managerRoleQuery.data as Hex | undefined) ?? DEFAULT_ADMIN_ROLE;

  const superQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'hasRole',
    args: [DEFAULT_ADMIN_ROLE, address ?? zeroAddress],
    query: { enabled: Boolean(isContractConfigured && address) },
  });
  const managerQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'hasRole',
    args: [managerRole, address ?? zeroAddress],
    query: { enabled: Boolean(isContractConfigured && address) },
  });

  return {
    isSuperAdmin: Boolean(superQuery.data),
    isManager: Boolean(managerQuery.data),
  };
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'nav-button active' : 'nav-button'} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </div>
  );
}

function ActionPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="action-pill">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SessionRow({ title, time, state, amount }: { title: string; time: string; state: string; amount: string }) {
  return (
    <div className="session-row">
      <div className="row-icon"><Clock3 size={17} /></div>
      <div>
        <strong>{title}</strong>
        <small>{time}</small>
      </div>
      <div className="row-right">
        <span>{state}</span>
        <small>{amount}</small>
      </div>
    </div>
  );
}

function OrderRow({ label, amount, status, time }: { label: string; amount: bigint; status: string; time: string }) {
  return (
    <div className="list-row">
      <div className="row-icon"><Landmark size={17} /></div>
      <div>
        <strong>{label}</strong>
        <small>{time}</small>
      </div>
      <div className="row-right">
        <span>{token(amount)} U</span>
        <small>{status}</small>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AdminCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="admin-card">
      <div className="row-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TxStatus({ tx }: { tx: { label: string; hash?: Hash; status: string; error?: string } }) {
  if (tx.status === 'idle') return null;

  return (
    <div className={`tx-status ${tx.status}`}>
      <strong>{tx.label}</strong>
      <span>
        {tx.status === 'wallet' && '等待钱包签名'}
        {tx.status === 'pending' && '交易已提交，等待链上确认'}
        {tx.status === 'confirmed' && '交易已确认'}
        {tx.status === 'failed' && (tx.error || '交易失败')}
      </span>
      {tx.hash && (
        <a href={`https://bscscan.com/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          查看交易
        </a>
      )}
    </div>
  );
}

export default App;
