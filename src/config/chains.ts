import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, tokenPocketWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { fallback, http } from 'wagmi';
import { bsc } from 'wagmi/chains';

export const selectedBscChain = bsc;
export const bscExplorerBaseUrl = 'https://bscscan.com';
const defaultBscRpcUrls = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.bnbchain.org',
  'https://binance.llamarpc.com',
];

function uniqueRpcUrls(urls: (string | undefined)[]) {
  return urls.filter((url): url is string => Boolean(url && url.trim())).filter((url, index, all) => all.indexOf(url) === index);
}

export const bscRpcUrl = import.meta.env.VITE_BSC_RPC_URL || defaultBscRpcUrls[0];
export const bscRpcUrls = uniqueRpcUrls([bscRpcUrl, ...defaultBscRpcUrls]);

export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'crudetrust-local-dev';

export const wagmiConfig = getDefaultConfig({
  appName: 'CrudeTrust',
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
    [selectedBscChain.id]: fallback(bscRpcUrls.map((url) => http(url))),
  },
});
