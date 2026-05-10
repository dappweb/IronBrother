import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  Gift,
  Landmark,
  Languages,
  Link2,
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
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { erc20Abi, ironBrotherAbi } from './abi/ironBrother';
import { bscExplorerBaseUrl, selectedBscChain } from './config/chains';
import { BSC_USDT_ADDRESS, IRONBROTHER_CONTRACT_ADDRESS, isContractConfigured } from './config/contracts';
import { resolveAdminAccess, type AdminAccessStatus } from './lib/adminAccess';
import {
  calculatePendingDynamicRewardRows,
  sumPendingDynamicRewards,
  type PendingDynamicRewardEligibility,
  type PendingDynamicRewardRate,
  type PendingDynamicRewardRow,
  type PendingDynamicRewardSource,
} from './lib/dynamicRewards';
import { bpsToPercent, dateTime, parseTokenInput, safeAddress, shortAddress, token } from './lib/format';

type NavKey = 'home' | 'stake' | 'wallet' | 'bot' | 'team';
type AdminNavKey = 'dashboard' | 'users' | 'principal' | 'stakes' | 'rewards' | 'withdrawals' | 'team' | 'config' | 'roles';
type LocaleKey = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'vi' | 'ms';
type TxStatusValue = 'idle' | 'wallet' | 'pending' | 'confirmed' | 'failed';
type TxErrorKind = 'userRejected' | 'wallet' | 'network' | 'rpc' | 'contract' | 'allowance' | 'balance' | 'unknown';

type LocaleCopy = {
  nav: Record<NavKey, string>;
  shell: {
    greeting: string;
    contractMissing: string;
    switchNetwork: string;
  };
  language: {
    eyebrow: string;
    title: string;
  };
  home: {
    principalWallet: string;
    availableStake: string;
    totalPrincipal: string;
    stakedPrincipal: string;
    rewardWallet: string;
    todaysYield: string;
    perTime: string;
    maturedUnredeemed: string;
    maturedTrend: string;
    actions: {
      deposit: string;
      stake: string;
      reinvest: string;
      withdraw: string;
    };
    chainTimeEyebrow: string;
    stakingSessions: string;
    perWalletPerSession: string;
    latestOrders: string;
    orderUnit: string;
    noOrdersTitle: string;
    noOrdersDetail: string;
  };
  session: {
    morning: string;
    afternoon: string;
    closed: string;
    canStake: string;
    pending: string;
  };
  order: {
    deposit: string;
    reinvest: string;
    stake: string;
    unlock: string;
    settle: string;
    redeem: string;
  };
  status: {
    redeemed: string;
    redeemable: string;
    locked: string;
    settled: string;
    settleable: string;
    pending: string;
  };
};

type TxState = {
  label: string;
  hash?: Hash;
  status: TxStatusValue;
  error?: string;
  errorKind?: TxErrorKind;
  rawError?: string;
};

type TxFlowStep = {
  label: string;
  request: () => Promise<Hash>;
};

type ContractWriteRequest = Parameters<ReturnType<typeof useWriteContract>['writeContractAsync']>[0];

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  reason?: unknown;
  code?: unknown;
  cause?: unknown;
  data?: unknown;
  metaMessages?: unknown;
};

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
type WithdrawalRequestTuple = readonly [bigint, Address, bigint, bigint, bigint, bigint, bigint, number, Address, Address];

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
  currentStakeVolume: bigint;
  isValidOnDay: boolean;
  currentLocalDay: bigint;
  settlementCycle: bigint;
};

type TeamSummaryData = {
  totalDeposited: bigint;
  totalMembers: number;
};

type AdminUserRow = {
  address: Address;
  account: UserAccountData;
  blockNumber?: bigint;
  logIndex?: number;
  registeredIndex?: number;
};

type UserTreeNode = AdminUserRow & {
  children: UserTreeNode[];
};

type DynamicSettlementRow = AdminUserRow & {
  dailyStakeVolume: bigint;
  isValidOnDay: boolean;
  settled: boolean;
};

type DynamicSettlementSourceDayRow = DynamicSettlementRow & {
  day: bigint;
};

type DynamicSettlementGroup = {
  day: bigint;
  addresses: Address[];
  totalVolume: bigint;
  validCount: number;
};

type AllDynamicSettlementData = {
  rows: DynamicSettlementSourceDayRow[];
  pendingRows: DynamicSettlementSourceDayRow[];
  groups: DynamicSettlementGroup[];
  sourceDayCount: number;
};

type WithdrawalRequestData = {
  id: bigint;
  user: Address;
  amount: bigint;
  fee: bigint;
  netAmount: bigint;
  requestedAt: bigint;
  processedAt: bigint;
  status: number;
  operator: Address;
  payer: Address;
};

type ChainEventRecord = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

type DynamicRewardDetail = {
  source: Address;
  upline: Address;
  day: bigint;
  generation: number;
  volume: bigint;
  reward: bigint;
  historyIndex: number;
};

type DynamicRewardSourceNode = {
  address: Address;
  generation: number;
};

type DynamicRewardSourceDay = DynamicRewardSourceNode & {
  day: bigint;
};

type DynamicRewardSourceResult = {
  nodes: DynamicRewardSourceNode[];
  isSourceLimitReached: boolean;
};

type PendingDynamicRewardQueryData = {
  rows: PendingDynamicRewardRow[];
  total: bigint;
  scannedDays: bigint[];
  sourceCount: number;
  isSourceLimitReached: boolean;
};

type PublicContractClient = NonNullable<ReturnType<typeof usePublicClient>>;

const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hex;
const CONTRACT_ADDRESS = IRONBROTHER_CONTRACT_ADDRESS ?? zeroAddress;
const EVENT_LOOKBACK_BLOCKS = 200_000n;
const EVENT_CHUNK_BLOCKS = 20_000n;
const SESSION_STATUS_REFETCH_MS = 30_000;
const PENDING_DYNAMIC_LOOKBACK_PERIODS = 5;
const PENDING_DYNAMIC_MAX_PERIODS = 60;
const PENDING_DYNAMIC_MAX_SOURCES = 400;
const PENDING_DYNAMIC_MAX_STAKE_ORDERS_PER_SOURCE = 80;
const ADMIN_DYNAMIC_SETTLEMENT_BATCH_SIZE = 80;
const HOME_LATEST_ORDER_LIMIT = 5;
const DYNAMIC_REWARD_DETAIL_BATCH_SIZE = 3;
const USER_ORDER_PAGE_SIZE = 8;
const ADMIN_ORDER_PAGE_SIZE = 12;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const EAST8_TIMEZONE_SECONDS = 8 * SECONDS_PER_HOUR;
const PRODUCT_TITLE_ZH = '原力';
const PRODUCT_TITLE_EN = 'CrudeTrust';
const PRODUCT_BRAND = '原力 CrudeTrust';
const PRODUCT_LOGO_SRC = '/crudetrust-logo.png';
const LANGUAGE_STORAGE_KEY = 'crudetrust.locale';
const DEFAULT_LOCALE: LocaleKey = 'zh-CN';
const PROMOTION_REFERRER_PARAM = 'ref';
const TOKEN_SYMBOL = 'USDT';
const TEAM_SUMMARY_MAX_DEPTH = 40;
const TX_GAS_BUFFER_BPS = 12_000n;
const DEFAULT_TX_ERROR = '交易失败，请检查钱包、余额和链上状态后重试。';

const LANGUAGE_OPTIONS: readonly { key: LocaleKey; label: string }[] = [
  { key: 'zh-CN', label: '简体中文' },
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
  { key: 'vi', label: 'Tiếng Việt' },
  { key: 'ms', label: 'Bahasa Melayu' },
];

const LOCALE_COPY: Record<LocaleKey, LocaleCopy> = {
  'zh-CN': {
    nav: { home: '首页', stake: '带单', wallet: '钱包', bot: '收益', team: '团队' },
    shell: {
      greeting: 'Hi',
      contractMissing: '合约地址未配置，链上读取和真实交易暂不可用。部署后设置 VITE_CRUDETRUST_CONTRACT_ADDRESS 即可启用。',
      switchNetwork: '切换到 BSC Testnet',
    },
    language: { eyebrow: 'Language', title: '语言切换' },
    home: {
      principalWallet: '本金钱包',
      availableStake: '可带单',
      totalPrincipal: '总本金',
      stakedPrincipal: '带单中',
      rewardWallet: '收益钱包',
      todaysYield: '今日收益率',
      perTime: '次',
      maturedUnredeemed: '到期未赎回',
      maturedTrend: '到期订单需手动赎回',
      actions: { deposit: '入金', stake: '带单', reinvest: '复投', withdraw: '提现' },
      chainTimeEyebrow: 'UTC+8 链上时间',
      stakingSessions: '带单场次',
      perWalletPerSession: '每钱包每场 1 单',
      latestOrders: '最新订单',
      orderUnit: '笔',
      noOrdersTitle: '暂无订单',
      noOrdersDetail: '连接钱包后，将直接读取该地址的入金订单。',
    },
    session: { morning: '上午场', afternoon: '下午场', closed: '休息中', canStake: '可带单', pending: '待开放' },
    order: { deposit: '入金订单', reinvest: '复投订单', stake: '带单订单', unlock: '解锁', settle: '结算', redeem: '赎回' },
    status: { redeemed: '已赎回', redeemable: '可赎回', locked: '锁仓中', settled: '已结算', settleable: '可结算', pending: '待结算' },
  },
  'zh-TW': {
    nav: { home: '首頁', stake: '帶單', wallet: '錢包', bot: '收益', team: '團隊' },
    shell: {
      greeting: 'Hi',
      contractMissing: '合約地址未設定，鏈上讀取和真實交易暫不可用。部署後設定 VITE_CRUDETRUST_CONTRACT_ADDRESS 即可啟用。',
      switchNetwork: '切換到 BSC Testnet',
    },
    language: { eyebrow: 'Language', title: '語言切換' },
    home: {
      principalWallet: '本金錢包',
      availableStake: '可帶單',
      totalPrincipal: '總本金',
      stakedPrincipal: '帶單中',
      rewardWallet: '收益錢包',
      todaysYield: '今日收益率',
      perTime: '次',
      maturedUnredeemed: '到期未贖回',
      maturedTrend: '到期訂單需手動贖回',
      actions: { deposit: '入金', stake: '帶單', reinvest: '複投', withdraw: '提現' },
      chainTimeEyebrow: 'UTC+8 鏈上時間',
      stakingSessions: '帶單場次',
      perWalletPerSession: '每錢包每場 1 單',
      latestOrders: '最新訂單',
      orderUnit: '筆',
      noOrdersTitle: '暫無訂單',
      noOrdersDetail: '連接錢包後，將直接讀取該地址的入金訂單。',
    },
    session: { morning: '上午場', afternoon: '下午場', closed: '休息中', canStake: '可帶單', pending: '待開放' },
    order: { deposit: '入金訂單', reinvest: '複投訂單', stake: '帶單訂單', unlock: '解鎖', settle: '結算', redeem: '贖回' },
    status: { redeemed: '已贖回', redeemable: '可贖回', locked: '鎖倉中', settled: '已結算', settleable: '可結算', pending: '待結算' },
  },
  en: {
    nav: { home: 'Home', stake: 'Stake', wallet: 'Wallet', bot: 'Rewards', team: 'Team' },
    shell: {
      greeting: 'Hi',
      contractMissing: 'Contract address is not configured. On-chain reads and real transactions are unavailable until VITE_CRUDETRUST_CONTRACT_ADDRESS is set.',
      switchNetwork: 'Switch to BSC Testnet',
    },
    language: { eyebrow: 'Language', title: 'Language' },
    home: {
      principalWallet: 'Principal Wallet',
      availableStake: 'Stakeable',
      totalPrincipal: 'Total principal',
      stakedPrincipal: 'In stake',
      rewardWallet: 'Reward Wallet',
      todaysYield: 'Today yield',
      perTime: 'time',
      maturedUnredeemed: 'Matured',
      maturedTrend: 'Matured orders require manual redemption',
      actions: { deposit: 'Deposit', stake: 'Stake', reinvest: 'Reinvest', withdraw: 'Withdraw' },
      chainTimeEyebrow: 'UTC+8 Chain Time',
      stakingSessions: 'Staking Sessions',
      perWalletPerSession: '1 order per wallet per session',
      latestOrders: 'Latest Orders',
      orderUnit: 'orders',
      noOrdersTitle: 'No on-chain orders',
      noOrdersDetail: 'Connect a wallet to read deposit orders for this address.',
    },
    session: { morning: 'Morning', afternoon: 'Afternoon', closed: 'Closed', canStake: 'Open', pending: 'Pending' },
    order: { deposit: 'Deposit Order', reinvest: 'Reinvest Order', stake: 'Stake Order', unlock: 'Unlock', settle: 'Settle', redeem: 'Redeem' },
    status: { redeemed: 'Redeemed', redeemable: 'Redeemable', locked: 'Locked', settled: 'Settled', settleable: 'Settleable', pending: 'Pending' },
  },
  ja: {
    nav: { home: 'ホーム', stake: 'ステーク', wallet: 'ウォレット', bot: '報酬', team: 'チーム' },
    shell: {
      greeting: 'Hi',
      contractMissing: 'コントラクトアドレスが未設定のため、オンチェーン読み取りと実取引は利用できません。',
      switchNetwork: 'BSC Testnet に切替',
    },
    language: { eyebrow: 'Language', title: '言語切替' },
    home: {
      principalWallet: '元本ウォレット',
      availableStake: 'ステーク可能',
      totalPrincipal: '元本合計',
      stakedPrincipal: 'ステーク中',
      rewardWallet: '報酬ウォレット',
      todaysYield: '本日の利回り',
      perTime: '回',
      maturedUnredeemed: '満期未償還',
      maturedTrend: '満期注文は手動で償還します',
      actions: { deposit: '入金', stake: 'ステーク', reinvest: '再投資', withdraw: '出金' },
      chainTimeEyebrow: 'UTC+8 チェーン時間',
      stakingSessions: 'ステーク枠',
      perWalletPerSession: 'ウォレットごと各枠 1 注文',
      latestOrders: '最新注文',
      orderUnit: '件',
      noOrdersTitle: 'オンチェーン注文なし',
      noOrdersDetail: 'ウォレット接続後、このアドレスの入金注文を直接読み取ります。',
    },
    session: { morning: '午前枠', afternoon: '午後枠', closed: '休止中', canStake: '受付中', pending: '待機中' },
    order: { deposit: '入金注文', reinvest: '再投資注文', stake: 'ステーク注文', unlock: '解除', settle: '精算', redeem: '償還' },
    status: { redeemed: '償還済み', redeemable: '償還可能', locked: 'ロック中', settled: '精算済み', settleable: '精算可能', pending: '精算待ち' },
  },
  ko: {
    nav: { home: '홈', stake: '스테이킹', wallet: '지갑', bot: '보상', team: '팀' },
    shell: {
      greeting: 'Hi',
      contractMissing: '컨트랙트 주소가 설정되지 않아 온체인 조회와 실제 거래를 사용할 수 없습니다.',
      switchNetwork: 'BSC Testnet으로 전환',
    },
    language: { eyebrow: 'Language', title: '언어 전환' },
    home: {
      principalWallet: '원금 지갑',
      availableStake: '스테이킹 가능',
      totalPrincipal: '총 원금',
      stakedPrincipal: '스테이킹 중',
      rewardWallet: '보상 지갑',
      todaysYield: '오늘 수익률',
      perTime: '회',
      maturedUnredeemed: '만기 미상환',
      maturedTrend: '만기 주문은 수동 상환이 필요합니다',
      actions: { deposit: '입금', stake: '스테이킹', reinvest: '재투자', withdraw: '출금' },
      chainTimeEyebrow: 'UTC+8 체인 시간',
      stakingSessions: '스테이킹 세션',
      perWalletPerSession: '지갑당 세션별 1건',
      latestOrders: '최근 주문',
      orderUnit: '건',
      noOrdersTitle: '온체인 주문 없음',
      noOrdersDetail: '지갑을 연결하면 이 주소의 입금 주문을 직접 읽습니다.',
    },
    session: { morning: '오전 세션', afternoon: '오후 세션', closed: '휴식 중', canStake: '가능', pending: '대기' },
    order: { deposit: '입금 주문', reinvest: '재투자 주문', stake: '스테이킹 주문', unlock: '잠금해제', settle: '정산', redeem: '상환' },
    status: { redeemed: '상환됨', redeemable: '상환 가능', locked: '잠김', settled: '정산됨', settleable: '정산 가능', pending: '정산 대기' },
  },
  vi: {
    nav: { home: 'Trang chủ', stake: 'Stake', wallet: 'Ví', bot: 'Thưởng', team: 'Đội nhóm' },
    shell: {
      greeting: 'Hi',
      contractMissing: 'Chưa cấu hình địa chỉ hợp đồng, tạm thời không thể đọc on-chain hoặc giao dịch thật.',
      switchNetwork: 'Chuyển sang BSC Testnet',
    },
    language: { eyebrow: 'Language', title: 'Đổi ngôn ngữ' },
    home: {
      principalWallet: 'Ví gốc',
      availableStake: 'Có thể stake',
      totalPrincipal: 'Tổng gốc',
      stakedPrincipal: 'Đang stake',
      rewardWallet: 'Ví thưởng',
      todaysYield: 'Lợi suất hôm nay',
      perTime: 'lần',
      maturedUnredeemed: 'Đáo hạn chưa rút',
      maturedTrend: 'Lệnh đáo hạn cần rút thủ công',
      actions: { deposit: 'Nạp', stake: 'Stake', reinvest: 'Tái đầu tư', withdraw: 'Rút' },
      chainTimeEyebrow: 'Giờ chain UTC+8',
      stakingSessions: 'Phiên stake',
      perWalletPerSession: 'Mỗi ví 1 lệnh mỗi phiên',
      latestOrders: 'Lệnh mới nhất',
      orderUnit: 'lệnh',
      noOrdersTitle: 'Chưa có lệnh on-chain',
      noOrdersDetail: 'Kết nối ví để đọc trực tiếp lệnh nạp của địa chỉ này.',
    },
    session: { morning: 'Phiên sáng', afternoon: 'Phiên chiều', closed: 'Đang nghỉ', canStake: 'Có thể stake', pending: 'Chưa mở' },
    order: { deposit: 'Lệnh nạp', reinvest: 'Lệnh tái đầu tư', stake: 'Lệnh stake', unlock: 'Mở khóa', settle: 'Quyết toán', redeem: 'Rút gốc' },
    status: { redeemed: 'Đã rút', redeemable: 'Có thể rút', locked: 'Đang khóa', settled: 'Đã quyết toán', settleable: 'Có thể quyết toán', pending: 'Chờ quyết toán' },
  },
  ms: {
    nav: { home: 'Utama', stake: 'Stake', wallet: 'Dompet', bot: 'Ganjaran', team: 'Pasukan' },
    shell: {
      greeting: 'Hi',
      contractMissing: 'Alamat kontrak belum dikonfigurasi. Bacaan on-chain dan transaksi sebenar belum tersedia.',
      switchNetwork: 'Tukar ke BSC Testnet',
    },
    language: { eyebrow: 'Language', title: 'Tukar Bahasa' },
    home: {
      principalWallet: 'Dompet Prinsipal',
      availableStake: 'Boleh stake',
      totalPrincipal: 'Jumlah prinsipal',
      stakedPrincipal: 'Sedang stake',
      rewardWallet: 'Dompet Ganjaran',
      todaysYield: 'Hasil hari ini',
      perTime: 'kali',
      maturedUnredeemed: 'Matang belum tebus',
      maturedTrend: 'Pesanan matang perlu ditebus manual',
      actions: { deposit: 'Deposit', stake: 'Stake', reinvest: 'Labur semula', withdraw: 'Keluar' },
      chainTimeEyebrow: 'Masa Chain UTC+8',
      stakingSessions: 'Sesi Stake',
      perWalletPerSession: '1 pesanan setiap dompet setiap sesi',
      latestOrders: 'Pesanan Terkini',
      orderUnit: 'pesanan',
      noOrdersTitle: 'Tiada pesanan on-chain',
      noOrdersDetail: 'Sambungkan dompet untuk membaca pesanan deposit alamat ini.',
    },
    session: { morning: 'Sesi pagi', afternoon: 'Sesi petang', closed: 'Rehat', canStake: 'Dibuka', pending: 'Menunggu' },
    order: { deposit: 'Pesanan Deposit', reinvest: 'Pesanan Labur Semula', stake: 'Pesanan Stake', unlock: 'Buka kunci', settle: 'Selesai', redeem: 'Tebus' },
    status: { redeemed: 'Ditebus', redeemable: 'Boleh tebus', locked: 'Dikunci', settled: 'Selesai', settleable: 'Boleh selesai', pending: 'Menunggu selesai' },
  },
};

