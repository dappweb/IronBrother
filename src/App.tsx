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
import { useEffect, useMemo, useState } from 'react';
import type { Address, Hash, Hex } from 'viem';
import { formatUnits, isAddress, zeroAddress } from 'viem';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { erc20Abi, ironBrotherAbi } from './abi/ironBrother';
import { BSC_USDT_ADDRESS, IRONBROTHER_CONTRACT_ADDRESS, isContractConfigured } from './config/contracts';
import { bpsToPercent, dateTime, parseTokenInput, safeAddress, shortAddress, token } from './lib/format';

type NavKey = 'home' | 'stake' | 'wallet' | 'team' | 'profile';
type AdminNavKey = 'dashboard' | 'users' | 'principal' | 'stakes' | 'rewards' | 'team' | 'config' | 'roles';

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

type UserAccountData = {
  referrer: Address;
  principalBalance: bigint;
  principalStaked: bigint;
  rewardBalance: bigint;
  totalDeposited: bigint;
  totalStaked: bigint;
  totalStaticReward: bigint;
  totalDynamicReward: bigint;
  totalWithdrawn: bigint;
  directCount: bigint;
  registered: boolean;
  whitelist40: boolean;
};

type PrincipalOrderTuple = readonly [bigint, Address, bigint, bigint, bigint, number, number];
type StakeOrderTuple = readonly [bigint, Address, bigint, bigint, bigint, bigint, number, bigint, bigint, boolean];

type PrincipalOrderData = {
  id: bigint;
  user: Address;
  amount: bigint;
  createdAt: bigint;
  unlockAt: bigint;
  source: number;
  status: number;
};

type StakeOrderData = {
  id: bigint;
  user: Address;
  amount: bigint;
  rewardBps: bigint;
  reward: bigint;
  day: bigint;
  session: number;
  createdAt: bigint;
  settleAt: bigint;
  settled: boolean;
};

type DirectReferralRow = {
  address: Address;
  account: UserAccountData;
  dailyStakeVolume: bigint;
  isValidToday: boolean;
};

type ChainEventRecord = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hex;
const CONTRACT_ADDRESS = IRONBROTHER_CONTRACT_ADDRESS ?? zeroAddress;
const EVENT_LOOKBACK_BLOCKS = 200_000n;
const EVENT_CHUNK_BLOCKS = 20_000n;

const emptyUser: UserAccountData = {
  referrer: zeroAddress,
  principalBalance: 0n,
  principalStaked: 0n,
  rewardBalance: 0n,
  totalDeposited: 0n,
  totalStaked: 0n,
  totalStaticReward: 0n,
  totalDynamicReward: 0n,
  totalWithdrawn: 0n,
  directCount: 0n,
  registered: false,
  whitelist40: false,
};

const emptyDashboard = {
  totalUsers: 0n,
  totalDepositedAmount: 0n,
  totalPrincipalBalance: 0n,
  totalRewardBalance: 0n,
  totalStakedVolume: 0n,
  totalStaticRewardCredited: 0n,
  totalDynamicRewardCredited: 0n,
  totalWithdrawnAmount: 0n,
};

