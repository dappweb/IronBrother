const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function parseEnv(relativePath) {
  return Object.fromEntries(
    read(relativePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const equalsIndex = line.indexOf('=');
        return [line.slice(0, equalsIndex), line.slice(equalsIndex + 1)];
      }),
  );
}

describe('main branch chain target', function () {
  it('targets BSC mainnet across app config, env files, and deployment defaults', function () {
    const chainsConfig = read('src/config/chains.ts');
    const contractsConfig = read('src/config/contracts.ts');
    const viteEnvTypes = read('src/vite-env.d.ts');
    const deployment = JSON.parse(read('deployments/bsc.json'));
    const expectedRpc = 'https://bsc-dataseed.bnbchain.org';
    const expectedUsdt = '0x55d398326f99059fF775485246999027B3197955';
    const expectedProxy = '0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3';

    assert.match(chainsConfig, /import \{ bsc \} from 'wagmi\/chains';/);
    assert.doesNotMatch(chainsConfig, /bscTestnet/);
    assert.match(chainsConfig, /selectedBscChain = bsc/);
    assert.match(chainsConfig, /https:\/\/bscscan\.com/);
    assert.doesNotMatch(chainsConfig, /VITE_BSC_TESTNET_RPC_URL/);
    assert.match(chainsConfig, /https:\/\/bsc-dataseed\.bnbchain\.org/);

    assert.match(contractsConfig, /deployments\/bsc\.json/);
    assert.doesNotMatch(contractsConfig, /deployments\/bsc-testnet\.json/);

    assert.equal(deployment.network, 'bsc');
    assert.equal(deployment.chainId, 56);
    assert.equal(deployment.usdt, expectedUsdt);
    assert.equal(deployment.ironBrotherProxy, expectedProxy);

    for (const envPath of ['.env.example', '.env.production', '.env.test']) {
      const env = parseEnv(envPath);
      assert.equal(env.VITE_CHAIN_ID, '56', `${envPath} chain id`);
      assert.equal(env.VITE_BSC_TESTNET_RPC_URL, undefined, `${envPath} must not set testnet rpc`);
      assert.equal(env.VITE_BSC_RPC_URL, expectedRpc, `${envPath} rpc`);
      assert.equal(env.VITE_USDT_ADDRESS, expectedUsdt, `${envPath} usdt`);
      assert.equal(env.VITE_IRONBROTHER_CONTRACT_ADDRESS, expectedProxy, `${envPath} proxy`);
    }

    assert.doesNotMatch(viteEnvTypes, /VITE_BSC_TESTNET_RPC_URL/);
  });
});
