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

async function setNextCycleSecond(cycleSeconds, second) {
  const latest = await ethers.provider.getBlock("latest");
  const now = latest.timestamp;
  const offset = 8 * 60 * 60;
  const cycleStart = Math.floor((now + offset) / cycleSeconds) * cycleSeconds - offset;
  const target = cycleStart + second;
  await network.provider.send("evm_setNextBlockTimestamp", [target > now ? target : target + cycleSeconds]);
  await network.provider.send("evm_mine");
}

describe("IronBrother", function () {
  async function deployFixture() {
    const [
      owner,
      alice,
      bob,
      carol,
      dave,
      erin,
      feeReceiver,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
      receiver5,
    ] = await ethers.getSigners();

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

    const depositReceivers = [receiver1, receiver2, receiver3, receiver4, receiver5];
    await ironBrother.setDepositReceivers(depositReceivers.map((account) => account.address));

    for (const account of [alice, bob, carol, dave, erin, owner]) {
      await usdt.mint(account.address, U("10000"));
      await usdt.connect(account).approve(await ironBrother.getAddress(), U("10000"));
    }

    return { owner, alice, bob, carol, dave, erin, feeReceiver, depositReceivers, usdt, ironBrother };
  }

  it("creates a principal order on deposit", async function () {
    const { owner, alice, depositReceivers, usdt, ironBrother } = await deployFixture();

    await expect(ironBrother.connect(alice).deposit(U("200"), ethers.ZeroAddress))
      .to.emit(ironBrother, "Deposited")
      .withArgs(alice.address, 1, U("200"));

    const account = await ironBrother.users(alice.address);
    expect(account.principalBalance).to.equal(U("200"));
    expect(account.referrer).to.equal(owner.address);
    expect(await ironBrother.availablePrincipal(alice.address)).to.equal(U("200"));
    expect(await usdt.balanceOf(depositReceivers[0].address)).to.equal(U("200"));
    expect(await usdt.balanceOf(await ironBrother.getAddress())).to.equal(0);
  });

  it("defaults the minimum deposit amount to 0.1 USDT", async function () {
    const { alice, depositReceivers, usdt, ironBrother } = await deployFixture();

    expect(await ironBrother.minAmount()).to.equal(U("0.1"));
    await expect(ironBrother.connect(alice).deposit(U("0.09"), ethers.ZeroAddress)).to.be.revertedWith("amount too low");
    await expect(ironBrother.connect(alice).deposit(U("0.1"), ethers.ZeroAddress))
      .to.emit(ironBrother, "Deposited")
      .withArgs(alice.address, 1, U("0.1"));

    expect(await usdt.balanceOf(depositReceivers[0].address)).to.equal(U("0.1"));
  });

  it("routes deposits across the five configured receiver wallets", async function () {
    const { alice, bob, carol, dave, erin, depositReceivers, usdt, ironBrother } = await deployFixture();

    for (const account of [alice, bob, carol, dave, erin]) {
      await ironBrother.connect(account).deposit(U("100"), ethers.ZeroAddress);
    }

    for (const receiver of depositReceivers) {
      expect(await usdt.balanceOf(receiver.address)).to.equal(U("100"));
    }

    await ironBrother.connect(alice).deposit(U("100"), ethers.ZeroAddress);
    expect(await usdt.balanceOf(depositReceivers[0].address)).to.equal(U("200"));
  });

  it("lets the super admin manage the default referrer", async function () {
    const { owner, alice, bob, carol, ironBrother } = await deployFixture();

    expect(await ironBrother.defaultReferrer()).to.equal(owner.address);
    await expect(ironBrother.connect(alice).setDefaultReferrer(bob.address)).to.be.revertedWith("not super admin");
    await expect(ironBrother.setDefaultReferrer(bob.address))
      .to.emit(ironBrother, "DefaultReferrerUpdated")
      .withArgs(bob.address);

    await ironBrother.connect(alice).deposit(U("200"), carol.address);
    const account = await ironBrother.users(alice.address);
    expect(account.referrer).to.equal(carol.address);
    expect((await ironBrother.users(bob.address)).directCount).to.equal(0);
  });

  it("indexes registered users for admin reads", async function () {
    const { owner, alice, bob, carol, ironBrother } = await deployFixture();

    await ironBrother.connect(alice).deposit(U("200"), ethers.ZeroAddress);
    await ironBrother.connect(bob).deposit(U("300"), alice.address);

    expect(await ironBrother.getAllUsers()).to.deep.equal([owner.address, alice.address, bob.address]);

    const aliceAccount = await ironBrother.users(alice.address);
    const bobAccount = await ironBrother.users(bob.address);
    expect(aliceAccount.totalDeposited).to.equal(U("200"));
    expect(aliceAccount.directCount).to.equal(1);
    expect(bobAccount.referrer).to.equal(alice.address);

    await ironBrother.syncRegisteredUsers([owner.address, alice.address]);
    expect(await ironBrother.getAllUsers()).to.deep.equal([owner.address, alice.address, bob.address]);
    await expect(ironBrother.syncRegisteredUsers([carol.address])).to.be.revertedWith("not registered");
  });

  it("transfers owner permissions and default referrer to a new owner", async function () {
    const { owner, alice, ironBrother } = await deployFixture();
    const adminRole = await ironBrother.DEFAULT_ADMIN_ROLE();
    const managerRole = await ironBrother.MANAGER_ROLE();

    await expect(ironBrother.connect(alice).transferOwner(owner.address)).to.be.revertedWith("not super admin");
    await expect(ironBrother.transferOwner(ethers.ZeroAddress)).to.be.revertedWith("owner required");
    await expect(ironBrother.transferOwner(owner.address)).to.be.revertedWith("owner unchanged");

    await expect(ironBrother.transferOwner(alice.address))
      .to.emit(ironBrother, "OwnerTransferred")
      .withArgs(owner.address, alice.address);

    expect(await ironBrother.hasRole(adminRole, alice.address)).to.equal(true);
    expect(await ironBrother.hasRole(managerRole, alice.address)).to.equal(true);
    expect(await ironBrother.hasRole(adminRole, owner.address)).to.equal(false);
    expect(await ironBrother.hasRole(managerRole, owner.address)).to.equal(false);
    expect(await ironBrother.defaultReferrer()).to.equal(alice.address);

    await expect(ironBrother.setYieldBps(200)).to.be.revertedWith("not super admin");
    await expect(ironBrother.connect(alice).setYieldBps(200)).to.emit(ironBrother, "ConfigUpdated");
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

  it("uses east-eight session windows and lets admin update morning and afternoon ranges", async function () {
    const { ironBrother } = await deployFixture();

    expect(await ironBrother.settlementCycle()).to.equal(BigInt(DAY));
    expect(await ironBrother.timezoneOffset()).to.equal(8n * 60n * 60n);

    await setNextLocalHour(8);
    expect((await ironBrother.currentSession())[0]).to.equal(0);

    await setNextLocalHour(10);
    expect((await ironBrother.currentSession())[0]).to.equal(1);

    await ironBrother.setSessionTimes(8 * 60 * 60, 10 * 60 * 60, 18 * 60 * 60, 20 * 60 * 60);

    await setNextLocalHour(10);
    expect((await ironBrother.currentSession())[0]).to.equal(0);

    await setNextLocalHour(8);
    expect((await ironBrother.currentSession())[0]).to.equal(1);

    await setNextLocalHour(19);
    expect((await ironBrother.currentSession())[0]).to.equal(2);

    await expect(ironBrother.setTimezoneOffset(7 * 60 * 60)).to.be.revertedWith("timezone fixed east8");
    await expect(ironBrother.setTimezoneOffset(8 * 60 * 60)).to.emit(ironBrother, "ConfigUpdated");
  });

  it("can shorten the settlement cycle for dynamic reward testing", async function () {
    const { alice, bob, ironBrother } = await deployFixture();

    await expect(ironBrother.setSettlementCycle(120)).to.emit(ironBrother, "ConfigUpdated");
    await ironBrother.setSessionTimes(0, 60, 60, 120);

    await ironBrother.connect(bob).deposit(U("1000"), alice.address);
    await setNextCycleSecond(120, 10);
    const day = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("1000"));

    expect(await ironBrother.dailyStakeVolume(bob.address, day)).to.equal(U("1000"));
    expect(await ironBrother.dailyDirectValidCount(alice.address, day)).to.equal(1n);
    await expect(ironBrother.settleDynamicRewardForUser(bob.address, day)).to.be.revertedWith("day not closed");

    await setNextCycleSecond(120, 10);
    expect(await ironBrother.currentLocalDay()).to.be.greaterThan(day);

    await expect(ironBrother.botSettleDailyDynamicRewards(day, 0, 100))
      .to.emit(ironBrother, "DynamicRewardSettled")
      .withArgs(bob.address, alice.address, day, 1, U("1000"), U("2"));

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("2"));
    expect(account.totalDynamicReward).to.equal(U("2"));
    expect(await ironBrother.totalDynamicRewardCredited()).to.equal(U("2"));
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

    const history = await ironBrother.getDynamicRewardHistory(alice.address);
    expect(history).to.have.lengthOf(1);
    expect(history[0].source).to.equal(bob.address);
    expect(history[0].day).to.equal(day);
    expect(history[0].generation).to.equal(1n);
    expect(history[0].volume).to.equal(U("1000"));
    expect(history[0].reward).to.equal(U("2"));
  });

  it("settles dynamic rewards for all staked volume within the eligible generation", async function () {
    const { alice, bob, carol, ironBrother } = await deployFixture();

    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    await ironBrother.connect(bob).deposit(U("1000"), alice.address);
    await ironBrother.connect(carol).deposit(U("100"), alice.address);

    await setNextLocalHour(10);
    const day = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("1000"));
    await ironBrother.connect(carol).stake(U("100"));

    expect(await ironBrother.eligibleGeneration(alice.address, day)).to.equal(1n);
    expect(await ironBrother.isValidOnDay(carol.address, day)).to.equal(false);

    await setNextLocalHour(10);
    await ironBrother.settleDynamicRewardForUser(carol.address, day);

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("0.2"));
  });

  it("sets eligible generations equal to the daily direct valid count", async function () {
    const { alice, bob, carol, dave, erin, ironBrother } = await deployFixture();
    const directs = [bob, carol, dave, erin];

    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    for (const direct of directs) {
      await ironBrother.connect(direct).deposit(U("1000"), alice.address);
    }

    await setNextLocalHour(10);
    const day = await ironBrother.currentLocalDay();
    for (const direct of directs) {
      await ironBrother.connect(direct).stake(U("1000"));
    }

    expect(await ironBrother.dailyDirectValidCount(alice.address, day)).to.equal(4n);
    expect(await ironBrother.eligibleGeneration(alice.address, day)).to.equal(4n);

    await ironBrother.setWhitelist40(alice.address, true);
    expect(await ironBrother.eligibleGeneration(alice.address, day)).to.equal(40n);
  });

  it("settles dynamic rewards across multiple closed cycles in one transaction", async function () {
    const { alice, bob, ironBrother } = await deployFixture();

    await ironBrother.setSettlementCycle(120);
    await ironBrother.setSessionTimes(0, 60, 60, 120);
    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    await ironBrother.connect(bob).deposit(U("1000"), alice.address);

    await setNextCycleSecond(120, 10);
    const firstDay = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("1000"));

    await setNextCycleSecond(120, 10);
    await ironBrother.settleStake(1);
    const secondDay = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("1000"));

    await setNextCycleSecond(120, 10);
    const preview = await ironBrother.settleDynamicRewardForSourceDays.staticCall(
      [bob.address, bob.address],
      [firstDay, secondDay],
    );
    expect(preview[0]).to.equal(2n);
    expect(preview[1]).to.equal(2n);
    expect(preview[2]).to.equal(U("4"));

    await ironBrother.settleDynamicRewardForSourceDays([bob.address, bob.address], [firstDay, secondDay]);

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("4"));
    expect(await ironBrother.dynamicRewardSettled(bob.address, firstDay)).to.equal(true);
    expect(await ironBrother.dynamicRewardSettled(bob.address, secondDay)).to.equal(true);

    const history = await ironBrother.getDynamicRewardHistory(alice.address);
    expect(history).to.have.lengthOf(2);
    expect(history[0].source).to.equal(bob.address);
    expect(history[0].day).to.equal(firstDay);
    expect(history[0].reward).to.equal(U("2"));
    expect(history[1].source).to.equal(bob.address);
    expect(history[1].day).to.equal(secondDay);
    expect(history[1].reward).to.equal(U("2"));
  });

  it("lets a manager bot settle the previous local day in indexed batches", async function () {
    const { owner, alice, bob, ironBrother } = await deployFixture();

    await ironBrother.setDefaultReferrer(ethers.ZeroAddress);
    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    await ironBrother.connect(bob).deposit(U("1000"), alice.address);

    await setNextLocalHour(10);
    const day = await ironBrother.currentLocalDay();
    await ironBrother.connect(bob).stake(U("400"));

    await setNextLocalHour(15);
    await ironBrother.connect(bob).stake(U("600"));

    await setNextLocalHour(10);
    const preview = await ironBrother.botSettleDailyDynamicRewards.staticCall(day, 0, 100);
    expect(preview[0]).to.equal(2n);
    expect(preview[1]).to.equal(1n);
    expect(preview[2]).to.equal(U("2"));
    expect(preview[3]).to.equal(2n);
    expect(preview[4]).to.equal(true);

    await expect(ironBrother.botSettleDailyDynamicRewards(day, 0, 100))
      .to.emit(ironBrother, "DynamicRewardBotSettled")
      .withArgs(owner.address, day, 0n, 2n, 1n, U("2"), 2n, true);

    const account = await ironBrother.users(alice.address);
    expect(account.rewardBalance).to.equal(U("2"));
    expect(await ironBrother.dynamicRewardSettled(alice.address, day)).to.equal(true);
    expect(await ironBrother.dynamicRewardSettled(bob.address, day)).to.equal(true);

    const history = await ironBrother.getDynamicRewardHistory(alice.address);
    expect(history).to.have.lengthOf(1);
    expect(history[0].source).to.equal(bob.address);
    expect(history[0].reward).to.equal(U("2"));
  });

  it("allows a registered user without referrer to bind one later", async function () {
    const { alice, bob, carol, ironBrother } = await deployFixture();

    await ironBrother.setDefaultReferrer(ethers.ZeroAddress);
    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    expect((await ironBrother.users(alice.address)).referrer).to.equal(ethers.ZeroAddress);

    await ironBrother.setDefaultReferrer(bob.address);
    await ironBrother.connect(alice).register(ethers.ZeroAddress);
    expect((await ironBrother.users(alice.address)).referrer).to.equal(bob.address);
    expect((await ironBrother.users(bob.address)).directCount).to.equal(1);
    expect(await ironBrother.getDirectReferrals(bob.address)).to.deep.equal([alice.address]);

    await ironBrother.connect(alice).register(carol.address);
    expect((await ironBrother.users(alice.address)).referrer).to.equal(bob.address);
    expect((await ironBrother.users(carol.address)).directCount).to.equal(0);
  });

  it("requires admin approval to pay a reward withdrawal with fee", async function () {
    const { owner, alice, feeReceiver, usdt, ironBrother } = await deployFixture();

    expect(await ironBrother.withdrawalApprovalRequired()).to.equal(true);
    await ironBrother.setYieldBps(500);
    await ironBrother.connect(alice).deposit(U("1000"), ethers.ZeroAddress);
    await setNextLocalHour(10);
    await ironBrother.connect(alice).stake(U("1000"));
    await setNextLocalHour(12);
    await ironBrother.settleStake(1);

    await expect(ironBrother.connect(alice).requestWithdrawRewards(U("50")))
      .to.emit(ironBrother, "WithdrawalRequested")
      .withArgs(alice.address, 1, U("50"), U("10"), U("40"));

    expect((await ironBrother.users(alice.address)).rewardBalance).to.equal(0);
    expect(await ironBrother.totalPendingWithdrawalAmount()).to.equal(U("50"));

    await expect(ironBrother.approveWithdrawal(1))
      .to.emit(ironBrother, "WithdrawalApproved")
      .withArgs(alice.address, 1, owner.address, U("50"), U("10"), U("40"));

    expect(await usdt.balanceOf(feeReceiver.address)).to.equal(U("10"));
    expect(await usdt.balanceOf(alice.address)).to.equal(U("9040"));
    expect(await ironBrother.totalPendingWithdrawalAmount()).to.equal(0);
    expect((await ironBrother.withdrawalRequests(1)).status).to.equal(1);
  });

  it("can disable withdrawal approval and pay from the contract reward pool", async function () {
    const { alice, feeReceiver, usdt, ironBrother } = await deployFixture();

    await ironBrother.setYieldBps(500);
    await ironBrother.connect(alice).deposit(U("1000"), ethers.ZeroAddress);
    await setNextLocalHour(10);
    await ironBrother.connect(alice).stake(U("1000"));
    await setNextLocalHour(12);
    await ironBrother.settleStake(1);

    await expect(ironBrother.setWithdrawalApprovalRequired(false)).to.emit(ironBrother, "ConfigUpdated");
    expect(await ironBrother.withdrawalApprovalRequired()).to.equal(false);
    await expect(ironBrother.connect(alice).requestWithdrawRewards(U("50"))).to.be.revertedWith("insufficient payout balance");

    await ironBrother.fundRewards(U("50"));
    const contractAddress = await ironBrother.getAddress();
    const withdrawal = await ironBrother.connect(alice).requestWithdrawRewards(U("50"));
    await expect(withdrawal)
      .to.emit(ironBrother, "WithdrawalRequested")
      .withArgs(alice.address, 1, U("50"), U("10"), U("40"));
    await expect(withdrawal)
      .to.emit(ironBrother, "WithdrawalApproved")
      .withArgs(alice.address, 1, contractAddress, U("50"), U("10"), U("40"));

    const request = await ironBrother.withdrawalRequests(1);
    expect(request.status).to.equal(1);
    expect(request.payer).to.equal(contractAddress);
    expect(await ironBrother.totalPendingWithdrawalAmount()).to.equal(0);
    expect(await usdt.balanceOf(contractAddress)).to.equal(0);
    expect(await usdt.balanceOf(feeReceiver.address)).to.equal(U("10"));
    expect(await usdt.balanceOf(alice.address)).to.equal(U("9040"));
  });

  it("lets only the super admin withdraw USDT held by the contract", async function () {
    const { owner, alice, bob, usdt, ironBrother } = await deployFixture();
    const contractAddress = await ironBrother.getAddress();

    await ironBrother.fundRewards(U("100"));
    expect(await usdt.balanceOf(contractAddress)).to.equal(U("100"));

    await expect(ironBrother.connect(alice).withdrawContractFunds(bob.address, U("10"))).to.be.revertedWith("not super admin");
    await expect(ironBrother.withdrawContractFunds(ethers.ZeroAddress, U("10"))).to.be.revertedWith("receiver required");
    await expect(ironBrother.withdrawContractFunds(bob.address, 0)).to.be.revertedWith("amount required");
    await expect(ironBrother.withdrawContractFunds(bob.address, U("101"))).to.be.revertedWith("insufficient contract balance");

    await expect(ironBrother.withdrawContractFunds(bob.address, U("60")))
      .to.emit(ironBrother, "ContractFundsWithdrawn")
      .withArgs(owner.address, bob.address, U("60"));

    expect(await usdt.balanceOf(contractAddress)).to.equal(U("40"));
    expect(await usdt.balanceOf(bob.address)).to.equal(U("10060"));
  });
});
