require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("./scripts/load-env.cjs");

const BSC_RPC_URL = process.env.BSC_RPC_URL || "";
const BSC_TESTNET_RPC_URL =
  process.env.BSC_TESTNET_RPC_URL ||
  process.env.VITE_BSC_TESTNET_RPC_URL ||
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "shanghai",
      optimizer: {
        enabled: true,
        runs: 1
      },
      metadata: {
        bytecodeHash: "none"
      },
      viaIR: true
    }
  },
  networks: {
    bsc: {
      url: BSC_RPC_URL,
      chainId: 56,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    },
    bscTestnet: {
      url: BSC_TESTNET_RPC_URL,
      chainId: 97,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
