// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract IronBrother is Initializable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    uint256 public constant BPS = 10_000;
    uint8 public constant MAX_GENERATION = 40;
    uint8 public constant DEPOSIT_RECEIVER_COUNT = 5;
    int256 private constant EAST8_TIMEZONE_OFFSET = 8 hours;

    IERC20 public usdt;

    uint256 public minAmount;
    uint256 public maxAmount;
    uint256 public maxPrincipal;
    uint256 public lockPeriod;
    uint256 public yieldBps;
    uint256 public minYieldBps;
    uint256 public maxYieldBps;
    uint256 public withdrawFee;
    uint256 public validVolumeThreshold;

    int256 public timezoneOffset;
    uint32 public morningStart;
    uint32 public morningEnd;
    uint32 public afternoonStart;
    uint32 public afternoonEnd;

    address public feeReceiver;
    uint256 public nextPrincipalOrderId;
    uint256 public nextStakeOrderId;
    uint256 public totalUsers;
    uint256 public totalDepositedAmount;
    uint256 public totalPrincipalBalance;
    uint256 public totalPrincipalStaked;
    uint256 public totalRewardBalance;
    uint256 public totalStakedVolume;
    uint256 public totalStaticRewardCredited;
    uint256 public totalDynamicRewardCredited;
    uint256 public totalWithdrawnAmount;
    uint256 private _reentrancyStatus;

    enum PrincipalSource {
        Deposit,
        Reinvest
    }

    enum PrincipalStatus {
        Locked,
        Redeemed
    }

    enum WithdrawalStatus {
        Pending,
        Paid,
        Rejected
    }

    struct UserAccount {
        address referrer;
        uint256 principalBalance;
        uint256 principalStaked;
        uint256 rewardBalance;
        uint256 totalDeposited;
        uint256 totalStaked;
        uint256 totalStaticReward;
        uint256 totalDynamicReward;
        uint256 totalWithdrawn;
        uint256 directCount;
        bool registered;
        bool whitelist40;
    }

    struct PrincipalOrder {
        uint256 id;
        address user;
        uint256 amount;
        uint256 createdAt;
        uint256 unlockAt;
        PrincipalSource source;
        PrincipalStatus status;
    }

    struct StakeOrder {
        uint256 id;
        address user;
        uint256 amount;
        uint256 rewardBps;
        uint256 reward;
        uint256 day;
        uint8 session;
        uint256 createdAt;
        uint256 settleAt;
        bool settled;
    }

    struct WithdrawalRequest {
        uint256 id;
        address user;
        uint256 amount;
        uint256 fee;
        uint256 netAmount;
        uint256 requestedAt;
        uint256 processedAt;
        WithdrawalStatus status;
        address operator;
        address payer;
    }

    mapping(address => UserAccount) public users;
    mapping(uint256 => PrincipalOrder) public principalOrders;
    mapping(uint256 => StakeOrder) public stakeOrders;
    mapping(address => uint256[]) private userPrincipalOrderIds;
    mapping(address => uint256[]) private userStakeOrderIds;
    mapping(address => address[]) private directReferrals;

    mapping(address => mapping(uint256 => mapping(uint8 => bool))) public stakedInSession;
    mapping(address => mapping(uint256 => uint256)) public dailyStakeVolume;
    mapping(address => mapping(uint256 => bool)) public isValidOnDay;
    mapping(address => mapping(uint256 => uint256)) public dailyDirectValidCount;
    mapping(address => mapping(uint256 => bool)) public dynamicRewardSettled;
    mapping(uint8 => uint16) public generationRateBps;
    address public defaultReferrer;
    address[DEPOSIT_RECEIVER_COUNT] private depositReceivers;
    uint8 public nextDepositReceiverIndex;
    uint256 public nextWithdrawalRequestId;
    uint256 public totalPendingWithdrawalAmount;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256[]) private userWithdrawalRequestIds;

    event UserRegistered(address indexed user, address indexed referrer);
    event DefaultReferrerUpdated(address indexed defaultReferrer);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event Deposited(address indexed user, uint256 indexed orderId, uint256 amount);
    event DepositRouted(address indexed user, address indexed receiver, uint8 indexed receiverIndex, uint256 amount);
    event DepositReceiversUpdated(address[DEPOSIT_RECEIVER_COUNT] receivers);
    event PrincipalRedeemed(address indexed user, uint256 indexed orderId, uint256 amount);
    event Reinvested(address indexed user, uint256 indexed orderId, uint256 amount);
    event StakeCreated(
        address indexed user,
        uint256 indexed stakeId,
        uint256 amount,
        uint256 reward,
        uint256 day,
        uint8 session,
        uint256 settleAt
    );
    event StakeSettled(address indexed user, uint256 indexed stakeId, uint256 principal, uint256 reward);
    event DynamicRewardSettled(address indexed source, address indexed upline, uint256 day, uint8 generation, uint256 volume, uint256 reward);
    event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 amount, uint256 fee, uint256 netAmount);
    event WithdrawalApproved(address indexed user, uint256 indexed requestId, address indexed payer, uint256 amount, uint256 fee, uint256 netAmount);
    event WithdrawalRejected(address indexed user, uint256 indexed requestId, address indexed operator, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount);
    event ConfigUpdated(bytes32 indexed key, uint256 value);
    event AddressConfigUpdated(bytes32 indexed key, address value);
    event Whitelist40Updated(address indexed user, bool enabled);

    modifier onlySuperAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "not super admin");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != 2, "reentrant call");
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address usdt_, address owner_, address feeReceiver_) external initializer {
        require(usdt_ != address(0), "usdt required");
        require(owner_ != address(0), "owner required");
        require(feeReceiver_ != address(0), "fee receiver required");

        __AccessControl_init();
        __Pausable_init();

        usdt = IERC20(usdt_);
        feeReceiver = feeReceiver_;
        minAmount = 100 ether;
        maxAmount = 1_000 ether;
        maxPrincipal = 1_000 ether;
        lockPeriod = 30 days;
        yieldBps = 100;
        minYieldBps = 50;
        maxYieldBps = 500;
        withdrawFee = 10 ether;
        validVolumeThreshold = 1_000 ether;
        timezoneOffset = EAST8_TIMEZONE_OFFSET;
        morningStart = 9 hours;
        morningEnd = 12 hours;
        afternoonStart = 14 hours;
        afternoonEnd = 17 hours;
        nextPrincipalOrderId = 1;
        nextStakeOrderId = 1;
        nextWithdrawalRequestId = 1;
        _reentrancyStatus = 1;
        defaultReferrer = owner_;
        _setDepositReceivers([owner_, owner_, owner_, owner_, owner_]);

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MANAGER_ROLE, owner_);

        generationRateBps[1] = 20;
        generationRateBps[2] = 15;
        generationRateBps[3] = 10;
        for (uint8 i = 4; i <= 10; i++) {
            generationRateBps[i] = 5;
        }
        for (uint8 i = 11; i <= MAX_GENERATION; i++) {
            generationRateBps[i] = 2;
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlySuperAdmin {}

    function register(address referrer) external whenNotPaused {
        _register(msg.sender, referrer);
    }

    function setDefaultReferrer(address newDefaultReferrer) external onlySuperAdmin {
        defaultReferrer = newDefaultReferrer;
        emit DefaultReferrerUpdated(newDefaultReferrer);
    }

    function deposit(uint256 amount, address referrer) external nonReentrant whenNotPaused {
        _validateAmount(amount);
        _register(msg.sender, referrer);

        UserAccount storage account = users[msg.sender];
        require(account.principalBalance + amount <= maxPrincipal, "principal cap exceeded");

        (address receiver, uint8 receiverIndex) = _nextDepositReceiver();
        usdt.safeTransferFrom(msg.sender, receiver, amount);

        account.principalBalance += amount;
        account.totalDeposited += amount;
        totalDepositedAmount += amount;
        totalPrincipalBalance += amount;
        uint256 orderId = _createPrincipalOrder(msg.sender, amount, PrincipalSource.Deposit);

        emit Deposited(msg.sender, orderId, amount);
        emit DepositRouted(msg.sender, receiver, receiverIndex, amount);
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        _validateAmount(amount);
        _register(msg.sender, address(0));

        (uint8 session, uint256 settleAt) = currentSession();
        require(session != 0, "staking window closed");

        uint256 day = currentLocalDay();
        require(!stakedInSession[msg.sender][day][session], "session already used");
        require(amount <= availablePrincipal(msg.sender), "insufficient available principal");

        UserAccount storage account = users[msg.sender];
        account.principalStaked += amount;
        account.totalStaked += amount;
        totalPrincipalStaked += amount;
        totalStakedVolume += amount;
        stakedInSession[msg.sender][day][session] = true;

        uint256 previousVolume = dailyStakeVolume[msg.sender][day];
        uint256 newVolume = previousVolume + amount;
        dailyStakeVolume[msg.sender][day] = newVolume;
        if (previousVolume < validVolumeThreshold && newVolume >= validVolumeThreshold) {
            isValidOnDay[msg.sender][day] = true;
            address referrer = account.referrer;
            if (referrer != address(0)) {
                dailyDirectValidCount[referrer][day] += 1;
            }
        }

        uint256 reward = (amount * yieldBps) / BPS;
        uint256 stakeId = nextStakeOrderId++;
        stakeOrders[stakeId] = StakeOrder({
            id: stakeId,
            user: msg.sender,
            amount: amount,
            rewardBps: yieldBps,
            reward: reward,
            day: day,
            session: session,
            createdAt: block.timestamp,
            settleAt: settleAt,
            settled: false
        });
        userStakeOrderIds[msg.sender].push(stakeId);

        emit StakeCreated(msg.sender, stakeId, amount, reward, day, session, settleAt);
    }

    function settleStake(uint256 stakeId) external nonReentrant {
        _settleStake(stakeId);
    }

    function settleStakes(uint256[] calldata stakeIds) external nonReentrant {
        for (uint256 i = 0; i < stakeIds.length; i++) {
            _settleStake(stakeIds[i]);
        }
    }

    function redeemPrincipal(uint256 orderId) external nonReentrant whenNotPaused {
        PrincipalOrder storage order = principalOrders[orderId];
        require(order.user == msg.sender, "not order owner");
        require(order.status == PrincipalStatus.Locked, "order closed");
        require(block.timestamp >= order.unlockAt, "order locked");

        order.status = PrincipalStatus.Redeemed;
        UserAccount storage account = users[msg.sender];
        account.principalBalance -= order.amount;
        account.rewardBalance += order.amount;
        totalPrincipalBalance -= order.amount;
        totalRewardBalance += order.amount;

        emit PrincipalRedeemed(msg.sender, orderId, order.amount);
    }

    function reinvest(uint256 amount) external nonReentrant whenNotPaused {
        _validateAmount(amount);
        UserAccount storage account = users[msg.sender];
        require(account.registered, "not registered");
        require(account.rewardBalance >= amount, "insufficient reward balance");
        require(account.principalBalance + amount <= maxPrincipal, "principal cap exceeded");

        account.rewardBalance -= amount;
        account.principalBalance += amount;
        totalRewardBalance -= amount;
        totalPrincipalBalance += amount;
        uint256 orderId = _createPrincipalOrder(msg.sender, amount, PrincipalSource.Reinvest);

        emit Reinvested(msg.sender, orderId, amount);
    }

    function requestWithdrawRewards(uint256 amount) external nonReentrant whenNotPaused {
        _requestWithdrawal(amount);
    }

    function approveWithdrawal(uint256 requestId) external nonReentrant whenNotPaused onlySuperAdmin {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        require(request.user != address(0), "no withdrawal");
        require(request.status == WithdrawalStatus.Pending, "closed");

        request.status = WithdrawalStatus.Paid;
        request.processedAt = block.timestamp;
        request.operator = msg.sender;
        request.payer = msg.sender;
        totalPendingWithdrawalAmount -= request.amount;

        UserAccount storage account = users[request.user];
        account.totalWithdrawn += request.netAmount;
        totalWithdrawnAmount += request.amount;

        usdt.safeTransferFrom(msg.sender, request.user, request.netAmount);
        if (request.fee > 0) {
            usdt.safeTransferFrom(msg.sender, feeReceiver, request.fee);
        }

        emit WithdrawalApproved(request.user, requestId, msg.sender, request.amount, request.fee, request.netAmount);
    }

    function rejectWithdrawal(uint256 requestId) external nonReentrant whenNotPaused onlySuperAdmin {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        require(request.user != address(0), "no withdrawal");
        require(request.status == WithdrawalStatus.Pending, "closed");

        request.status = WithdrawalStatus.Rejected;
        request.processedAt = block.timestamp;
        request.operator = msg.sender;
        totalPendingWithdrawalAmount -= request.amount;

        UserAccount storage account = users[request.user];
        account.rewardBalance += request.amount;
        totalRewardBalance += request.amount;

        emit WithdrawalRejected(request.user, requestId, msg.sender, request.amount);
    }

    function _requestWithdrawal(uint256 amount) internal {
        UserAccount storage account = users[msg.sender];
        require(account.rewardBalance >= amount, "insufficient reward balance");
        require(amount > withdrawFee, "amount must exceed fee");

        account.rewardBalance -= amount;
        uint256 netAmount = amount - withdrawFee;
        totalRewardBalance -= amount;
        totalPendingWithdrawalAmount += amount;

        uint256 requestId = _nextWithdrawalId();
        withdrawalRequests[requestId] = WithdrawalRequest({
            id: requestId,
            user: msg.sender,
            amount: amount,
            fee: withdrawFee,
            netAmount: netAmount,
            requestedAt: block.timestamp,
            processedAt: 0,
            status: WithdrawalStatus.Pending,
            operator: address(0),
            payer: address(0)
        });
        userWithdrawalRequestIds[msg.sender].push(requestId);

        emit WithdrawalRequested(msg.sender, requestId, amount, withdrawFee, netAmount);
    }

    function fundRewards(uint256 amount) external nonReentrant {
        require(amount > 0, "amount required");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsFunded(msg.sender, amount);
    }

    function settleDynamicRewardForUser(address user, uint256 day) external nonReentrant {
        _settleDynamicRewardForUser(user, day);
    }

    function settleDynamicRewardForUsers(address[] calldata userList, uint256 day) external nonReentrant {
        for (uint256 i = 0; i < userList.length; i++) {
            _settleDynamicRewardForUser(userList[i], day);
        }
    }

    function availablePrincipal(address user) public view returns (uint256) {
        UserAccount storage account = users[user];
        uint256 blocked = account.principalStaked + maturedUnredeemedPrincipal(user);
        if (account.principalBalance <= blocked) {
            return 0;
        }
        return account.principalBalance - blocked;
    }

    function maturedUnredeemedPrincipal(address user) public view returns (uint256 total) {
        uint256[] storage orderIds = userPrincipalOrderIds[user];
        for (uint256 i = 0; i < orderIds.length; i++) {
            PrincipalOrder storage order = principalOrders[orderIds[i]];
            if (order.status == PrincipalStatus.Locked && block.timestamp >= order.unlockAt) {
                total += order.amount;
            }
        }
    }

    function currentSession() public view returns (uint8 session, uint256 settleAt) {
        uint256 localSecond = _localSecondOfDay(block.timestamp);
        uint256 day = currentLocalDay();
        uint256 dayStartUtc = _localDayStartUtc(day);

        if (localSecond >= morningStart && localSecond < morningEnd) {
            return (1, dayStartUtc + morningEnd);
        }
        if (localSecond >= afternoonStart && localSecond < afternoonEnd) {
            return (2, dayStartUtc + afternoonEnd);
        }
        return (0, 0);
    }

    function currentLocalDay() public view returns (uint256) {
        return _localDay(block.timestamp);
    }

    function eligibleGeneration(address user, uint256 day) public view returns (uint8) {
        if (users[user].whitelist40) {
            return MAX_GENERATION;
        }

        uint256 directValid = dailyDirectValidCount[user][day];
        if (directValid == 0) {
            return 0;
        }
        if (directValid == 1) {
            return 1;
        }
        if (directValid == 2) {
            return 2;
        }
        if (directValid == 3) {
            return 3;
        }
        if (directValid < 11) {
            return 10;
        }
        if (directValid >= MAX_GENERATION) {
            return MAX_GENERATION;
        }
        return uint8(directValid);
    }

    function getUserPrincipalOrderIds(address user) external view returns (uint256[] memory) {
        return userPrincipalOrderIds[user];
    }

    function getUserStakeOrderIds(address user) external view returns (uint256[] memory) {
        return userStakeOrderIds[user];
    }

    function getUserWithdrawalRequestIds(address user) external view returns (uint256[] memory) {
        return userWithdrawalRequestIds[user];
    }

    function getDirectReferrals(address user) external view returns (address[] memory) {
        return directReferrals[user];
    }

    function getDepositReceivers() external view returns (address[DEPOSIT_RECEIVER_COUNT] memory) {
        return depositReceivers;
    }

    function setAdmin(address account, bool enabled) external onlySuperAdmin {
        require(account != address(0), "account required");
        if (enabled) {
            _grantRole(DEFAULT_ADMIN_ROLE, account);
            _grantRole(MANAGER_ROLE, account);
        } else {
            require(account != msg.sender, "cannot remove self");
            _revokeRole(DEFAULT_ADMIN_ROLE, account);
            _revokeRole(MANAGER_ROLE, account);
        }
    }

    function transferOwner(address newOwner) external onlySuperAdmin {
        require(newOwner != address(0), "owner required");
        require(newOwner != msg.sender, "owner unchanged");

        _grantRole(DEFAULT_ADMIN_ROLE, newOwner);
        _grantRole(MANAGER_ROLE, newOwner);
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _revokeRole(MANAGER_ROLE, msg.sender);

        if (defaultReferrer == msg.sender) {
            defaultReferrer = newOwner;
            emit DefaultReferrerUpdated(newOwner);
        }

        emit OwnerTransferred(msg.sender, newOwner);
    }

    function setManager(address account, bool enabled) external onlySuperAdmin {
        require(account != address(0), "account required");
        if (enabled) {
            _grantRole(MANAGER_ROLE, account);
        } else {
            _revokeRole(MANAGER_ROLE, account);
        }
    }

    function setWhitelist40(address user, bool enabled) external onlySuperAdmin {
        users[user].whitelist40 = enabled;
        emit Whitelist40Updated(user, enabled);
    }

    function setYieldBps(uint256 newYieldBps) external onlySuperAdmin {
        require(newYieldBps >= minYieldBps && newYieldBps <= maxYieldBps, "yield out of range");
        yieldBps = newYieldBps;
        emit ConfigUpdated("YIELD_BPS", newYieldBps);
    }

    function setYieldBounds(uint256 newMinYieldBps, uint256 newMaxYieldBps) external onlySuperAdmin {
        require(newMinYieldBps <= newMaxYieldBps, "invalid bounds");
        require(yieldBps >= newMinYieldBps && yieldBps <= newMaxYieldBps, "current yield outside bounds");
        minYieldBps = newMinYieldBps;
        maxYieldBps = newMaxYieldBps;
        emit ConfigUpdated("MIN_YIELD_BPS", newMinYieldBps);
        emit ConfigUpdated("MAX_YIELD_BPS", newMaxYieldBps);
    }

    function setAmountRules(uint256 newMinAmount, uint256 newMaxAmount, uint256 newMaxPrincipal) external onlySuperAdmin {
        require(newMinAmount > 0, "min required");
        require(newMinAmount <= newMaxAmount, "invalid amount range");
        require(newMaxAmount <= newMaxPrincipal, "max amount over cap");
        minAmount = newMinAmount;
        maxAmount = newMaxAmount;
        maxPrincipal = newMaxPrincipal;
        emit ConfigUpdated("MIN_AMOUNT", newMinAmount);
        emit ConfigUpdated("MAX_AMOUNT", newMaxAmount);
        emit ConfigUpdated("MAX_PRINCIPAL", newMaxPrincipal);
    }

    function setLockPeriod(uint256 newLockPeriod) external onlySuperAdmin {
        require(newLockPeriod >= 1 days, "lock too short");
        lockPeriod = newLockPeriod;
        emit ConfigUpdated("LOCK_PERIOD", newLockPeriod);
    }

    function setWithdrawFee(uint256 newWithdrawFee) external onlySuperAdmin {
        withdrawFee = newWithdrawFee;
        emit ConfigUpdated("WITHDRAW_FEE", newWithdrawFee);
    }

    function setFeeReceiver(address newFeeReceiver) external onlySuperAdmin {
        require(newFeeReceiver != address(0), "fee receiver required");
        feeReceiver = newFeeReceiver;
        emit AddressConfigUpdated("FEE_RECEIVER", newFeeReceiver);
    }

    function setDepositReceivers(address[DEPOSIT_RECEIVER_COUNT] calldata newDepositReceivers) external onlySuperAdmin {
        _setDepositReceivers(newDepositReceivers);
    }

    function setValidVolumeThreshold(uint256 newThreshold) external onlySuperAdmin {
        require(newThreshold > 0, "threshold required");
        validVolumeThreshold = newThreshold;
        emit ConfigUpdated("VALID_VOLUME_THRESHOLD", newThreshold);
    }

    function setSessionTimes(uint32 newMorningStart, uint32 newMorningEnd, uint32 newAfternoonStart, uint32 newAfternoonEnd) external onlySuperAdmin {
        require(newMorningStart < newMorningEnd, "invalid morning");
        require(newMorningEnd <= newAfternoonStart, "sessions overlap");
        require(newAfternoonStart < newAfternoonEnd, "invalid afternoon");
        require(newAfternoonEnd <= 1 days, "invalid day");

        morningStart = newMorningStart;
        morningEnd = newMorningEnd;
        afternoonStart = newAfternoonStart;
        afternoonEnd = newAfternoonEnd;

        emit ConfigUpdated("MORNING_START", newMorningStart);
        emit ConfigUpdated("MORNING_END", newMorningEnd);
        emit ConfigUpdated("AFTERNOON_START", newAfternoonStart);
        emit ConfigUpdated("AFTERNOON_END", newAfternoonEnd);
    }

    function setTimezoneOffset(int256 newTimezoneOffset) external onlySuperAdmin {
        require(newTimezoneOffset == EAST8_TIMEZONE_OFFSET, "timezone fixed east8");
        timezoneOffset = EAST8_TIMEZONE_OFFSET;
        emit ConfigUpdated("TIMEZONE_OFFSET", uint256(20 hours));
    }

    function setGenerationRate(uint8 generation, uint16 rateBps) external onlySuperAdmin {
        require(generation >= 1 && generation <= MAX_GENERATION, "invalid generation");
        require(rateBps <= 100, "rate too high");
        generationRateBps[generation] = rateBps;
        emit ConfigUpdated("GENERATION_RATE_BPS", rateBps);
    }

    function pause() external onlySuperAdmin {
        _pause();
    }

    function unpause() external onlySuperAdmin {
        _unpause();
    }

    function _settleStake(uint256 stakeId) internal whenNotPaused {
        StakeOrder storage stakeOrder = stakeOrders[stakeId];
        require(stakeOrder.user != address(0), "stake missing");
        require(!stakeOrder.settled, "stake settled");
        require(block.timestamp >= stakeOrder.settleAt, "settlement pending");

        stakeOrder.settled = true;
        UserAccount storage account = users[stakeOrder.user];
        account.principalStaked -= stakeOrder.amount;
        account.rewardBalance += stakeOrder.reward;
        account.totalStaticReward += stakeOrder.reward;
        totalPrincipalStaked -= stakeOrder.amount;
        totalRewardBalance += stakeOrder.reward;
        totalStaticRewardCredited += stakeOrder.reward;

        emit StakeSettled(stakeOrder.user, stakeId, stakeOrder.amount, stakeOrder.reward);
    }

    function _settleDynamicRewardForUser(address user, uint256 day) internal whenNotPaused {
        require(day < currentLocalDay(), "day not closed");
        require(!dynamicRewardSettled[user][day], "dynamic settled");

        dynamicRewardSettled[user][day] = true;
        uint256 volume = dailyStakeVolume[user][day];
        if (volume < validVolumeThreshold) {
            return;
        }

        address upline = users[user].referrer;
        for (uint8 generation = 1; generation <= MAX_GENERATION && upline != address(0); generation++) {
            if (eligibleGeneration(upline, day) >= generation) {
                uint256 reward = (volume * generationRateBps[generation]) / BPS;
                if (reward > 0) {
                    users[upline].rewardBalance += reward;
                    users[upline].totalDynamicReward += reward;
                    totalRewardBalance += reward;
                    totalDynamicRewardCredited += reward;
                    emit DynamicRewardSettled(user, upline, day, generation, volume, reward);
                }
            }
            upline = users[upline].referrer;
        }
    }

    function _register(address user, address referrer) internal {
        UserAccount storage account = users[user];
        address resolvedReferrer = _resolveReferrer(user, referrer);
        if (account.registered) {
            if (account.referrer == address(0) && resolvedReferrer != address(0)) {
                _bindReferrer(user, resolvedReferrer);
            }
            return;
        }

        if (resolvedReferrer != address(0)) {
            _bindReferrer(user, resolvedReferrer);
        }

        account.registered = true;
        totalUsers += 1;
        emit UserRegistered(user, resolvedReferrer);
    }

    function _resolveReferrer(address user, address referrer) internal view returns (address) {
        if (referrer != address(0)) {
            return referrer;
        }
        if (defaultReferrer != address(0) && defaultReferrer != user) {
            return defaultReferrer;
        }
        return address(0);
    }

    function _bindReferrer(address user, address referrer) internal {
        require(referrer != user, "self referrer");
        UserAccount storage account = users[user];

        if (!users[referrer].registered) {
            users[referrer].registered = true;
            totalUsers += 1;
            emit UserRegistered(referrer, address(0));
        }

        account.referrer = referrer;
        directReferrals[referrer].push(user);
        users[referrer].directCount += 1;
    }

    function _setDepositReceivers(address[DEPOSIT_RECEIVER_COUNT] memory newDepositReceivers) internal {
        for (uint8 i = 0; i < DEPOSIT_RECEIVER_COUNT; i++) {
            require(newDepositReceivers[i] != address(0), "receiver required");
            depositReceivers[i] = newDepositReceivers[i];
        }
        if (nextDepositReceiverIndex >= DEPOSIT_RECEIVER_COUNT) {
            nextDepositReceiverIndex = 0;
        }
        emit DepositReceiversUpdated(newDepositReceivers);
    }

    function _nextDepositReceiver() internal returns (address receiver, uint8 receiverIndex) {
        receiverIndex = nextDepositReceiverIndex;
        receiver = depositReceivers[receiverIndex];
        require(receiver != address(0), "receiver missing");
        nextDepositReceiverIndex = uint8((uint256(receiverIndex) + 1) % DEPOSIT_RECEIVER_COUNT);
    }

    function _nextWithdrawalId() internal returns (uint256 requestId) {
        if (nextWithdrawalRequestId == 0) {
            nextWithdrawalRequestId = 1;
        }
        requestId = nextWithdrawalRequestId++;
    }

    function _validateAmount(uint256 amount) internal view {
        require(amount >= minAmount, "amount too low");
        require(amount <= maxAmount, "amount too high");
        require(amount % 1e16 == 0, "max two decimals");
    }

    function _createPrincipalOrder(address user, uint256 amount, PrincipalSource source) internal returns (uint256 orderId) {
        orderId = nextPrincipalOrderId++;
        principalOrders[orderId] = PrincipalOrder({
            id: orderId,
            user: user,
            amount: amount,
            createdAt: block.timestamp,
            unlockAt: block.timestamp + lockPeriod,
            source: source,
            status: PrincipalStatus.Locked
        });
        userPrincipalOrderIds[user].push(orderId);
    }

    function _localDay(uint256 timestamp) internal pure returns (uint256) {
        int256 adjusted = int256(timestamp) + EAST8_TIMEZONE_OFFSET;
        require(adjusted >= 0, "invalid adjusted time");
        return uint256(adjusted) / 1 days;
    }

    function _localSecondOfDay(uint256 timestamp) internal pure returns (uint256) {
        int256 adjusted = int256(timestamp) + EAST8_TIMEZONE_OFFSET;
        require(adjusted >= 0, "invalid adjusted time");
        return uint256(adjusted) % 1 days;
    }

    function _localDayStartUtc(uint256 day) internal pure returns (uint256) {
        int256 timestamp = int256(day * 1 days) - EAST8_TIMEZONE_OFFSET;
        require(timestamp >= 0, "invalid day start");
        return uint256(timestamp);
    }
}
