export const mockUser = {
  principalBalance: 1000n * 10n ** 18n,
  principalStaked: 0n,
  rewardBalance: 12850n * 10n ** 16n,
  totalDeposited: 1000n * 10n ** 18n,
  totalStaked: 4200n * 10n ** 18n,
  totalStaticReward: 42n * 10n ** 18n,
  totalDynamicReward: 18n * 10n ** 18n,
  totalWithdrawn: 0n,
  directCount: 12n,
  registered: true,
  whitelist40: false,
};

export const mockOrders = [
  { id: 1n, label: '入金订单', amount: 200n * 10n ** 18n, status: '锁仓中', time: '29天 23:59:59' },
  { id: 2n, label: '复投订单', amount: 100n * 10n ** 18n, status: '锁仓中', time: '18天 04:12:31' },
  { id: 3n, label: '入金订单', amount: 500n * 10n ** 18n, status: '可赎回', time: '已到期' },
];

export const mockTeam = [
  { address: '0xA31B...92F1', volume: '1,000U', status: '有效账户' },
  { address: '0x77C8...4E10', volume: '800U', status: '未达标' },
  { address: '0xF19A...A002', volume: '1,600U', status: '有效账户' },
];

export const mockDashboard = {
  totalUsers: 328n,
  totalDepositedAmount: 186000n * 10n ** 18n,
  totalPrincipalBalance: 92000n * 10n ** 18n,
  totalRewardBalance: 8400n * 10n ** 18n,
  totalStakedVolume: 452000n * 10n ** 18n,
  totalStaticRewardCredited: 4520n * 10n ** 18n,
  totalDynamicRewardCredited: 1280n * 10n ** 18n,
  totalWithdrawnAmount: 6400n * 10n ** 18n,
};