function userFromTuple(data: unknown): UserAccountData {
  const tuple = data as UserTuple | undefined;
  if (!tuple) {
    return emptyUser;
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

function principalOrderFromTuple(data: unknown): PrincipalOrderData | undefined {
  const tuple = data as PrincipalOrderTuple | undefined;
  if (!tuple || tuple[0] === 0n || tuple[1] === zeroAddress) return undefined;

  return {
    id: tuple[0],
    user: tuple[1],
    amount: tuple[2],
    createdAt: tuple[3],
    unlockAt: tuple[4],
    source: Number(tuple[5]),
    status: Number(tuple[6]),
  };
}

function stakeOrderFromTuple(data: unknown): StakeOrderData | undefined {
  const tuple = data as StakeOrderTuple | undefined;
  if (!tuple || tuple[0] === 0n || tuple[1] === zeroAddress) return undefined;

  return {
    id: tuple[0],
    user: tuple[1],
    amount: tuple[2],
    rewardBps: tuple[3],
    reward: tuple[4],
    day: tuple[5],
    session: Number(tuple[6]),
    createdAt: tuple[7],
    settleAt: tuple[8],
    settled: tuple[9],
  };
}

function readResult<T>(data: unknown, fallback: T): T {
  const result = data as { status?: string; result?: T } | undefined;
  return result?.status === 'success' && result.result !== undefined ? result.result : fallback;
}

function uniqueAddresses(addresses: readonly (Address | string | undefined)[]) {
  const seen = new Map<string, Address>();
  for (const address of addresses) {
    if (address && isAddress(address) && !seen.has(address.toLowerCase())) {
      seen.set(address.toLowerCase(), address as Address);
    }
  }
  return [...seen.values()];
}

function recentIds(nextId?: bigint, limit = 40) {
  if (!nextId || nextId <= 1n) return [] as bigint[];

  const ids: bigint[] = [];
  const floor = nextId > BigInt(limit) ? nextId - BigInt(limit) : 1n;
  for (let id = nextId - 1n; id >= floor; id -= 1n) {
    ids.push(id);
    if (id === 1n) break;
  }
  return ids;
}

function principalSourceLabel(source: number) {
  return source === 1 ? '复投订单' : '入金订单';
}

function principalStatusLabel(order: PrincipalOrderData) {
  if (order.status === 1) return '已赎回';
  return BigInt(Math.floor(Date.now() / 1000)) >= order.unlockAt ? '可赎回' : '锁定中';
}

function stakeStatusLabel(order: StakeOrderData) {
  if (order.settled) return '已结算';
  return BigInt(Math.floor(Date.now() / 1000)) >= order.settleAt ? '可结算' : '待结算';
}

function sessionLabel(session: number) {
  if (session === 1) return '上午场';
  if (session === 2) return '下午场';
  return '休息中';
}

function parseBigIntInput(value: string) {
  try {
    return BigInt(value.trim() || '0');
  } catch {
    return 0n;
  }
}

function parseBlockEnv(value?: string) {
  try {
    return value ? BigInt(value) : undefined;
  } catch {
    return undefined;
  }
}

function secondsToHours(value?: bigint | number) {
  const numeric = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return String(numeric / 3600);
}

function hoursToSeconds(value: string) {
  return BigInt(Math.round(Number(value || '0') * 3600));
}

function daysToSeconds(value: string) {
  return BigInt(Math.round(Number(value || '0') * 24 * 60 * 60));
}

function secondsToDays(value?: bigint | number) {
  const numeric = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return String(numeric / (24 * 60 * 60));
}

function tokenInput(value?: bigint) {
  if (!value) return '0';
  return formatUnits(value, 18);
}

function bpsInput(value?: bigint | number) {
  const raw = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return String(raw / 100);
}

function parseAddressList(value: string) {
  return value
    .split(/[\s,;]+/)
    .filter((item) => isAddress(item)) as Address[];
}

function parseIdList(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((item) => parseBigIntInput(item))
    .filter((item) => item > 0n);
}

function App() {
  const isAdminRoute = window.location.pathname.startsWith('/admin');

  return isAdminRoute ? <AdminConsole /> : <CustomerApp />;
}

function useUserOrders(accountAddress: Address, enabled: boolean) {
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

  const principalOrderIds = (principalOrderIdsQuery.data as readonly bigint[] | undefined) ?? [];
  const stakeOrderIds = (stakeOrderIdsQuery.data as readonly bigint[] | undefined) ?? [];

  const principalOrderContracts = useMemo(
    () =>
      principalOrderIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'principalOrders',
        args: [id],
      })),
    [principalOrderIds],
  );

  const stakeOrderContracts = useMemo(
    () =>
      stakeOrderIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'stakeOrders',
        args: [id],
      })),
    [stakeOrderIds],
  );

  const principalOrdersQuery = useReadContracts({
    contracts: principalOrderContracts as never,
    query: { enabled: enabled && principalOrderContracts.length > 0 },
  });

  const stakeOrdersQuery = useReadContracts({
    contracts: stakeOrderContracts as never,
    query: { enabled: enabled && stakeOrderContracts.length > 0 },
  });

  const principalOrders = useMemo(
    () =>
      (principalOrdersQuery.data ?? [])
        .map((result) => principalOrderFromTuple(readResult(result, undefined)))
        .filter((order): order is PrincipalOrderData => Boolean(order)),
    [principalOrdersQuery.data],
  );

  const stakeOrders = useMemo(
    () =>
      (stakeOrdersQuery.data ?? [])
        .map((result) => stakeOrderFromTuple(readResult(result, undefined)))
        .filter((order): order is StakeOrderData => Boolean(order)),
    [stakeOrdersQuery.data],
  );

  return {
    principalOrderIds,
    stakeOrderIds,
    principalOrders,
    stakeOrders,
    isLoading: principalOrderIdsQuery.isLoading || stakeOrderIdsQuery.isLoading || principalOrdersQuery.isLoading || stakeOrdersQuery.isLoading,
  };
}

function useDirectReferralRows(rootAddress: Address, day: bigint, enabled = true) {
  const referralsQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getDirectReferrals',
    args: [rootAddress],
    query: { enabled: Boolean(isContractConfigured && enabled && rootAddress !== zeroAddress) },
  });

  const referralAddresses = (referralsQuery.data as readonly Address[] | undefined) ?? [];

  const detailContracts = useMemo(
    () =>
      referralAddresses.flatMap((referral) => [
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'users', args: [referral] },
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'dailyStakeVolume', args: [referral, day] },
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'isValidOnDay', args: [referral, day] },
      ]),
    [day, referralAddresses],
  );

  const detailQuery = useReadContracts({
    contracts: detailContracts as never,
    query: { enabled: Boolean(isContractConfigured && enabled && referralAddresses.length > 0) },
  });

  const rows = useMemo(
    () =>
      referralAddresses.map((referral, index) => {
        const base = index * 3;
        return {
          address: referral,
          account: userFromTuple(readResult(detailQuery.data?.[base], undefined)),
          dailyStakeVolume: readResult(detailQuery.data?.[base + 1], 0n),
          isValidToday: readResult(detailQuery.data?.[base + 2], false),
        };
      }),
    [detailQuery.data, referralAddresses],
  );

  return {
    rows,
    isLoading: referralsQuery.isLoading || detailQuery.isLoading,
  };
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

  const currentDayQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentLocalDay',
    query: { enabled: isContractConfigured },
  });

  const account = userFromTuple(userQuery.data);
  const sessionTuple = sessionQuery.data as readonly [number, bigint] | undefined;
  const currentLocalDay = (currentDayQuery.data as bigint | undefined) ?? 0n;
  const orders = useUserOrders(accountAddress, enabled);
  const directReferrals = useDirectReferralRows(accountAddress, currentLocalDay, enabled);

  return {
    account,
    availablePrincipal: (availableQuery.data as bigint | undefined) ?? 0n,
    maturedUnredeemed: (maturedQuery.data as bigint | undefined) ?? 0n,
    currentSession: Number(sessionTuple?.[0] ?? 0),
    sessionSettleAt: sessionTuple?.[1] ?? 0n,
    yieldBps: (yieldQuery.data as bigint | undefined) ?? 100n,
    withdrawFee: (withdrawFeeQuery.data as bigint | undefined) ?? 10n * 10n ** 18n,
    currentLocalDay,
    principalOrderIds: orders.principalOrderIds,
    stakeOrderIds: orders.stakeOrderIds,
    principalOrders: orders.principalOrders,
    stakeOrders: orders.stakeOrders,
    directReferrals: directReferrals.rows,
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
            合约地址未配置，链上读取和真实交易暂不可用。部署后设置 VITE_IRONBROTHER_CONTRACT_ADDRESS 即可启用。
          </div>
        )}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            切换到 BSC Testnet
          </button>
        )}
      </header>

      <main className="mobile-frame content-frame">
        {nav === 'home' && <HomeScreen data={data} onNavigate={setNav} />}
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

