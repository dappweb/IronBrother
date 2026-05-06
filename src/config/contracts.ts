import type { Address } from 'viem';
import { isAddress, zeroAddress } from 'viem';

const configuredUsdtAddress = import.meta.env.VITE_USDT_ADDRESS;

export const BSC_USDT_ADDRESS =
  configuredUsdtAddress && isAddress(configuredUsdtAddress)
    ? (configuredUsdtAddress as Address)
    : zeroAddress;

const configuredAddress = import.meta.env.VITE_IRONBROTHER_CONTRACT_ADDRESS;

export const IRONBROTHER_CONTRACT_ADDRESS =
  configuredAddress && isAddress(configuredAddress)
    ? (configuredAddress as Address)
    : undefined;

export const isContractConfigured = Boolean(IRONBROTHER_CONTRACT_ADDRESS);
