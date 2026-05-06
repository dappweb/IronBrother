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

async function main() {
  const proxyAddress = process.env.IRONBROTHER_PROXY;
  if (!proxyAddress) {
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

  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("IronBrother proxy upgraded:", proxyAddress);
  console.log("New implementation:", implementation);
  console.log("Default referrer:", await upgraded.defaultReferrer());
  console.log("Deposit receivers:", (await upgraded.getDepositReceivers()).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