function HomeScreen({ data, onNavigate }: { data: ReturnType<typeof useIronBrotherData>; onNavigate: (nav: NavKey) => void }) {
  const currentSessionLabel = sessionLabel(data.currentSession);
  const recentOrders = useMemo(() => {
    const principal = data.principalOrders.map((order) => ({
      id: `principal-${order.id.toString()}`,
      label: `${principalSourceLabel(order.source)} #${order.id.toString()}`,
      amount: order.amount,
      status: principalStatusLabel(order),
      time: `解锁 ${dateTime(order.unlockAt)}`,
      createdAt: order.createdAt,
    }));
    const stakes = data.stakeOrders.map((order) => ({
      id: `stake-${order.id.toString()}`,
      label: `质押订单 #${order.id.toString()}`,
      amount: order.amount,
      status: stakeStatusLabel(order),
      time: `${sessionLabel(order.session)} / 结算 ${dateTime(order.settleAt)}`,
      createdAt: order.createdAt,
    }));

    return [...principal, ...stakes]
      .sort((a, b) => Number(b.createdAt - a.createdAt))
      .slice(0, 5);
  }, [data.principalOrders, data.stakeOrders]);

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
        <ActionPill icon={<ArrowDownToLine />} label="入金" onClick={() => onNavigate('wallet')} />
        <ActionPill icon={<Coins />} label="质押" onClick={() => onNavigate('stake')} />
        <ActionPill icon={<Repeat2 />} label="复投" onClick={() => onNavigate('wallet')} />
        <ActionPill icon={<ArrowUpRight />} label="提现" onClick={() => onNavigate('wallet')} />
      </div>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Today</p>
            <h2>质押场次</h2>
          </div>
          <span className="status-chip">{currentSessionLabel}</span>
        </div>
        <div className="session-list">
          <SessionRow title="上午场" time="09:00-12:00" state={data.currentSession === 1 ? '可质押' : '待开放'} amount="每钱包每日 1 单" />
          <SessionRow title="下午场" time="14:00-17:00" state={data.currentSession === 2 ? '可质押' : '待开放'} amount="每钱包每日 1 单" />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>最新订单</h2>
          <span>{recentOrders.length} 笔</span>
        </div>
        {recentOrders.length > 0 ? (
          recentOrders.map((order) => (
            <OrderRow key={order.id} label={order.label} amount={order.amount} status={order.status} time={order.time} />
          ))
        ) : (
          <EmptyState title="暂无链上订单" detail="连接钱包后会直接读取该地址的本金和质押订单。" />
        )}
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

      <StakeOrderList orders={data.stakeOrders} />
    </section>
  );
}

