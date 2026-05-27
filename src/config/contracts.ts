import type { Address } from 'viem';
import { isAddress, zeroAddress } from 'viem';

import bscDeployment from '../../deployments/bsc.json';

const BSC_MAINNET_USDT = '0x55d398326f99059fF775485246999027B3197955';

function resolveAddress(configuredAddress: string | undefined, fallbackAddress: string): Address {
  if (configuredAddress && isAddress(configuredAddress)) {
    return configuredAddress as Address;
  }

  if (isAddress(fallbackAddress)) {
    return fallbackAddress as Address;
  }

  return zeroAddress;
}

const configuredUsdtAddress = import.meta.env.VITE_USDT_ADDRESS;
const deployment = bscDeployment;
const fallbackUsdtAddress = bscDeployment.usdt || BSC_MAINNET_USDT;

export const BSC_USDT_ADDRESS = resolveAddress(configuredUsdtAddress, fallbackUsdtAddress);

const configuredAddress =
  import.meta.env.VITE_CRUDETRUST_CONTRACT_ADDRESS ||
  import.meta.env.VITE_IRONBROTHER_CONTRACT_ADDRESS;

export const IRONBROTHER_CONTRACT_ADDRESS = resolveAddress(
  configuredAddress,
  deployment.ironBrotherProxy,
);

export const isContractConfigured = IRONBROTHER_CONTRACT_ADDRESS !== zeroAddress;
