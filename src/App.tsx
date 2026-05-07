import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
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
import { bscTestnet } from 'wagmi/chains';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { erc20Abi, ironBrotherAbi } from './abi/ironBrother';
import { BSC_USDT_ADDRESS, IRONBROTHER_CONTRACT_ADDRESS, isContractConfigured } from './config/contracts';
import { bpsToPercent, dateTime, parseTokenInput, safeAddress, shortAddress, token } from './lib/format';

type NavKey = 'home' | 'stake' | 'wallet' | 'team' | 'profile';
type AdminNavKey = 'dashboard' | 'users' | 'principal' | 'stakes' | 'rewards' | 'team' | 'config' | 'roles';
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
  dailyStakeVolume: bigint;
  isValidToday: boolean;
};

type TeamSummaryData = {
  totalDeposited: bigint;
  totalMembers: number;
};

type AdminUserRow = {
  address: Address;
  account: UserAccountData;
  blockNumber?: bigint;
};

type UserTreeNode = AdminUserRow & {
  children: UserTreeNode[];
};

type DynamicSettlementRow = AdminUserRow & {
  dailyStakeVolume: bigint;
  isValidOnDay: boolean;
  settled: boolean;
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

const DEFAULT_ADMIN_ROLE = `0x${'00'.repeat(32)}` as Hex;
const CONTRACT_ADDRESS = IRONBROTHER_CONTRACT_ADDRESS ?? zeroAddress;
const EVENT_LOOKBACK_BLOCKS = 200_000n;
const EVENT_CHUNK_BLOCKS = 20_000n;
const SESSION_STATUS_REFETCH_MS = 30_000;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const EAST8_TIMEZONE_SECONDS = 8 * SECONDS_PER_HOUR;
const LANGUAGE_STORAGE_KEY = 'ironbrother.locale';
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
    nav: { home: '首页', stake: '带单', wallet: '钱包', team: '团队', profile: '我的' },
    shell: {
      greeting: 'Hi',
      contractMissing: '合约地址未配置，链上读取和真实交易暂不可用。部署后设置 VITE_IRONBROTHER_CONTRACT_ADDRESS 即可启用。',
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
      noOrdersDetail: '连接钱包后，将直接读取该地址的本金订单和带单订单。',
    },
    session: { morning: '上午场', afternoon: '下午场', closed: '休息中', canStake: '可带单', pending: '待开放' },
    order: { deposit: '入金订单', reinvest: '复投订单', stake: '带单订单', unlock: '解锁', settle: '结算' },
    status: { redeemed: '已赎回', redeemable: '可赎回', locked: '锁仓中', settled: '已结算', settleable: '可结算', pending: '待结算' },
  },
  'zh-TW': {
    nav: { home: '首頁', stake: '帶單', wallet: '錢包', team: '團隊', profile: '我的' },
    shell: {
      greeting: 'Hi',
      contractMissing: '合約地址未設定，鏈上讀取和真實交易暫不可用。部署後設定 VITE_IRONBROTHER_CONTRACT_ADDRESS 即可啟用。',
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
      noOrdersDetail: '連接錢包後，將直接讀取該地址的本金訂單和帶單訂單。',
    },
    session: { morning: '上午場', afternoon: '下午場', closed: '休息中', canStake: '可帶單', pending: '待開放' },
    order: { deposit: '入金訂單', reinvest: '複投訂單', stake: '帶單訂單', unlock: '解鎖', settle: '結算' },
    status: { redeemed: '已贖回', redeemable: '可贖回', locked: '鎖倉中', settled: '已結算', settleable: '可結算', pending: '待結算' },
  },
  en: {
    nav: { home: 'Home', stake: 'Stake', wallet: 'Wallet', team: 'Team', profile: 'Me' },
    shell: {
      greeting: 'Hi',
      contractMissing: 'Contract address is not configured. On-chain reads and real transactions are unavailable until VITE_IRONBROTHER_CONTRACT_ADDRESS is set.',
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
      noOrdersDetail: 'Connect a wallet to read principal and staking orders for this address.',
    },
    session: { morning: 'Morning', afternoon: 'Afternoon', closed: 'Closed', canStake: 'Open', pending: 'Pending' },
    order: { deposit: 'Deposit Order', reinvest: 'Reinvest Order', stake: 'Stake Order', unlock: 'Unlock', settle: 'Settle' },
    status: { redeemed: 'Redeemed', redeemable: 'Redeemable', locked: 'Locked', settled: 'Settled', settleable: 'Settleable', pending: 'Pending' },
  },
  ja: {
    nav: { home: 'ホーム', stake: 'ステーク', wallet: 'ウォレット', team: 'チーム', profile: 'マイ' },
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
      noOrdersDetail: 'ウォレット接続後、このアドレスの元本とステーク注文を直接読み取ります。',
    },
    session: { morning: '午前枠', afternoon: '午後枠', closed: '休止中', canStake: '受付中', pending: '待機中' },
    order: { deposit: '入金注文', reinvest: '再投資注文', stake: 'ステーク注文', unlock: '解除', settle: '精算' },
    status: { redeemed: '償還済み', redeemable: '償還可能', locked: 'ロック中', settled: '精算済み', settleable: '精算可能', pending: '精算待ち' },
  },
  ko: {
    nav: { home: '홈', stake: '스테이킹', wallet: '지갑', team: '팀', profile: '내 정보' },
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
      noOrdersDetail: '지갑을 연결하면 이 주소의 원금 및 스테이킹 주문을 직접 읽습니다.',
    },
    session: { morning: '오전 세션', afternoon: '오후 세션', closed: '휴식 중', canStake: '가능', pending: '대기' },
    order: { deposit: '입금 주문', reinvest: '재투자 주문', stake: '스테이킹 주문', unlock: '잠금해제', settle: '정산' },
    status: { redeemed: '상환됨', redeemable: '상환 가능', locked: '잠김', settled: '정산됨', settleable: '정산 가능', pending: '정산 대기' },
  },
  vi: {
    nav: { home: 'Trang chủ', stake: 'Stake', wallet: 'Ví', team: 'Đội nhóm', profile: 'Của tôi' },
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
      noOrdersDetail: 'Kết nối ví để đọc trực tiếp lệnh gốc và stake của địa chỉ này.',
    },
    session: { morning: 'Phiên sáng', afternoon: 'Phiên chiều', closed: 'Đang nghỉ', canStake: 'Có thể stake', pending: 'Chưa mở' },
    order: { deposit: 'Lệnh nạp', reinvest: 'Lệnh tái đầu tư', stake: 'Lệnh stake', unlock: 'Mở khóa', settle: 'Quyết toán' },
    status: { redeemed: 'Đã rút', redeemable: 'Có thể rút', locked: 'Đang khóa', settled: 'Đã quyết toán', settleable: 'Có thể quyết toán', pending: 'Chờ quyết toán' },
  },
  ms: {
    nav: { home: 'Utama', stake: 'Stake', wallet: 'Dompet', team: 'Pasukan', profile: 'Saya' },
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
      noOrdersDetail: 'Sambungkan dompet untuk membaca pesanan prinsipal dan stake alamat ini.',
    },
    session: { morning: 'Sesi pagi', afternoon: 'Sesi petang', closed: 'Rehat', canStake: 'Dibuka', pending: 'Menunggu' },
    order: { deposit: 'Pesanan Deposit', reinvest: 'Pesanan Labur Semula', stake: 'Pesanan Stake', unlock: 'Buka kunci', settle: 'Selesai' },
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
  ['day not closed', '只能结算已结束的本地日期。'],
  ['dynamic settled', '该用户当天动态奖励已经结算。'],
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