function WalletScreen({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  return (
    <section className="screen-stack">
      <DepositPanel disabled={disabled} />
      <WalletActions data={data} disabled={disabled} />
      <PrincipalOrderList orders={data.principalOrders} />
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
  const directDailyVolume = data.directReferrals.reduce((sum, item) => sum + item.dailyStakeVolume, 0n);
  const validCount = data.directReferrals.filter((item) => item.isValidToday).length;

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
        <MetricCard label="今日直推流水" value={`${token(directDailyVolume)} U`} trend={`${validCount} 个今日有效账户`} />
        <MetricCard label="动态奖励" value={`${token(data.account.totalDynamicReward)} U`} trend="按下级质押流水结算" />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>直推列表</h2>
          <span>{data.directReferrals.length} 人</span>
        </div>
        {data.directReferrals.length > 0 ? (
          data.directReferrals.map((item) => <DirectReferralListRow key={item.address} item={item} />)
        ) : (
          <EmptyState title="暂无直推数据" detail="直推关系由合约 getDirectReferrals 直接读取。" />
        )}
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
        <InfoLine label="本地日编号" value={data.currentLocalDay.toString()} />
        <InfoLine label="累计入金" value={`${token(data.account.totalDeposited)} U`} />
        <InfoLine label="累计提现" value={`${token(data.account.totalWithdrawn)} U`} />
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
  const runner = useTxRunner();
  const [nav, setNav] = useState<AdminNavKey>('dashboard');
  const dashboard = useAdminDashboard();
  const role = useAdminRole(address);

  const canEdit = isContractConfigured && role.isSuperAdmin && !wrongNetwork;
  const canWrite = isContractConfigured && !wrongNetwork;
  const readOnly = isContractConfigured && role.isManager && !role.isSuperAdmin;
  const noRole = isConnected && isContractConfigured && !role.isManager && !role.isSuperAdmin;
  const navItems: { key: AdminNavKey; label: string }[] = [
    { key: 'dashboard', label: '数据看板' },
    { key: 'users', label: '用户管理' },
    { key: 'principal', label: '本金订单' },
    { key: 'stakes', label: '质押订单' },
    { key: 'rewards', label: '收益流水' },
    { key: 'team', label: '团队关系' },
    { key: 'config', label: '合约配置' },
    { key: 'roles', label: '权限管理' },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div>
          <p className="eyebrow">IronBrother</p>
          <h1>Admin</h1>
        </div>
        <a href="/">客户页面</a>
        {navItems.map((item) => (
          <button
            key={item.key}
            className={nav === item.key ? 'side-active' : ''}
            onClick={() => setNav(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">BSC Contract Console</p>
            <h1>链上管理面板</h1>
          </div>
          <ConnectButton accountStatus="address" chainStatus="full" showBalance={false} />
        </header>

        {!isContractConfigured && <div className="notice warning">未配置合约地址，后台链上读取和写操作已禁用。</div>}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            切换到 BSC Testnet
          </button>
        )}
        {readOnly && <div className="notice">当前钱包是 Manager，只能查看数据，不能修改合约配置。</div>}
        {noRole && <div className="notice warning">当前钱包没有 Admin/Manager 权限，写操作和受限操作将被禁用。</div>}

        {nav === 'dashboard' && <AdminDashboardPage dashboard={dashboard} />}
        {nav === 'users' && <AdminUsersPage />}
        {nav === 'principal' && <AdminPrincipalOrdersPage />}
        {nav === 'stakes' && <AdminStakeOrdersPage />}
        {nav === 'rewards' && <AdminRewardsPage canWrite={canWrite} runner={runner} />}
        {nav === 'team' && <AdminTeamPage defaultAddress={address} />}
        {nav === 'config' && <AdminConfigPage canEdit={canEdit} runner={runner} />}
        {nav === 'roles' && <AdminRolesPage canEdit={canEdit} runner={runner} />}

        {runner.tx.status !== 'idle' && (
          <section className="admin-panel tx-panel">
            <TxStatus tx={runner.tx} />
          </section>
        )}
      </main>
    </div>
  );
}

function AdminDashboardPage({ dashboard }: { dashboard: ReturnType<typeof useAdminDashboard> }) {
  return (
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
  );
}

function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const lookupAddress = isAddress(search.trim()) ? (search.trim() as Address) : undefined;
  const users = useAdminUsers(lookupAddress);

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Users</p>
          <h2>用户管理</h2>
        </div>
        <span className="status-chip">{users.rows.length} 人</span>
      </div>
      <label className="full-field">
        搜索钱包地址
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入 0x 地址可直接读取该用户链上资料" />
      </label>
      <div className="list-stack">
        {users.rows.length > 0 ? (
          users.rows.map((row) => <AdminUserListRow key={row.address} row={row} />)
        ) : (
          <EmptyState title="暂无用户事件" detail="用户列表来自 UserRegistered 链上事件，搜索地址可直接读取 users(address)。" />
        )}
      </div>
    </section>
  );
}

function AdminUserListRow({ row }: { row: { address: Address; account: UserAccountData; blockNumber?: bigint } }) {
  return (
    <div className="admin-list-row wide">
      <div className="row-icon"><UserRound size={17} /></div>
      <div>
        <strong>{shortAddress(row.address)}</strong>
        <small>上级 {shortAddress(row.account.referrer)} / 直推 {row.account.directCount.toString()}</small>
      </div>
      <div className="row-metrics">
        <span>本金 {token(row.account.principalBalance)} U</span>
        <span>收益 {token(row.account.rewardBalance)} U</span>
        <span>{row.account.whitelist40 ? '40 代白名单' : row.account.registered ? '已注册' : '未注册'}</span>
      </div>
    </div>
  );
}

function AdminPrincipalOrdersPage() {
  const orderBook = useAdminOrderBook();

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Principal Orders</p>
          <h2>本金订单</h2>
        </div>
        <span className="status-chip">{orderBook.principalOrders.length} 笔</span>
      </div>
      <div className="list-stack">
        {orderBook.principalOrders.length > 0 ? (
          orderBook.principalOrders.map((order) => <AdminPrincipalOrderRow key={order.id.toString()} order={order} />)
        ) : (
          <EmptyState title="暂无本金订单" detail="订单列表通过 nextPrincipalOrderId 和 principalOrders(id) 直接读取链上状态。" />
        )}
      </div>
    </section>
  );
}

function AdminStakeOrdersPage() {
  const orderBook = useAdminOrderBook();

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Stake Orders</p>
          <h2>质押订单</h2>
        </div>
        <span className="status-chip">{orderBook.stakeOrders.length} 笔</span>
      </div>
      <div className="list-stack">
        {orderBook.stakeOrders.length > 0 ? (
          orderBook.stakeOrders.map((order) => <AdminStakeOrderRow key={order.id.toString()} order={order} />)
        ) : (
          <EmptyState title="暂无质押订单" detail="订单列表通过 nextStakeOrderId 和 stakeOrders(id) 直接读取链上状态。" />
        )}
      </div>
    </section>
  );
}

function AdminRewardsPage({ canWrite, runner }: { canWrite: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const [dynamicUser, setDynamicUser] = useState('');
  const [dynamicDay, setDynamicDay] = useState('');
  const [batchUsers, setBatchUsers] = useState('');
  const [stakeIds, setStakeIds] = useState('');
  const events = useChainEvents(['StakeSettled', 'DynamicRewardSettled', 'RewardWithdrawn', 'PrincipalRedeemed', 'Reinvested']);

  return (
    <section className="screen-stack">
      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Daily settlement</p>
            <h2>收益结算</h2>
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
          disabled={!canWrite || !dynamicDay || !isAddress(dynamicUser)}
          onClick={() =>
            runner.runTx('结算动态奖励', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'settleDynamicRewardForUser',
                args: [safeAddress(dynamicUser), parseBigIntInput(dynamicDay)],
              }),
            )
          }
        >
          结算该用户动态奖励
        </button>
        <div className="form-grid spaced">
          <label>
            批量用户地址
            <input value={batchUsers} onChange={(event) => setBatchUsers(event.target.value)} placeholder="多个地址用逗号或空格分隔" />
          </label>
          <label>
            批量质押 ID
            <input value={stakeIds} onChange={(event) => setStakeIds(event.target.value)} placeholder="多个 ID 用逗号或空格分隔" />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canWrite || parseAddressList(batchUsers).length === 0 || !dynamicDay}
            onClick={() =>
              runner.runTx('批量结算动态奖励', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleDynamicRewardForUsers',
                  args: [parseAddressList(batchUsers), parseBigIntInput(dynamicDay)],
                }),
              )
            }
          >
            批量动态结算
          </button>
          <button
            className="secondary-button"
            disabled={!canWrite || parseIdList(stakeIds).length === 0}
            onClick={() =>
              runner.runTx('批量结算质押', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleStakes',
                  args: [parseIdList(stakeIds)],
                }),
              )
            }
          >
            批量质押结算
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Events</p>
            <h2>收益流水</h2>
          </div>
          <span className="status-chip">{events.data?.length ?? 0} 条</span>
        </div>
        <div className="list-stack">
          {(events.data ?? []).length > 0 ? (
            events.data?.map((event) => <EventRow key={`${event.transactionHash}-${event.logIndex}`} event={event} />)
          ) : (
            <EmptyState title="暂无流水事件" detail="流水来自合约事件日志，会按区块倒序读取最近链上记录。" />
          )}
        </div>
      </section>
    </section>
  );
}

