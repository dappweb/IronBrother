import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { bscTestnet } from 'wagmi/chains';

export const bscRpcUrl =
  import.meta.env.VITE_BSC_TESTNET_RPC_URL ||
  import.meta.env.VITE_BSC_RPC_URL ||
  'https://data-seed-prebsc-1-s1.bnbchain.org:8545';

export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'ironbrother-local-dev';

export const wagmiConfig = getDefaultConfig({
  appName: 'IronBrother',
  projectId: walletConnectProjectId,
  chains: [bscTestnet],
  ssr: false,
  transports: {
    [bscTestnet.id]: http(bscRpcUrl),
  },
});