const CONTRACT_ERROR_MESSAGES: readonly [needle: string, message: string][] = [
  ['not super admin', '当前钱包没有超级管理员权限，无法执行该操作。'],
  ['reentrant call', '上一笔交易仍在处理中，请稍后再试。'],
  ['usdt required', 'USDT 合约地址未配置。'],
  ['owner required', '合约管理员地址未配置。'],
  ['owner unchanged', '新 Owner 不能与当前钱包相同。'],
  ['fee receiver required', '手续费接收地址不能为空。'],
  ['principal cap exceeded', '本金钱包已达到上限，请降低金额或先处理现有本金。'],
  ['staking window closed', '当前不在带单时间段，请在开放场次内提交。'],
  ['session already used', '当前场次已经带单过，每个钱包每场限 1 单。'],
  ['insufficient available principal', '可用本金不足，请降低带单金额或先赎回到期本金。'],
  ['not order owner', '该订单不属于当前钱包。'],
  ['order closed', '该本金订单已关闭或已赎回。'],
  ['order locked', '该本金订单尚未到期，暂不能赎回。'],
  ['not registered', '当前钱包尚未注册，请先完成入金或注册。'],
  ['insufficient reward balance', '收益钱包余额不足。'],
  ['amount must exceed fee', '提现金额必须大于手续费。'],
  ['insufficient payout balance', '合约奖励池余额不足，暂不能免审批自动打款。请联系 Admin 补充奖励池或开启审批。'],
  ['amount required', '请输入大于 0 的金额。'],
  ['account required', '请输入有效的钱包地址。'],
  ['cannot remove self', '不能移除当前登录钱包自己的管理员权限。'],
  ['yield out of range', '收益率超出后台允许范围。'],
  ['invalid bounds', '收益率上下限设置不正确。'],
  ['current yield outside bounds', '当前收益率不在新的上下限内，请先调整当前收益率。'],
  ['min required', '最低金额必须大于 0。'],
  ['invalid amount range', '最低金额不能高于最高金额。'],
  ['max amount over cap', '单笔最高金额不能超过本金上限。'],
  ['lock too short', '锁定周期不能少于 1 天。'],
  ['threshold required', '有效流水门槛必须大于 0。'],
  ['invalid morning', '上午场开始时间必须早于结束时间。'],
  ['sessions overlap', '上午场和下午场时间不能重叠。'],
  ['invalid afternoon', '下午场开始时间必须早于结束时间。'],
  ['invalid day', '场次时间不能超过一天。'],
  ['invalid session time', '请输入有效的场次时间，例如 09:00 或 13:30。'],
  ['timezone fixed east8', '场次时区固定为东八区，后台仅可调整上下午时间范围。'],
  ['offset out of range', '时区偏移必须在 -12 到 +14 小时之间。'],
  ['invalid generation', '代数必须在 1 到 40 之间。'],
  ['rate too high', '代数奖励比例不能超过 1%。'],
  ['stake missing', '带单订单不存在，请检查订单 ID。'],
  ['stake settled', '该带单订单已经结算。'],
  ['settlement pending', '带单订单尚未到结算时间。'],
  ['day not closed', '只能结算已结束的周期。'],
  ['dynamic settled', '该用户该周期动态奖励已经结算。'],
  ['self referrer', '推荐人不能填写当前钱包自己。'],
  ['amount too low', '金额低于合约最低限制。'],
  ['amount too high', '金额高于合约最高限制。'],
  ['max two decimals', '金额最多支持两位小数。'],
  ['invalid adjusted time', '合约时间配置异常，请联系管理员。'],
  ['invalid day start', '合约日期配置异常，请联系管理员。'],
];

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
  totalPendingWithdrawalAmount: 0n,
};

const emptyTeamSummary: TeamSummaryData = {
  totalDeposited: 0n,
  totalMembers: 0,
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

function withdrawalRequestFromTuple(data: unknown): WithdrawalRequestData | undefined {
  const tuple = data as WithdrawalRequestTuple | undefined;
  if (!tuple || tuple[0] === 0n || tuple[1] === zeroAddress) return undefined;

  return {
    id: tuple[0],
    user: tuple[1],
    amount: tuple[2],
    fee: tuple[3],
    netAmount: tuple[4],
    requestedAt: tuple[5],
    processedAt: tuple[6],
    status: Number(tuple[7]),
    operator: tuple[8],
    payer: tuple[9],
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

function historyValue(row: unknown, key: string, index: number) {
  const objectValue = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[key] : undefined;
  if (objectValue !== undefined) return objectValue;
  return Array.isArray(row) ? row[index] : undefined;
}

function historyAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) ? (value as Address) : undefined;
}

function historyBigInt(value: unknown) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

function historyNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function dynamicRewardDetailFromHistory(row: unknown, upline: Address, historyIndex: number): DynamicRewardDetail | undefined {
  const source = historyAddress(historyValue(row, 'source', 0));
  if (!source) return undefined;

  return {
    source,
    upline,
    day: historyBigInt(historyValue(row, 'day', 1)),
    generation: historyNumber(historyValue(row, 'generation', 2)),
    volume: historyBigInt(historyValue(row, 'volume', 3)),
    reward: historyBigInt(historyValue(row, 'reward', 4)),
    historyIndex,
  };
}

function dynamicRewardDetailFromEvent(event: ChainEventRecord, upline: Address, historyIndex: number): DynamicRewardDetail | undefined {
  if (event.eventName !== 'DynamicRewardSettled') return undefined;
  const eventUpline = historyAddress(event.args.upline);
  const source = historyAddress(event.args.source);
  if (!source || !eventUpline || eventUpline.toLowerCase() !== upline.toLowerCase()) return undefined;

  return {
    source,
    upline: eventUpline,
    day: historyBigInt(event.args.day),
    generation: historyNumber(event.args.generation),
    volume: historyBigInt(event.args.volume),
    reward: historyBigInt(event.args.reward),
    historyIndex,
  };
}

function recentClosedDynamicDays(currentLocalDay: bigint, limit = PENDING_DYNAMIC_LOOKBACK_PERIODS) {
  const days: bigint[] = [];
  for (let offset = 1n; days.length < limit && currentLocalDay > offset; offset += 1n) {
    days.push(currentLocalDay - offset);
  }
  return days;
}

async function readDirectReferralAddresses(publicClient: PublicContractClient, root: Address) {
  try {
    const referrals = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: ironBrotherAbi,
      functionName: 'getDirectReferrals',
      args: [root],
    });
    return ((referrals as readonly string[] | undefined) ?? []).filter((value): value is Address => isAddress(value));
  } catch {
    return [] as Address[];
  }
}

async function collectDynamicRewardSources(
  publicClient: PublicContractClient,
  root: Address,
  maxGeneration: number,
): Promise<DynamicRewardSourceResult> {
  if (maxGeneration <= 0) return { nodes: [], isSourceLimitReached: false };

  const seen = new Set<string>([root.toLowerCase()]);
  let frontier: Address[] = [root];
  const nodes: DynamicRewardSourceNode[] = [];
  let isSourceLimitReached = false;

  for (let generation = 1; generation <= maxGeneration && frontier.length > 0; generation += 1) {
    const referralGroups = await Promise.all(frontier.map((account) => readDirectReferralAddresses(publicClient, account)));
    const nextFrontier: Address[] = [];

    referralGroups.flat().forEach((referral) => {
      const key = referral.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      if (nodes.length >= PENDING_DYNAMIC_MAX_SOURCES) {
        isSourceLimitReached = true;
        return;
      }

      nodes.push({ address: referral, generation });
      if (generation < maxGeneration) {
        nextFrontier.push(referral);
      }
    });

    if (isSourceLimitReached) break;
    frontier = nextFrontier;
  }

  return { nodes, isSourceLimitReached };
}

function uniqueDynamicSourceDays(sourceDays: readonly DynamicRewardSourceDay[]) {
  const seen = new Set<string>();
  const rows: DynamicRewardSourceDay[] = [];

  sourceDays.forEach((row) => {
    const key = `${row.address.toLowerCase()}-${row.day.toString()}-${row.generation}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });

  return rows;
}

function uniqueDynamicDays(sourceDays: readonly DynamicRewardSourceDay[]) {
  const seen = new Set<string>();
  return sourceDays
    .map((row) => row.day)
    .filter((day) => {
      const key = day.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (left === right ? 0 : left > right ? -1 : 1))
    .slice(0, PENDING_DYNAMIC_MAX_PERIODS);
}

async function collectStakeOrderSourceDays(publicClient: PublicContractClient, sources: readonly DynamicRewardSourceNode[]) {
  const sourceDays = await Promise.all(
    sources.map(async (source) => {
      try {
        const orderIds = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'getUserStakeOrderIds',
          args: [source.address],
        });
        const selectedIds = [...((orderIds as readonly bigint[] | undefined) ?? [])].slice(
          -PENDING_DYNAMIC_MAX_STAKE_ORDERS_PER_SOURCE,
        );
        const orders = await Promise.all(
          selectedIds.map(async (id) => {
            try {
              return stakeOrderFromTuple(
                await publicClient.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'stakeOrders',
                  args: [id],
                }),
              );
            } catch {
              return undefined;
            }
          }),
        );

        return orders
          .filter((order): order is StakeOrderData => Boolean(order && order.day > 0n))
          .map((order) => ({ ...source, day: order.day }));
      } catch {
        return [] as DynamicRewardSourceDay[];
      }
    }),
  );

  return uniqueDynamicSourceDays(sourceDays.flat());
}

function uniqueSettlementSourceDays(sourceDays: readonly Pick<DynamicSettlementSourceDayRow, 'address' | 'day'>[]) {
  const seen = new Set<string>();
  const rows: Pick<DynamicSettlementSourceDayRow, 'address' | 'day'>[] = [];

  sourceDays.forEach((row) => {
    const key = `${row.address.toLowerCase()}-${row.day.toString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });

  return rows;
}

async function collectAdminSettlementSourceDays(
  publicClient: PublicContractClient,
  addresses: readonly Address[],
  currentLocalDay: bigint,
) {
  if (currentLocalDay <= 0n) return [] as Pick<DynamicSettlementSourceDayRow, 'address' | 'day'>[];

  const sourceDays = await Promise.all(
    addresses.map(async (address) => {
      try {
        const orderIds = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'getUserStakeOrderIds',
          args: [address],
        });
        const orders = await Promise.all(
          [...((orderIds as readonly bigint[] | undefined) ?? [])].map(async (id) => {
            try {
              return stakeOrderFromTuple(
                await publicClient.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'stakeOrders',
                  args: [id],
                }),
              );
            } catch {
              return undefined;
            }
          }),
        );

        return orders
          .filter((order): order is StakeOrderData => Boolean(order && order.day > 0n && order.day < currentLocalDay))
          .map((order) => ({ address, day: order.day }));
      } catch {
        return [] as Pick<DynamicSettlementSourceDayRow, 'address' | 'day'>[];
      }
    }),
  );

  return uniqueSettlementSourceDays(sourceDays.flat());
}

function groupDynamicSettlementRows(rows: readonly DynamicSettlementSourceDayRow[]) {
  const groups = new Map<string, DynamicSettlementGroup>();

  rows.forEach((row) => {
    const key = row.day.toString();
    const group =
      groups.get(key) ??
      ({
        day: row.day,
        addresses: [],
        totalVolume: 0n,
        validCount: 0,
      } satisfies DynamicSettlementGroup);

    group.addresses.push(row.address);
    group.totalVolume += row.dailyStakeVolume;
    if (row.isValidOnDay) group.validCount += 1;
    groups.set(key, group);
  });

  return [...groups.values()].sort((left, right) => (left.day === right.day ? 0 : left.day < right.day ? -1 : 1));
}

function chunkAddresses(addresses: readonly Address[], chunkSize = ADMIN_DYNAMIC_SETTLEMENT_BATCH_SIZE) {
  const chunks: Address[][] = [];
  for (let index = 0; index < addresses.length; index += chunkSize) {
    chunks.push(addresses.slice(index, index + chunkSize));
  }
  return chunks;
}

function chunkSettlementSourceDays(
  rows: readonly DynamicSettlementSourceDayRow[],
  chunkSize = ADMIN_DYNAMIC_SETTLEMENT_BATCH_SIZE,
) {
  const chunks: DynamicSettlementSourceDayRow[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

function comparePendingDynamicRewardRows(left: PendingDynamicRewardRow, right: PendingDynamicRewardRow) {
  if (left.day !== right.day) return left.day > right.day ? -1 : 1;
  if (left.generation !== right.generation) return left.generation - right.generation;
  if (left.reward !== right.reward) return left.reward > right.reward ? -1 : 1;
  return left.source.localeCompare(right.source);
}

function shanghaiDateTimeParts(timestampSeconds: bigint) {
  const timestampMs = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(timestampMs)) return undefined;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(new Date(timestampMs));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');

  return year && month && day && hour && minute ? { year, month, day, hour, minute } : undefined;
}

function shanghaiDateTimeLabel(timestampSeconds: bigint) {
  const parts = shanghaiDateTimeParts(timestampSeconds);
  return parts ? `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}` : '--';
}

function effectiveSettlementCycle(day: bigint, settlementCycle: bigint) {
  if (day <= 0n) return 0n;
  const fallbackCycle = settlementCycle > 0n ? settlementCycle : BigInt(SECONDS_PER_DAY);
  const dailyLocalDay = BigInt(currentUnixSeconds() + EAST8_TIMEZONE_SECONDS) / BigInt(SECONDS_PER_DAY);

  if (fallbackCycle !== BigInt(SECONDS_PER_DAY) && dailyLocalDay > 0n && day <= dailyLocalDay * 2n) {
    return BigInt(SECONDS_PER_DAY);
  }

  if (fallbackCycle === BigInt(SECONDS_PER_DAY) && dailyLocalDay > 0n && day > dailyLocalDay * 2n) {
    const inferredCycle = BigInt(currentUnixSeconds() + EAST8_TIMEZONE_SECONDS) / day;
    if (inferredCycle >= 60n && inferredCycle <= BigInt(SECONDS_PER_DAY)) {
      return inferredCycle;
    }
  }

  return fallbackCycle;
}

function localPeriodBounds(day: bigint, settlementCycle: bigint = BigInt(SECONDS_PER_DAY)) {
  if (day <= 0n) return undefined;
  const cycle = effectiveSettlementCycle(day, settlementCycle);
  if (cycle <= 0n) return undefined;
  const startAt = day * cycle - BigInt(EAST8_TIMEZONE_SECONDS);
  if (startAt < 0n) return undefined;
  return { startAt, endAt: startAt + cycle };
}

function localPeriodLabel(day: bigint, settlementCycle: bigint = BigInt(SECONDS_PER_DAY)) {
  const bounds = localPeriodBounds(day, settlementCycle);
  if (!bounds) return '--';
  return `${shanghaiDateTimeLabel(bounds.startAt)} - ${shanghaiDateTimeLabel(bounds.endAt)}`;
}

function localPeriodInputValue(day: bigint, settlementCycle: bigint = BigInt(SECONDS_PER_DAY)) {
  const bounds = localPeriodBounds(day, settlementCycle);
  if (!bounds) return '';

  const localDate = new Date(Number(bounds.startAt + BigInt(EAST8_TIMEZONE_SECONDS)) * 1000);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const date = String(localDate.getUTCDate()).padStart(2, '0');
  const hours = String(localDate.getUTCHours()).padStart(2, '0');
  const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${date}T${hours}:${minutes}`;
}

function shanghaiInputToTimestamp(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return 0n;

  const [, year, month, day, hour, minute] = match;
  const utcMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    EAST8_TIMEZONE_SECONDS * 1000;
  if (!Number.isFinite(utcMs)) return 0n;
  return BigInt(Math.floor(utcMs / 1000));
}

function localPeriodDayFromInput(value: string, settlementCycle: bigint = BigInt(SECONDS_PER_DAY)) {
  const cycle = settlementCycle > 0n ? settlementCycle : BigInt(SECONDS_PER_DAY);
  const timestamp = shanghaiInputToTimestamp(value);
  const adjusted = timestamp + BigInt(EAST8_TIMEZONE_SECONDS);
  return adjusted > 0n ? adjusted / cycle : 0n;
}

function settlementCycleLabel(value?: bigint | number) {
  const seconds = secondsNumber(value);
  if (seconds <= 0) return '--';
  if (seconds % SECONDS_PER_DAY === 0) return `${seconds / SECONDS_PER_DAY} 天`;
  if (seconds % SECONDS_PER_HOUR === 0) return `${seconds / SECONDS_PER_HOUR} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
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

function usePaginatedItems<T>(items: readonly T[], pageSize: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), totalPages));
  }, [totalPages]);

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pagedItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);

  return { page, setPage, totalPages, total, start, end, items: pagedItems };
}