function AdminTeamPage({ defaultAddress }: { defaultAddress?: Address }) {
  const [rootInput, setRootInput] = useState('');
  const currentDayQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentLocalDay',
    query: { enabled: isContractConfigured },
  });
  const day = (currentDayQuery.data as bigint | undefined) ?? 0n;
  const root = isAddress(rootInput.trim()) ? (rootInput.trim() as Address) : defaultAddress ?? zeroAddress;
  const referrals = useDirectReferralRows(root, day, root !== zeroAddress);

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Referrals</p>
          <h2>团队关系</h2>
        </div>
        <span className="status-chip">{referrals.rows.length} 人</span>
      </div>
      <label className="full-field">
        上级钱包地址
        <input value={rootInput} onChange={(event) => setRootInput(event.target.value)} placeholder="留空默认读取当前钱包的直推" />
      </label>
      <div className="list-stack">
        {referrals.rows.length > 0 ? (
          referrals.rows.map((item) => <DirectReferralListRow key={item.address} item={item} />)
        ) : (
          <EmptyState title="暂无直推关系" detail="团队关系通过 getDirectReferrals(root) 和 users(address) 读取。" />
        )}
      </div>
    </section>
  );
}

function AdminConfigPage({ canEdit, runner }: { canEdit: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const config = useContractConfig();
  const [yieldPercent, setYieldPercent] = useState('1');
  const [minYieldPercent, setMinYieldPercent] = useState('0.5');
  const [maxYieldPercent, setMaxYieldPercent] = useState('5');
  const [feeAmount, setFeeAmount] = useState('10');
  const [minAmount, setMinAmount] = useState('100');
  const [maxAmount, setMaxAmount] = useState('1000');
  const [maxPrincipal, setMaxPrincipal] = useState('1000');
  const [lockDays, setLockDays] = useState('30');
  const [threshold, setThreshold] = useState('1000');
  const [feeReceiver, setFeeReceiver] = useState('');
  const [timezoneHours, setTimezoneHours] = useState('8');
  const [morningStart, setMorningStart] = useState('9');
  const [morningEnd, setMorningEnd] = useState('12');
  const [afternoonStart, setAfternoonStart] = useState('14');
  const [afternoonEnd, setAfternoonEnd] = useState('17');
  const [generation, setGeneration] = useState('1');
  const [generationRate, setGenerationRate] = useState('0.2');

  useEffect(() => {
    if (!isContractConfigured) return;
    setYieldPercent(bpsInput(config.yieldBps));
    setMinYieldPercent(bpsInput(config.minYieldBps));
    setMaxYieldPercent(bpsInput(config.maxYieldBps));
    setFeeAmount(tokenInput(config.withdrawFee));
    setMinAmount(tokenInput(config.minAmount));
    setMaxAmount(tokenInput(config.maxAmount));
    setMaxPrincipal(tokenInput(config.maxPrincipal));
    setLockDays(secondsToDays(config.lockPeriod));
    setThreshold(tokenInput(config.validVolumeThreshold));
    setFeeReceiver(config.feeReceiver === zeroAddress ? '' : config.feeReceiver);
    setTimezoneHours(secondsToHours(config.timezoneOffset));
    setMorningStart(secondsToHours(config.morningStart));
    setMorningEnd(secondsToHours(config.morningEnd));
    setAfternoonStart(secondsToHours(config.afternoonStart));
    setAfternoonEnd(secondsToHours(config.afternoonEnd));
  }, [config.loadedKey]);

  return (
    <section className="screen-stack">
      <section className="admin-grid">
        <AdminCard icon={<Settings />} label="当前收益率" value={bpsToPercent(config.yieldBps)} />
        <AdminCard icon={<Send />} label="提现手续费" value={`${token(config.withdrawFee)} U`} />
        <AdminCard icon={<LockKeyhole />} label="锁仓周期" value={`${secondsToDays(config.lockPeriod)} 天`} />
        <AdminCard icon={<PauseCircle />} label="合约状态" value={config.paused ? '已暂停' : '运行中'} />
      </section>

      <section className="admin-panel">
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
          <label>
            最低收益率 %
            <input value={minYieldPercent} onChange={(event) => setMinYieldPercent(event.target.value)} />
          </label>
          <label>
            最高收益率 %
            <input value={maxYieldPercent} onChange={(event) => setMaxYieldPercent(event.target.value)} />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="primary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置收益率', () =>
                runner.writeContractAsync({
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
              runner.runTx('设置提现手续费', () =>
                runner.writeContractAsync({
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
        <button
          className="secondary-button full-button"
          disabled={!canEdit}
          onClick={() =>
            runner.runTx('设置收益率上下限', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setYieldBounds',
                args: [BigInt(Math.round(Number(minYieldPercent) * 100)), BigInt(Math.round(Number(maxYieldPercent) * 100))],
              }),
            )
          }
        >
          保存收益率范围
        </button>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <h2>金额与时间规则</h2>
          <Clock3 size={20} />
        </div>
        <div className="form-grid">
          <label>
            单笔最小 U
            <input value={minAmount} onChange={(event) => setMinAmount(event.target.value)} />
          </label>
          <label>
            单笔最大 U
            <input value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
          </label>
          <label>
            本金上限 U
            <input value={maxPrincipal} onChange={(event) => setMaxPrincipal(event.target.value)} />
          </label>
          <label>
            锁仓天数
            <input value={lockDays} onChange={(event) => setLockDays(event.target.value)} />
          </label>
          <label>
            有效流水门槛 U
            <input value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </label>
          <label>
            手续费接收地址
            <input value={feeReceiver} onChange={(event) => setFeeReceiver(event.target.value)} placeholder="0x..." />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置金额规则', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setAmountRules',
                  args: [parseTokenInput(minAmount), parseTokenInput(maxAmount), parseTokenInput(maxPrincipal)],
                }),
              )
            }
          >
            保存金额规则
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置锁仓周期', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setLockPeriod',
                  args: [daysToSeconds(lockDays)],
                }),
              )
            }
          >
            保存锁仓周期
          </button>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置有效流水门槛', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setValidVolumeThreshold',
                  args: [parseTokenInput(threshold)],
                }),
              )
            }
          >
            保存有效门槛
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit || !isAddress(feeReceiver)}
            onClick={() =>
              runner.runTx('设置手续费接收地址', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setFeeReceiver',
                  args: [safeAddress(feeReceiver)],
                }),
              )
            }
          >
            保存手续费地址
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <h2>场次与代数</h2>
          <Users size={20} />
        </div>
        <div className="form-grid">
          <label>
            时区偏移小时
            <input value={timezoneHours} onChange={(event) => setTimezoneHours(event.target.value)} />
          </label>
          <label>
            上午开始小时
            <input value={morningStart} onChange={(event) => setMorningStart(event.target.value)} />
          </label>
          <label>
            上午结束小时
            <input value={morningEnd} onChange={(event) => setMorningEnd(event.target.value)} />
          </label>
          <label>
            下午开始小时
            <input value={afternoonStart} onChange={(event) => setAfternoonStart(event.target.value)} />
          </label>
          <label>
            下午结束小时
            <input value={afternoonEnd} onChange={(event) => setAfternoonEnd(event.target.value)} />
          </label>
          <label>
            代数
            <input value={generation} onChange={(event) => setGeneration(event.target.value)} />
          </label>
          <label>
            代数奖励 %
            <input value={generationRate} onChange={(event) => setGenerationRate(event.target.value)} />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置时区', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setTimezoneOffset',
                  args: [hoursToSeconds(timezoneHours)],
                }),
              )
            }
          >
            保存时区
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置质押场次', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setSessionTimes',
                  args: [
                    Number(hoursToSeconds(morningStart)),
                    Number(hoursToSeconds(morningEnd)),
                    Number(hoursToSeconds(afternoonStart)),
                    Number(hoursToSeconds(afternoonEnd)),
                  ],
                }),
              )
            }
          >
            保存场次
          </button>
        </div>
        <button
          className="secondary-button full-button"
          disabled={!canEdit}
          onClick={() =>
            runner.runTx('设置代数奖励比例', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setGenerationRate',
                args: [Number(generation || '0'), Math.round(Number(generationRate) * 100)],
              }),
            )
          }
        >
          保存代数奖励比例
        </button>
        <div className="split-buttons">
          <button
            className="secondary-button danger-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('暂停合约', () =>
                runner.writeContractAsync({ address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'pause' }),
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
              runner.runTx('恢复合约', () =>
                runner.writeContractAsync({ address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'unpause' }),
              )
            }
          >
            <CheckCircle2 size={17} />
            恢复
          </button>
        </div>
      </section>
    </section>
  );
}

