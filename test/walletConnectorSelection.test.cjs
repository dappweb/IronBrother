const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadWalletConnectorModule() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'walletConnector.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });
  const moduleShim = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(require, moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const { selectDirectWalletConnector } = loadWalletConnectorModule();

const selected = selectDirectWalletConnector([
  { id: 'walletConnect', name: 'WalletConnect', type: 'walletConnect' },
  { id: 'metaMask', name: 'MetaMask', type: 'metaMask' },
  { id: 'injected', name: 'Browser Wallet', type: 'injected' },
]);

assert.equal(selected?.id, 'injected');

const tokenPocketSelected = selectDirectWalletConnector([
  { id: 'walletConnect', name: 'WalletConnect', type: 'walletConnect' },
  { id: 'injected', name: 'Browser Wallet', type: 'injected' },
  { id: 'tokenPocket', name: 'TokenPocket', type: 'injected' },
]);

assert.equal(tokenPocketSelected?.id, 'tokenPocket');