function PaginationControls({
  page,
  totalPages,
  total,
  start,
  end,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination-controls">
      <span>{start}-{end} / {total}</span>
      <div>
        <button
          type="button"
          className="pagination-button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="上一页"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-page">{page} / {totalPages}</span>
        <button
          type="button"
          className="pagination-button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="下一页"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function principalSourceLabel(source: number) {
  return source === 1 ? '复投订单' : '入金订单';
}

function principalStatusLabel(order: PrincipalOrderData) {
  if (order.status === 1) return '已赎回';
  return BigInt(Math.floor(Date.now() / 1000)) >= order.unlockAt ? '可赎回' : '锁仓中';
}

function stakeStatusLabel(order: StakeOrderData) {
  if (order.settled) return '已结算';
  return BigInt(Math.floor(Date.now() / 1000)) >= order.settleAt ? '可结算' : '待结算';
}

function withdrawalStatusLabel(request: WithdrawalRequestData) {
  if (request.status === 1) return '已打款';
  if (request.status === 2) return '已驳回';
  return '待审核';
}

function sessionLabel(session: number) {
  if (session === 1) return '上午场';
  if (session === 2) return '下午场';
  return '休息中';
}

function isLocaleKey(value: string | null): value is LocaleKey {
  return LANGUAGE_OPTIONS.some((option) => option.key === value);
}

function initialLocale(): LocaleKey {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocaleKey(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function productTitleForLocale(locale: LocaleKey) {
  return locale === 'zh-CN' || locale === 'zh-TW' ? PRODUCT_TITLE_ZH : PRODUCT_TITLE_EN;
}

function urlReferrer(): Address | undefined {
  if (typeof window === 'undefined') return undefined;

  const params = new URLSearchParams(window.location.search);
  const referrer = params.get(PROMOTION_REFERRER_PARAM) ?? params.get('referrer');

  return referrer && isAddress(referrer) && referrer !== zeroAddress ? (referrer as Address) : undefined;
}

function promotionLinkForAddress(address?: Address) {
  if (!address || typeof window === 'undefined') return '';

  const url = new URL(window.location.href);
  if (url.pathname.startsWith('/admin')) {
    url.pathname = '/';
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set(PROMOTION_REFERRER_PARAM, address);
  return url.toString();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) {
    throw new Error('Copy failed');
  }
}

function sessionLabelForLocale(session: number, copy: LocaleCopy) {
  if (session === 1) return copy.session.morning;
  if (session === 2) return copy.session.afternoon;
  return copy.session.closed;
}

function principalSourceLabelForLocale(source: number, copy: LocaleCopy) {
  return source === 1 ? copy.order.reinvest : copy.order.deposit;
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function formatCountdown(targetAt: bigint, nowSeconds: number) {
  const remaining = Math.max(0, Number(targetAt - BigInt(nowSeconds)));
  const days = Math.floor(remaining / SECONDS_PER_DAY);
  const hours = Math.floor((remaining % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((remaining % SECONDS_PER_HOUR) / 60);
  const seconds = remaining % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');

  return `${days}天 ${clock}`;
}

function principalStatusLabelForLocale(order: PrincipalOrderData, copy: LocaleCopy, nowSeconds = currentUnixSeconds()) {
  if (order.status === 1) return copy.status.redeemed;
  return BigInt(nowSeconds) >= order.unlockAt ? copy.status.redeemable : copy.status.locked;
}

function stakeStatusLabelForLocale(order: StakeOrderData, copy: LocaleCopy, nowSeconds = currentUnixSeconds()) {
  if (order.settled) return copy.status.settled;
  return BigInt(nowSeconds) >= order.settleAt ? copy.status.settleable : copy.status.pending;
}

function principalOrderHomeTime(order: PrincipalOrderData, copy: LocaleCopy, nowSeconds: number) {
  if (order.status === 1) return `${copy.order.unlock} ${dateTime(order.unlockAt)}`;
  if (BigInt(nowSeconds) < order.unlockAt) return `${copy.order.unlock} ${formatCountdown(order.unlockAt, nowSeconds)}`;
  return `${copy.status.redeemable} / ${copy.order.unlock} ${dateTime(order.unlockAt)}`;
}

function useNowSeconds() {
  const [nowSeconds, setNowSeconds] = useState(currentUnixSeconds);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSeconds(currentUnixSeconds());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return nowSeconds;
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

function stringFromErrorValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  return '';
}

function addErrorPart(parts: string[], value: unknown) {
  const text = stringFromErrorValue(value).trim();
  if (text) parts.push(text);
}

function collectDataErrorParts(data: unknown, seen: Set<unknown>) {
  const parts: string[] = [];

  if (!data) return parts;
  if (typeof data !== 'object') {
    addErrorPart(parts, data);
    return parts;
  }
  if (seen.has(data)) return parts;
  seen.add(data);

  const record = data as Record<string, unknown>;
  addErrorPart(parts, record.errorName);
  addErrorPart(parts, record.message);
  addErrorPart(parts, record.shortMessage);
  addErrorPart(parts, record.details);
  addErrorPart(parts, record.reason);
  parts.push(...collectErrorParts(record.error, seen));
  parts.push(...collectErrorParts(record.cause, seen));

  return parts;
}

function collectErrorParts(error: unknown, seen = new Set<unknown>()) {
  const parts: string[] = [];

  if (!error) return parts;
  if (typeof error !== 'object') {
    addErrorPart(parts, error);
    return parts;
  }
  if (seen.has(error)) return parts;
  seen.add(error);

  const typed = error as ErrorLike;
  addErrorPart(parts, typed.name);
  addErrorPart(parts, typed.shortMessage);
  addErrorPart(parts, typed.message);
  addErrorPart(parts, typed.details);
  addErrorPart(parts, typed.reason);
  addErrorPart(parts, typed.code);

  if (Array.isArray(typed.metaMessages)) {
    typed.metaMessages.forEach((message) => addErrorPart(parts, message));
  }

  parts.push(...collectDataErrorParts(typed.data, seen));
  parts.push(...collectErrorParts(typed.cause, seen));

  return [...new Set(parts)];
}

function normalizeTxError(error: unknown): Pick<TxState, 'error' | 'errorKind' | 'rawError'> {
  const rawError = collectErrorParts(error).join('\n');
  const lower = rawError.toLowerCase();

  if (
    lower.includes('4001') ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected the request') ||
    lower.includes('denied transaction signature')
  ) {
    return { error: '你已取消钱包确认，交易未提交。', errorKind: 'userRejected', rawError };
  }

  for (const [needle, message] of CONTRACT_ERROR_MESSAGES) {
    if (lower.includes(needle)) {
      return { error: message, errorKind: 'contract', rawError };
    }
  }

  if (lower.includes('enforcedpause')) {
    return { error: '合约当前已暂停，暂不能执行该操作。', errorKind: 'contract', rawError };
  }

  if (lower.includes('accesscontrolunauthorizedaccount')) {
    return { error: '当前钱包没有执行该操作的权限。', errorKind: 'contract', rawError };
  }

  if (lower.includes('erc20insufficientallowance') || lower.includes('insufficient allowance')) {
    return { error: 'USDT 授权额度不足，请先完成授权后再入金。', errorKind: 'allowance', rawError };
  }

  if (
    lower.includes('erc20insufficientbalance') ||
    lower.includes('transfer amount exceeds balance') ||
    lower.includes('exceeds balance')
  ) {
    return { error: 'USDT 余额不足，请降低金额或先补充余额。', errorKind: 'balance', rawError };
  }

  if (lower.includes('insufficient funds for gas') || lower.includes('insufficient funds')) {
    return { error: '钱包 BNB 余额不足，无法支付 Gas。', errorKind: 'balance', rawError };
  }

  if (
    lower.includes('unsupported chain') ||
    lower.includes('chain mismatch') ||
    lower.includes('wrong network') ||
    lower.includes('switch chain') ||
    lower.includes('not connected to requested chain')
  ) {
    return { error: '钱包网络不正确，请切换到 BSC Testnet 后重试。', errorKind: 'network', rawError };
  }

  if (
    lower.includes('connector not connected') ||
    lower.includes('provider not found') ||
    lower.includes('missing provider') ||
    lower.includes('wallet is not connected') ||
    lower.includes('disconnected')
  ) {
    return { error: '钱包未连接或已断开，请重新连接钱包。', errorKind: 'wallet', rawError };
  }

  if (
    lower.includes('unknown transaction type') ||
    lower.includes('unsupported transaction type') ||
    lower.includes('cannot estimate gas') ||
    lower.includes('gas required exceeds allowance') ||
    lower.includes('intrinsic gas too low')
  ) {
    return { error: '钱包无法识别或估算这笔交易，请确认当前网络为 BSC Testnet、钱包有足够 BNB 支付 Gas 后重试。', errorKind: 'wallet', rawError };
  }

  if (
    lower.includes('http request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('timeout') ||
    lower.includes('rpc')
  ) {
    return { error: '链上网络请求失败，请稍后重试或切换 RPC。', errorKind: 'rpc', rawError };
  }

  if (lower.includes('execution reverted') || (lower.includes('contract function') && lower.includes('reverted'))) {
    return { error: '合约拒绝了这笔交易，请确认金额、余额、场次和权限后重试。', errorKind: 'contract', rawError };
  }

  return {
    error: DEFAULT_TX_ERROR,
    errorKind: 'unknown',
    rawError,
  };
}

function secondsNumber(value?: bigint | number) {
  const numeric = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return Number.isFinite(numeric) ? numeric : 0;
}

function secondsToClock(value?: bigint | number) {
  const clamped = Math.max(0, Math.min(SECONDS_PER_DAY, Math.round(secondsNumber(value))));
  if (clamped === SECONDS_PER_DAY) return '24:00';

  const hours = Math.floor(clamped / SECONDS_PER_HOUR);
  const minutes = Math.floor((clamped % SECONDS_PER_HOUR) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function sessionTimeToSeconds(value: string) {
  const trimmed = value.trim();
  const clockMatch = trimmed.match(/^(\d{1,2})(?::([0-5]\d))?$/);

  if (clockMatch) {
    const hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2] ?? '0');
    if (hours > 24 || (hours === 24 && minutes > 0)) {
      throw new Error('invalid session time');
    }
    return Math.round(hours * SECONDS_PER_HOUR + minutes * 60);
  }

  const decimalHours = Number(trimmed || '0');
  if (!Number.isFinite(decimalHours) || decimalHours < 0 || decimalHours > 24) {
    throw new Error('invalid session time');
  }

  return Math.round(decimalHours * SECONDS_PER_HOUR);
}

function sessionTimeRange(start?: bigint | number, end?: bigint | number) {
  return `${secondsToClock(start)}-${secondsToClock(end)}`;
}

function currentSessionRange(data: ReturnType<typeof useIronBrotherData>) {
  if (data.currentSession === 1) return sessionTimeRange(data.morningStart, data.morningEnd);
  if (data.currentSession === 2) return sessionTimeRange(data.afternoonStart, data.afternoonEnd);
  return '等待开放';
}

function daysToSeconds(value: string) {
  return BigInt(Math.round(Number(value || '0') * 24 * 60 * 60));
}

function secondsToDays(value?: bigint | number) {
  const numeric = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return String(numeric / (24 * 60 * 60));
}

function settlementCycleMinutesToSeconds(value: string) {
  const numeric = Number(value.trim() || '0');
  if (!Number.isFinite(numeric)) return 0n;
  return BigInt(Math.round(numeric * 60));
}

function secondsToSettlementCycleMinutes(value?: bigint | number) {
  const numeric = typeof value === 'bigint' ? Number(value) : value ?? 0;
  return String(numeric / 60);
}

function tokenInput(value?: bigint) {
  if (!value) return '0';
  return formatUnits(value, 18);
}

function withGasBuffer(gas: bigint) {
  return (gas * TX_GAS_BUFFER_BPS + 9_999n) / 10_000n;
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

function compareBigIntDesc(left: bigint, right: bigint) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function comparePrincipalOrderLatest(left: PrincipalOrderData, right: PrincipalOrderData) {
  const createdDiff = compareBigIntDesc(left.createdAt, right.createdAt);
  return createdDiff !== 0 ? createdDiff : compareBigIntDesc(left.id, right.id);
}

function compareStakeOrderLatest(left: StakeOrderData, right: StakeOrderData) {
  const createdDiff = compareBigIntDesc(left.createdAt, right.createdAt);
  return createdDiff !== 0 ? createdDiff : compareBigIntDesc(left.id, right.id);
}

function compareWithdrawalRequestLatest(left: WithdrawalRequestData, right: WithdrawalRequestData) {
  const requestedDiff = compareBigIntDesc(left.requestedAt, right.requestedAt);
  return requestedDiff !== 0 ? requestedDiff : compareBigIntDesc(left.id, right.id);
}

function compareAdminUserLatest(left: AdminUserRow, right: AdminUserRow) {
  if (left.blockNumber !== undefined && right.blockNumber !== undefined) {
    const blockDiff = compareBigIntDesc(left.blockNumber, right.blockNumber);
    if (blockDiff !== 0) return blockDiff;
  } else if (left.blockNumber !== undefined || right.blockNumber !== undefined) {
    return left.blockNumber !== undefined ? -1 : 1;
  }

  if (left.registeredIndex !== undefined && right.registeredIndex !== undefined && left.registeredIndex !== right.registeredIndex) {
    return right.registeredIndex - left.registeredIndex;
  }

  if (left.logIndex !== undefined && right.logIndex !== undefined && left.logIndex !== right.logIndex) {
    return right.logIndex - left.logIndex;
  }

  return left.address.localeCompare(right.address);
}

function sortUserTreeNodes(nodes: UserTreeNode[]) {
  nodes.sort((left, right) => {
    const latestDiff = compareAdminUserLatest(left, right);
    if (latestDiff !== 0) return latestDiff;
    const depositedDiff = compareBigIntDesc(left.account.totalDeposited, right.account.totalDeposited);
    if (depositedDiff !== 0) return depositedDiff;
    const directDiff = compareBigIntDesc(left.account.directCount, right.account.directCount);
    return directDiff !== 0 ? directDiff : left.address.localeCompare(right.address);
  });
  nodes.forEach((node) => sortUserTreeNodes(node.children));
  return nodes;
}

function buildUserTree(rows: AdminUserRow[]) {
  const registeredRows = rows.filter((row) => row.account.registered);
  const nodes = new Map<string, UserTreeNode>();
  registeredRows.forEach((row) => {
    nodes.set(row.address.toLowerCase(), { ...row, children: [] });
  });

  const roots: UserTreeNode[] = [];
  for (const node of nodes.values()) {
    const selfKey = node.address.toLowerCase();
    const parentKey = node.account.referrer.toLowerCase();
    const parent = parentKey !== zeroAddress && parentKey !== selfKey ? nodes.get(parentKey) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return sortUserTreeNodes(roots.length > 0 ? roots : Array.from(nodes.values()));
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

  const withdrawalRequestIdsQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getUserWithdrawalRequestIds',
    args: [accountAddress],
    query: { enabled },
  });

  const principalOrderIds = (principalOrderIdsQuery.data as readonly bigint[] | undefined) ?? [];
  const stakeOrderIds = (stakeOrderIdsQuery.data as readonly bigint[] | undefined) ?? [];
  const withdrawalRequestIds = (withdrawalRequestIdsQuery.data as readonly bigint[] | undefined) ?? [];

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

  const withdrawalRequestContracts = useMemo(
    () =>
      withdrawalRequestIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'withdrawalRequests',
        args: [id],
      })),
    [withdrawalRequestIds],
  );

  const principalOrdersQuery = useReadContracts({
    contracts: principalOrderContracts as never,
    query: { enabled: enabled && principalOrderContracts.length > 0 },
  });

  const stakeOrdersQuery = useReadContracts({
    contracts: stakeOrderContracts as never,
    query: { enabled: enabled && stakeOrderContracts.length > 0 },
  });
  const withdrawalRequestsQuery = useReadContracts({
    contracts: withdrawalRequestContracts as never,
    query: { enabled: enabled && withdrawalRequestContracts.length > 0 },
  });

  const principalOrders = useMemo(
    () =>
      (principalOrdersQuery.data ?? [])
        .map((result) => principalOrderFromTuple(readResult(result, undefined)))
        .filter((order): order is PrincipalOrderData => Boolean(order))
        .sort(comparePrincipalOrderLatest),
    [principalOrdersQuery.data],
  );

  const stakeOrders = useMemo(
    () =>
      (stakeOrdersQuery.data ?? [])
        .map((result) => stakeOrderFromTuple(readResult(result, undefined)))
        .filter((order): order is StakeOrderData => Boolean(order))
        .sort(compareStakeOrderLatest),
    [stakeOrdersQuery.data],
  );
  const withdrawalRequests = useMemo(
    () =>
      (withdrawalRequestsQuery.data ?? [])
        .map((result) => withdrawalRequestFromTuple(readResult(result, undefined)))
        .filter((request): request is WithdrawalRequestData => Boolean(request))
        .sort(compareWithdrawalRequestLatest),
    [withdrawalRequestsQuery.data],
  );

  return {
    principalOrderIds,
    stakeOrderIds,
    withdrawalRequestIds,
    principalOrders,
    stakeOrders,
    withdrawalRequests,
    isLoading:
      principalOrderIdsQuery.isLoading ||
      stakeOrderIdsQuery.isLoading ||
      withdrawalRequestIdsQuery.isLoading ||
      principalOrdersQuery.isLoading ||
      stakeOrdersQuery.isLoading ||
      withdrawalRequestsQuery.isLoading,
  };
}

function useDirectReferralRows(
  rootAddress: Address,
  enabled = true,
  currentLocalDayOverride?: bigint,
  settlementCycleOverride?: bigint,
) {
  const referralsQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getDirectReferrals',
    args: [rootAddress],
    query: {
      enabled: Boolean(isContractConfigured && enabled && rootAddress !== zeroAddress),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const shouldReadPeriod = currentLocalDayOverride === undefined || settlementCycleOverride === undefined;
  const currentPeriodQuery = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'currentLocalDay' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'settlementCycle' },
    ],
    query: {
      enabled: Boolean(isContractConfigured && enabled && shouldReadPeriod),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });
  const currentLocalDay = currentLocalDayOverride ?? readResult(currentPeriodQuery.data?.[0], 0n);
  const settlementCycle =
    settlementCycleOverride ?? readResult(currentPeriodQuery.data?.[1], BigInt(SECONDS_PER_DAY));
  const currentPeriodBounds = useMemo(
    () => localPeriodBounds(currentLocalDay, settlementCycle),
    [currentLocalDay, settlementCycle],
  );

  const referralAddresses = (referralsQuery.data as readonly Address[] | undefined) ?? [];
  const latestReferralAddresses = useMemo(() => [...referralAddresses].reverse(), [referralAddresses]);

  const thresholdQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'validVolumeThreshold',
    query: {
      enabled: Boolean(isContractConfigured && enabled && latestReferralAddresses.length > 0),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const detailContracts = useMemo(
    () =>
      latestReferralAddresses.map((referral) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'users',
        args: [referral],
      })),
    [latestReferralAddresses],
  );

  const detailQuery = useReadContracts({
    contracts: detailContracts as never,
    query: {
      enabled: Boolean(isContractConfigured && enabled && latestReferralAddresses.length > 0),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const periodContracts = useMemo(
    () =>
      latestReferralAddresses.flatMap((referral) => [
        {
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'dailyStakeVolume',
          args: [referral, currentLocalDay],
        },
        {
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'isValidOnDay',
          args: [referral, currentLocalDay],
        },
      ]),
    [currentLocalDay, latestReferralAddresses],
  );

  const periodQuery = useReadContracts({
    contracts: periodContracts as never,
    query: {
      enabled: Boolean(isContractConfigured && enabled && latestReferralAddresses.length > 0 && currentLocalDay > 0n),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const stakeOrderIdsQuery = useReadContracts({
    contracts: latestReferralAddresses.map((referral) => ({
      address: CONTRACT_ADDRESS,
      abi: ironBrotherAbi,
      functionName: 'getUserStakeOrderIds',
      args: [referral],
    })) as never,
    query: {
      enabled: Boolean(isContractConfigured && enabled && latestReferralAddresses.length > 0 && currentPeriodBounds),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const referralStakeOrderRefs = useMemo(
    () =>
      (stakeOrderIdsQuery.data ?? []).flatMap((result, referralIndex) => {
        const orderIds = readResult(result, [] as readonly bigint[]);
        return orderIds.map((id) => ({ id, referralIndex }));
      }),
    [stakeOrderIdsQuery.data],
  );

  const stakeOrderQuery = useReadContracts({
    contracts: referralStakeOrderRefs.map(({ id }) => ({
      address: CONTRACT_ADDRESS,
      abi: ironBrotherAbi,
      functionName: 'stakeOrders',
      args: [id],
    })) as never,
    query: {
      enabled: Boolean(isContractConfigured && enabled && referralStakeOrderRefs.length > 0 && currentPeriodBounds),
      refetchInterval: SESSION_STATUS_REFETCH_MS,
    },
  });

  const orderVolumesByReferral = useMemo(() => {
    const volumes = new Map<number, bigint>();
    if (!currentPeriodBounds) return volumes;

    (stakeOrderQuery.data ?? []).forEach((result, index) => {
      const order = stakeOrderFromTuple(readResult(result, undefined));
      const orderRef = referralStakeOrderRefs[index];
      if (!order || !orderRef) return;
      if (order.createdAt < currentPeriodBounds.startAt || order.createdAt >= currentPeriodBounds.endAt) return;

      volumes.set(orderRef.referralIndex, (volumes.get(orderRef.referralIndex) ?? 0n) + order.amount);
    });
    return volumes;
  }, [
    currentPeriodBounds?.endAt,
    currentPeriodBounds?.startAt,
    referralStakeOrderRefs,
    stakeOrderQuery.data,
  ]);

  const rows = useMemo(
    () => {
      const validVolumeThreshold = readResult(thresholdQuery.data, 0n);
      return latestReferralAddresses.map((referral, index) => {
        const periodIndex = index * 2;
        const mappedStakeVolume = readResult(periodQuery.data?.[periodIndex], 0n);
        const orderStakeVolume = orderVolumesByReferral.get(index) ?? 0n;
        const currentStakeVolume =
          orderStakeVolume > mappedStakeVolume ? orderStakeVolume : mappedStakeVolume;
        return {
          address: referral,
          account: userFromTuple(readResult(detailQuery.data?.[index], undefined)),
          currentStakeVolume,
          isValidOnDay:
            readResult(periodQuery.data?.[periodIndex + 1], false) ||
            (validVolumeThreshold > 0n && currentStakeVolume >= validVolumeThreshold),
          currentLocalDay,
          settlementCycle,
        };
      });
    },
    [
      currentLocalDay,
      detailQuery.data,
      latestReferralAddresses,
      orderVolumesByReferral,
      periodQuery.data,
      settlementCycle,
      thresholdQuery.data,
    ],
  );

  return {
    rows,
    isLoading:
      referralsQuery.isLoading ||
      detailQuery.isLoading ||
      (shouldReadPeriod && currentPeriodQuery.isLoading) ||
      periodQuery.isLoading ||
      thresholdQuery.isLoading ||
      stakeOrderIdsQuery.isLoading ||
      stakeOrderQuery.isLoading,
  };
}

function useTeamSummary(rootAddress: Address, enabled = true) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['ironBrother', 'teamSummary', CONTRACT_ADDRESS, rootAddress],
    enabled: Boolean(isContractConfigured && enabled && publicClient && rootAddress !== zeroAddress),
    queryFn: async (): Promise<TeamSummaryData> => {
      if (!publicClient) return emptyTeamSummary;

      const seen = new Set<string>([rootAddress.toLowerCase()]);
      let frontier: Address[] = [rootAddress];
      let totalDeposited = 0n;
      let totalMembers = 0;

      for (let depth = 0; depth < TEAM_SUMMARY_MAX_DEPTH && frontier.length > 0; depth += 1) {
        const referralGroups = await Promise.all(
          frontier.map(async (user) => {
            try {
              return (await publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'getDirectReferrals',
                args: [user],
              })) as readonly Address[];
            } catch {
              return [] as Address[];
            }
          }),
        );

        const next: Address[] = [];
        for (const referrals of referralGroups) {
          for (const referral of referrals) {
            const normalized = referral.toLowerCase();
            if (!seen.has(normalized)) {
              seen.add(normalized);
              next.push(referral);
            }
          }
        }

        if (next.length === 0) break;

        totalMembers += next.length;
        const accounts = await Promise.all(
          next.map(async (member) => {
            try {
              return userFromTuple(
                await publicClient.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'users',
                  args: [member],
                }),
              );
            } catch {
              return emptyUser;
            }
          }),
        );

        totalDeposited = accounts.reduce((sum, account) => sum + account.totalDeposited, totalDeposited);
        frontier = next;
      }

      return { totalDeposited, totalMembers };
    },
    staleTime: 30_000,
  });
}

function useIronBrotherData(scope: NavKey = 'home') {
  const { address } = useAccount();
  const accountEnabled = isContractConfigured && Boolean(address);
  const accountAddress = address ?? zeroAddress;
  const shouldLoadOrders = scope === 'home' || scope === 'stake' || scope === 'wallet';
  const shouldLoadTeam = scope === 'team';

  const baseQuery = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'users', args: [accountAddress] },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'availablePrincipal', args: [accountAddress] },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'maturedUnredeemedPrincipal', args: [accountAddress] },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'currentSession' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'timezoneOffset' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'yieldBps' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'withdrawFee' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'withdrawalApprovalRequired' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'defaultReferrer' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'currentLocalDay' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'settlementCycle' },
    ],
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
  });

  const pickBase = <T,>(index: number, fallback: T) => readResult(baseQuery.data?.[index], fallback);
  const account = userFromTuple(pickBase(0, undefined));
  const sessionTuple = pickBase(3, [0, 0n] as readonly [number, bigint]);
  const currentLocalDay = pickBase(13, 0n);
  const orders = useUserOrders(accountAddress, accountEnabled && shouldLoadOrders);
  const settlementCycle = pickBase(14, BigInt(SECONDS_PER_DAY));
  const directReferrals = useDirectReferralRows(
    accountAddress,
    accountEnabled && shouldLoadTeam,
    currentLocalDay,
    settlementCycle,
  );
  const teamSummary = useTeamSummary(accountAddress, accountEnabled && shouldLoadTeam);

  return {
    account,
    availablePrincipal: pickBase(1, 0n),
    maturedUnredeemed: pickBase(2, 0n),
    currentSession: Number(sessionTuple?.[0] ?? 0),
    sessionSettleAt: sessionTuple?.[1] ?? 0n,
    timezoneOffset: pickBase(4, BigInt(EAST8_TIMEZONE_SECONDS)),
    morningStart: pickBase(5, 9 * SECONDS_PER_HOUR),
    morningEnd: pickBase(6, 12 * SECONDS_PER_HOUR),
    afternoonStart: pickBase(7, 14 * SECONDS_PER_HOUR),
    afternoonEnd: pickBase(8, 17 * SECONDS_PER_HOUR),
    yieldBps: pickBase(9, 100n),
    withdrawFee: pickBase(10, 10n * 10n ** 18n),
    withdrawalApprovalRequired: pickBase(11, true),
    defaultReferrer: pickBase(12, zeroAddress),
    currentLocalDay,
    settlementCycle,
    principalOrderIds: orders.principalOrderIds,
    stakeOrderIds: orders.stakeOrderIds,
    withdrawalRequestIds: orders.withdrawalRequestIds,
    principalOrders: orders.principalOrders,
    stakeOrders: orders.stakeOrders,
    withdrawalRequests: orders.withdrawalRequests,
    directReferrals: directReferrals.rows,
    teamSummary: teamSummary.data ?? emptyTeamSummary,
    isTeamSummaryLoading: teamSummary.isLoading,
    isAccountLoading: baseQuery.isLoading,
    isSessionLoading: baseQuery.isLoading,
    isDefaultReferrerLoading: baseQuery.isLoading,
  };
}

function useTxRunner() {
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { writeContractAsync: wagmiWriteContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({
    label: '',
    status: 'idle',
  });

  async function writeContractAsync(request: ContractWriteRequest) {
    if (!address) {
      throw new Error('wallet is not connected');
    }
    if (!publicClient) {
      throw new Error('RPC client is not initialized');
    }

    const [gasPrice, gas] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.estimateContractGas({
        ...request,
        account: address,
      } as never),
    ]);

    return wagmiWriteContractAsync({
      ...request,
      account: address,
      chainId: selectedBscChain.id,
      type: 'legacy',
      gasPrice,
      gas: withGasBuffer(gas),
    } as ContractWriteRequest);
  }

  async function runTx(label: string, request: () => Promise<Hash>) {
    if (!publicClient) {
      setTx({ label, status: 'failed', error: 'RPC 客户端未初始化，请刷新页面后重试。', errorKind: 'rpc' });
      return;
    }

    try {
      setTx({ label, status: 'wallet' });
      const hash = await request();
      setTx({ label, hash, status: 'pending' });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setTx(
        receipt.status === 'success'
          ? { label, hash, status: 'confirmed' }
          : {
              label,
              hash,
              status: 'failed',
              error: '交易已提交，但链上执行失败。请打开 BscScan 查看失败原因。',
              errorKind: 'contract',
            },
      );
      await queryClient.invalidateQueries();
    } catch (error) {
      setTx({
        label,
        status: 'failed',
        ...normalizeTxError(error),
      });
    }
  }

  async function runTxFlow(label: string, steps: TxFlowStep[]) {
    if (!publicClient) {
      setTx({ label, status: 'failed', error: 'RPC 客户端未初始化，请刷新页面后重试。', errorKind: 'rpc' });
      return;
    }

    try {
      let lastHash: Hash | undefined;

      for (const [index, step] of steps.entries()) {
        const stepLabel = steps.length > 1 ? `${label}（${index + 1}/${steps.length} ${step.label}）` : label;
        setTx({ label: stepLabel, status: 'wallet' });
        const hash = await step.request();
        lastHash = hash;
        setTx({ label: stepLabel, hash, status: 'pending' });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status !== 'success') {
          setTx({
            label: stepLabel,
            hash,
            status: 'failed',
            error: '交易已提交，但链上执行失败。请打开 BscScan 查看失败原因。',
            errorKind: 'contract',
          });
          return;
        }
      }

      setTx({ label, hash: lastHash, status: 'confirmed' });
      await queryClient.invalidateQueries();
    } catch (error) {
      setTx({
        label,
        status: 'failed',
        ...normalizeTxError(error),
      });
    }
  }

  return { tx, runTx, runTxFlow, writeContractAsync };
}