function AdminRolesPage({ canEdit, runner }: { canEdit: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const [targetAddress, setTargetAddress] = useState('');
  const target = isAddress(targetAddress.trim()) ? (targetAddress.trim() as Address) : undefined;
  const role = useAdminRole(target);
  const userQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'users',
    args: [target ?? zeroAddress],
    query: { enabled: Boolean(isContractConfigured && target) },
  });
  const account = userFromTuple(userQuery.data);

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Roles</p>
          <h2>权限与白名单</h2>
        </div>
        <Shield size={20} />
      </div>
      <label className="full-field">
        钱包地址
        <input value={targetAddress} onChange={(event) => setTargetAddress(event.target.value)} placeholder="0x..." />
      </label>
      <div className="admin-grid compact-grid">
        <AdminCard icon={<Shield />} label="Admin" value={role.isSuperAdmin ? '是' : '否'} />
        <AdminCard icon={<Settings />} label="Manager" value={role.isManager ? '是' : '否'} />
        <AdminCard icon={<Gift />} label="40 代白名单" value={account.whitelist40 ? '是' : '否'} />
        <AdminCard icon={<Users />} label="直推数" value={account.directCount.toString()} />
      </div>
      <div className="button-stack spaced">
        <button
          className="secondary-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('开启 40 代白名单', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setWhitelist40',
                args: [target ?? zeroAddress, true],
              }),
            )
          }
        >
          开启 40 代白名单
        </button>
        <button
          className="secondary-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('关闭 40 代白名单', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setWhitelist40',
                args: [target ?? zeroAddress, false],
              }),
            )
          }
        >
          关闭 40 代白名单
        </button>
        <button
          className="secondary-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('设置 Manager', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setManager',
                args: [target ?? zeroAddress, true],
              }),
            )
          }
        >
          授予 Manager
        </button>
        <button
          className="secondary-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('移除 Manager', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setManager',
                args: [target ?? zeroAddress, false],
              }),
            )
          }
        >
          移除 Manager
        </button>
        <button
          className="secondary-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('设置 Admin', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setAdmin',
                args: [target ?? zeroAddress, true],
              }),
            )
          }
        >
          授予 Admin
        </button>
        <button
          className="secondary-button danger-button"
          disabled={!canEdit || !target}
          onClick={() =>
            runner.runTx('移除 Admin', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setAdmin',
                args: [target ?? zeroAddress, false],
              }),
            )
          }
        >
          移除 Admin
        </button>
      </div>
    </section>
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
    totalUsers: pick(0, emptyDashboard.totalUsers),
    totalDepositedAmount: pick(1, emptyDashboard.totalDepositedAmount),
    totalPrincipalBalance: pick(2, emptyDashboard.totalPrincipalBalance),
    totalRewardBalance: pick(3, emptyDashboard.totalRewardBalance),
    totalStakedVolume: pick(4, emptyDashboard.totalStakedVolume),
    totalStaticRewardCredited: pick(5, emptyDashboard.totalStaticRewardCredited),
    totalDynamicRewardCredited: pick(6, emptyDashboard.totalDynamicRewardCredited),
    totalWithdrawnAmount: pick(7, emptyDashboard.totalWithdrawnAmount),
  };
}

