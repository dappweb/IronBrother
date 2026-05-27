import type { Address } from 'viem';
import { isAddress, zeroAddress } from 'viem';

import bscTestnetDeployment from '../../deployments/bsc-testnet.json';

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
const deployment = bscTestnetDeployment;
const fallbackUsdtAddress = bscTestnetDeployment.usdt;

export const BSC_USDT_ADDRESS = resolveAddress(configuredUsdtAddress, fallbackUsdtAddress);

const configuredAddress =
  import.meta.env.VITE_CRUDETRUST_CONTRACT_ADDRESS ||
  import.meta.env.VITE_IRONBROTHER_CONTRACT_ADDRESS;

export const IRONBROTHER_CONTRACT_ADDRESS = resolveAddress(
  configuredAddress,
  deployment.ironBrotherProxy,
);

export const isContractConfigured = IRONBROTHER_CONTRACT_ADDRESS !== zeroAddress;
