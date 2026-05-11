import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { bsc } from 'wagmi/chains';

export const selectedBscChain = bsc;
export const bscExplorerBaseUrl = 'https://bscscan.com';
export const bscRpcUrl = import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org';

export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'crudetrust-local-dev';

export const wagmiConfig = getDefaultConfig({
  appName: 'CrudeTrust',
  projectId: walletConnectProjectId,
  chains: [selectedBscChain],
  ssr: false,
  transports: {
    [selectedBscChain.id]: http(bscRpcUrl),
  },
});