function useContractConfig() {
  const query = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'minAmount' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'maxAmount' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'maxPrincipal' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'lockPeriod' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'yieldBps' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'minYieldBps' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'maxYieldBps' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'withdrawFee' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'validVolumeThreshold' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'feeReceiver' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'timezoneOffset' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'paused' },
    ],
    query: { enabled: isContractConfigured },
  });

  const pick = <T,>(index: number, fallback: T) => readResult(query.data?.[index], fallback);
  const config = {
    minAmount: pick(0, 0n),
    maxAmount: pick(1, 0n),
    maxPrincipal: pick(2, 0n),
    lockPeriod: pick(3, 0n),
    yieldBps: pick(4, 0n),
    minYieldBps: pick(5, 0n),
    maxYieldBps: pick(6, 0n),
    withdrawFee: pick(7, 0n),
    validVolumeThreshold: pick(8, 0n),
    feeReceiver: pick(9, zeroAddress),
    timezoneOffset: pick(10, 0n),
    morningStart: pick(11, 0),
    morningEnd: pick(12, 0),
    afternoonStart: pick(13, 0),
    afternoonEnd: pick(14, 0),
    paused: pick(15, false),
  };

  return {
    ...config,
    loadedKey: [
      config.minAmount,
      config.maxAmount,
      config.maxPrincipal,
      config.lockPeriod,
      config.yieldBps,
      config.minYieldBps,
      config.maxYieldBps,
      config.withdrawFee,
      config.validVolumeThreshold,
      config.feeReceiver,
      config.timezoneOffset,
      config.morningStart,
      config.morningEnd,
      config.afternoonStart,
      config.afternoonEnd,
      config.paused,
    ].join('|'),
  };
}

function useAdminOrderBook() {
  const nextIdsQuery = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'nextPrincipalOrderId' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'nextStakeOrderId' },
    ],
    query: { enabled: isContractConfigured },
  });

  const nextPrincipalOrderId = readResult(nextIdsQuery.data?.[0], 1n);
  const nextStakeOrderId = readResult(nextIdsQuery.data?.[1], 1n);
  const principalIds = useMemo(() => recentIds(nextPrincipalOrderId), [nextPrincipalOrderId]);
  const stakeIds = useMemo(() => recentIds(nextStakeOrderId), [nextStakeOrderId]);

  const principalOrderContracts = useMemo(
    () =>
      principalIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'principalOrders',
        args: [id],
      })),
    [principalIds],
  );

  const stakeOrderContracts = useMemo(
    () =>
      stakeIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'stakeOrders',
        args: [id],
      })),
    [stakeIds],
  );

  const principalOrdersQuery = useReadContracts({
    contracts: principalOrderContracts as never,
    query: { enabled: principalOrderContracts.length > 0 },
  });
  const stakeOrdersQuery = useReadContracts({
    contracts: stakeOrderContracts as never,
    query: { enabled: stakeOrderContracts.length > 0 },
  });

  return {
    principalOrders: (principalOrdersQuery.data ?? [])
      .map((result) => principalOrderFromTuple(readResult(result, undefined)))
      .filter((order): order is PrincipalOrderData => Boolean(order)),
    stakeOrders: (stakeOrdersQuery.data ?? [])
      .map((result) => stakeOrderFromTuple(readResult(result, undefined)))
      .filter((order): order is StakeOrderData => Boolean(order)),
  };
}

function useChainEvents(eventNames: readonly string[]) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['ironBrotherEvents', CONTRACT_ADDRESS, eventNames.join('|')],
    enabled: Boolean(isContractConfigured && publicClient),
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!publicClient) return [] as ChainEventRecord[];

      const client = publicClient as unknown as {
        getBlockNumber: () => Promise<bigint>;
        getContractEvents: (args: Record<string, unknown>) => Promise<ChainEventRecord[]>;
      };
      const latest = await client.getBlockNumber();
      const configuredFromBlock = parseBlockEnv(import.meta.env.VITE_IRONBROTHER_EVENT_FROM_BLOCK);
      const fromBlock = configuredFromBlock ?? (latest > EVENT_LOOKBACK_BLOCKS ? latest - EVENT_LOOKBACK_BLOCKS : 0n);
      const logs: ChainEventRecord[] = [];

      for (const eventName of eventNames) {
        for (let start = fromBlock; start <= latest; start += EVENT_CHUNK_BLOCKS + 1n) {
          const end = start + EVENT_CHUNK_BLOCKS > latest ? latest : start + EVENT_CHUNK_BLOCKS;
          const chunk = await client.getContractEvents({
            address: CONTRACT_ADDRESS,
            abi: ironBrotherAbi,
            eventName,
            fromBlock: start,
            toBlock: end,
          });
          logs.push(...chunk);
        }
      }

      return logs.sort((a, b) => {
        const blockDiff = Number(b.blockNumber - a.blockNumber);
        return blockDiff === 0 ? Number(b.logIndex - a.logIndex) : blockDiff;
      });
    },
  });
}

