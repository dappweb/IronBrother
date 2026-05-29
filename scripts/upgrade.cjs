const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function parseDepositReceivers(value, fallback) {
  const receivers = value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const resolved = receivers.length > 0 ? receivers : fallback;
  if (resolved.length !== 5) {
    throw new Error("DEPOSIT_RECEIVERS must contain exactly 5 comma-separated addresses");
  }
  for (const receiver of resolved) {
    if (!hre.ethers.isAddress(receiver)) {
      throw new Error(`Invalid deposit receiver: ${receiver}`);
    }
  }
  return resolved;
}

function parseAddressList(value, name) {
  const addresses = value
    ? value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)
    : [];
  for (const address of addresses) {
    if (!hre.ethers.isAddress(address)) {
      throw new Error(`Invalid ${name}: ${address}`);
    }
  }
  return addresses;
}

function deploymentFileForNetwork(networkName) {
  if (networkName === "bscTestnet") {
    return {
      fileName: "bsc-testnet.json",
      network: "bscTestnet",
      chainId: 97,
    };
  }

  return {
    fileName: "bsc.json",
    network: "bsc",
    chainId: 56,
  };
}

async function upgradeProxy(proxyAddress, IronBrother) {
  try {
    return await hre.upgrades.upgradeProxy(proxyAddress, IronBrother);
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("is not registered")) {
      throw error;
    }

    console.log("Proxy implementation is missing from the local OpenZeppelin manifest; force importing first.");
    await hre.upgrades.forceImport(proxyAddress, IronBrother, { kind: "uups" });
    return hre.upgrades.upgradeProxy(proxyAddress, IronBrother);
  }
}

async function main() {
  const deploymentTarget = deploymentFileForNetwork(hre.network.name);
  const deploymentPath = path.join(__dirname, "..", "deployments", deploymentTarget.fileName);
  const existingDeployment = fs.existsSync(deploymentPath)
    ? JSON.parse(fs.readFileSync(deploymentPath, "utf8"))
    : {};
  const proxyAddress = process.env.IRONBROTHER_PROXY || existingDeployment.ironBrotherProxy;
  if (!proxyAddress || !hre.ethers.isAddress(proxyAddress)) {
    throw new Error("Set IRONBROTHER_PROXY to the deployed proxy address");
  }

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const upgraded = await upgradeProxy(proxyAddress, IronBrother);
  await upgraded.waitForDeployment();

  const [deployer] = await hre.ethers.getSigners();
  const currentDefaultReferrer = await upgraded.defaultReferrer();
  const defaultReferrer = process.env.DEFAULT_REFERRER || currentDefaultReferrer;
  if (!hre.ethers.isAddress(defaultReferrer)) {
    throw new Error("DEFAULT_REFERRER must be a valid address");
  }
  const currentDepositReceivers = await upgraded.getDepositReceivers();
  const depositReceivers = parseDepositReceivers(process.env.DEPOSIT_RECEIVERS, [...currentDepositReceivers]);
  if (currentDefaultReferrer.toLowerCase() !== defaultReferrer.toLowerCase()) {
    const tx = await upgraded.setDefaultReferrer(defaultReferrer);
    await tx.wait();
  }
  const receiversChanged = currentDepositReceivers.some(
    (receiver, index) => receiver.toLowerCase() !== depositReceivers[index].toLowerCase(),
  );
  if (receiversChanged) {
    const receiverTx = await upgraded.setDepositReceivers(depositReceivers);
    await receiverTx.wait();
  }

  const registeredUsers = parseAddressList(process.env.REGISTERED_USERS, "registered user");
  for (let start = 0; start < registeredUsers.length; start += 100) {
    const batch = registeredUsers.slice(start, start + 100);
    const tx = await upgraded.syncRegisteredUsers(batch);
    await tx.wait();
  }

  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  if (fs.existsSync(deploymentPath)) {
    fs.writeFileSync(
      deploymentPath,
      JSON.stringify(
        {
          ...existingDeployment,
          network: deploymentTarget.network,
          chainId: deploymentTarget.chainId,
          upgradedAt: new Date().toISOString(),
          deployer: deployer.address,
          defaultReferrer,
          depositReceivers,
          ironBrotherProxy: proxyAddress,
          ironBrotherImplementation: implementation,
          proxyKind: "uups",
        },
        null,
        2,
      ),
    );
  }

  console.log("IronBrother proxy upgraded:", proxyAddress);
  console.log("New implementation:", implementation);
  console.log("Default referrer:", await upgraded.defaultReferrer());
  console.log("Deposit receivers:", (await upgraded.getDepositReceivers()).join(", "));
  console.log("Synced registered users:", registeredUsers.length);
  console.log("Deployment file:", path.join("deployments", deploymentTarget.fileName));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