function sortUserTreeNodes(nodes: UserTreeNode[]) {
  nodes.sort((left, right) => {
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
  const withdrawalRequests = useMemo(
    () =>
      (withdrawalRequestsQuery.data ?? [])
        .map((result) => withdrawalRequestFromTuple(readResult(result, undefined)))
        .filter((request): request is WithdrawalRequestData => Boolean(request)),
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
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
  });

  const sessionConfigQuery = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'timezoneOffset' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'morningEnd' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonStart' },
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'afternoonEnd' },
    ],
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
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

  const withdrawalApprovalQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'withdrawalApprovalRequired',
    query: { enabled: isContractConfigured },
  });

  const defaultReferrerQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'defaultReferrer',
    query: { enabled: isContractConfigured },
  });

  const currentDayQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentLocalDay',
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
  });

  const account = userFromTuple(userQuery.data);
  const sessionTuple = sessionQuery.data as readonly [number, bigint] | undefined;
  const pickSessionConfig = <T,>(index: number, fallback: T) => readResult(sessionConfigQuery.data?.[index], fallback);
  const currentLocalDay = (currentDayQuery.data as bigint | undefined) ?? 0n;
  const orders = useUserOrders(accountAddress, enabled);
  const directReferrals = useDirectReferralRows(accountAddress, currentLocalDay, enabled);
  const teamSummary = useTeamSummary(accountAddress, enabled);

  return {
    account,
    availablePrincipal: (availableQuery.data as bigint | undefined) ?? 0n,
    maturedUnredeemed: (maturedQuery.data as bigint | undefined) ?? 0n,
    currentSession: Number(sessionTuple?.[0] ?? 0),
    sessionSettleAt: sessionTuple?.[1] ?? 0n,
    timezoneOffset: pickSessionConfig(0, BigInt(EAST8_TIMEZONE_SECONDS)),
    morningStart: pickSessionConfig(1, 9 * SECONDS_PER_HOUR),
    morningEnd: pickSessionConfig(2, 12 * SECONDS_PER_HOUR),
    afternoonStart: pickSessionConfig(3, 14 * SECONDS_PER_HOUR),
    afternoonEnd: pickSessionConfig(4, 17 * SECONDS_PER_HOUR),
    yieldBps: (yieldQuery.data as bigint | undefined) ?? 100n,
    withdrawFee: (withdrawFeeQuery.data as bigint | undefined) ?? 10n * 10n ** 18n,
    withdrawalApprovalRequired: (withdrawalApprovalQuery.data as boolean | undefined) ?? true,
    defaultReferrer: (defaultReferrerQuery.data as Address | undefined) ?? zeroAddress,
    currentLocalDay,
    principalOrderIds: orders.principalOrderIds,
    stakeOrderIds: orders.stakeOrderIds,
    withdrawalRequestIds: orders.withdrawalRequestIds,
    principalOrders: orders.principalOrders,
    stakeOrders: orders.stakeOrders,
    withdrawalRequests: orders.withdrawalRequests,
    directReferrals: directReferrals.rows,
    teamSummary: teamSummary.data ?? emptyTeamSummary,
    isTeamSummaryLoading: teamSummary.isLoading,
    isAccountLoading: userQuery.isLoading,
    isSessionLoading: sessionQuery.isLoading,
    isDefaultReferrerLoading: defaultReferrerQuery.isLoading,
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
      chainId: bscTestnet.id,
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
  const data = useIronBrotherData();
  const wrongNetwork = isConnected && chainId !== bscTestnet.id;
  const copy = LOCALE_COPY[locale];
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
          <div>
            <p className="eyebrow">IronBrother</p>
            <h1>{copy.shell.greeting}, {shortAddress(address)}</h1>
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
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            {copy.shell.switchNetwork}
          </button>
        )}
      </header>

      <main className="mobile-frame content-frame">
        {nav === 'home' && <HomeScreen data={data} copy={copy} onNavigate={setNav} />}
        {nav === 'stake' && <StakeScreen data={data} disabled={!isConnected || wrongNetwork || !isContractConfigured} />}
        {nav === 'wallet' && (
          <WalletScreen
            data={data}
            disabled={!isConnected || wrongNetwork || !isContractConfigured}
            suggestedReferrer={effectiveReferrer}
          />
        )}
        {nav === 'team' && <TeamScreen data={data} />}
        {nav === 'profile' && <ProfileScreen address={address} data={data} />}
      </main>

      <nav className="mobile-frame bottom-nav" aria-label="主导航">
        <NavButton icon={<Landmark />} label={copy.nav.home} active={nav === 'home'} onClick={() => setNav('home')} />
        <NavButton icon={<Coins />} label={copy.nav.stake} active={nav === 'stake'} onClick={() => setNav('stake')} />
        <NavButton icon={<Wallet />} label={copy.nav.wallet} active={nav === 'wallet'} onClick={() => setNav('wallet')} />
        <NavButton icon={<Users />} label={copy.nav.team} active={nav === 'team'} onClick={() => setNav('team')} />
        <NavButton icon={<UserRound />} label={copy.nav.profile} active={nav === 'profile'} onClick={() => setNav('profile')} />
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
  onNavigate,
}: {
  data: ReturnType<typeof useIronBrotherData>;
  copy: LocaleCopy;
  onNavigate: (nav: NavKey) => void;
}) {
  const currentSessionLabel = sessionLabelForLocale(data.currentSession, copy);
  const morningRange = sessionTimeRange(data.morningStart, data.morningEnd);
  const afternoonRange = sessionTimeRange(data.afternoonStart, data.afternoonEnd);
  const nowSeconds = useNowSeconds();
  const recentOrders = useMemo(() => {
    const principal = data.principalOrders.map((order) => ({
      id: `principal-${order.id.toString()}`,
      label: `${principalSourceLabelForLocale(order.source, copy)} #${order.id.toString()}`,
      amount: order.amount,
      status: principalStatusLabelForLocale(order, copy, nowSeconds),
      time: principalOrderHomeTime(order, copy, nowSeconds),
      createdAt: order.createdAt,
    }));
    const stakes = data.stakeOrders.map((order) => ({
      id: `stake-${order.id.toString()}`,
      label: `${copy.order.stake} #${order.id.toString()}`,
      amount: order.amount,
      status: stakeStatusLabelForLocale(order, copy, nowSeconds),
      time: `${sessionLabelForLocale(order.session, copy)} / ${copy.order.settle} ${dateTime(order.settleAt)}`,
      createdAt: order.createdAt,
    }));

    return [...principal, ...stakes]
      .sort((a, b) => Number(b.createdAt - a.createdAt))
      .slice(0, 5);
  }, [copy, data.principalOrders, data.stakeOrders, nowSeconds]);

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
            <OrderRow key={order.id} label={order.label} amount={order.amount} status={order.status} time={order.time} />
          ))
        ) : (
          <EmptyState title={copy.home.noOrdersTitle} detail={copy.home.noOrdersDetail} />
        )}
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

      <StakeOrderList orders={data.stakeOrders} />
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
      <PrincipalOrderList orders={data.principalOrders} />
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
  const [redeemId, setRedeemId] = useState('1');
  const [stakeId, setStakeId] = useState('1');

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
    : <>提现手续费 <MoneyAmount value={data.withdrawFee} />，预计到账 <MoneyAmount value={netWithdrawal} />，将从合约奖励池即时打款。</>;
  const reinvestValidation = reinvestParsed > data.account.rewardBalance ? '复投金额不能超过收益钱包余额。' : '';
  const withdrawValidation =
    withdrawParsed > data.account.rewardBalance
      ? '提现金额不能超过收益钱包余额。'
      : withdrawParsed > 0n && withdrawParsed <= data.withdrawFee
        ? '提现金额必须大于手续费。'
        : '';

  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Reward wallet</p>
          <h2>收益钱包</h2>
        </div>
        <strong><MoneyAmount value={data.account.rewardBalance} /></strong>
      </div>
      <div className="calc-grid">
        <MetricCard label="静态累计" value={<MoneyAmount value={data.account.totalStaticReward} />} trend="带单按次结算" />
        <MetricCard label="动态累计" value={<MoneyAmount value={data.account.totalDynamicReward} />} trend="每日 0 点后可结算" />
      </div>
      <div className="form-grid">
        <label>
          复投金额
          <input value={reinvestAmount} onChange={(event) => setReinvestAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          <small>可用 <MoneyAmount value={data.account.rewardBalance} /></small>
        </label>
        <label>
          提现金额
          <input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          <small>可用 <MoneyAmount value={data.account.rewardBalance} /></small>
        </label>
      </div>
      <p className="helper-line">{withdrawHelper}</p>
      {reinvestValidation && <p className="field-error">{reinvestValidation}</p>}
      {withdrawValidation && <p className="field-error">{withdrawValidation}</p>}
      <div className="split-buttons">
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
      <div className="form-grid">
        <label>
          赎回订单 ID
          <input value={redeemId} onChange={(event) => setRedeemId(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          结算带单 ID
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
            runTx('结算带单', () =>
              writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: ironBrotherAbi,
                functionName: 'settleStake',
                args: [BigInt(stakeId || '0')],
              }),
            )
          }
        >
          结算带单
        </button>
      </div>
      <TxStatus tx={tx} />
    </section>
  );
}