function CustomerApp() {
  const [nav, setNav] = useState<NavKey>('home');
  const [locale, setLocale] = useState<LocaleKey>(initialLocale);
  const [dismissedReferrerPromptFor, setDismissedReferrerPromptFor] = useState<Address | undefined>();
  const promotionReferrer = useMemo(urlReferrer, []);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const data = useIronBrotherData(nav);
  const wrongNetwork = isConnected && chainId !== selectedBscChain.id;
  const copy = LOCALE_COPY[locale];
  const productTitle = productTitleForLocale(locale);
  const effectiveReferrer = useMemo(() => {
    if (!promotionReferrer) return data.defaultReferrer;
    if (address && promotionReferrer.toLowerCase() === address.toLowerCase()) return data.defaultReferrer;
    return promotionReferrer;
  }, [address, data.defaultReferrer, promotionReferrer]);
  const connectedDefaultReferrer = Boolean(address && effectiveReferrer.toLowerCase() === address.toLowerCase());
  const shouldPromptReferrer =
    Boolean(
      isConnected &&
        address &&
        isContractConfigured &&
        !wrongNetwork &&
        !data.isAccountLoading &&
        !data.isDefaultReferrerLoading &&
        data.account.referrer === zeroAddress &&
        !connectedDefaultReferrer &&
        dismissedReferrerPromptFor !== address,
    );

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    } catch {
      // localStorage may be unavailable in restricted browser contexts.
    }
  }, [locale]);

  return (
    <div className="app-shell">
      <header className="mobile-frame top-frame">
        <div className="topbar">
          <div className="brand-lockup">
            <img className="brand-logo" src={PRODUCT_LOGO_SRC} alt={PRODUCT_BRAND} />
            <h1>{productTitle}</h1>
          </div>
          <div className="topbar-actions">
            <TopLanguageSwitcher locale={locale} copy={copy} onChange={setLocale} />
            <WalletConnectButton />
          </div>
        </div>
        {!isContractConfigured && (
          <div className="notice warning">
            {copy.shell.contractMissing}
          </div>
        )}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: selectedBscChain.id })}>
            {copy.shell.switchNetwork}
          </button>
        )}
      </header>

      <main className="mobile-frame content-frame">
        {nav === 'home' && <HomeScreen data={data} copy={copy} disabled={!isConnected || wrongNetwork || !isContractConfigured} onNavigate={setNav} />}
        {nav === 'stake' && <StakeScreen data={data} disabled={!isConnected || wrongNetwork || !isContractConfigured} />}
        {nav === 'wallet' && (
          <WalletScreen
            data={data}
            disabled={!isConnected || wrongNetwork || !isContractConfigured}
            suggestedReferrer={effectiveReferrer}
          />
        )}
        {nav === 'bot' && <BotRewardsScreen address={address} data={data} />}
        {nav === 'team' && <TeamScreen address={address} data={data} />}
      </main>

      <nav className="mobile-frame bottom-nav" aria-label="主导航">
        <NavButton icon={<Landmark />} label={copy.nav.home} active={nav === 'home'} onClick={() => setNav('home')} />
        <NavButton icon={<Coins />} label={copy.nav.stake} active={nav === 'stake'} onClick={() => setNav('stake')} />
        <NavButton icon={<Wallet />} label={copy.nav.wallet} active={nav === 'wallet'} onClick={() => setNav('wallet')} />
        <NavButton icon={<Gift />} label={copy.nav.bot} active={nav === 'bot'} onClick={() => setNav('bot')} />
        <NavButton icon={<Users />} label={copy.nav.team} active={nav === 'team'} onClick={() => setNav('team')} />
      </nav>

      {shouldPromptReferrer && address && (
        <BindReferrerModal
          address={address}
          defaultReferrer={effectiveReferrer}
          onDismiss={() => setDismissedReferrerPromptFor(address)}
        />
      )}
    </div>
  );
}

function BindReferrerModal({
  address,
  defaultReferrer,
  onDismiss,
}: {
  address: Address;
  defaultReferrer: Address;
  onDismiss: () => void;
}) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [referrer, setReferrer] = useState(defaultReferrer === zeroAddress ? '' : defaultReferrer);
  const trimmedReferrer = referrer.trim();
  const referrerAddress = isAddress(trimmedReferrer) ? (trimmedReferrer as Address) : undefined;
  const transactionBusy = tx.status === 'wallet' || tx.status === 'pending';
  const validationMessage = !trimmedReferrer
    ? '请输入推荐人钱包地址。'
    : !referrerAddress
      ? '请输入有效的钱包地址。'
      : referrerAddress.toLowerCase() === address.toLowerCase()
        ? '推荐人不能是当前钱包。'
        : '';

  useEffect(() => {
    if (!referrer && defaultReferrer !== zeroAddress) {
      setReferrer(defaultReferrer);
    }
  }, [defaultReferrer, referrer]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="referrer-modal" role="dialog" aria-modal="true" aria-labelledby="bind-referrer-title">
        <div className="section-title">
          <div>
            <p className="eyebrow">Referrer</p>
            <h2 id="bind-referrer-title">绑定推荐人</h2>
          </div>
          <Users size={18} />
        </div>
        <p className="modal-helper">
          {defaultReferrer === zeroAddress
            ? '当前钱包还没有推荐人。绑定后推荐关系将写入链上，确认后不能更换。'
            : '当前钱包还没有推荐人。系统已填入默认推荐人，绑定后不可更改。'}
        </p>
        <label>
          推荐人地址
          <input
            value={referrer}
            onChange={(event) => setReferrer(event.target.value)}
            placeholder="0x..."
            spellCheck={false}
          />
        </label>
        {validationMessage && <p className="field-error">{validationMessage}</p>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" disabled={transactionBusy} onClick={onDismiss}>
            稍后绑定
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={transactionBusy || Boolean(validationMessage)}
            onClick={() => {
              if (!referrerAddress) return;
              runTx('绑定推荐人', () =>
                writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'register',
                  args: [referrerAddress],
                }),
              );
            }}
          >
            绑定推荐人
          </button>
        </div>
        <TxStatus tx={tx} />
      </section>
    </div>
  );
}

function HomeScreen({
  data,
  copy,
  disabled,
  onNavigate,
}: {
  data: ReturnType<typeof useIronBrotherData>;
  copy: LocaleCopy;
  disabled: boolean;
  onNavigate: (nav: NavKey) => void;
}) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const currentSessionLabel = sessionLabelForLocale(data.currentSession, copy);
  const morningRange = sessionTimeRange(data.morningStart, data.morningEnd);
  const afternoonRange = sessionTimeRange(data.afternoonStart, data.afternoonEnd);
  const nowSeconds = useNowSeconds();
  const transactionBusy = tx.status === 'wallet' || tx.status === 'pending';
  const recentOrders = useMemo(() => {
    return data.principalOrders
      .filter((order) => order.source === 0)
      .map((order) => ({
        id: `principal-${order.id.toString()}`,
        orderId: order.id,
        label: `${principalSourceLabelForLocale(order.source, copy)} #${order.id.toString()}`,
        amount: order.amount,
        status: principalStatusLabelForLocale(order, copy, nowSeconds),
        time: principalOrderHomeTime(order, copy, nowSeconds),
        createdAt: order.createdAt,
        canRedeem: order.status === 0 && BigInt(nowSeconds) >= order.unlockAt,
      }))
      .sort((a, b) => {
        const createdDiff = compareBigIntDesc(a.createdAt, b.createdAt);
        return createdDiff !== 0 ? createdDiff : compareBigIntDesc(a.orderId, b.orderId);
      })
      .slice(0, HOME_LATEST_ORDER_LIMIT);
  }, [copy, data.principalOrders, nowSeconds]);

  return (
    <section className="screen-stack">
      <div className="asset-card glow">
        <div className="card-row">
          <span>{copy.home.principalWallet}</span>
          <LockKeyhole size={18} />
        </div>
        <strong><MoneyAmount value={data.availablePrincipal} /></strong>
        <small className="asset-card-detail">
          <span>{copy.home.totalPrincipal} <MoneyAmount value={data.account.principalBalance} /></span>
          <span>{copy.home.stakedPrincipal} <MoneyAmount value={data.account.principalStaked} /></span>
        </small>
      </div>

      <div className="quick-grid">
        <MetricCard label={copy.home.rewardWallet} value={<MoneyAmount value={data.account.rewardBalance} />} trend={`${copy.home.todaysYield} ${bpsToPercent(data.yieldBps)} / ${copy.home.perTime}`} />
        <MetricCard label={copy.home.maturedUnredeemed} value={<MoneyAmount value={data.maturedUnredeemed} />} trend={copy.home.maturedTrend} />
      </div>

      <div className="action-grid">
        <ActionPill icon={<ArrowDownToLine />} label={copy.home.actions.deposit} onClick={() => onNavigate('wallet')} />
        <ActionPill icon={<Coins />} label={copy.home.actions.stake} onClick={() => onNavigate('stake')} />
        <ActionPill icon={<Repeat2 />} label={copy.home.actions.reinvest} onClick={() => onNavigate('wallet')} />
        <ActionPill icon={<ArrowUpRight />} label={copy.home.actions.withdraw} onClick={() => onNavigate('wallet')} />
      </div>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">{copy.home.chainTimeEyebrow}</p>
            <h2>{copy.home.stakingSessions}</h2>
          </div>
          <span className="status-chip">{currentSessionLabel}</span>
        </div>
        <div className="session-list">
          <SessionRow title={copy.session.morning} time={morningRange} state={data.currentSession === 1 ? copy.session.canStake : copy.session.pending} amount={copy.home.perWalletPerSession} />
          <SessionRow title={copy.session.afternoon} time={afternoonRange} state={data.currentSession === 2 ? copy.session.canStake : copy.session.pending} amount={copy.home.perWalletPerSession} />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>{copy.home.latestOrders}</h2>
          <span>{recentOrders.length} {copy.home.orderUnit}</span>
        </div>
        {recentOrders.length > 0 ? (
          recentOrders.map((order) => (
            <OrderRow
              key={order.id}
              label={order.label}
              amount={order.amount}
              status={order.status}
              time={order.time}
              action={
                order.canRedeem ? (
                  <button
                    className="row-action-button"
                    type="button"
                    disabled={disabled || transactionBusy}
                    onClick={() =>
                      runTx(`${copy.order.redeem} #${order.orderId.toString()}`, () =>
                        writeContractAsync({
                          address: CONTRACT_ADDRESS,
                          abi: ironBrotherAbi,
                          functionName: 'redeemPrincipal',
                          args: [order.orderId],
                        }),
                      )
                    }
                  >
                    {copy.order.redeem}
                  </button>
                ) : undefined
              }
            />
          ))
        ) : (
          <EmptyState title={copy.home.noOrdersTitle} detail={copy.home.noOrdersDetail} />
        )}
        <TxStatus tx={tx} />
      </section>
    </section>
  );
}

function StakeScreen({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const [amount, setAmount] = useState(() => tokenInput(data.availablePrincipal));
  const previousDefaultAmountRef = useRef(amount);

  useEffect(() => {
    const nextDefaultAmount = tokenInput(data.availablePrincipal);
    setAmount((currentAmount) => {
      const shouldUseDefault = currentAmount === previousDefaultAmountRef.current;
      previousDefaultAmountRef.current = nextDefaultAmount;
      return shouldUseDefault ? nextDefaultAmount : currentAmount;
    });
  }, [data.availablePrincipal]);

  const parsedAmount = useMemo(() => {
    try {
      return parseTokenInput(amount);
    } catch {
      return 0n;
    }
  }, [amount]);
  const estimatedReward = (parsedAmount * data.yieldBps) / 10_000n;
  const sessionSettleLabel = data.sessionSettleAt > 0n ? dateTime(data.sessionSettleAt) : '未开放';
  const stakingWindowOpen = data.currentSession === 1 || data.currentSession === 2;
  const amountExceedsAvailable = parsedAmount > data.availablePrincipal;
  const sessionGuardMessage = data.isSessionLoading
    ? '正在读取链上场次，请稍候。'
    : stakingWindowOpen
      ? ''
      : '当前场次未开放，请等待下一场开启。';
  const amountGuardMessage = amountExceedsAvailable ? '带单金额不能超过可带单余额。' : '';
  const stakeDisabled = disabled || !stakingWindowOpen || data.isSessionLoading || parsedAmount <= 0n || amountExceedsAvailable;

  function submitStake() {
    if (stakeDisabled) return;

    runTx('确认带单', () =>
      writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'stake',
        args: [parsedAmount],
      }),
    );
  }

  return (
    <section className="screen-stack">
      <section className="panel pay-panel">
        <div className="section-title centered">
          <span />
          <h2>带单</h2>
          <Clock3 size={18} />
        </div>
        <label className="amount-field">
          <span>带单金额</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          <small>可带单 <MoneyAmount value={data.availablePrincipal} /></small>
        </label>

        <div className="calc-grid">
          <MetricCard label="链上场次" value={sessionLabel(data.currentSession)} trend={`东八区 ${currentSessionRange(data)}`} />
          <MetricCard label="预计收益" value={<MoneyAmount value={estimatedReward} prefix="+" />} trend={`${bpsToPercent(data.yieldBps)} / 结算 ${sessionSettleLabel}`} />
        </div>

        <button
          className="primary-button"
          type="button"
          disabled={stakeDisabled}
          onClick={submitStake}
        >
          确认带单
        </button>
        {sessionGuardMessage && <p className="field-error">{sessionGuardMessage}</p>}
        {amountGuardMessage && <p className="field-error">{amountGuardMessage}</p>}
        <TxStatus tx={tx} />
      </section>

      <StakeOrderList orders={data.stakeOrders} disabled={disabled} />
    </section>
  );
}

function WalletScreen({
  data,
  disabled,
  suggestedReferrer,
}: {
  data: ReturnType<typeof useIronBrotherData>;
  disabled: boolean;
  suggestedReferrer: Address;
}) {
  return (
    <section className="screen-stack">
      <DepositPanel disabled={disabled} suggestedReferrer={suggestedReferrer} />
      <WalletActions data={data} disabled={disabled} />
      <WithdrawalRequestList requests={data.withdrawalRequests} />
      <PrincipalOrderList orders={data.principalOrders} disabled={disabled} />
    </section>
  );
}

function DepositPanel({ disabled, suggestedReferrer }: { disabled: boolean; suggestedReferrer: Address }) {
  const { address } = useAccount();
  const { runTxFlow, tx, writeContractAsync } = useTxRunner();
  const [amount, setAmount] = useState('');
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
  const depositButtonLabel = needsApproval ? '授权并入金' : '确认入金';
  const transactionBusy = tx.status === 'wallet' || tx.status === 'pending';

  function submitDeposit() {
    const depositStep: TxFlowStep = {
      label: '确认入金',
      request: () =>
        writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'deposit',
          args: [parsedAmount, suggestedReferrer],
        }),
    };

    const steps: TxFlowStep[] = needsApproval
      ? [
          {
            label: '授权 USDT',
            request: () =>
              writeContractAsync({
                address: BSC_USDT_ADDRESS,
                abi: erc20Abi,
                functionName: 'approve',
                args: [CONTRACT_ADDRESS, parsedAmount],
              }),
          },
          depositStep,
        ]
      : [depositStep];

    runTxFlow(depositButtonLabel, steps);
  }

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">BEP-20 USDT</p>
          <h2>链上入金</h2>
        </div>
        <span className="status-chip">BSC</span>
      </div>
      <label className="full-field">
        入金金额
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
      </label>
      <p className="helper-line">
        新用户入金时，将使用推荐人：{suggestedReferrer === zeroAddress ? '未设置' : shortAddress(suggestedReferrer)}
      </p>
      <button className="primary-button" disabled={disabled || parsedAmount <= 0n || transactionBusy} onClick={submitDeposit}>
        {depositButtonLabel}
      </button>
      <TxStatus tx={tx} />
    </section>
  );
}

function WalletActions({ data, disabled }: { data: ReturnType<typeof useIronBrotherData>; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const rewardBalanceInput = tokenInput(data.account.rewardBalance);
  const [reinvestAmount, setReinvestAmount] = useState(() => rewardBalanceInput);
  const [withdrawAmount, setWithdrawAmount] = useState(() => rewardBalanceInput);
  const previousReinvestDefaultRef = useRef(reinvestAmount);
  const previousWithdrawDefaultRef = useRef(withdrawAmount);

  useEffect(() => {
    const nextDefaultAmount = tokenInput(data.account.rewardBalance);

    setReinvestAmount((currentAmount) => {
      const shouldUseDefault = currentAmount === previousReinvestDefaultRef.current;
      previousReinvestDefaultRef.current = nextDefaultAmount;
      return shouldUseDefault ? nextDefaultAmount : currentAmount;
    });

    setWithdrawAmount((currentAmount) => {
      const shouldUseDefault = currentAmount === previousWithdrawDefaultRef.current;
      previousWithdrawDefaultRef.current = nextDefaultAmount;
      return shouldUseDefault ? nextDefaultAmount : currentAmount;
    });
  }, [data.account.rewardBalance]);

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
  const withdrawActionLabel = data.withdrawalApprovalRequired ? '申请提现' : '确认提现';
  const withdrawHelper = data.withdrawalApprovalRequired
    ? <>提现手续费 <MoneyAmount value={data.withdrawFee} />，预计到账 <MoneyAmount value={netWithdrawal} />，提交后需后台审批打款。</>
    : <>提现手续费 <MoneyAmount value={data.withdrawFee} />，预计到账 <MoneyAmount value={netWithdrawal} />。</>;
  const reinvestValidation = reinvestParsed > data.account.rewardBalance ? '复投金额不能超过收益钱包余额。' : '';
  const withdrawValidation =
    withdrawParsed > data.account.rewardBalance
      ? '提现金额不能超过收益钱包余额。'
      : withdrawParsed > 0n && withdrawParsed <= data.withdrawFee
        ? '提现金额必须大于手续费。'
        : '';

  return (
    <section className="panel reward-wallet-panel">
      <div className="section-title reward-wallet-title">
        <div>
          <p className="eyebrow">Reward wallet</p>
          <h2>收益钱包</h2>
        </div>
        <div className="wallet-balance-summary">
          <span>可用收益</span>
          <strong><MoneyAmount value={data.account.rewardBalance} /></strong>
        </div>
      </div>
      <div className="calc-grid reward-wallet-metrics">
        <MetricCard label="静态累计" value={<MoneyAmount value={data.account.totalStaticReward} />} trend="带单按次结算" />
        <MetricCard label="动态累计" value={<MoneyAmount value={data.account.totalDynamicReward} />} trend="每日 0 点后可结算" />
      </div>
      <div className="form-grid reward-wallet-form">
        <label className="wallet-field">
          复投金额
          <input value={reinvestAmount} onChange={(event) => setReinvestAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          <small>可用 <MoneyAmount value={data.account.rewardBalance} /></small>
        </label>
        <label className="wallet-field">
          提现金额
          <input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          <small>可用 <MoneyAmount value={data.account.rewardBalance} /></small>
        </label>
      </div>
      <p className="helper-line reward-wallet-helper">{withdrawHelper}</p>
      {reinvestValidation && <p className="field-error">{reinvestValidation}</p>}
      {withdrawValidation && <p className="field-error">{withdrawValidation}</p>}
      <div className="split-buttons reward-wallet-actions">
        <button
          className="secondary-button"
          disabled={disabled || reinvestParsed <= 0n || Boolean(reinvestValidation)}
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
          disabled={disabled || withdrawParsed <= 0n || Boolean(withdrawValidation)}
          onClick={() =>
            runTx(withdrawActionLabel, () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'requestWithdrawRewards',
                args: [withdrawParsed],
              }),
            )
          }
        >
          {withdrawActionLabel}
        </button>
      </div>
      <TxStatus tx={tx} />
    </section>
  );
}

