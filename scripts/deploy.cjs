const hre = require("hardhat");

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const feeReceiver = process.env.FEE_RECEIVER || deployer.address;

  console.log("Deploying IronBrother with account:", deployer.address);
  console.log("USDT:", BSC_USDT);
  console.log("Fee receiver:", feeReceiver);

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const ironBrother = await hre.upgrades.deployProxy(
    IronBrother,
    [BSC_USDT, deployer.address, feeReceiver],
    { kind: "uups", initializer: "initialize" }
  );
  await ironBrother.waitForDeployment();

  const address = await ironBrother.getAddress();
  const implementation = await hre.upgrades.erc1967.getImplementationAddress(address);
  console.log("IronBrother proxy deployed to:", address);
  console.log("IronBrother implementation:", implementation);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
