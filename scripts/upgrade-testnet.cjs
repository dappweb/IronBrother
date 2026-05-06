const hre = require("hardhat");

async function main() {
  const proxyAddress = process.env.IRONBROTHER_PROXY;
  if (!proxyAddress) {
    throw new Error("Set IRONBROTHER_PROXY to the deployed proxy address");
  }

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, IronBrother);
  await upgraded.waitForDeployment();

  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("IronBrother proxy upgraded:", proxyAddress);
  console.log("New implementation:", implementation);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