function useAdminUsers(extraAddress?: Address) {
  const events = useChainEvents(['UserRegistered']);
  const addresses = useMemo(() => {
    const eventAddresses = (events.data ?? []).map((event) => event.args.user as Address | undefined);
    return uniqueAddresses(extraAddress ? [extraAddress, ...eventAddresses] : eventAddresses);
  }, [events.data, extraAddress]);

  const userContracts = useMemo(
    () =>
      addresses.map((address) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'users',
        args: [address],
      })),
    [addresses],
  );

  const usersQuery = useReadContracts({
    contracts: userContracts as never,
    query: { enabled: isContractConfigured && userContracts.length > 0 },
  });

  const rows = useMemo(
    () =>
      addresses.map((address, index) => ({
        address,
        account: userFromTuple(readResult(usersQuery.data?.[index], undefined)),
      })),
    [addresses, usersQuery.data],
  );

  return { rows };
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

function ActionPill({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="action-pill" type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
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

function PrincipalOrderList({ orders }: { orders: PrincipalOrderData[] }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>本金订单</h2>
        <span>{orders.length} 笔</span>
      </div>
      {orders.length > 0 ? (
        orders.map((order) => (
          <OrderRow
            key={order.id.toString()}
            label={`${principalSourceLabel(order.source)} #${order.id.toString()}`}
            amount={order.amount}
            status={principalStatusLabel(order)}
            time={`创建 ${dateTime(order.createdAt)} / 解锁 ${dateTime(order.unlockAt)}`}
          />
        ))
      ) : (
        <EmptyState title="暂无本金订单" detail="入金和复投后会从 principalOrders(id) 读取显示。" />
      )}
    </section>
  );
}

function StakeOrderList({ orders }: { orders: StakeOrderData[] }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>质押订单</h2>
        <span>{orders.length} 笔</span>
      </div>
      {orders.length > 0 ? (
        orders.map((order) => (
          <OrderRow
            key={order.id.toString()}
            label={`质押订单 #${order.id.toString()}`}
            amount={order.amount}
            status={stakeStatusLabel(order)}
            time={`${sessionLabel(order.session)} / 收益 ${token(order.reward)} U / 结算 ${dateTime(order.settleAt)}`}
          />
        ))
      ) : (
        <EmptyState title="暂无质押订单" detail="质押后会从 stakeOrders(id) 读取显示。" />
      )}
    </section>
  );
}

function DirectReferralListRow({ item }: { item: DirectReferralRow }) {
  return (
    <div className="list-row">
      <div className="row-icon"><Users size={17} /></div>
      <div>
        <strong>{shortAddress(item.address)}</strong>
        <small>今日流水 {token(item.dailyStakeVolume)} U / 本金 {token(item.account.principalBalance)} U</small>
      </div>
      <span className={item.isValidToday ? 'amount-positive' : 'amount-muted'}>
        {item.isValidToday ? '今日有效' : '未达标'}
      </span>
    </div>
  );
}

function AdminPrincipalOrderRow({ order }: { order: PrincipalOrderData }) {
  return (
    <div className="admin-list-row">
      <div className="row-icon"><Landmark size={17} /></div>
      <div>
        <strong>{principalSourceLabel(order.source)} #{order.id.toString()}</strong>
        <small>{shortAddress(order.user)} / 创建 {dateTime(order.createdAt)}</small>
      </div>
      <div className="row-metrics">
        <span>{token(order.amount)} U</span>
        <span>{principalStatusLabel(order)}</span>
        <span>解锁 {dateTime(order.unlockAt)}</span>
      </div>
    </div>
  );
}

function AdminStakeOrderRow({ order }: { order: StakeOrderData }) {
  return (
    <div className="admin-list-row">
      <div className="row-icon"><Coins size={17} /></div>
      <div>
        <strong>质押订单 #{order.id.toString()}</strong>
        <small>{shortAddress(order.user)} / {sessionLabel(order.session)} / Day {order.day.toString()}</small>
      </div>
      <div className="row-metrics">
        <span>本金 {token(order.amount)} U</span>
        <span>收益 {token(order.reward)} U</span>
        <span>{stakeStatusLabel(order)}</span>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: ChainEventRecord }) {
  const args = event.args ?? {};
  const primaryAddress = (args.user || args.source || args.upline || args.funder) as string | undefined;
  const amount = (args.amount || args.reward || args.netAmount || args.principal) as bigint | undefined;

  return (
    <div className="admin-list-row">
      <div className="row-icon"><BarChart3 size={17} /></div>
      <div>
        <strong>{event.eventName}</strong>
        <small>区块 {event.blockNumber.toString()} / {primaryAddress ? shortAddress(primaryAddress) : shortAddress(event.transactionHash)}</small>
      </div>
      <div className="row-metrics">
        <span>{amount !== undefined ? `${token(amount)} U` : '链上事件'}</span>
        <a href={`https://testnet.bscscan.com/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">查看交易</a>
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
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
        <a href={`https://testnet.bscscan.com/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          查看交易
        </a>
      )}
    </div>
  );
}

export default App;
