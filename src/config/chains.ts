import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { bsc, bscTestnet } from 'wagmi/chains';

const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID || '97');

export const selectedBscChain = configuredChainId === bscTestnet.id ? bscTestnet : bsc;
export const isBscTestnet = selectedBscChain.id === bscTestnet.id;
export const bscExplorerBaseUrl = isBscTestnet ? 'https://testnet.bscscan.com' : 'https://bscscan.com';

export const bscRpcUrl = isBscTestnet
  ? import.meta.env.VITE_BSC_TESTNET_RPC_URL ||
    import.meta.env.VITE_BSC_RPC_URL ||
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545'
  : import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org';

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
