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

describe('test branch chain target', function () {
  it('targets BSC Testnet across app config, env files, and deployment defaults', function () {
    const chainsConfig = read('src/config/chains.ts');
    const contractsConfig = read('src/config/contracts.ts');
    const viteEnvTypes = read('src/vite-env.d.ts');
    const deployment = JSON.parse(read('deployments/bsc-testnet.json'));
    const expectedRpc = 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
    const expectedUsdt = '0xacD944e910952c020eb129C50921f180c62c3291';
    const expectedProxy = '0x5D8d8Fe47EcA5B2812194e3cD149CAAeb315e72E';

    assert.match(chainsConfig, /import \{ bscTestnet \} from 'wagmi\/chains';/);
    assert.doesNotMatch(chainsConfig, /import \{ bsc \} from 'wagmi\/chains';/);
    assert.match(chainsConfig, /selectedBscChain = bscTestnet/);
    assert.match(chainsConfig, /https:\/\/testnet\.bscscan\.com/);
    assert.match(chainsConfig, /VITE_BSC_TESTNET_RPC_URL/);
    assert.match(chainsConfig, /https:\/\/data-seed-prebsc-1-s1\.bnbchain\.org:8545/);

    assert.match(contractsConfig, /deployments\/bsc-testnet\.json/);
    assert.doesNotMatch(contractsConfig, /deployments\/bsc\.json/);

    assert.equal(deployment.network, 'bscTestnet');
    assert.equal(deployment.chainId, 97);
    assert.equal(deployment.usdt, expectedUsdt);
    assert.equal(deployment.ironBrotherProxy, expectedProxy);

    for (const envPath of ['.env.example', '.env.production', '.env.test']) {
      const env = parseEnv(envPath);
      assert.equal(env.VITE_CHAIN_ID, '97', `${envPath} chain id`);
      assert.equal(env.VITE_BSC_TESTNET_RPC_URL, expectedRpc, `${envPath} testnet rpc`);
      assert.equal(env.VITE_BSC_RPC_URL, expectedRpc, `${envPath} fallback rpc`);
      assert.equal(env.VITE_USDT_ADDRESS, expectedUsdt, `${envPath} usdt`);
      assert.equal(env.VITE_IRONBROTHER_CONTRACT_ADDRESS, expectedProxy, `${envPath} proxy`);
    }

    assert.match(viteEnvTypes, /readonly VITE_BSC_TESTNET_RPC_URL\?: string;/);
  });
});