function BotRewardsScreen({ address, data }: { address?: Address; data: ReturnType<typeof useIronBrotherData> }) {
  const details = useDynamicRewardDetails(address);
  const pendingRewards = usePendingDynamicRewards(address, data.currentLocalDay);
  const latestDetail = details.rows[0];
  const settlementCycle = data.settlementCycle;
  const pendingRows = pendingRewards.data?.rows ?? [];
  const pendingTotal = pendingRewards.data?.total ?? 0n;
  const [visibleDetailCount, setVisibleDetailCount] = useState(DYNAMIC_REWARD_DETAIL_BATCH_SIZE);
  const visibleDetails = useMemo(
    () => details.rows.slice(0, visibleDetailCount),
    [details.rows, visibleDetailCount],
  );
  const hasMoreDetails = visibleDetailCount < details.rows.length;
  const shownDetailCount = Math.min(visibleDetailCount, details.rows.length);

  useEffect(() => {
    setVisibleDetailCount(DYNAMIC_REWARD_DETAIL_BATCH_SIZE);
  }, [address]);

  return (
    <section className="screen-stack">
      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Settlement Bot</p>
            <h2>动态收益</h2>
          </div>
          <Gift size={18} />
        </div>
        <div className="calc-grid dynamic-reward-grid">
          <MetricCard label="链上动态累计" value={<MoneyAmount value={data.account.totalDynamicReward} />} trend="已进入收益钱包" />
          <MetricCard
            label="待结算动态"
            value={pendingRewards.isLoading ? '--' : <MoneyAmount value={pendingTotal} prefix={pendingTotal > 0n ? '+' : ''} />}
            trend={pendingRewards.isError ? '读取失败' : `${pendingRows.length} 条待结算明细`}
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Reward details</p>
            <h2>动态收益明细</h2>
          </div>
          <span className="status-chip">{details.isLoading ? '读取中' : details.isError ? '读取失败' : `${details.rows.length} 条`}</span>
        </div>
        <div className="settlement-stats reward-summary-grid">
          <InfoLine label="当前周期" value={localPeriodLabel(data.currentLocalDay, settlementCycle)} />
          <InfoLine label="最近结算" value={latestDetail ? localPeriodLabel(latestDetail.day, settlementCycle) : '--'} />
          <InfoLine label="最近来源" value={latestDetail ? shortAddress(latestDetail.source) : '--'} />
          <InfoLine label="最近奖励" value={latestDetail ? <MoneyAmount value={latestDetail.reward} prefix="+" /> : '--'} />
        </div>
        <div className="list-stack reward-detail-list">
          {details.isLoading ? (
            <EmptyState title="正在读取动态明细" detail="明细来自合约 history，确认后会自动出现在这里。" />
          ) : details.isError ? (
            <EmptyState title="动态明细读取失败" detail="链上动态奖励 history 读取失败，请稍后重试。" />
          ) : details.rows.length > 0 ? (
            visibleDetails.map((detail) => <DynamicRewardDetailRow key={`${detail.upline}-${detail.historyIndex}`} detail={detail} settlementCycle={settlementCycle} />)
          ) : (
            <EmptyState title="暂无动态收益明细" />
          )}
        </div>
        {hasMoreDetails && (
          <div className="load-more-footer">
            <span>已显示 {shownDetailCount} / {details.rows.length} 条</span>
            <button
              type="button"
              className="load-more-button"
              onClick={() => setVisibleDetailCount((count) => count + DYNAMIC_REWARD_DETAIL_BATCH_SIZE)}
            >
              <ChevronDown size={16} />
              点击加载更多
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Pending rewards</p>
            <h2>待结算动态收益</h2>
          </div>
          <span className="status-chip">{pendingRewards.isLoading ? '读取中' : pendingRewards.isError ? '读取失败' : `${pendingRows.length} 条`}</span>
        </div>
        <div className="settlement-stats reward-summary-grid">
          <InfoLine label="扫描周期" value={`最近 ${pendingRewards.data?.scannedDays.length ?? PENDING_DYNAMIC_LOOKBACK_PERIODS} 期`} />
          <InfoLine
            label="团队来源"
            value={`${pendingRewards.data?.sourceCount ?? 0} 个${pendingRewards.data?.isSourceLimitReached ? '+' : ''}`}
          />
          <InfoLine label="待结算笔数" value={`${pendingRows.length} 笔`} />
          <InfoLine label="待结算金额" value={pendingRewards.isLoading ? '--' : <MoneyAmount value={pendingTotal} prefix={pendingTotal > 0n ? '+' : ''} />} />
        </div>
        <div className="list-stack reward-detail-list">
          {pendingRewards.isLoading ? (
            <EmptyState title="正在读取待结算动态收益" detail="正在读取直推关系、已关闭周期流水和动态奖励比例。" />
          ) : pendingRewards.isError ? (
            <EmptyState title="待结算动态收益读取失败" detail="链上读取失败，请检查网络后重试。" />
          ) : pendingRows.length > 0 ? (
            pendingRows.map((row) => <PendingDynamicRewardListRow key={`${row.source}-${row.day}-${row.generation}`} row={row} settlementCycle={settlementCycle} />)
          ) : (
            <EmptyState title="暂无待结算动态收益" detail="下级已关闭周期有质押流水、且在可拿代数内未结算时，会显示在这里。" />
          )}
        </div>
      </section>
    </section>
  );
}

function PendingDynamicRewardListRow({ row, settlementCycle }: { row: PendingDynamicRewardRow; settlementCycle: bigint }) {
  return (
    <div className="admin-list-row reward-detail-row pending-reward-row">
      <div className="row-icon"><Clock3 size={17} /></div>
      <div>
        <strong>待结算 {shortAddress(row.source)} / {row.generation} 代</strong>
        <small>周期 {localPeriodLabel(row.day, settlementCycle)} / 比例 {bpsToPercent(row.rateBps)}</small>
      </div>
      <div className="row-metrics">
        <span>流水 {token(row.volume)} U</span>
        <span className="amount-positive">+{token(row.reward)} U</span>
      </div>
    </div>
  );
}

function DynamicRewardDetailRow({ detail, settlementCycle }: { detail: DynamicRewardDetail; settlementCycle: bigint }) {
  return (
    <div className="admin-list-row reward-detail-row">
      <div className="row-icon"><Gift size={17} /></div>
      <div>
        <strong>来自 {shortAddress(detail.source)} / {detail.generation} 代</strong>
        <small>周期 {localPeriodLabel(detail.day, settlementCycle)}</small>
      </div>
      <div className="row-metrics">
        <span>流水 {token(detail.volume)} U</span>
        <span className="amount-positive">+{token(detail.reward)} U</span>
      </div>
    </div>
  );
}

function TeamScreen({ address, data }: { address?: Address; data: ReturnType<typeof useIronBrotherData> }) {
  return (
    <section className="screen-stack">
      <section className="panel profile-panel">
        <div className="avatar-large">
          <img className="avatar-logo" src={PRODUCT_LOGO_SRC} alt={PRODUCT_BRAND} />
        </div>
        <h2>{shortAddress(address)}</h2>
      </section>
      <PromotionLinkCard address={address} />
      <section className="panel">
        <InfoLine
          label="我的推荐人"
          value={
            data.account.referrer !== zeroAddress
              ? shortAddress(data.account.referrer)
              : data.defaultReferrer === zeroAddress
                ? '未绑定'
                : `${shortAddress(data.defaultReferrer)}（默认）`
          }
        />
      </section>
      <div className="quick-grid">
        <MetricCard
          label="团队充值总业绩"
          value={data.isTeamSummaryLoading ? '--' : <MoneyAmount value={data.teamSummary.totalDeposited} />}
          trend="累计下级入金"
        />
        <MetricCard
          label="团队人数"
          value={data.isTeamSummaryLoading ? '--' : `${data.teamSummary.totalMembers} 人`}
          trend="含所有下级成员"
        />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>直推列表</h2>
          <span>{data.directReferrals.length} 人</span>
        </div>
        {data.directReferrals.length > 0 ? (
          data.directReferrals.map((item) => <DirectReferralListRow key={item.address} item={item} />)
        ) : (
          <EmptyState title="暂无直推数据" />
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Account</p>
            <h2>我的资料</h2>
          </div>
          <UserRound size={18} />
        </div>
        <InfoLine label="USDT 合约" value={shortAddress(BSC_USDT_ADDRESS)} />
        <InfoLine label="业务合约" value={isContractConfigured ? shortAddress(CONTRACT_ADDRESS) : '未配置'} />
        <InfoLine label="网络" value="BSC Testnet" />
        <InfoLine label="当前周期" value={localPeriodLabel(data.currentLocalDay, data.settlementCycle)} />
        <InfoLine label="累计入金" value={<MoneyAmount value={data.account.totalDeposited} />} />
        <InfoLine label="累计提现" value={<MoneyAmount value={data.account.totalWithdrawn} />} />
      </section>
    </section>
  );
}

function PromotionLinkCard({ address }: { address?: Address }) {
  const promotionLink = useMemo(() => promotionLinkForAddress(address), [address]);
  const promotionLinkLabel = address ? `ref=${shortAddress(address)}` : '';
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyStatus =
    copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请手动复制' : '分享给新用户绑定推荐关系';

  useEffect(() => {
    setCopyState('idle');
  }, [promotionLink]);

  return (
    <section className="panel promotion-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Referral</p>
          <h2>推广链接</h2>
        </div>
        <Link2 size={18} />
      </div>
      {promotionLink ? (
        <>
          <div className="promotion-link-row">
            <div className="promotion-link-content">
              <span>我的推广链接</span>
              <strong>{promotionLinkLabel}</strong>
            </div>
            <div className="promotion-link-actions">
              <button
                className="icon-button"
                type="button"
                title="复制推广链接"
                aria-label="复制推广链接"
                onClick={async () => {
                  try {
                    await copyText(promotionLink);
                    setCopyState('copied');
                  } catch {
                    setCopyState('failed');
                  }
                }}
              >
                <Copy size={16} />
              </button>
              <a
                className="icon-button"
                href={promotionLink}
                target="_blank"
                rel="noreferrer"
                title="打开推广链接"
                aria-label="打开推广链接"
              >
                <ArrowUpRight size={16} />
              </a>
            </div>
          </div>
          <p className={copyState === 'failed' ? 'promotion-copy-status danger' : 'promotion-copy-status'}>
            {copyStatus}
          </p>
        </>
      ) : (
        <EmptyState title="暂无推广链接" />
      )}
    </section>
  );
}

function AdminConsole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongNetwork = isConnected && chainId !== selectedBscChain.id;
  const { switchChain } = useSwitchChain();
  const runner = useTxRunner();
  const [nav, setNav] = useState<AdminNavKey>('dashboard');
  const role = useAdminRole(address);
  const accessStatus = resolveAdminAccess({
    isContractConfigured,
    isConnected,
    wrongNetwork,
    isRoleLoading: role.isLoading,
    isSuperAdmin: role.isSuperAdmin,
    isManager: role.isManager,
  });
  const adminAllowed = accessStatus === 'allowed';
  const dashboard = useAdminDashboard(adminAllowed);

  const canEdit = isContractConfigured && role.isSuperAdmin && !wrongNetwork;
  const canWrite = isContractConfigured && !wrongNetwork;
  const readOnly = isContractConfigured && role.isManager && !role.isSuperAdmin;
  const navItems: { key: AdminNavKey; label: string }[] = [
    { key: 'dashboard', label: '数据看板' },
    { key: 'users', label: '用户管理' },
    { key: 'principal', label: '本金订单' },
    { key: 'stakes', label: '带单订单' },
    { key: 'rewards', label: '收益流水' },
    { key: 'withdrawals', label: '提现申请' },
    { key: 'team', label: '团队关系' },
    { key: 'config', label: '合约配置' },
    { key: 'roles', label: '权限管理' },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div>
          <p className="eyebrow">{PRODUCT_BRAND}</p>
          <h1>Admin</h1>
        </div>
        <a href="/">客户页面</a>
        {adminAllowed && navItems.map((item) => (
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
          <div className="brand-lockup admin-brand-lockup">
            <img className="brand-logo" src={PRODUCT_LOGO_SRC} alt={PRODUCT_BRAND} />
            <div>
              <p className="eyebrow">BSC Contract Console</p>
              <h1>链上管理面板</h1>
            </div>
          </div>
          <WalletConnectButton />
        </header>

        {adminAllowed ? (
          <>
            {readOnly && <div className="notice">当前钱包是 Manager，只能查看数据，不能修改合约配置。</div>}

            {nav === 'dashboard' && <AdminDashboardPage dashboard={dashboard} />}
            {nav === 'users' && <AdminUsersPage />}
            {nav === 'principal' && <AdminPrincipalOrdersPage canWrite={canEdit} runner={runner} />}
            {nav === 'stakes' && <AdminStakeOrdersPage />}
            {nav === 'rewards' && <AdminRewardsPage canWrite={canWrite} runner={runner} />}
            {nav === 'withdrawals' && <AdminWithdrawalsPage canWrite={canWrite} canApprove={canEdit} runner={runner} />}
            {nav === 'team' && <AdminTeamPage defaultAddress={address} />}
            {nav === 'config' && <AdminConfigPage canEdit={canEdit} runner={runner} />}
            {nav === 'roles' && <AdminRolesPage canEdit={canEdit} runner={runner} />}
          </>
        ) : (
          <AdminAccessGate
            status={accessStatus as Exclude<AdminAccessStatus, 'allowed'>}
            onSwitchChain={() => switchChain({ chainId: selectedBscChain.id })}
          />
        )}

        {adminAllowed && runner.tx.status !== 'idle' && (
          <section className="admin-panel tx-panel">
            <TxStatus tx={runner.tx} />
          </section>
        )}
      </main>
    </div>
  );
}

function AdminAccessGate({
  status,
  onSwitchChain,
}: {
  status: Exclude<AdminAccessStatus, 'allowed'>;
  onSwitchChain: () => void;
}) {
  if (status === 'switch-network') {
    return (
      <section className="admin-panel">
        <EmptyState title="需要切换网络" detail={`Admin 后台只允许在 ${selectedBscChain.name} 读取权限。`} />
        <button className="primary-button full-button" type="button" onClick={onSwitchChain}>
          切换到 {selectedBscChain.name}
        </button>
      </section>
    );
  }

  const content: Record<Exclude<AdminAccessStatus, 'allowed' | 'switch-network'>, { title: string; detail: string }> = {
    checking: {
      title: '正在验证权限',
      detail: '正在读取当前钱包的 Admin/Manager 链上角色。',
    },
    connect: {
      title: '请连接管理员钱包',
      detail: '连接拥有 Admin 或 Manager 权限的钱包后才能进入后台。',
    },
    denied: {
      title: '无权访问 Admin',
      detail: '当前钱包没有 Admin/Manager 权限，不能进入后台页面。',
    },
    unconfigured: {
      title: '后台未启用',
      detail: '合约地址未配置，暂不能进入 Admin 后台。',
    },
  };
  const { title, detail } = content[status];

  return (
    <section className="admin-panel">
      <EmptyState title={title} detail={detail} />
      {status === 'denied' && (
        <a className="secondary-button full-button" href="/">
          返回客户页面
        </a>
      )}
    </section>
  );
}

function AdminDashboardPage({ dashboard }: { dashboard: ReturnType<typeof useAdminDashboard> }) {
  return (
    <section className="admin-grid">
      <AdminCard icon={<Users />} label="总用户" value={dashboard.totalUsers.toString()} />
      <AdminCard icon={<ArrowDownToLine />} label="总入金" value={`${token(dashboard.totalDepositedAmount)} U`} />
      <AdminCard icon={<Wallet />} label="当前本金" value={`${token(dashboard.totalPrincipalBalance)} U`} />
      <AdminCard icon={<Gift />} label="当前收益" value={`${token(dashboard.totalRewardBalance)} U`} />
      <AdminCard icon={<BarChart3 />} label="带单流水" value={`${token(dashboard.totalStakedVolume)} U`} />
      <AdminCard icon={<Coins />} label="静态收益" value={`${token(dashboard.totalStaticRewardCredited)} U`} />
      <AdminCard icon={<Users />} label="动态奖励" value={`${token(dashboard.totalDynamicRewardCredited)} U`} />
      <AdminCard icon={<Send />} label="提现总额" value={`${token(dashboard.totalWithdrawnAmount)} U`} />
      <AdminCard icon={<Clock3 />} label="待审提现" value={`${token(dashboard.totalPendingWithdrawalAmount)} U`} />
    </section>
  );
}

function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const lookupAddress = isAddress(search.trim()) ? (search.trim() as Address) : undefined;
  const [selectedAddress, setSelectedAddress] = useState<Address | undefined>();
  const orderBook = useAdminOrderBook();
  const withdrawals = useAdminWithdrawalRequests();
  const totalUsersQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'totalUsers',
    query: { enabled: isContractConfigured },
  });
  const orderAddresses = useMemo(
    () =>
      uniqueAddresses([
        ...orderBook.principalOrders.map((order) => order.user),
        ...orderBook.stakeOrders.map((order) => order.user),
        ...withdrawals.requests.map((request) => request.user),
      ]),
    [orderBook.principalOrders, orderBook.stakeOrders, withdrawals.requests],
  );
  const extraAddresses = useMemo(() => uniqueAddresses([lookupAddress, selectedAddress, ...orderAddresses]), [lookupAddress, orderAddresses, selectedAddress]);
  const users = useAdminUsers(extraAddresses);
  const totalUsers = (totalUsersQuery.data as bigint | undefined) ?? 0n;
  const sortedRows = useMemo(
    () =>
      [...users.rows].sort((left, right) => {
        if (left.account.registered !== right.account.registered) return left.account.registered ? -1 : 1;
        const latestDiff = compareAdminUserLatest(left, right);
        if (latestDiff !== 0) return latestDiff;
        const depositedDiff = compareBigIntDesc(left.account.totalDeposited, right.account.totalDeposited);
        if (depositedDiff !== 0) return depositedDiff;
        return left.address.localeCompare(right.address);
      }),
    [users.rows],
  );
  const selectedRow = useMemo(() => {
    if (selectedAddress) {
      const matched = users.rows.find((row) => row.address.toLowerCase() === selectedAddress.toLowerCase());
      if (matched) return matched;
    }
    return sortedRows[0];
  }, [selectedAddress, sortedRows, users.rows]);

  useEffect(() => {
    if (lookupAddress) {
      setSelectedAddress(lookupAddress);
    }
  }, [lookupAddress]);
  const registeredRows = sortedRows.filter((row) => row.account.registered);
  const totalUsersLabel = totalUsers > 0n ? `${registeredRows.length}/${totalUsers.toString()} 人` : `${registeredRows.length} 人`;
  const showPartialUserWarning = totalUsers > BigInt(registeredRows.length);

  return (
    <section className="screen-stack">
      <section className="admin-users-layout">
        <section className="admin-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">Users</p>
              <h2>用户管理</h2>
            </div>
            <span className="status-chip">{totalUsersLabel}</span>
          </div>
          <label className="full-field">
            搜索钱包地址
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入 0x 地址可直接读取该用户链上资料" />
          </label>
          {users.isLoading && <p className="helper-line">正在读取用户索引/事件和链上账户...</p>}
          {users.eventError && users.indexedCount === 0 && <p className="field-error">合约用户索引为空，用户事件读取也失败，已尝试从订单地址兜底回显。请检查线上 RPC 或先执行历史用户同步。</p>}
          {!users.eventError && users.indexedCount === 0 && users.eventCount === 0 && totalUsers > 0n && (
            <p className="field-error">链上已有 {totalUsers.toString()} 个用户，但当前合约用户索引为空。升级后需要执行 syncRegisteredUsers 同步历史用户。</p>
          )}
          {showPartialUserWarning && (
            <p className="field-error">当前仅回显 {registeredRows.length} / {totalUsers.toString()} 个链上用户。要完全一致，请用 syncRegisteredUsers 补齐历史用户索引。</p>
          )}
          <div className="list-stack">
            {sortedRows.length > 0 ? (
              sortedRows.map((row) => (
                <AdminUserListRow
                  key={row.address}
                  row={row}
                  selected={selectedRow?.address.toLowerCase() === row.address.toLowerCase()}
                  onSelect={setSelectedAddress}
                />
              ))
            ) : (
              <EmptyState title="暂无注册记录" detail="可输入钱包地址，直接查询该用户的链上资料。" />
            )}
          </div>
        </section>

        <AdminUserDetailPanel row={selectedRow} onSelect={setSelectedAddress} />
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">User Tree</p>
            <h2>全部用户关系树</h2>
          </div>
          <span className="status-chip">{totalUsersLabel}</span>
        </div>
        <AdminUserTree rows={users.rows} selectedAddress={selectedRow?.address} onSelect={setSelectedAddress} />
      </section>
    </section>
  );
}

function AdminUserListRow({
  row,
  selected,
  onSelect,
}: {
  row: AdminUserRow;
  selected: boolean;
  onSelect: (address: Address) => void;
}) {
  return (
    <button className={`admin-list-row wide user-row-button${selected ? ' selected' : ''}`} type="button" onClick={() => onSelect(row.address)}>
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
    </button>
  );
}

function AdminUserTree({
  rows,
  selectedAddress,
  onSelect,
}: {
  rows: AdminUserRow[];
  selectedAddress?: Address;
  onSelect: (address: Address) => void;
}) {
  const tree = useMemo(() => buildUserTree(rows), [rows]);

  if (tree.length === 0) {
    return <EmptyState title="暂无用户树" detail="用户注册后，会按推荐关系在这里生成层级树。" />;
  }

  return (
    <div className="user-tree">
      {tree.map((node) => (
        <AdminUserTreeNode key={node.address} node={node} depth={0} seen={new Set()} selectedAddress={selectedAddress} onSelect={onSelect} />
      ))}
    </div>
  );
}

function AdminUserTreeNode({
  node,
  depth,
  seen,
  selectedAddress,
  onSelect,
}: {
  node: UserTreeNode;
  depth: number;
  seen: Set<string>;
  selectedAddress?: Address;
  onSelect: (address: Address) => void;
}) {
  const key = node.address.toLowerCase();
  const cyclic = seen.has(key);
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  const selected = selectedAddress?.toLowerCase() === key;

  return (
    <div className="user-tree-node">
      <button className={`user-tree-row user-tree-row-button${selected ? ' selected' : ''}`} type="button" style={{ paddingLeft: depth * 18 }} onClick={() => onSelect(node.address)}>
        <div className="row-icon"><Users size={17} /></div>
        <div>
          <strong>{shortAddress(node.address)}</strong>
          <small>上级 {shortAddress(node.account.referrer)} / 直推 {node.account.directCount.toString()}</small>
        </div>
        <div className="row-metrics">
          <span>入金 {token(node.account.totalDeposited)} U</span>
          <span>本金 {token(node.account.principalBalance)} U</span>
          <span>动态 {token(node.account.totalDynamicReward)} U</span>
          {cyclic && <span className="amount-muted">循环引用</span>}
        </div>
      </button>
      {!cyclic && node.children.length > 0 && (
        <div className="user-tree-children">
          {node.children.map((child) => (
            <AdminUserTreeNode
              key={`${node.address}-${child.address}`}
              node={child}
              depth={depth + 1}
              seen={nextSeen}
              selectedAddress={selectedAddress}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUserDetailPanel({
  row,
  onSelect,
}: {
  row?: AdminUserRow;
  onSelect: (address: Address) => void;
}) {
  const address = row?.address ?? zeroAddress;
  const enabled = Boolean(row && address !== zeroAddress);
  const orders = useUserOrders(address, enabled);
  const referrals = useDirectReferralRows(address, enabled);
  const teamSummary = useTeamSummary(address, enabled);
  const latestPrincipalOrders = useMemo(() => [...orders.principalOrders].sort(comparePrincipalOrderLatest).slice(0, 2), [orders.principalOrders]);
  const latestStakeOrders = useMemo(() => [...orders.stakeOrders].sort(compareStakeOrderLatest).slice(0, 2), [orders.stakeOrders]);
  const latestWithdrawalRequests = useMemo(
    () => [...orders.withdrawalRequests].sort(compareWithdrawalRequestLatest).slice(0, 2),
    [orders.withdrawalRequests],
  );

  if (!row) {
    return (
      <section className="admin-panel user-detail-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">User Detail</p>
            <h2>用户详细信息</h2>
          </div>
          <span className="status-chip">未选择</span>
        </div>
        <EmptyState title="请选择用户" detail="从用户列表或关系树点击钱包地址后，会在这里回显链上明细。" />
      </section>
    );
  }

  const account = row.account;
  const accountStatus = account.whitelist40 ? '40 代白名单' : account.registered ? '已注册' : '未注册';

  return (
    <section className="admin-panel user-detail-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">User Detail</p>
          <h2>用户详细信息</h2>
        </div>
        <span className="status-chip">{accountStatus}</span>
      </div>

      <div className="user-detail-address">
        <div>
          <strong>{row.address}</strong>
          <small>上级 {account.referrer === zeroAddress ? '未绑定' : shortAddress(account.referrer)} / 直推 {account.directCount.toString()} 人</small>
        </div>
        <a href={`${bscExplorerBaseUrl}/address/${row.address}`} target="_blank" rel="noreferrer">BscScan</a>
      </div>

      <div className="settlement-stats user-detail-stats">
        <InfoLine label="本金余额" value={`${token(account.principalBalance)} U`} />
        <InfoLine label="带单中本金" value={`${token(account.principalStaked)} U`} />
        <InfoLine label="收益余额" value={`${token(account.rewardBalance)} U`} />
        <InfoLine label="累计入金" value={`${token(account.totalDeposited)} U`} />
        <InfoLine label="累计带单" value={`${token(account.totalStaked)} U`} />
        <InfoLine label="累计提现" value={`${token(account.totalWithdrawn)} U`} />
        <InfoLine label="静态收益" value={`${token(account.totalStaticReward)} U`} />
        <InfoLine label="动态收益" value={`${token(account.totalDynamicReward)} U`} />
        <InfoLine label="团队人数" value={teamSummary.isLoading ? '读取中' : `${teamSummary.data?.totalMembers ?? 0} 人`} />
        <InfoLine label="团队入金" value={teamSummary.isLoading ? '读取中' : `${token(teamSummary.data?.totalDeposited ?? 0n)} U`} />
        <InfoLine label="本金订单" value={`${orders.principalOrders.length} 笔`} />
        <InfoLine label="带单订单" value={`${orders.stakeOrders.length} 笔`} />
      </div>

      <section className="user-detail-section">
        <div className="section-title compact-title">
          <h3>直推用户</h3>
          <span>{referrals.rows.length} 人</span>
        </div>
        <div className="list-stack">
          {referrals.rows.length > 0 ? (
            referrals.rows.map((item) => <DirectReferralListRow key={item.address} item={item} onSelect={onSelect} />)
          ) : (
            <EmptyState title="暂无直推用户" detail="该用户当前没有链上直推记录。" />
          )}
        </div>
      </section>

      <section className="user-detail-section">
        <div className="section-title compact-title">
          <h3>最近订单</h3>
          <span>{orders.isLoading ? '读取中' : `${orders.principalOrders.length + orders.stakeOrders.length + orders.withdrawalRequests.length} 笔`}</span>
        </div>
        <div className="list-stack">
          {latestPrincipalOrders.map((order) => (
            <OrderRow
              key={`principal-${order.id.toString()}`}
              label={`${principalSourceLabel(order.source)} #${order.id.toString()}`}
              amount={order.amount}
              status={principalStatusLabel(order)}
              time={`创建 ${dateTime(order.createdAt)} / 解锁 ${dateTime(order.unlockAt)}`}
            />
          ))}
          {latestStakeOrders.map((order) => (
            <OrderRow
              key={`stake-${order.id.toString()}`}
              label={`带单订单 #${order.id.toString()}`}
              amount={order.amount}
              status={stakeStatusLabel(order)}
              time={`${sessionLabel(order.session)} / 收益 ${token(order.reward)} U / 结算 ${dateTime(order.settleAt)}`}
            />
          ))}
          {latestWithdrawalRequests.map((request) => (
            <OrderRow
              key={`withdrawal-${request.id.toString()}`}
              label={`提现申请 #${request.id.toString()}`}
              amount={request.amount}
              status={withdrawalStatusLabel(request)}
              time={`到账 ${token(request.netAmount)} U / 申请 ${dateTime(request.requestedAt)}`}
            />
          ))}
          {latestPrincipalOrders.length + latestStakeOrders.length + latestWithdrawalRequests.length === 0 && (
            <EmptyState title="暂无订单记录" detail="该用户暂未产生本金、带单或提现申请。" />
          )}
        </div>
      </section>
    </section>
  );
}

function AdminPrincipalOrdersPage({ canWrite, runner }: { canWrite: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const orderBook = useAdminOrderBook();
  const pagination = usePaginatedItems(
    orderBook.principalOrders,
    ADMIN_ORDER_PAGE_SIZE,
    orderBook.principalOrders[0]?.id.toString() ?? 'empty',
  );

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
          pagination.items.map((order) => (
            <AdminPrincipalOrderRow key={order.id.toString()} order={order} canWrite={canWrite} runner={runner} />
          ))
        ) : (
          <EmptyState title="暂无本金订单" detail="用户入金或复投后，本金订单会自动显示在这里。" />
        )}
      </div>
      <PaginationControls {...pagination} onPageChange={pagination.setPage} />
    </section>
  );
}

function AdminStakeOrdersPage() {
  const orderBook = useAdminOrderBook();
  const config = useContractConfig();
  const pagination = usePaginatedItems(
    orderBook.stakeOrders,
    ADMIN_ORDER_PAGE_SIZE,
    orderBook.stakeOrders[0]?.id.toString() ?? 'empty',
  );

  return (
    <section className="admin-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Stake Orders</p>
          <h2>带单订单</h2>
        </div>
        <span className="status-chip">{orderBook.stakeOrders.length} 笔</span>
      </div>
      <div className="list-stack">
        {orderBook.stakeOrders.length > 0 ? (
          pagination.items.map((order) => <AdminStakeOrderRow key={order.id.toString()} order={order} settlementCycle={config.settlementCycle} />)
        ) : (
          <EmptyState title="暂无带单订单" detail="用户完成带单后，订单会自动显示在这里。" />
        )}
      </div>
      <PaginationControls {...pagination} onPageChange={pagination.setPage} />
    </section>
  );
}

function AdminRewardsPage({ canWrite, runner }: { canWrite: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const [dynamicUser, setDynamicUser] = useState('');
  const [dynamicPeriodStart, setDynamicPeriodStart] = useState('');
  const [batchUsers, setBatchUsers] = useState('');
  const [stakeIds, setStakeIds] = useState('');
  const currentPeriodQuery = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'currentLocalDay' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'settlementCycle' },
    ],
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
  });
  const currentLocalDay = readResult(currentPeriodQuery.data?.[0], 0n);
  const settlementCycle = readResult(currentPeriodQuery.data?.[1], BigInt(SECONDS_PER_DAY));
  const settlementDay = useMemo(
    () => localPeriodDayFromInput(dynamicPeriodStart, settlementCycle),
    [dynamicPeriodStart, settlementCycle],
  );
  const dayClosed = settlementDay > 0n && settlementDay < currentLocalDay;
  const currentPeriodLabel = localPeriodLabel(currentLocalDay, settlementCycle);
  const selectedPeriodLabel = settlementDay > 0n ? localPeriodLabel(settlementDay, settlementCycle) : '--';
  const users = useAdminUsers();
  const settlement = useDynamicSettlementRows(users.rows, settlementDay, settlementDay > 0n);
  const allSettlement = useAllDynamicSettlementRows(users.rows, currentLocalDay);
  const oneClickAddresses = settlement.pendingRows.map((row) => row.address);
  const validPendingCount = settlement.pendingRows.filter((row) => row.isValidOnDay).length;
  const allPendingRows = allSettlement.data?.pendingRows ?? [];
  const allSettlementGroups = allSettlement.data?.groups ?? [];
  const allPendingVolume = allPendingRows.reduce((sum, row) => sum + row.dailyStakeVolume, 0n);
  const allValidPendingCount = allPendingRows.filter((row) => row.isValidOnDay).length;
  const allSettlementBatches = useMemo(
    () => chunkSettlementSourceDays(allPendingRows),
    [allPendingRows],
  );
  const allSettlementTxCount = allSettlementBatches.length;
  const orderBook = useAdminOrderBook();
  const currentDayStakeOrders = orderBook.stakeOrders.filter((order) => order.day === currentLocalDay);
  const unsettledStakeOrders = orderBook.stakeOrders.filter((order) => !order.settled);
  const recentStakeVolume = orderBook.stakeOrders.reduce((sum, order) => sum + order.amount, 0n);
  const currentDayStakeVolume = currentDayStakeOrders.reduce((sum, order) => sum + order.amount, 0n);
  const events = useChainEvents(['StakeCreated', 'StakeSettled', 'DynamicRewardSettled', 'DynamicRewardBotSettled', 'WithdrawalRequested', 'WithdrawalApproved', 'WithdrawalRejected', 'RewardsFunded', 'ContractFundsWithdrawn', 'PrincipalRedeemed', 'Reinvested']);

  useEffect(() => {
    if (!dynamicPeriodStart && currentLocalDay > 0n) {
      setDynamicPeriodStart(localPeriodInputValue(currentLocalDay - 1n, settlementCycle));
    }
  }, [currentLocalDay, dynamicPeriodStart, settlementCycle]);

  function runAllDynamicSettlement() {
    const steps = allSettlementBatches.map((rows, index, batches): TxFlowStep => ({
      label: batches.length > 1 ? `全量批次 ${index + 1}/${batches.length}` : '全部待结算',
      request: () =>
        runner.writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          functionName: 'settleDynamicRewardForSourceDays',
          args: [rows.map((row) => row.address), rows.map((row) => row.day)],
        }),
    }));

    if (steps.length === 0) return;
    runner.runTxFlow('全量一键动态结算', steps);
  }

  return (
    <section className="screen-stack">
      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Cycle settlement</p>
            <h2>收益结算</h2>
          </div>
          <Clock3 size={20} />
        </div>
        <div className="settlement-box">
          <div className="section-title">
            <div>
              <p className="eyebrow">Auto settlement</p>
              <h2>全量一键动态结算</h2>
            </div>
            <span className="status-chip">
              {allSettlement.isLoading ? '扫描中' : allSettlement.isError ? '读取失败' : `${allPendingRows.length} 待结算`}
            </span>
          </div>
          <div className="settlement-stats">
            <InfoLine label="扫描用户" value={`${users.rows.filter((row) => row.account.registered).length} 人`} />
            <InfoLine label="未结算周期" value={`${allSettlementGroups.length} 个`} />
            <InfoLine label="有效流水用户" value={`${allValidPendingCount} 人`} />
            <InfoLine label="预计交易" value={`${allSettlementTxCount} 笔`} />
            <InfoLine label="未结算流水" value={`${token(allPendingVolume)} U`} />
          </div>
          <button
            className="primary-button"
            disabled={!canWrite || users.isLoading || allSettlement.isLoading || allSettlementGroups.length === 0}
            onClick={runAllDynamicSettlement}
          >
            自动结算全部未结算动态奖励
          </button>
          <p className="helper-line">
            系统会自动扫描所有已登记用户的已关闭带单周期，并按周期分组提交结算；不需要手动输入地址或周期。
          </p>
          <div className="settlement-preview">
            {allSettlement.isLoading ? (
              <span>正在扫描所有带单周期...</span>
            ) : allSettlement.isError ? (
              <span>全量待结算读取失败，请刷新后重试。</span>
            ) : allSettlementGroups.length > 0 ? (
              allSettlementGroups.slice(0, 8).map((group) => (
                <div className="settlement-row" key={group.day.toString()}>
                  <span>周期 {group.day.toString()}</span>
                  <span>{group.addresses.length} 用户 / 有效 {group.validCount}</span>
                  <span>{token(group.totalVolume)} U</span>
                </div>
              ))
            ) : (
              <span>暂无未结算动态奖励。</span>
            )}
            {allSettlementGroups.length > 8 && <span>还有 {allSettlementGroups.length - 8} 个周期未显示。</span>}
          </div>
        </div>
        <div className="form-grid">
          <label>
            用户地址
            <input value={dynamicUser} onChange={(event) => setDynamicUser(event.target.value)} placeholder="0x..." />
          </label>
          <label>
            结算周期开始时间
            <input
              type="datetime-local"
              value={dynamicPeriodStart}
              onChange={(event) => setDynamicPeriodStart(event.target.value)}
              onBlur={() => {
                if (settlementDay > 0n) {
                  setDynamicPeriodStart(localPeriodInputValue(settlementDay, settlementCycle));
                }
              }}
            />
            <small>所选周期：{selectedPeriodLabel}</small>
          </label>
        </div>
        <button
          className="primary-button compact"
          disabled={!canWrite || settlementDay <= 0n || !isAddress(dynamicUser)}
          onClick={() =>
            runner.runTx('结算动态奖励', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'settleDynamicRewardForUser',
                args: [safeAddress(dynamicUser), settlementDay],
              }),
            )
          }
        >
          结算该用户动态奖励
        </button>
        <div className="settlement-box">
          <div className="section-title">
            <div>
              <p className="eyebrow">Cycle batch</p>
              <h2>周期一键动态结算</h2>
            </div>
            <span className="status-chip">{oneClickAddresses.length} 待结算</span>
          </div>
          <div className="settlement-stats">
            <InfoLine label="当前周期" value={currentPeriodLabel} />
            <InfoLine label="结算周期" value={selectedPeriodLabel} />
            <InfoLine label="有流水用户" value={`${settlement.rows.length} 人`} />
            <InfoLine label="有效流水用户" value={`${validPendingCount} 人`} />
          </div>
          <button
            className="primary-button"
            disabled={!canWrite || !dayClosed || oneClickAddresses.length === 0}
            onClick={() =>
              runner.runTx('一键动态结算', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleDynamicRewardForUsers',
                  args: [oneClickAddresses, settlementDay],
                }),
              )
            }
          >
            一键结算所选周期
          </button>
          <p className="helper-line">
            {dayClosed
              ? '将结算所选周期内已产生流水且尚未结算的用户。'
              : '只能结算已经结束的周期，通常选择当前周期的上一期。'}
          </p>
          <div className="settlement-preview">
            {settlement.isLoading ? (
              <span>正在读取候选用户...</span>
            ) : settlement.pendingRows.length > 0 ? (
              settlement.pendingRows.slice(0, 8).map((row) => (
                <div className="settlement-row" key={row.address}>
                  <span>{shortAddress(row.address)}</span>
                  <span>{token(row.dailyStakeVolume)} U</span>
                  <span>{row.isValidOnDay ? '有效直推' : '普通流水'}</span>
                </div>
              ))
            ) : (
              <span>暂无待结算用户。</span>
            )}
            {settlement.pendingRows.length > 8 && <span>还有 {settlement.pendingRows.length - 8} 个用户未显示。</span>}
          </div>
        </div>
        <div className="form-grid spaced">
          <label>
            批量用户地址
            <input value={batchUsers} onChange={(event) => setBatchUsers(event.target.value)} placeholder="多个地址用逗号或空格分隔" />
          </label>
          <label>
            批量带单 ID
            <input value={stakeIds} onChange={(event) => setStakeIds(event.target.value)} placeholder="多个 ID 用逗号或空格分隔" />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canWrite || parseAddressList(batchUsers).length === 0 || settlementDay <= 0n}
            onClick={() =>
              runner.runTx('批量结算动态奖励', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleDynamicRewardForUsers',
                  args: [parseAddressList(batchUsers), settlementDay],
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
              runner.runTx('批量结算带单', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleStakes',
                  args: [parseIdList(stakeIds)],
                }),
              )
            }
          >
            批量带单结算
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Stake Flow</p>
            <h2>带单流水回显</h2>
          </div>
          <span className="status-chip">{orderBook.stakeOrders.length} 笔</span>
        </div>
        <div className="settlement-stats">
          <InfoLine label="当前周期" value={currentPeriodLabel} />
          <InfoLine label="本周期带单笔数" value={`${currentDayStakeOrders.length} 笔`} />
          <InfoLine label="本周期带单流水" value={`${token(currentDayStakeVolume)} U`} />
          <InfoLine label="未结算带单" value={`${unsettledStakeOrders.length} 笔`} />
          <InfoLine label="最近带单流水" value={`${token(recentStakeVolume)} U`} />
        </div>
        <div className="list-stack">
          {orderBook.stakeOrders.length > 0 ? (
            orderBook.stakeOrders.slice(0, 8).map((order) => <AdminStakeOrderRow key={order.id.toString()} order={order} settlementCycle={settlementCycle} />)
          ) : (
            <EmptyState title="暂无带单流水" detail="这里直接读取 stakeOrders(id)，用户完成带单后即使未结算也会显示。" />
          )}
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

