import type { Address } from 'viem';
import { formatUnits, isAddress, parseUnits, zeroAddress } from 'viem';

export function shortAddress(address?: string) {
  if (!address) return '未连接';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function token(value?: bigint | number | string, digits = 2) {
  if (value === undefined || value === null) return '0.00';
  const formatted =
    typeof value === 'bigint' ? formatUnits(value, 18) : String(value);
  const numeric = Number(formatted);
  if (!Number.isFinite(numeric)) return formatted;
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function bpsToPercent(value?: bigint | number) {
  const raw = typeof value === 'bigint' ? Number(value) : value || 0;
  return `${(raw / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

export function parseTokenInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return 0n;
  return parseUnits(normalized, 18);
}

export function safeAddress(value: string): Address {
  return isAddress(value) ? value : zeroAddress;
}

export function dateTime(timestamp?: bigint) {
  if (!timestamp || timestamp === 0n) return '--';
  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    hour12: false,
  });
}
