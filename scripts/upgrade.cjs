const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function parseDepositReceivers(value, fallback) {
  const receivers = value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const resolved = receivers.length > 0 ? receivers : [fallback, fallback, fallback, fallback, fallback];
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

async function main() {
  const proxyAddress = process.env.IRONBROTHER_PROXY;
  if (!proxyAddress || !hre.ethers.isAddress(proxyAddress)) {
    throw new Error("Set IRONBROTHER_PROXY to the deployed proxy address");
  }

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, IronBrother);
  await upgraded.waitForDeployment();

  const [deployer] = await hre.ethers.getSigners();
  const defaultReferrer = process.env.DEFAULT_REFERRER || deployer.address;
  if (!hre.ethers.isAddress(defaultReferrer)) {
    throw new Error("DEFAULT_REFERRER must be a valid address");
  }
  const depositReceivers = parseDepositReceivers(process.env.DEPOSIT_RECEIVERS, deployer.address);
  const currentDefaultReferrer = await upgraded.defaultReferrer();
  if (currentDefaultReferrer.toLowerCase() !== defaultReferrer.toLowerCase()) {
    const tx = await upgraded.setDefaultReferrer(defaultReferrer);
    await tx.wait();
  }
  const receiverTx = await upgraded.setDepositReceivers(depositReceivers);
  await receiverTx.wait();

  const registeredUsers = parseAddressList(process.env.REGISTERED_USERS, "registered user");
  for (let start = 0; start < registeredUsers.length; start += 100) {
    const batch = registeredUsers.slice(start, start + 100);
    const tx = await upgraded.syncRegisteredUsers(batch);
    await tx.wait();
  }

  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  const deploymentPath = path.join(__dirname, "..", "deployments", "bsc.json");
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    fs.writeFileSync(
      deploymentPath,
      JSON.stringify(
        {
          ...deployment,
          network: "bsc",
          chainId: 56,
          upgradedAt: new Date().toISOString(),
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
  console.log("Deployment file:", path.join("deployments", "bsc.json"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