function AdminWithdrawalsPage({
  canWrite,
  canApprove,
  runner,
}: {
  canWrite: boolean;
  canApprove: boolean;
  runner: ReturnType<typeof useTxRunner>;
}) {
  const { address } = useAccount();
  const [fundAmount, setFundAmount] = useState('1000');
  const [contractWithdrawReceiver, setContractWithdrawReceiver] = useState('');
  const [contractWithdrawAmount, setContractWithdrawAmount] = useState('');
  const withdrawals = useAdminWithdrawalRequests();
  const config = useContractConfig();
  const pendingWithdrawalAmount = withdrawals.pendingRequests.reduce((sum, request) => sum + request.amount, 0n);
  const sortedRequests = useMemo(
    () => [...withdrawals.requests].sort(compareWithdrawalRequestLatest),
    [withdrawals.requests],
  );
  const pagination = usePaginatedItems(
    sortedRequests,
    ADMIN_ORDER_PAGE_SIZE,
    sortedRequests[0]?.id.toString() ?? 'empty',
  );
  const rewardPoolQuery = useReadContract({
    address: BSC_USDT_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [CONTRACT_ADDRESS],
    query: { enabled: isContractConfigured },
  });
  const rewardPoolBalance = (rewardPoolQuery.data as bigint | undefined) ?? 0n;
  const fundParsed = useMemo(() => {
    try {
      return parseTokenInput(fundAmount);
    } catch {
      return 0n;
    }
  }, [fundAmount]);
  const contractWithdrawParsed = useMemo(() => {
    try {
      return parseTokenInput(contractWithdrawAmount);
    } catch {
      return 0n;
    }
  }, [contractWithdrawAmount]);
  const resolvedContractWithdrawReceiver = contractWithdrawReceiver.trim() || address || '';
  const canWithdrawContractFunds =
    canApprove &&
    contractWithdrawParsed > 0n &&
    contractWithdrawParsed <= rewardPoolBalance &&
    isAddress(resolvedContractWithdrawReceiver);

  return (
    <section className="screen-stack">
      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Withdrawals</p>
            <h2>提现申请处理</h2>
          </div>
          <span className="status-chip">
            {config.withdrawalApprovalRequired ? `${withdrawals.pendingRequests.length} 待审 / ${token(pendingWithdrawalAmount)} U` : `免审批 / ${withdrawals.pendingRequests.length} 历史待审`}
          </span>
        </div>
        <p className="helper-line">
          {config.withdrawalApprovalRequired
            ? '审批会从当前 Admin 钱包扣除申请金额，并向用户钱包打款；请先确认当前钱包有足够 USDT。'
            : '当前已关闭提现审批，新提现会从合约奖励池自动打款；这里仅处理关闭前留下的待审申请。'}
        </p>
        <div className="settlement-stats">
          <InfoLine label="提现申请" value={`${withdrawals.requests.length} 笔`} />
          <InfoLine label="待审申请" value={`${withdrawals.pendingRequests.length} 笔`} />
          <InfoLine label="待审金额" value={`${token(pendingWithdrawalAmount)} U`} />
          <InfoLine label="奖励池余额" value={`${token(rewardPoolBalance)} U`} />
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Payout Pool</p>
            <h2>奖励池与合约出金</h2>
          </div>
          <Wallet size={20} />
        </div>
        <div className="form-grid">
          <label>
            奖励池充值 U
            <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" />
          </label>
          <div className="inline-info-box">
            <span>合约奖励池余额</span>
            <strong>{token(rewardPoolBalance)} U</strong>
          </div>
        </div>
        <button
          className="secondary-button full-button"
          disabled={!canWrite || fundParsed <= 0n}
          onClick={() =>
            runner.runTxFlow('充值奖励池', [
              {
                label: '授权 USDT',
                request: () =>
                  runner.writeContractAsync({
                    address: BSC_USDT_ADDRESS,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [CONTRACT_ADDRESS, fundParsed],
                  }),
              },
              {
                label: '充值奖励池',
                request: () =>
                  runner.writeContractAsync({
                    address: CONTRACT_ADDRESS,
                    abi: ironBrotherAbi,
                    functionName: 'fundRewards',
                    args: [fundParsed],
                  }),
              },
            ])
          }
        >
          充值奖励池
        </button>
        <div className="form-grid spaced">
          <label>
            合约出金接收地址
            <input
              value={contractWithdrawReceiver}
              onChange={(event) => setContractWithdrawReceiver(event.target.value)}
              placeholder={address ?? '0x...'}
            />
          </label>
          <label>
            合约出金金额 U
            <input value={contractWithdrawAmount} onChange={(event) => setContractWithdrawAmount(event.target.value)} inputMode="decimal" />
          </label>
        </div>
        <button
          className="secondary-button full-button"
          disabled={!canWithdrawContractFunds}
          onClick={() =>
            runner.runTx('提走合约 USDT', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'withdrawContractFunds',
                args: [safeAddress(resolvedContractWithdrawReceiver), contractWithdrawParsed],
              }),
            )
          }
        >
          提走合约 USDT
        </button>
        <p className="helper-line">仅 Super Admin 可提走合约奖励池当前持有的 USDT。</p>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Requests</p>
            <h2>提现申请列表</h2>
          </div>
          <span className="status-chip">{withdrawals.isLoading ? '读取中' : `${sortedRequests.length} 笔`}</span>
        </div>
        <div className="list-stack">
          {sortedRequests.length > 0 ? (
            pagination.items.map((request) => (
              <AdminWithdrawalRequestRow key={request.id.toString()} request={request} canWrite={canApprove} runner={runner} />
            ))
          ) : (
            <EmptyState title="暂无提现申请" detail={config.withdrawalApprovalRequired ? '用户提交提现后，会在这里等待 Admin 审批。' : '免审批提现会自动打款并直接显示为已打款记录。'} />
          )}
        </div>
        <PaginationControls {...pagination} onPageChange={pagination.setPage} />
      </section>
    </section>
  );
}

