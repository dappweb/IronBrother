export type WalletConnectorCandidate = {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
};

type SelectDirectWalletConnectorOptions = {
  readonly hasInjectedProvider?: boolean;
};

type BrowserEthereumWindow = Window & {
  readonly ethereum?: unknown;
};

function isInjectedConnector(connector: WalletConnectorCandidate) {
  return connector.id === 'injected' || connector.type === 'injected';
}

function isTokenPocketConnector(connector: WalletConnectorCandidate) {
  const id = connector.id.toLowerCase();
  const name = connector.name?.toLowerCase() ?? '';
  return id === 'tokenpocket' || name === 'tokenpocket';
}

export function hasInjectedEthereumProvider() {
  return typeof window !== 'undefined' && Boolean((window as BrowserEthereumWindow).ethereum);
}

export function selectDirectWalletConnector<T extends WalletConnectorCandidate>(
  connectors: readonly T[],
  options: SelectDirectWalletConnectorOptions = {},
) {
  const hasInjectedProvider = options.hasInjectedProvider ?? true;
  if (!hasInjectedProvider) return undefined;

  return connectors.find(isTokenPocketConnector) ?? connectors.find(isInjectedConnector);
}
