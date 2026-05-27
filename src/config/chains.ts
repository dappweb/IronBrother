import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, tokenPocketWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { http } from 'wagmi';
import { bscTestnet } from 'wagmi/chains';

export const selectedBscChain = bscTestnet;
export const bscExplorerBaseUrl = 'https://testnet.bscscan.com';
export const bscRpcUrl =
  import.meta.env.VITE_BSC_TESTNET_RPC_URL ||
  import.meta.env.VITE_BSC_RPC_URL ||
  'https://data-seed-prebsc-1-s1.bnbchain.org:8545';

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
    [selectedBscChain.id]: http(bscRpcUrl),
  },
});
