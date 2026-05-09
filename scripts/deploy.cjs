const hre = require("hardhat");

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

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
  const [deployer] = await hre.ethers.getSigners();
  const feeReceiver = process.env.FEE_RECEIVER || deployer.address;
  const defaultReferrer = process.env.DEFAULT_REFERRER || deployer.address;
  const depositReceivers = parseDepositReceivers(process.env.DEPOSIT_RECEIVERS, deployer.address);
  if (!hre.ethers.isAddress(defaultReferrer)) {
    throw new Error("DEFAULT_REFERRER must be a valid address");
  }

  console.log("Deploying IronBrother with account:", deployer.address);
  console.log("USDT:", BSC_USDT);
  console.log("Fee receiver:", feeReceiver);
  console.log("Default referrer:", defaultReferrer);
  console.log("Deposit receivers:", depositReceivers.join(", "));

  const IronBrother = await hre.ethers.getContractFactory("IronBrother");
  const ironBrother = await hre.upgrades.deployProxy(
    IronBrother,
    [BSC_USDT, deployer.address, feeReceiver],
    { kind: "uups", initializer: "initialize" }
  );
  await ironBrother.waitForDeployment();

  if (defaultReferrer.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await ironBrother.setDefaultReferrer(defaultReferrer);
    await tx.wait();
  }
  const receiverTx = await ironBrother.setDepositReceivers(depositReceivers);
  await receiverTx.wait();

  const address = await ironBrother.getAddress();
  const implementation = await hre.upgrades.erc1967.getImplementationAddress(address);
  console.log("IronBrother proxy deployed to:", address);
  console.log("IronBrother implementation:", implementation);
  console.log("Default referrer:", await ironBrother.defaultReferrer());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
