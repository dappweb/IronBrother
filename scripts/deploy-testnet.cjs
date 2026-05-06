const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const feeReceiver = process.env.FEE_RECEIVER || deployer.address;

  console.log("Deploying upgradeable IronBrother to BSC Testnet");
  console.log("Deployer:", deployer.address);
  console.log("Fee receiver:", feeReceiver);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer BNB balance:", hre.ethers.formatEther(balance));

  let usdtAddress = process.env.TEST_USDT_ADDRESS;
  if (!usdtAddress) {
    const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
    const mockUSDT = await MockUSDT.deploy();
    await mockUSDT.waitForDeployment();
    usdtAddress = await mockUSDT.getAddress();
    console.log("Mock test USDT deployed:", usdtAddress);
  } else {
    console.log("Using existing test USDT:", usdtAddress);
  }

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const ironBrother = await hre.upgrades.deployProxy(
    IronBrother,
    [usdtAddress, deployer.address, feeReceiver],
    { kind: "uups", initializer: "initialize" }
  );
  await ironBrother.waitForDeployment();

  const proxy = await ironBrother.getAddress();
  const implementation = await hre.upgrades.erc1967.getImplementationAddress(proxy);

  const deployment = {
    network: "bscTestnet",
    chainId: 97,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    feeReceiver,
    usdt: usdtAddress,
    ironBrotherProxy: proxy,
    ironBrotherImplementation: implementation,
    proxyKind: "uups"
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "bsc-testnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("IronBrother proxy deployed:", proxy);
  console.log("IronBrother implementation:", implementation);
  console.log("Deployment file:", path.join("deployments", "bsc-testnet.json"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