function AdminTeamPage({ defaultAddress }: { defaultAddress?: Address }) {
  const [rootInput, setRootInput] = useState('');
  const root = isAddress(rootInput.trim()) ? (rootInput.trim() as Address) : defaultAddress ?? zeroAddress;
  const referrals = useDirectReferralRows(root, root !== zeroAddress);

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
  const [minAmount, setMinAmount] = useState('0.1');
  const [maxAmount, setMaxAmount] = useState('1000');
  const [maxPrincipal, setMaxPrincipal] = useState('1000');
  const [lockDays, setLockDays] = useState('30');
  const [threshold, setThreshold] = useState('1000');
  const [settlementCycleMinutes, setSettlementCycleMinutes] = useState('1440');
  const [feeReceiver, setFeeReceiver] = useState('');
  const [defaultReferrer, setDefaultReferrer] = useState('');
  const [depositReceivers, setDepositReceivers] = useState<string[]>(['', '', '', '', '']);
  const [morningStart, setMorningStart] = useState('09:00');
  const [morningEnd, setMorningEnd] = useState('12:00');
  const [afternoonStart, setAfternoonStart] = useState('14:00');
  const [afternoonEnd, setAfternoonEnd] = useState('17:00');
  const [generation, setGeneration] = useState('1');
  const [generationRate, setGenerationRate] = useState('0.2');
  const defaultReferrerInput = defaultReferrer.trim();
  const canSaveDefaultReferrer = canEdit && (defaultReferrerInput === '' || isAddress(defaultReferrerInput));
  const depositReceiverInputs = depositReceivers.map((receiver) => receiver.trim());
  const canSaveDepositReceivers = canEdit && depositReceiverInputs.length === 5 && depositReceiverInputs.every((receiver) => isAddress(receiver));
  const settlementCycleSeconds = settlementCycleMinutesToSeconds(settlementCycleMinutes);
  const canSaveSettlementCycle =
    canEdit && settlementCycleSeconds >= 60n && settlementCycleSeconds <= BigInt(SECONDS_PER_DAY);

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
    setSettlementCycleMinutes(secondsToSettlementCycleMinutes(config.settlementCycle));
    setFeeReceiver(config.feeReceiver === zeroAddress ? '' : config.feeReceiver);
    setDefaultReferrer(config.defaultReferrer === zeroAddress ? '' : config.defaultReferrer);
    setDepositReceivers([0, 1, 2, 3, 4].map((index) => config.depositReceivers[index] ?? ''));
    setMorningStart(secondsToClock(config.morningStart));
    setMorningEnd(secondsToClock(config.morningEnd));
    setAfternoonStart(secondsToClock(config.afternoonStart));
    setAfternoonEnd(secondsToClock(config.afternoonEnd));
  }, [config.loadedKey]);

  return (
    <section className="screen-stack">
      <section className="admin-grid">
        <AdminCard icon={<Settings />} label="当前收益率" value={bpsToPercent(config.yieldBps)} />
        <AdminCard icon={<ArrowDownToLine />} label="最低入金" value={`${token(config.minAmount)} U`} />
        <AdminCard icon={<Send />} label="提现手续费" value={`${token(config.withdrawFee)} U`} />
        <AdminCard icon={<LockKeyhole />} label="锁仓周期" value={`${secondsToDays(config.lockPeriod)} 天`} />
        <AdminCard icon={<Repeat2 />} label="动态结算周期" value={settlementCycleLabel(config.settlementCycle)} />
        <AdminCard icon={<PauseCircle />} label="合约状态" value={config.paused ? '已暂停' : '运行中'} />
        <AdminCard icon={<Users />} label="默认推荐人" value={config.defaultReferrer === zeroAddress ? '未设置' : shortAddress(config.defaultReferrer)} />
        <AdminCard icon={<Shield />} label="提现审批" value={config.withdrawalApprovalRequired ? '开启' : '关闭'} />
        <AdminCard icon={<Wallet />} label="下个入金钱包" value={`#${Number(config.nextDepositReceiverIndex) + 1}`} />
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
        <div className="setting-toggle-row">
          <div>
            <strong>提现需要 Admin 审批</strong>
            <small>{config.withdrawalApprovalRequired ? '用户提现会进入待审列表，由 Admin 审批打款。' : '用户提现会从合约奖励池自动打款，请确保奖励池余额充足。'}</small>
          </div>
          <button
            className={config.withdrawalApprovalRequired ? 'toggle-button on' : 'toggle-button'}
            type="button"
            aria-pressed={config.withdrawalApprovalRequired}
            disabled={!canEdit}
            onClick={() =>
              runner.runTx(config.withdrawalApprovalRequired ? '关闭提现审批' : '开启提现审批', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setWithdrawalApprovalRequired',
                  args: [!config.withdrawalApprovalRequired],
                }),
              )
            }
          >
            <span />
          </button>
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
          <label>
            默认推荐人地址
            <input value={defaultReferrer} onChange={(event) => setDefaultReferrer(event.target.value)} placeholder="留空则关闭默认推荐人" />
          </label>
          {depositReceivers.map((receiver, index) => (
            <label key={`deposit-receiver-${index}`}>
              入金收款钱包 {index + 1}
              <input
                value={receiver}
                onChange={(event) =>
                  setDepositReceivers((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                }
                placeholder="0x..."
              />
            </label>
          ))}
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
          <button
            className="secondary-button"
            disabled={!canSaveDefaultReferrer}
            onClick={() =>
              runner.runTx('设置默认推荐人', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setDefaultReferrer',
                  args: [defaultReferrerInput === '' ? zeroAddress : safeAddress(defaultReferrerInput)],
                }),
              )
            }
          >
            保存默认推荐人
          </button>
          <button
            className="secondary-button"
            disabled={!canSaveDepositReceivers}
            onClick={() =>
              runner.runTx('设置入金收款钱包', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setDepositReceivers',
                  args: [depositReceiverInputs.map((receiver) => safeAddress(receiver)) as [Address, Address, Address, Address, Address]],
                }),
              )
            }
          >
            保存5个收款钱包
          </button>
        </div>
      </section>

      <section className="admin-panel schedule-config-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>动态结算与上下场次</h2>
          </div>
          <Clock3 size={20} />
        </div>
        <p className="helper-line">测试环境可把结算周期调短，并把上午场、下午场压缩到同一个周期内。</p>
        <div className="form-grid schedule-config-grid">
          <label>
            动态奖励结算周期（分钟）
            <input
              type="number"
              value={settlementCycleMinutes}
              onChange={(event) => setSettlementCycleMinutes(event.target.value)}
              inputMode="decimal"
              min="1"
              max="1440"
              placeholder="1-1440"
            />
            <small>当前：{settlementCycleLabel(config.settlementCycle)}；范围 1-1440 分钟</small>
          </label>
          <label>
            场次时区
            <input value="UTC+8（东八区，链上自动识别）" readOnly />
          </label>
          <label>
            上午场开始
            <input value={morningStart} onChange={(event) => setMorningStart(event.target.value)} placeholder="09:00" inputMode="numeric" />
          </label>
          <label>
            上午场结束
            <input value={morningEnd} onChange={(event) => setMorningEnd(event.target.value)} placeholder="12:00" inputMode="numeric" />
          </label>
          <label>
            下午场开始
            <input value={afternoonStart} onChange={(event) => setAfternoonStart(event.target.value)} placeholder="14:00" inputMode="numeric" />
          </label>
          <label>
            下午场结束
            <input value={afternoonEnd} onChange={(event) => setAfternoonEnd(event.target.value)} placeholder="17:00" inputMode="numeric" />
          </label>
        </div>
        <div className="split-buttons">
          <button
            className="secondary-button"
            disabled={!canSaveSettlementCycle}
            onClick={() =>
              runner.runTx('设置动态奖励结算周期', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setSettlementCycle',
                  args: [settlementCycleSeconds],
                }),
              )
            }
          >
            保存动态结算周期
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit}
            onClick={() =>
              runner.runTx('设置带单场次', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setSessionTimes',
                  args: [
                    sessionTimeToSeconds(morningStart),
                    sessionTimeToSeconds(morningEnd),
                    sessionTimeToSeconds(afternoonStart),
                    sessionTimeToSeconds(afternoonEnd),
                  ],
                }),
              )
            }
          >
            保存上下午时间范围
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <h2>代数与合约状态</h2>
          <Users size={20} />
        </div>
        <div className="form-grid">
          <label>
            代数
            <input value={generation} onChange={(event) => setGeneration(event.target.value)} />
          </label>
          <label>
            代数奖励 %
            <input value={generationRate} onChange={(event) => setGenerationRate(event.target.value)} />
          </label>
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
  const { address } = useAccount();
  const [targetAddress, setTargetAddress] = useState('');
  const [ownerTransferTarget, setOwnerTransferTarget] = useState<Address>();
  const target = isAddress(targetAddress.trim()) ? (targetAddress.trim() as Address) : undefined;
  const role = useAdminRole(target);
  const transactionBusy = runner.tx.status === 'wallet' || runner.tx.status === 'pending';
  const userQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'users',
    args: [target ?? zeroAddress],
    query: { enabled: Boolean(isContractConfigured && target) },
  });
  const account = userFromTuple(userQuery.data);

  return (
    <>
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
          <AdminCard icon={<Shield />} label="Admin 权限" value={role.isSuperAdmin ? '是' : '否'} />
          <AdminCard icon={<Settings />} label="Manager 权限" value={role.isManager ? '是' : '否'} />
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
              runner.runTx('授予 Manager 权限', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setManager',
                  args: [target ?? zeroAddress, true],
                }),
              )
            }
          >
            授予 Manager 权限
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit || !target}
            onClick={() =>
              runner.runTx('撤销 Manager 权限', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setManager',
                  args: [target ?? zeroAddress, false],
                }),
              )
            }
          >
            撤销 Manager 权限
          </button>
          <button
            className="secondary-button"
            disabled={!canEdit || !target}
            onClick={() =>
              runner.runTx('授予 Admin 权限', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setAdmin',
                  args: [target ?? zeroAddress, true],
                }),
              )
            }
          >
            授予 Admin 权限
          </button>
          <button
            className="secondary-button danger-button"
            disabled={!canEdit || !target}
            onClick={() =>
              runner.runTx('撤销 Admin 权限', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'setAdmin',
                  args: [target ?? zeroAddress, false],
                }),
              )
            }
          >
            撤销 Admin 权限
          </button>
          <button
            className="secondary-button danger-button"
            disabled={!canEdit || !target}
            onClick={() => {
              if (target) setOwnerTransferTarget(target);
            }}
          >
            <Shield size={17} />
            转移 Owner 权限
          </button>
          <p className="helper-line">转移后，新地址获得 Admin/Manager 权限；当前钱包会失去这些权限。默认推荐人如果仍是当前钱包，会同步到新 Owner。</p>
        </div>
      </section>
      {ownerTransferTarget && (
        <OwnerTransferConfirmModal
          currentOwner={address}
          newOwner={ownerTransferTarget}
          busy={transactionBusy}
          onCancel={() => setOwnerTransferTarget(undefined)}
          onConfirm={() => {
            runner.runTx('转移 Owner 权限', () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'transferOwner',
                args: [ownerTransferTarget],
              }),
            );
            setOwnerTransferTarget(undefined);
          }}
        />
      )}
    </>
  );
}

function OwnerTransferConfirmModal({
  currentOwner,
  newOwner,
  busy,
  onCancel,
  onConfirm,
}: {
  currentOwner?: Address;
  newOwner: Address;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="referrer-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="owner-transfer-title">
        <div className="section-title">
          <div>
            <p className="eyebrow">Owner Transfer</p>
            <h2 id="owner-transfer-title">转移 Owner 权限</h2>
          </div>
          <Shield size={18} />
        </div>
        <p className="modal-helper">
          这是一项高风险操作。确认后，新地址将获得 Admin/Manager 权限，当前钱包会失去管理权限。
        </p>
        <div className="confirm-summary">
          <InfoLine label="当前钱包" value={shortAddress(currentOwner)} />
          <InfoLine label="新 Owner" value={shortAddress(newOwner)} />
          <InfoLine label="默认推荐人" value="如仍指向当前钱包，将同步到新 Owner" />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button className="primary-button danger-primary-button" type="button" disabled={busy} onClick={onConfirm}>
            确认转移
          </button>
        </div>
      </section>
    </div>
  );
}

function useAdminDashboard(enabled = true) {
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
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalPendingWithdrawalAmount' },
    ],
    query: { enabled: isContractConfigured && enabled },
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
    totalPendingWithdrawalAmount: pick(8, emptyDashboard.totalPendingWithdrawalAmount),
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
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'settlementCycle' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'feeReceiver' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'defaultReferrer' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'getDepositReceivers' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'nextDepositReceiverIndex' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'timezoneOffset' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'paused' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'withdrawalApprovalRequired' },
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
    settlementCycle: pick(9, BigInt(SECONDS_PER_DAY)),
    feeReceiver: pick(10, zeroAddress),
    defaultReferrer: pick(11, zeroAddress),
    depositReceivers: pick(12, [] as readonly Address[]),
    nextDepositReceiverIndex: pick(13, 0),
    timezoneOffset: pick(14, BigInt(EAST8_TIMEZONE_SECONDS)),
    morningStart: pick(15, 0),
    morningEnd: pick(16, 0),
    afternoonStart: pick(17, 0),
    afternoonEnd: pick(18, 0),
    paused: pick(19, false),
    withdrawalApprovalRequired: pick(20, true),
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
      config.settlementCycle,
      config.feeReceiver,
      config.defaultReferrer,
      config.depositReceivers.join(','),
      config.nextDepositReceiverIndex,
      config.timezoneOffset,
      config.morningStart,
      config.morningEnd,
      config.afternoonStart,
      config.afternoonEnd,
      config.paused,
      config.withdrawalApprovalRequired,
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
      .filter((order): order is PrincipalOrderData => Boolean(order))
      .sort(comparePrincipalOrderLatest),
    stakeOrders: (stakeOrdersQuery.data ?? [])
      .map((result) => stakeOrderFromTuple(readResult(result, undefined)))
      .filter((order): order is StakeOrderData => Boolean(order))
      .sort(compareStakeOrderLatest),
  };
}

function useAdminWithdrawalRequests() {
  const nextIdQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'nextWithdrawalRequestId',
    query: { enabled: isContractConfigured },
  });

  const requestIds = useMemo(() => recentIds(nextIdQuery.data as bigint | undefined, 80), [nextIdQuery.data]);
  const requestContracts = useMemo(
    () =>
      requestIds.map((id) => ({
        address: CONTRACT_ADDRESS,
        abi: ironBrotherAbi,
        functionName: 'withdrawalRequests',
        args: [id],
      })),
    [requestIds],
  );

  const requestsQuery = useReadContracts({
    contracts: requestContracts as never,
    query: { enabled: requestContracts.length > 0 },
  });

  const requests = useMemo(
    () =>
      (requestsQuery.data ?? [])
        .map((result) => withdrawalRequestFromTuple(readResult(result, undefined)))
        .filter((request): request is WithdrawalRequestData => Boolean(request))
        .sort(compareWithdrawalRequestLatest),
    [requestsQuery.data],
  );

  return {
    requests,
    pendingRequests: requests.filter((request) => request.status === 0),
    isLoading: nextIdQuery.isLoading || requestsQuery.isLoading,
  };
}

type ChainEventClient = {
  getBlockNumber: () => Promise<bigint>;
  getContractEvents: (args: Record<string, unknown>) => Promise<ChainEventRecord[]>;
};

async function getContractEventsOnceOrChunked(
  client: ChainEventClient,
  args: Record<string, unknown>,
  fromBlock: bigint,
  latest: bigint,
) {
  try {
    return await client.getContractEvents({
      ...args,
      fromBlock,
      toBlock: latest,
    });
  } catch {
    const logs: ChainEventRecord[] = [];
    for (let start = fromBlock; start <= latest; start += EVENT_CHUNK_BLOCKS + 1n) {
      const end = start + EVENT_CHUNK_BLOCKS > latest ? latest : start + EVENT_CHUNK_BLOCKS;
      const chunk = await client.getContractEvents({
        ...args,
        fromBlock: start,
        toBlock: end,
      });
      logs.push(...chunk);
    }
    return logs;
  }
}

function useChainEvents(eventNames: readonly string[], enabled = true) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['ironBrotherEvents', CONTRACT_ADDRESS, eventNames.join('|')],
    enabled: Boolean(enabled && isContractConfigured && publicClient),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient) return [] as ChainEventRecord[];

      const client = publicClient as unknown as ChainEventClient;
      const latest = await client.getBlockNumber();
      const configuredFromBlock = parseBlockEnv(import.meta.env.VITE_IRONBROTHER_EVENT_FROM_BLOCK);
      const fromBlock = configuredFromBlock ?? (latest > EVENT_LOOKBACK_BLOCKS ? latest - EVENT_LOOKBACK_BLOCKS : 0n);
      const logs: ChainEventRecord[] = [];

      for (const eventName of eventNames) {
        logs.push(
          ...(await getContractEventsOnceOrChunked(
            client,
            {
              address: CONTRACT_ADDRESS,
              abi: ironBrotherAbi,
              eventName,
            },
            fromBlock,
            latest,
          )),
        );
      }

      return logs.sort((a, b) => {
        const blockDiff = Number(b.blockNumber - a.blockNumber);
        return blockDiff === 0 ? Number(b.logIndex - a.logIndex) : blockDiff;
      });
    },
  });
}

function useDynamicRewardDetails(upline?: Address) {
  const publicClient = usePublicClient();
  const historyQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getDynamicRewardHistory',
    args: upline ? [upline] : undefined,
    query: {
      enabled: Boolean(isContractConfigured && upline),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  });
  const eventQuery = useQuery({
    queryKey: ['dynamicRewardEvents', CONTRACT_ADDRESS, upline],
    enabled: Boolean(isContractConfigured && upline && publicClient),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!publicClient || !upline) return [] as ChainEventRecord[];

      const client = publicClient as unknown as ChainEventClient;
      const latest = await client.getBlockNumber();
      const configuredFromBlock = parseBlockEnv(import.meta.env.VITE_IRONBROTHER_EVENT_FROM_BLOCK);
      const fromBlock = configuredFromBlock ?? (latest > EVENT_LOOKBACK_BLOCKS ? latest - EVENT_LOOKBACK_BLOCKS : 0n);
      const logs = await getContractEventsOnceOrChunked(
        client,
        {
          address: CONTRACT_ADDRESS,
          abi: ironBrotherAbi,
          eventName: 'DynamicRewardSettled',
          args: { upline },
        },
        fromBlock,
        latest,
      );

      return logs.sort((a, b) => {
        const blockDiff = Number(b.blockNumber - a.blockNumber);
        return blockDiff === 0 ? Number(b.logIndex - a.logIndex) : blockDiff;
      });
    },
  });

  const historyRows = useMemo(
    () =>
      ((historyQuery.data as readonly unknown[] | undefined) ?? [])
        .map((row, index) => (upline ? dynamicRewardDetailFromHistory(row, upline, index) : undefined))
        .filter((row): row is DynamicRewardDetail => Boolean(row))
        .sort((left, right) => {
          const dayDiff = Number(right.day - left.day);
          return dayDiff === 0 ? right.historyIndex - left.historyIndex : dayDiff;
        }),
    [historyQuery.data, upline],
  );
  const eventRows = useMemo(
    () =>
      ((eventQuery.data as ChainEventRecord[] | undefined) ?? [])
        .map((event, index) => (upline ? dynamicRewardDetailFromEvent(event, upline, index) : undefined))
        .filter((row): row is DynamicRewardDetail => Boolean(row))
        .sort((left, right) => {
          const dayDiff = Number(right.day - left.day);
          return dayDiff === 0 ? right.historyIndex - left.historyIndex : dayDiff;
        }),
    [eventQuery.data, upline],
  );
  const rows = historyRows.length > 0 ? historyRows : eventRows;
  const isLoading =
    rows.length === 0 &&
    ((historyQuery.isLoading && !historyQuery.isError) ||
      (eventQuery.isLoading && !eventQuery.isError));

  return {
    rows,
    isLoading,
    isError: rows.length === 0 && historyQuery.isError && eventQuery.isError,
  };
}

function usePendingDynamicRewards(upline: Address | undefined, currentLocalDay: bigint) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['pendingDynamicRewards', CONTRACT_ADDRESS, upline, currentLocalDay.toString()],
    enabled: Boolean(isContractConfigured && publicClient && upline && currentLocalDay > 0n),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PendingDynamicRewardQueryData> => {
      if (!publicClient || !upline) {
        return { rows: [], total: 0n, scannedDays: [], sourceCount: 0, isSourceLimitReached: false };
      }

      const recentDays = recentClosedDynamicDays(currentLocalDay);
      const sourceResult = await collectDynamicRewardSources(publicClient, upline, TEAM_SUMMARY_MAX_DEPTH);
      if (sourceResult.nodes.length === 0) {
        return { rows: [], total: 0n, scannedDays: recentDays, sourceCount: 0, isSourceLimitReached: false };
      }

      const recentSourceDays = sourceResult.nodes.flatMap((node) => recentDays.map((day) => ({ ...node, day })));
      const stakeOrderSourceDays = await collectStakeOrderSourceDays(publicClient, sourceResult.nodes);
      const allSourceDays = uniqueDynamicSourceDays(
        [...recentSourceDays, ...stakeOrderSourceDays].filter((row) => row.day > 0n && row.day < currentLocalDay),
      );
      const scannedDays = uniqueDynamicDays(allSourceDays);
      const scannedDaySet = new Set(scannedDays.map((day) => day.toString()));
      const sourceDays = allSourceDays.filter((row) => scannedDaySet.has(row.day.toString()));

      if (sourceDays.length === 0 || scannedDays.length === 0) {
        return {
          rows: [],
          total: 0n,
          scannedDays,
          sourceCount: sourceResult.nodes.length,
          isSourceLimitReached: sourceResult.isSourceLimitReached,
        };
      }

      const eligibility = await Promise.all(
        scannedDays.map(async (day): Promise<PendingDynamicRewardEligibility> => ({
          day,
          eligibleGeneration: historyNumber(
            await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: ironBrotherAbi,
              functionName: 'eligibleGeneration',
              args: [upline, day],
            }),
          ),
        })),
      );

      const maxSourceGeneration = Math.max(0, ...sourceDays.map((row) => row.generation));
      const maxEligibleGeneration = Math.max(0, ...eligibility.map((row) => row.eligibleGeneration));
      const maxGeneration = Math.min(maxSourceGeneration, maxEligibleGeneration);
      if (maxGeneration <= 0) {
        return {
          rows: [],
          total: 0n,
          scannedDays,
          sourceCount: sourceResult.nodes.length,
          isSourceLimitReached: sourceResult.isSourceLimitReached,
        };
      }

      const rates = await Promise.all(
        Array.from({ length: maxGeneration }, async (_, index): Promise<PendingDynamicRewardRate> => {
          const generation = index + 1;
          return {
            generation,
            rateBps: historyBigInt(
              await publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'generationRateBps',
                args: [generation],
              }),
            ),
          };
        }),
      );

      const candidates = (
        await Promise.all(
          sourceDays.map(async (sourceDay): Promise<PendingDynamicRewardSource | undefined> => {
            const eligibleOnDay = eligibility.find((row) => row.day === sourceDay.day)?.eligibleGeneration ?? 0;
            if (eligibleOnDay < sourceDay.generation) return undefined;

            const [volumeValue, settledValue] = await Promise.all([
              publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'dailyStakeVolume',
                args: [sourceDay.address, sourceDay.day],
              }),
              publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'dynamicRewardSettled',
                args: [sourceDay.address, sourceDay.day],
              }),
            ]);

            return {
              source: sourceDay.address,
              day: sourceDay.day,
              generation: sourceDay.generation,
              volume: historyBigInt(volumeValue),
              settled: Boolean(settledValue),
            };
          }),
        )
      ).filter((row): row is PendingDynamicRewardSource => Boolean(row));

      const rows = calculatePendingDynamicRewardRows(
        candidates,
        rates,
        eligibility,
      ).sort(comparePendingDynamicRewardRows);

      return {
        rows,
        total: sumPendingDynamicRewards(rows),
        scannedDays,
        sourceCount: sourceResult.nodes.length,
        isSourceLimitReached: sourceResult.isSourceLimitReached,
      };
    },
  });
}

