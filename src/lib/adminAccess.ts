export type AdminAccessStatus =
  | 'allowed'
  | 'checking'
  | 'connect'
  | 'denied'
  | 'switch-network'
  | 'unconfigured';

type AdminAccessInput = {
  isContractConfigured: boolean;
  isConnected: boolean;
  wrongNetwork: boolean;
  isRoleLoading: boolean;
  isSuperAdmin: boolean;
  isManager: boolean;
};

export function resolveAdminAccess({
  isContractConfigured,
  isConnected,
  wrongNetwork,
  isRoleLoading,
  isSuperAdmin,
  isManager,
}: AdminAccessInput): AdminAccessStatus {
  if (!isContractConfigured) return 'unconfigured';
  if (!isConnected) return 'connect';
  if (wrongNetwork) return 'switch-network';
  if (isRoleLoading) return 'checking';
  return isSuperAdmin || isManager ? 'allowed' : 'denied';
}
