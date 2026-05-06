const hre = require("hardhat");

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
  const currentDefaultReferrer = await upgraded.defaultReferrer();
  if (currentDefaultReferrer.toLowerCase() !== defaultReferrer.toLowerCase()) {
    const tx = await upgraded.setDefaultReferrer(defaultReferrer);
    await tx.wait();
  }

  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("IronBrother proxy upgraded:", proxyAddress);
  console.log("New implementation:", implementation);
  console.log("Default referrer:", await upgraded.defaultReferrer());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