function useAdminUsers(extraAddress?: Address | readonly Address[]) {
  const indexedUsersQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'getAllUsers',
    query: { enabled: isContractConfigured },
  });
  const indexedAddresses = (indexedUsersQuery.data as readonly Address[] | undefined) ?? [];
  const shouldReadUserEvents = !indexedUsersQuery.isLoading && indexedAddresses.length === 0;
  const events = useChainEvents(['UserRegistered'], shouldReadUserEvents);
  const extraAddresses = useMemo(() => (Array.isArray(extraAddress) ? extraAddress : extraAddress ? [extraAddress] : []), [extraAddress]);
  const addresses = useMemo(() => {
    const eventAddresses = shouldReadUserEvents ? (events.data ?? []).map((event) => event.args.user as Address | undefined) : [];
    return uniqueAddresses([...extraAddresses, ...indexedAddresses, ...eventAddresses]);
  }, [events.data, extraAddresses, indexedAddresses, shouldReadUserEvents]);
  const userOrderMeta = useMemo(() => {
    const meta = new Map<string, Pick<AdminUserRow, 'blockNumber' | 'logIndex' | 'registeredIndex'>>();

    indexedAddresses.forEach((address, index) => {
      meta.set(address.toLowerCase(), { registeredIndex: index });
    });

    if (shouldReadUserEvents) {
      (events.data ?? []).forEach((event, index) => {
        const user = event.args.user as Address | undefined;
        if (user && isAddress(user)) {
          meta.set(user.toLowerCase(), {
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            registeredIndex: Number.MAX_SAFE_INTEGER - index,
          });
        }
      });
    }

    extraAddresses.forEach((address) => {
      if (isAddress(address) && !meta.has(address.toLowerCase())) {
        meta.set(address.toLowerCase(), { registeredIndex: -1 });
      }
    });

    return meta;
  }, [events.data, extraAddresses, indexedAddresses, shouldReadUserEvents]);

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
      addresses.map((address, index) => {
        const meta = userOrderMeta.get(address.toLowerCase());
        return {
          address,
          account: userFromTuple(readResult(usersQuery.data?.[index], undefined)),
          blockNumber: meta?.blockNumber,
          logIndex: meta?.logIndex,
          registeredIndex: meta?.registeredIndex,
        };
      }),
    [addresses, userOrderMeta, usersQuery.data],
  );

  return {
    rows,
    indexedCount: indexedAddresses.length,
    eventCount: shouldReadUserEvents ? events.data?.length ?? 0 : 0,
    eventError: shouldReadUserEvents && events.isError,
    isLoading: indexedUsersQuery.isLoading || (shouldReadUserEvents && events.isLoading) || usersQuery.isLoading,
  };
}

function useDynamicSettlementRows(rows: AdminUserRow[], day: bigint, enabled = true) {
  const registeredRows = useMemo(() => rows.filter((row) => row.account.registered), [rows]);
  const detailContracts = useMemo(
    () =>
      registeredRows.flatMap((row) => [
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'dailyStakeVolume', args: [row.address, day] },
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'isValidOnDay', args: [row.address, day] },
        { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'dynamicRewardSettled', args: [row.address, day] },
      ]),
    [day, registeredRows],
  );

  const detailQuery = useReadContracts({
    contracts: detailContracts as never,
    query: { enabled: Boolean(isContractConfigured && enabled && day > 0n && registeredRows.length > 0) },
  });

  const settlementRows = useMemo(
    () =>
      registeredRows
        .map((row, index): DynamicSettlementRow => {
          const base = index * 3;
          return {
            ...row,
            dailyStakeVolume: readResult(detailQuery.data?.[base], 0n),
            isValidOnDay: readResult(detailQuery.data?.[base + 1], false),
            settled: readResult(detailQuery.data?.[base + 2], false),
          };
        })
        .filter((row) => row.dailyStakeVolume > 0n)
        .sort(compareAdminUserLatest),
    [detailQuery.data, registeredRows],
  );

  return {
    rows: settlementRows,
    pendingRows: settlementRows.filter((row) => !row.settled),
    isLoading: detailQuery.isLoading,
  };
}

function useAllDynamicSettlementRows(rows: AdminUserRow[], currentLocalDay: bigint) {
  const publicClient = usePublicClient();
  const registeredRows = useMemo(() => rows.filter((row) => row.account.registered), [rows]);
  const registeredAddressKey = useMemo(
    () => registeredRows.map((row) => row.address.toLowerCase()).join('|'),
    [registeredRows],
  );

  return useQuery({
    queryKey: ['allDynamicSettlementRows', CONTRACT_ADDRESS, registeredAddressKey, currentLocalDay.toString()],
    enabled: Boolean(isContractConfigured && publicClient && currentLocalDay > 0n && registeredRows.length > 0),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AllDynamicSettlementData> => {
      if (!publicClient || currentLocalDay <= 0n || registeredRows.length === 0) {
        return { rows: [], pendingRows: [], groups: [], sourceDayCount: 0 };
      }

      const rowByAddress = new Map(registeredRows.map((row) => [row.address.toLowerCase(), row]));
      const sourceDays = await collectAdminSettlementSourceDays(
        publicClient,
        registeredRows.map((row) => row.address),
        currentLocalDay,
      );

      const detailRows = (
        await Promise.all(
          sourceDays.map(async (sourceDay): Promise<DynamicSettlementSourceDayRow | undefined> => {
            const baseRow = rowByAddress.get(sourceDay.address.toLowerCase());
            if (!baseRow) return undefined;

            const [volumeValue, validValue, settledValue] = await Promise.all([
              publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'dailyStakeVolume',
                args: [sourceDay.address, sourceDay.day],
              }),
              publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'isValidOnDay',
                args: [sourceDay.address, sourceDay.day],
              }),
              publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'dynamicRewardSettled',
                args: [sourceDay.address, sourceDay.day],
              }),
            ]);

            return {
              ...baseRow,
              day: sourceDay.day,
              dailyStakeVolume: historyBigInt(volumeValue),
              isValidOnDay: Boolean(validValue),
              settled: Boolean(settledValue),
            };
          }),
        )
      )
        .filter((row): row is DynamicSettlementSourceDayRow => Boolean(row && row.dailyStakeVolume > 0n))
        .sort((left, right) => {
          if (left.day !== right.day) return left.day < right.day ? -1 : 1;
          return compareAdminUserLatest(left, right);
        });

      const pendingRows = detailRows.filter((row) => !row.settled);

      return {
        rows: detailRows,
        pendingRows,
        groups: groupDynamicSettlementRows(pendingRows),
        sourceDayCount: sourceDays.length,
      };
    },
  });
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
    isLoading: Boolean(isContractConfigured && address) && (
      managerRoleQuery.isLoading ||
      superQuery.isLoading ||
      managerQuery.isLoading
    ),
  };
}

function WalletConnectButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const connected = mounted && account && chain;

        if (!mounted) {
          return (
            <button className="wallet-connect-button" type="button" disabled>
              <Wallet size={17} />
              <span>钱包</span>
            </button>
          );
        }

        if (!connected) {
          return (
            <button className="wallet-connect-button" type="button" onClick={openConnectModal}>
              <Wallet size={17} />
              <span>连接钱包</span>
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button className="wallet-connect-button danger" type="button" onClick={openChainModal}>
              <Wallet size={17} />
              <span>网络错误</span>
            </button>
          );
        }

        return (
          <button className="wallet-connect-button connected" type="button" onClick={openAccountModal}>
            {chain.hasIcon && chain.iconUrl ? (
              <img
                src={chain.iconUrl}
                alt={chain.name ?? 'BSC'}
                style={{ background: chain.iconBackground }}
              />
            ) : (
              <span className="chain-dot" />
            )}
            <span>{shortAddress(account.address)}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function TopLanguageSwitcher({ locale, copy, onChange }: { locale: LocaleKey; copy: LocaleCopy; onChange: (locale: LocaleKey) => void }) {
  const [open, setOpen] = useState(false);
  const activeOption = LANGUAGE_OPTIONS.find((option) => option.key === locale) ?? LANGUAGE_OPTIONS[0];

  return (
    <div
      className={open ? 'top-language-switcher open' : 'top-language-switcher'}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as HTMLElement | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
      title={copy.language.title}
    >
      <button
        className="top-language-trigger"
        type="button"
        aria-label={copy.language.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Languages size={15} />
        <span>{activeOption.label}</span>
        <ChevronDown className="top-language-chevron" size={14} />
      </button>

      {open && (
        <div className="top-language-menu" role="listbox" aria-label={copy.language.title}>
          {LANGUAGE_OPTIONS.map((option) => {
            const active = option.key === locale;
            return (
              <button
                key={option.key}
                className={active ? 'top-language-option active' : 'top-language-option'}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {active && <CheckCircle2 size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'nav-button active' : 'nav-button'} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MoneyAmount({
  value,
  prefix = '',
  digits = 2,
}: {
  value?: bigint | number | string;
  prefix?: string;
  digits?: number;
}) {
  return (
    <span className="token-amount">
      <span className="token-amount-value">{prefix}{token(value, digits)}</span>
      <span className="token-amount-unit">{TOKEN_SYMBOL}</span>
    </span>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: React.ReactNode; trend: React.ReactNode }) {
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

function OrderRow({
  label,
  amount,
  status,
  time,
  action,
}: {
  label: string;
  amount: bigint;
  status: string;
  time: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="list-row">
      <div className="row-icon"><Landmark size={17} /></div>
      <div>
        <strong>{label}</strong>
        <small>{time}</small>
      </div>
      <div className="row-right">
        <MoneyAmount value={amount} />
        <small>{status}</small>
        {action}
      </div>
    </div>
  );
}

function WithdrawalRequestList({ requests }: { requests: WithdrawalRequestData[] }) {
  const sortedRequests = useMemo(() => [...requests].sort(compareWithdrawalRequestLatest), [requests]);
  const pagination = usePaginatedItems(
    sortedRequests,
    USER_ORDER_PAGE_SIZE,
    sortedRequests[0]?.id.toString() ?? 'empty',
  );

  return (
    <section className="panel">
      <div className="section-title">
        <h2>提现申请</h2>
        <span>{sortedRequests.length} 笔</span>
      </div>
      {sortedRequests.length > 0 ? (
        pagination.items.map((request) => (
          <OrderRow
            key={request.id.toString()}
            label={`提现申请 #${request.id.toString()}`}
            amount={request.amount}
            status={withdrawalStatusLabel(request)}
            time={<>到账 <MoneyAmount value={request.netAmount} /> / 手续费 <MoneyAmount value={request.fee} /> / 申请 {dateTime(request.requestedAt)}</>}
          />
        ))
      ) : (
        <EmptyState title="暂无提现申请" detail="提交提现后，提现记录会在这里显示。" />
      )}
      <PaginationControls {...pagination} onPageChange={pagination.setPage} />
    </section>
  );
}

function PrincipalOrderList({ orders, disabled }: { orders: PrincipalOrderData[]; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const nowSeconds = useNowSeconds();
  const transactionBusy = tx.status === 'wallet' || tx.status === 'pending';
  const sortedOrders = useMemo(() => [...orders].sort(comparePrincipalOrderLatest), [orders]);
  const pagination = usePaginatedItems(
    sortedOrders,
    USER_ORDER_PAGE_SIZE,
    sortedOrders[0]?.id.toString() ?? 'empty',
  );

  return (
    <section className="panel">
      <div className="section-title">
        <h2>本金订单</h2>
        <span>{sortedOrders.length} 笔</span>
      </div>
      {sortedOrders.length > 0 ? (
        pagination.items.map((order) => {
          const canRedeem = order.status === 0 && BigInt(nowSeconds) >= order.unlockAt;

          return (
            <OrderRow
              key={order.id.toString()}
              label={`${principalSourceLabel(order.source)} #${order.id.toString()}`}
              amount={order.amount}
              status={principalStatusLabel(order)}
              time={`创建 ${dateTime(order.createdAt)} / 解锁 ${dateTime(order.unlockAt)}`}
              action={
                canRedeem ? (
                  <button
                    className="row-action-button"
                    type="button"
                    disabled={disabled || transactionBusy}
                    onClick={() =>
                      runTx(`赎回本金 #${order.id.toString()}`, () =>
                        writeContractAsync({
                          address: CONTRACT_ADDRESS,
                          abi: ironBrotherAbi,
                          functionName: 'redeemPrincipal',
                          args: [order.id],
                        }),
                      )
                    }
                  >
                    赎回
                  </button>
                ) : undefined
              }
            />
          );
        })
      ) : (
        <EmptyState title="暂无本金订单" />
      )}
      <PaginationControls {...pagination} onPageChange={pagination.setPage} />
      <TxStatus tx={tx} />
    </section>
  );
}

function StakeOrderList({ orders, disabled }: { orders: StakeOrderData[]; disabled: boolean }) {
  const { runTx, tx, writeContractAsync } = useTxRunner();
  const nowSeconds = useNowSeconds();
  const transactionBusy = tx.status === 'wallet' || tx.status === 'pending';
  const sortedOrders = useMemo(() => [...orders].sort(compareStakeOrderLatest), [orders]);
  const pagination = usePaginatedItems(
    sortedOrders,
    USER_ORDER_PAGE_SIZE,
    sortedOrders[0]?.id.toString() ?? 'empty',
  );

  return (
    <section className="panel">
      <div className="section-title">
        <h2>带单订单</h2>
        <span>{sortedOrders.length} 笔</span>
      </div>
      {sortedOrders.length > 0 ? (
        pagination.items.map((order) => {
          const canSettle = !order.settled && BigInt(nowSeconds) >= order.settleAt;

          return (
            <OrderRow
              key={order.id.toString()}
              label={`带单订单 #${order.id.toString()}`}
              amount={order.amount}
              status={stakeStatusLabel(order)}
              time={<>{sessionLabel(order.session)} / 收益 <MoneyAmount value={order.reward} /> / 结算 {dateTime(order.settleAt)}</>}
              action={
                canSettle ? (
                  <button
                    className="row-action-button"
                    type="button"
                    disabled={disabled || transactionBusy}
                    onClick={() =>
                      runTx(`结算带单 #${order.id.toString()}`, () =>
                        writeContractAsync({
                          address: CONTRACT_ADDRESS,
                          abi: ironBrotherAbi,
                          functionName: 'settleStake',
                          args: [order.id],
                        }),
                      )
                    }
                  >
                    结算
                  </button>
                ) : undefined
              }
            />
          );
        })
      ) : (
        <EmptyState title="暂无带单订单" detail="带单后会从 stakeOrders(id) 读取显示。" />
      )}
      <PaginationControls {...pagination} onPageChange={pagination.setPage} />
      <TxStatus tx={tx} />
    </section>
  );
}

function DirectReferralListRow({
  item,
  onSelect,
}: {
  item: DirectReferralRow;
  onSelect?: (address: Address) => void;
}) {
  const volumeLabel =
    item.settlementCycle === BigInt(SECONDS_PER_DAY) ? '单日流水' : '本周期流水';
  const content = (
    <>
      <div className="row-icon"><Users size={17} /></div>
      <div>
        <strong>{shortAddress(item.address)}</strong>
        <small>{volumeLabel} <MoneyAmount value={item.currentStakeVolume} /> / 本金 <MoneyAmount value={item.account.principalBalance} /></small>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button className="list-row referral-row referral-row-button" type="button" onClick={() => onSelect(item.address)}>
        {content}
      </button>
    );
  }

  return (
    <div className="list-row referral-row">
      {content}
    </div>
  );
}

function principalOrderLockDays(order: PrincipalOrderData) {
  if (order.unlockAt <= order.createdAt) return '0';
  return secondsToDays(order.unlockAt - order.createdAt);
}

function AdminPrincipalOrderRow({
  order,
  canWrite,
  runner,
}: {
  order: PrincipalOrderData;
  canWrite: boolean;
  runner: ReturnType<typeof useTxRunner>;
}) {
  const [lockDays, setLockDays] = useState(() => principalOrderLockDays(order));
  const currentLockDays = principalOrderLockDays(order);
  const canUpdate = canWrite && order.status === 0 && Number(lockDays) >= 1 && lockDays !== currentLockDays;

  useEffect(() => {
    setLockDays(currentLockDays);
  }, [currentLockDays, order.id]);

  return (
    <div className="admin-list-row principal-admin-row wide">
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
      <div className="principal-cycle-editor">
        <label>
          赎回周期
          <input
            value={lockDays}
            onChange={(event) => setLockDays(event.target.value)}
            inputMode="decimal"
            disabled={!canWrite || order.status !== 0}
          />
          <span>天</span>
        </label>
        <button
          className="row-action-button"
          type="button"
          disabled={!canUpdate}
          onClick={() =>
            runner.runTx(`修改本金订单 #${order.id.toString()} 赎回周期`, () =>
              runner.writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'setPrincipalOrderLockPeriod',
                args: [order.id, daysToSeconds(lockDays)],
              }),
            )
          }
        >
          保存
        </button>
      </div>
    </div>
  );
}

function AdminStakeOrderRow({
  order,
  settlementCycle = BigInt(SECONDS_PER_DAY),
}: {
  order: StakeOrderData;
  settlementCycle?: bigint;
}) {
  return (
    <div className="admin-list-row">
      <div className="row-icon"><Coins size={17} /></div>
      <div>
        <strong>带单订单 #{order.id.toString()}</strong>
        <small>{shortAddress(order.user)} / {sessionLabel(order.session)} / 周期 {localPeriodLabel(order.day, settlementCycle)}</small>
      </div>
      <div className="row-metrics">
        <span>本金 {token(order.amount)} U</span>
        <span>收益 {token(order.reward)} U</span>
        <span>{stakeStatusLabel(order)}</span>
      </div>
    </div>
  );
}

function AdminWithdrawalRequestRow({
  request,
  canWrite,
  runner,
}: {
  request: WithdrawalRequestData;
  canWrite: boolean;
  runner: ReturnType<typeof useTxRunner>;
}) {
  const pending = request.status === 0;

  return (
    <div className="admin-list-row wide">
      <div className="row-icon"><Send size={17} /></div>
      <div>
        <strong>提现申请 #{request.id.toString()}</strong>
        <small>
          {shortAddress(request.user)} / 申请 {dateTime(request.requestedAt)} / {withdrawalStatusLabel(request)}
        </small>
      </div>
      <div className="row-metrics">
        <span>申请 {token(request.amount)} U</span>
        <span>到账 {token(request.netAmount)} U</span>
        <span>手续费 {token(request.fee)} U</span>
      </div>
      {pending && (
        <div className="split-buttons inline-actions">
          <button
            className="secondary-button"
            disabled={!canWrite}
            onClick={() =>
              runner.runTxFlow('审批提现', [
                {
                  label: '授权出款 USDT',
                  request: () =>
                    runner.writeContractAsync({
                      address: BSC_USDT_ADDRESS,
                      abi: erc20Abi,
                      functionName: 'approve',
                      args: [CONTRACT_ADDRESS, request.amount],
                    }),
                },
                {
                  label: '审批并打款',
                  request: () =>
                    runner.writeContractAsync({
                      address: CONTRACT_ADDRESS,
                      abi: ironBrotherAbi,
                      functionName: 'approveWithdrawal',
                      args: [request.id],
                    }),
                },
              ])
            }
          >
            审批打款
          </button>
          <button
            className="secondary-button danger-action"
            disabled={!canWrite}
            onClick={() =>
              runner.runTx('驳回提现', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'rejectWithdrawal',
                  args: [request.id],
                }),
              )
            }
          >
            驳回
          </button>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: ChainEventRecord }) {
  const args = event.args ?? {};
  const primaryAddress = (args.user ?? args.source ?? args.upline ?? args.operator ?? args.funder) as string | undefined;
  const amount = (args.amount ?? args.reward ?? args.totalReward ?? args.netAmount ?? args.principal) as bigint | undefined;

  return (
    <div className="admin-list-row">
      <div className="row-icon"><BarChart3 size={17} /></div>
      <div>
        <strong>{event.eventName}</strong>
        <small>区块 {event.blockNumber.toString()} / {primaryAddress ? shortAddress(primaryAddress) : shortAddress(event.transactionHash)}</small>
      </div>
      <div className="row-metrics">
        <span>{amount !== undefined ? `${token(amount)} U` : '链上事件'}</span>
        <a href={`${bscExplorerBaseUrl}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">查看交易</a>
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
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

function TxStatus({ tx }: { tx: TxState }) {
  if (tx.status === 'idle') return null;

  return (
    <div className={`tx-status ${tx.status}`}>
      <strong>{tx.label}</strong>
      <span>
        {tx.status === 'wallet' && '等待钱包确认'}
        {tx.status === 'pending' && '交易已提交，等待链上确认'}
        {tx.status === 'confirmed' && '交易已确认'}
        {tx.status === 'failed' && (tx.error || DEFAULT_TX_ERROR)}
      </span>
      {tx.hash && (
        <a href={`${bscExplorerBaseUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          查看交易
        </a>
      )}
    </div>
  );
}

export default App;
