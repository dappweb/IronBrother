const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const U = ethers.parseEther;
const DAY = 24 * 60 * 60;

async function setNextLocalHour(hour) {
  const latest = await ethers.provider.getBlock("latest");
  const now = latest.timestamp;
  const utcDay = Math.floor((now + 8 * 60 * 60) / DAY);
  const target = utcDay * DAY - 8 * 60 * 60 + hour * 60 * 60;
  await network.provider.send("evm_setNextBlockTimestamp", [target > now ? target : target + DAY]);
  await network.provider.send("evm_mine");
}

describe("IronBrother", function () {
  async function deployFixture() {
    const [owner, alice, bob, carol, feeReceiver] = await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();
    await usdt.waitForDeployment();

    const IronBrother = await ethers.getContractFactory("IronBrother");
    const ironBrother = await upgrades.deployProxy(
      IronBrother,
      [await usdt.getAddress(), owner.address, feeReceiver.address],
      { kind: "uups", initializer: "initialize" }
    );
    await ironBrother.waitForDeployment();

    for (const account of [alice, bob, carol, owner]) {
      await usdt.mint(account.address, U("10000"));
      await usdt.connect(account).approve(await ironBrother.getAddress(), U("10000"));
    }

    return { owner, alice, bob, carol, feeReceiver, usdt, ironBrother };
  }

  it("creates a principal order on deposit", async function () {
    const { alice, ironBrother } = await deployFixture();

    await expect(ironBrother.connect(alice).deposit(U("200"), ethers.ZeroAddress))
      .to.emit(ironBrother, "Deposited")
      .withArgs(alice.address, 1, U("200"));

    const account = await ironBrother.users(alice.address);
    expect(account.principalBalance).to.equal(U("200"));
    expect(await ironBrother.availablePrincipal(alice.address)).to.equal(U("200"));
  });

  it("limits staking to one order per wallet per session and pays static reward", async function () {
    const { alice, ironBrother } = await deployFixture();

    await ironBrother.connect(alice).deposit(U("1000"), ethers.ZeroAddress);
    await setNextLocalHour(10);

    await ironBrother.connect(alice).stake(U("400"));
    await expect(ironBrother.connect(alice).stake(U("100"))).to.be.revertedWith("session already used");

    await setNextLocalHour(12);
    await ironBrother.settleStake(1);

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("4"));
    expect(account.principalStaked).to.equal(0);
  });

  it("moves matured principal to reward wallet on redemption", async function () {
    const { alice, ironBrother } = await deployFixture();

    await ironBrother.connect(alice).deposit(U("200"), ethers.ZeroAddress);
    await network.provider.send("evm_increaseTime", [30 * DAY + 1]);
    await network.provider.send("evm_mine");

    expect(await ironBrother.availablePrincipal(alice.address)).to.equal(0);
    await ironBrother.connect(alice).redeemPrincipal(1);

    const account = await ironBrother.users(alice.address);
    expect(account.principalBalance).to.equal(0);
    expect(account.rewardBalance).to.equal(U("200"));
  });

  it("settles first-generation dynamic reward after local day closes", async function () {
    const { alice, bob, ironBrother } = await deployFixture();

    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    await ironBrother.connect(bob).deposit(U("1000"), alice.address);
    await ironBrother.connect(alice).deposit(U("1000"), ethers.ZeroAddress);

    await setNextLocalHour(10);
    const day = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("400"));

    await setNextLocalHour(15);
    await ironBrother.connect(bob).stake(U("600"));

    await setNextLocalHour(10);
    await ironBrother.settleDynamicRewardForUser(bob.address, day);

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("2"));
  });

  it("allows reward withdrawal with fee", async function () {
    const { alice, feeReceiver, usdt, ironBrother } = await deployFixture();

    await ironBrother.setYieldBps(500);
    await ironBrother.connect(alice).deposit(U("1000"), ethers.ZeroAddress);
    await setNextLocalHour(10);
    await ironBrother.connect(alice).stake(U("1000"));
    await setNextLocalHour(12);
    await ironBrother.settleStake(1);

    await usdt.mint(await ironBrother.getAddress(), U("100"));
    await ironBrother.connect(alice).withdrawRewards(U("50"));

    expect(await usdt.balanceOf(feeReceiver.address)).to.equal(U("10"));
    expect(await usdt.balanceOf(alice.address)).to.equal(U("9040"));
  });
});
