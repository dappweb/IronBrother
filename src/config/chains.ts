import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, tokenPocketWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { fallback, http } from 'wagmi';
import { bsc } from 'wagmi/chains';

export const selectedBscChain = bsc;
export const bscExplorerBaseUrl = 'https://bscscan.com';
const configuredBscRpcUrl = import.meta.env.VITE_BSC_RPC_URL;
export const bscRpcUrls = [
  configuredBscRpcUrl,
  'https://bsc-rpc.publicnode.com',
  'https://binance.llamarpc.com',
  'https://bsc-dataseed.bnbchain.org',
].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index);
export const bscRpcUrl = bscRpcUrls[0];

export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'crudetrust-local-dev';

export const dappBaseUrl = (import.meta.env.VITE_DAPP_BASE_URL || 'https://dapp.crudetrust.net').replace(/\/+$/, '');
export const dappIconUrl = `${dappBaseUrl}/icon-512.png`;

export const wagmiConfig = getDefaultConfig({
  appName: 'CrudeTrust',
  appDescription: 'CrudeTrust DApp',
  appUrl: dappBaseUrl,
  appIcon: dappIconUrl,
  projectId: walletConnectProjectId,
  chains: [selectedBscChain],
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [tokenPocketWallet, injectedWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
  ssr: false,
  transports: {
    [selectedBscChain.id]: fallback(
      bscRpcUrls.map((url) => http(url, { retryCount: 1, timeout: 12_000 })),
      { retryCount: 1 },
    ),
  },
});
