const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const EXPECTED_CHAIN_ID = 56n;
const EXPECTED_BATCH_LIMIT = 500n;
const deploymentPath = path.join(__dirname, "..", "deployments", "bsc.json");
const manifestPath = path.join(__dirname, "..", ".openzeppelin", "bsc.json");

function loadDeployment() {
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Missing deployments/bsc.json");
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function resolveProxyAddress(deployment) {
  const proxyAddress = process.env.IRONBROTHER_PROXY || deployment.ironBrotherProxy;
  if (!proxyAddress || !hre.ethers.isAddress(proxyAddress)) {
    throw new Error("Set IRONBROTHER_PROXY or deployments/bsc.json.ironBrotherProxy");
  }
  return proxyAddress;
}

async function assertUpgradeReady(proxyAddress) {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: expected 56, got ${network.chainId}`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer configured. Set PRIVATE_KEY for the super admin account.");
  }

  const contract = await hre.ethers.getContractAt("IronBrother", proxyAddress, deployer);
  const superAdminRole = await contract.DEFAULT_ADMIN_ROLE();
  const isSuperAdmin = await contract.hasRole(superAdminRole, deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const currentLimit = await contract.MAX_BOT_SETTLEMENT_BATCH();
  const implementationBefore = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("Network chainId:", network.chainId.toString());
  console.log("Proxy:", proxyAddress);
  console.log("Signer:", deployer.address);
  console.log("Signer BNB:", hre.ethers.formatEther(balance));
  console.log("Signer is super admin:", isSuperAdmin);
  console.log("Current batch limit:", currentLimit.toString());
  console.log("Current implementation:", implementationBefore);

  if (!isSuperAdmin) {
    throw new Error("Signer does not have DEFAULT_ADMIN_ROLE on the proxy.");
  }
  if (balance === 0n) {
    throw new Error("Signer has no BNB for gas.");
  }

  return { currentLimit, deployer, implementationBefore };
}

async function validateUpgrade(proxyAddress, IronBrother) {
  try {
    await hre.upgrades.validateUpgrade(proxyAddress, IronBrother, { kind: "uups" });
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("is not registered")) {
      throw error;
    }

    console.log("Proxy implementation is missing from the local OpenZeppelin manifest; force importing for layout validation.");
    await hre.upgrades.forceImport(proxyAddress, IronBrother, { kind: "uups" });
    await hre.upgrades.validateUpgrade(proxyAddress, IronBrother, { kind: "uups" });
  }
}

function preferManifestImplementation(implementation) {
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const normalizedImplementation = implementation.toLowerCase();
  for (const entry of Object.values(manifest.impls || {})) {
    const addresses = [entry.address, ...(entry.allAddresses || [])].filter(Boolean);
    const hasImplementation = addresses.some((address) => address.toLowerCase() === normalizedImplementation);
    if (!hasImplementation) continue;

    const allAddresses = new Set(addresses);
    allAddresses.delete(implementation);
    allAddresses.delete(entry.address);
    entry.allAddresses = [entry.address, ...allAddresses].filter(
      (address) => address.toLowerCase() !== normalizedImplementation,
    );
    entry.address = implementation;
    if (entry.allAddresses.length === 0) {
      delete entry.allAddresses;
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
}

async function main() {
  const deployment = loadDeployment();
  const proxyAddress = resolveProxyAddress(deployment);
  const ready = await assertUpgradeReady(proxyAddress);

  if (process.env.DRY_RUN === "true") {
    console.log("Dry run complete. No transaction sent.");
    return;
  }

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  await validateUpgrade(proxyAddress, IronBrother);

  const implementationTx = await hre.upgrades.deployImplementation(IronBrother, {
    kind: "uups",
    redeployImplementation: "always",
    getTxResponse: true,
  });
  const implementationReceipt = await implementationTx.wait();
  const nextImplementation = implementationReceipt.contractAddress;
  if (!nextImplementation || !hre.ethers.isAddress(nextImplementation)) {
    throw new Error("Implementation deployment did not return a contract address.");
  }

  const proxy = await hre.ethers.getContractAt("IronBrother", proxyAddress, ready.deployer);
  const upgradeTx = await proxy.upgradeToAndCall(nextImplementation, "0x");
  await upgradeTx.wait();

  const upgraded = await hre.ethers.getContractAt("IronBrother", proxyAddress, ready.deployer);
  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  if (implementation.toLowerCase() !== nextImplementation.toLowerCase()) {
    throw new Error(`Unexpected implementation after upgrade: ${implementation}`);
  }
  const batchLimit = await upgraded.MAX_BOT_SETTLEMENT_BATCH();
  if (batchLimit !== EXPECTED_BATCH_LIMIT) {
    throw new Error(`Unexpected batch limit after upgrade: ${batchLimit}`);
  }

  preferManifestImplementation(implementation);

  const updatedDeployment = {
    ...deployment,
    network: "bsc",
    chainId: 56,
    upgradedAt: new Date().toISOString(),
    ironBrotherProxy: proxyAddress,
    ironBrotherImplementation: implementation,
    maxBotSettlementBatch: Number(batchLimit),
    upgradeImplementationTxHash: implementationTx.hash,
    upgradeBatchLimitTxHash: upgradeTx.hash,
    proxyKind: "uups",
  };
  fs.writeFileSync(deploymentPath, `${JSON.stringify(updatedDeployment, null, 2)}\n`);

  console.log("IronBrother proxy upgraded:", proxyAddress);
  console.log("Previous implementation:", ready.implementationBefore);
  console.log("New implementation:", implementation);
  console.log("New batch limit:", batchLimit.toString());
  console.log("Implementation transaction:", implementationTx.hash);
  console.log("Upgrade transaction:", upgradeTx.hash);
  console.log("Deployment file:", path.join("deployments", "bsc.json"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