function TeamScreen({ data }: { data: ReturnType<typeof useIronBrotherData> }) {
  return (
    <section className="screen-stack">
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
          <EmptyState title="暂无直推数据" detail="直推关系由合约 getDirectReferrals 直接读取。" />
        )}
      </section>
    </section>
  );
}

function PromotionLinkCard({ address }: { address?: Address }) {
  const promotionLink = useMemo(() => promotionLinkForAddress(address), [address]);
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
              <strong>{promotionLink}</strong>
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
        <EmptyState title="暂无推广链接" detail="连接钱包后自动生成你的专属推广链接。" />
      )}
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
      <PromotionLinkCard address={address} />
      <section className="panel">
        <InfoLine label="USDT 合约" value={shortAddress(BSC_USDT_ADDRESS)} />
        <InfoLine label="业务合约" value={isContractConfigured ? shortAddress(CONTRACT_ADDRESS) : '未配置'} />
        <InfoLine label="网络" value="BSC Testnet" />
        <InfoLine label="本地日编号" value={data.currentLocalDay.toString()} />
        <InfoLine label="累计入金" value={<MoneyAmount value={data.account.totalDeposited} />} />
        <InfoLine label="累计提现" value={<MoneyAmount value={data.account.totalWithdrawn} />} />
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
    { key: 'stakes', label: '带单订单' },
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
          <WalletConnectButton />
        </header>

        {!isContractConfigured && <div className="notice warning">未配置合约地址，后台链上读取和写操作已禁用。</div>}
        {wrongNetwork && (
          <button className="notice danger action-notice" onClick={() => switchChain({ chainId: bscTestnet.id })}>
            切换到 BSC Testnet
          </button>
        )}
        {readOnly && <div className="notice">当前钱包是 Manager，只能查看数据，不能修改合约配置。</div>}
        {noRole && <div className="notice warning">当前钱包没有 Admin/Manager 权限，不能执行写操作。</div>}

        {nav === 'dashboard' && <AdminDashboardPage dashboard={dashboard} />}
        {nav === 'users' && <AdminUsersPage />}
        {nav === 'principal' && <AdminPrincipalOrdersPage />}
        {nav === 'stakes' && <AdminStakeOrdersPage />}
        {nav === 'rewards' && <AdminRewardsPage canWrite={canWrite} canApprove={canEdit} runner={runner} />}
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
  const currentDayQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentLocalDay',
    query: { enabled: isContractConfigured },
  });
  const currentLocalDay = (currentDayQuery.data as bigint | undefined) ?? 0n;
  const totalUsers = (totalUsersQuery.data as bigint | undefined) ?? 0n;
  const sortedRows = useMemo(
    () =>
      [...users.rows].sort((left, right) => {
        if (left.account.registered !== right.account.registered) return left.account.registered ? -1 : 1;
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

        <AdminUserDetailPanel row={selectedRow} currentLocalDay={currentLocalDay} onSelect={setSelectedAddress} />
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
  currentLocalDay,
  onSelect,
}: {
  row?: AdminUserRow;
  currentLocalDay: bigint;
  onSelect: (address: Address) => void;
}) {
  const address = row?.address ?? zeroAddress;
  const enabled = Boolean(row && address !== zeroAddress);
  const orders = useUserOrders(address, enabled);
  const referrals = useDirectReferralRows(address, currentLocalDay, enabled);
  const teamSummary = useTeamSummary(address, enabled);
  const latestPrincipalOrders = useMemo(() => [...orders.principalOrders].sort((left, right) => compareBigIntDesc(left.id, right.id)).slice(0, 2), [orders.principalOrders]);
  const latestStakeOrders = useMemo(() => [...orders.stakeOrders].sort((left, right) => compareBigIntDesc(left.id, right.id)).slice(0, 2), [orders.stakeOrders]);
  const latestWithdrawalRequests = useMemo(
    () => [...orders.withdrawalRequests].sort((left, right) => compareBigIntDesc(left.id, right.id)).slice(0, 2),
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
        <a href={`https://testnet.bscscan.com/address/${row.address}`} target="_blank" rel="noreferrer">BscScan</a>
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
          <EmptyState title="暂无本金订单" detail="用户入金或复投后，本金订单会自动显示在这里。" />
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
          <h2>带单订单</h2>
        </div>
        <span className="status-chip">{orderBook.stakeOrders.length} 笔</span>
      </div>
      <div className="list-stack">
        {orderBook.stakeOrders.length > 0 ? (
          orderBook.stakeOrders.map((order) => <AdminStakeOrderRow key={order.id.toString()} order={order} />)
        ) : (
          <EmptyState title="暂无带单订单" detail="用户完成带单后，订单会自动显示在这里。" />
        )}
      </div>
    </section>
  );
}

function AdminRewardsPage({ canWrite, canApprove, runner }: { canWrite: boolean; canApprove: boolean; runner: ReturnType<typeof useTxRunner> }) {
  const [dynamicUser, setDynamicUser] = useState('');
  const [dynamicDay, setDynamicDay] = useState('');
  const [batchUsers, setBatchUsers] = useState('');
  const [stakeIds, setStakeIds] = useState('');
  const [fundAmount, setFundAmount] = useState('1000');
  const currentDayQuery = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ironBrotherAbi,
    functionName: 'currentLocalDay',
    query: { enabled: isContractConfigured, refetchInterval: SESSION_STATUS_REFETCH_MS },
  });
  const currentLocalDay = (currentDayQuery.data as bigint | undefined) ?? 0n;
  const settlementDay = parseBigIntInput(dynamicDay);
  const dayClosed = settlementDay > 0n && settlementDay < currentLocalDay;
  const users = useAdminUsers();
  const settlement = useDynamicSettlementRows(users.rows, settlementDay, settlementDay > 0n);
  const oneClickAddresses = settlement.pendingRows.map((row) => row.address);
  const validPendingCount = settlement.pendingRows.filter((row) => row.isValidOnDay).length;
  const orderBook = useAdminOrderBook();
  const currentDayStakeOrders = orderBook.stakeOrders.filter((order) => order.day === currentLocalDay);
  const unsettledStakeOrders = orderBook.stakeOrders.filter((order) => !order.settled);
  const recentStakeVolume = orderBook.stakeOrders.reduce((sum, order) => sum + order.amount, 0n);
  const currentDayStakeVolume = currentDayStakeOrders.reduce((sum, order) => sum + order.amount, 0n);
  const withdrawals = useAdminWithdrawalRequests();
  const config = useContractConfig();
  const pendingWithdrawalAmount = withdrawals.pendingRequests.reduce((sum, request) => sum + request.amount, 0n);
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
  const events = useChainEvents(['StakeCreated', 'StakeSettled', 'DynamicRewardSettled', 'WithdrawalRequested', 'WithdrawalApproved', 'WithdrawalRejected', 'RewardsFunded', 'PrincipalRedeemed', 'Reinvested']);

  useEffect(() => {
    if (!dynamicDay && currentLocalDay > 0n) {
      setDynamicDay((currentLocalDay - 1n).toString());
    }
  }, [currentLocalDay, dynamicDay]);

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
        <div className="settlement-box">
          <div className="section-title">
            <div>
              <p className="eyebrow">Daily batch</p>
              <h2>每日一键动态结算</h2>
            </div>
            <span className="status-chip">{oneClickAddresses.length} 待结算</span>
          </div>
          <div className="settlement-stats">
            <InfoLine label="当前本地日" value={currentLocalDay.toString()} />
            <InfoLine label="结算日期" value={dynamicDay || '--'} />
            <InfoLine label="有流水用户" value={`${settlement.rows.length} 人`} />
            <InfoLine label="有效流水用户" value={`${validPendingCount} 人`} />
          </div>
          <button
            className="primary-button"
            disabled={!canWrite || !dayClosed || oneClickAddresses.length === 0}
            onClick={() =>
              runner.runTx('每日一键动态结算', () =>
                runner.writeContractAsync({
                  address: CONTRACT_ADDRESS,
                  abi: ironBrotherAbi,
                  functionName: 'settleDynamicRewardForUsers',
                  args: [oneClickAddresses, settlementDay],
                }),
              )
            }
          >
            每日一键动态结算
          </button>
          <p className="helper-line">
            {dayClosed
              ? '将结算所选日期内已产生流水且尚未结算的用户。'
              : '只能结算已经结束的本地日期，通常选择当前本地日的前一天。'}
          </p>
          <div className="settlement-preview">
            {settlement.isLoading ? (
              <span>正在读取候选用户...</span>
            ) : settlement.pendingRows.length > 0 ? (
              settlement.pendingRows.slice(0, 8).map((row) => (
                <div className="settlement-row" key={row.address}>
                  <span>{shortAddress(row.address)}</span>
                  <span>{token(row.dailyStakeVolume)} U</span>
                  <span>{row.isValidOnDay ? '有效' : '未达门槛'}</span>
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
          <InfoLine label="当前本地日" value={currentLocalDay.toString()} />
          <InfoLine label="今日带单笔数" value={`${currentDayStakeOrders.length} 笔`} />
          <InfoLine label="今日带单流水" value={`${token(currentDayStakeVolume)} U`} />
          <InfoLine label="未结算带单" value={`${unsettledStakeOrders.length} 笔`} />
          <InfoLine label="最近带单流水" value={`${token(recentStakeVolume)} U`} />
        </div>
        <div className="list-stack">
          {orderBook.stakeOrders.length > 0 ? (
            orderBook.stakeOrders.slice(0, 8).map((order) => <AdminStakeOrderRow key={order.id.toString()} order={order} />)
          ) : (
            <EmptyState title="暂无带单流水" detail="这里直接读取 stakeOrders(id)，用户完成带单后即使未结算也会显示。" />
          )}
        </div>
      </section>

      <section className="admin-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Withdrawals</p>
            <h2>提现审批</h2>
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
        <div className="list-stack">
          {withdrawals.requests.length > 0 ? (
            withdrawals.requests.map((request) => (
              <AdminWithdrawalRequestRow key={request.id.toString()} request={request} canWrite={canApprove} runner={runner} />
            ))
          ) : (
            <EmptyState title="暂无提现申请" detail={config.withdrawalApprovalRequired ? '用户提交提现后，会在这里等待 Admin 审批。' : '免审批提现会自动打款并直接显示为已打款记录。'} />
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
        <AdminCard icon={<Send />} label="提现手续费" value={`${token(config.withdrawFee)} U`} />
        <AdminCard icon={<LockKeyhole />} label="锁仓周期" value={`${secondsToDays(config.lockPeriod)} 天`} />
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

      <section className="admin-panel">
        <div className="section-title">
          <h2>场次与代数</h2>
          <Users size={20} />
        </div>
        <div className="form-grid">
          <label>
            场次时区
            <input value="UTC+8（东八区，链上自动识别）" readOnly />
          </label>
          <label>
            上午开始时间
            <input value={morningStart} onChange={(event) => setMorningStart(event.target.value)} placeholder="09:00" inputMode="numeric" />
          </label>
          <label>
            上午结束时间
            <input value={morningEnd} onChange={(event) => setMorningEnd(event.target.value)} placeholder="12:00" inputMode="numeric" />
          </label>
          <label>
            下午开始时间
            <input value={afternoonStart} onChange={(event) => setAfternoonStart(event.target.value)} placeholder="14:00" inputMode="numeric" />
          </label>
          <label>
            下午结束时间
            <input value={afternoonEnd} onChange={(event) => setAfternoonEnd(event.target.value)} placeholder="17:00" inputMode="numeric" />
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
        <button
          className="secondary-button full-button"
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
      { address: CONTRACT_ADDRESS, abi: ironBrotherAbi, functionName: 'totalPendingWithdrawalAmount' },
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
    feeReceiver: pick(9, zeroAddress),
    defaultReferrer: pick(10, zeroAddress),
    depositReceivers: pick(11, [] as readonly Address[]),
    nextDepositReceiverIndex: pick(12, 0),
    timezoneOffset: pick(13, BigInt(EAST8_TIMEZONE_SECONDS)),
    morningStart: pick(14, 0),
    morningEnd: pick(15, 0),
    afternoonStart: pick(16, 0),
    afternoonEnd: pick(17, 0),
    paused: pick(18, false),
    withdrawalApprovalRequired: pick(19, true),
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
      .filter((order): order is PrincipalOrderData => Boolean(order)),
    stakeOrders: (stakeOrdersQuery.data ?? [])
      .map((result) => stakeOrderFromTuple(readResult(result, undefined)))
      .filter((order): order is StakeOrderData => Boolean(order)),
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
        .filter((request): request is WithdrawalRequestData => Boolean(request)),
    [requestsQuery.data],
  );

  return {
    requests,
    pendingRequests: requests.filter((request) => request.status === 0),
    isLoading: nextIdQuery.isLoading || requestsQuery.isLoading,
  };
}

function useChainEvents(eventNames: readonly string[], enabled = true) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['ironBrotherEvents', CONTRACT_ADDRESS, eventNames.join('|')],
    enabled: Boolean(enabled && isContractConfigured && publicClient),
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
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
        .filter((row) => row.dailyStakeVolume > 0n),
    [detailQuery.data, registeredRows],
  );

  return {
    rows: settlementRows,
    pendingRows: settlementRows.filter((row) => !row.settled),
    isLoading: detailQuery.isLoading,
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

function OrderRow({ label, amount, status, time }: { label: string; amount: bigint; status: string; time: React.ReactNode }) {
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
      </div>
    </div>
  );
}

function WithdrawalRequestList({ requests }: { requests: WithdrawalRequestData[] }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>提现申请</h2>
        <span>{requests.length} 笔</span>
      </div>
      {requests.length > 0 ? (
        requests.map((request) => (
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
    </section>
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
        <h2>带单订单</h2>
        <span>{orders.length} 笔</span>
      </div>
      {orders.length > 0 ? (
        orders.map((order) => (
          <OrderRow
            key={order.id.toString()}
            label={`带单订单 #${order.id.toString()}`}
            amount={order.amount}
            status={stakeStatusLabel(order)}
            time={<>{sessionLabel(order.session)} / 收益 <MoneyAmount value={order.reward} /> / 结算 {dateTime(order.settleAt)}</>}
          />
        ))
      ) : (
        <EmptyState title="暂无带单订单" detail="带单后会从 stakeOrders(id) 读取显示。" />
      )}
    </section>
  );
}

function DirectReferralListRow({ item, onSelect }: { item: DirectReferralRow; onSelect?: (address: Address) => void }) {
  const content = (
    <>
      <div className="row-icon"><Users size={17} /></div>
      <div>
        <strong>{shortAddress(item.address)}</strong>
        <small>今日流水 <MoneyAmount value={item.dailyStakeVolume} /> / 本金 <MoneyAmount value={item.account.principalBalance} /></small>
      </div>
      <span className={item.isValidToday ? 'amount-positive' : 'amount-muted'}>
        {item.isValidToday ? '今日有效' : '未达标'}
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button className="list-row referral-row-button" type="button" onClick={() => onSelect(item.address)}>
        {content}
      </button>
    );
  }

  return (
    <div className="list-row">
      {content}
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
        <strong>带单订单 #{order.id.toString()}</strong>
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
        <a href={`https://testnet.bscscan.com/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          查看交易
        </a>
      )}
    </div>
  );
}

export default App;
