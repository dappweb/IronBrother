from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.colors import HexColor


OUT_DIR = Path(__file__).resolve().parent
PDF = OUT_DIR / "IronBrother_Contract_Audit_Report_2026-05-19.pdf"
FONT_PATH = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
FONT = "NotoSansSC"

pdfmetrics.registerFont(TTFont(FONT, FONT_PATH))

BLUE = HexColor("#2E74B5")
DARK = HexColor("#1F4D78")
MUTED = HexColor("#666666")
LIGHT_BLUE = HexColor("#E8EEF5")
LIGHT_GRAY = HexColor("#F2F4F7")
GRID = HexColor("#B7C4D6")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CNTitle", fontName=FONT, fontSize=23, leading=29, textColor=colors.black, spaceAfter=6))
styles.add(ParagraphStyle(name="CNSubtitle", fontName=FONT, fontSize=12.5, leading=16, textColor=MUTED, spaceAfter=16))
styles.add(ParagraphStyle(name="CNH1", fontName=FONT, fontSize=15.5, leading=20, textColor=BLUE, spaceBefore=14, spaceAfter=8))
styles.add(ParagraphStyle(name="CNH2", fontName=FONT, fontSize=12.5, leading=16, textColor=BLUE, spaceBefore=10, spaceAfter=5))
styles.add(ParagraphStyle(name="CNBody", fontName=FONT, fontSize=10.1, leading=14.2, textColor=colors.black, spaceAfter=6, alignment=TA_LEFT, wordWrap="CJK"))
styles.add(ParagraphStyle(name="CNBodySmall", fontName=FONT, fontSize=8.5, leading=11.5, textColor=colors.black, spaceAfter=3, wordWrap="CJK"))
styles.add(ParagraphStyle(name="CNTable", fontName=FONT, fontSize=7.5, leading=10.5, textColor=colors.black, wordWrap="CJK"))
styles.add(ParagraphStyle(name="CNTableHead", fontName=FONT, fontSize=7.8, leading=10.5, textColor=colors.black, wordWrap="CJK"))
styles.add(ParagraphStyle(name="CNCalloutTitle", fontName=FONT, fontSize=10.2, leading=13, textColor=DARK, spaceAfter=4, wordWrap="CJK"))


def esc(text):
    s = str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"(0x[a-fA-F0-9]{12})([a-fA-F0-9]{12})([a-fA-F0-9]+)", r"\1\2<br/>\3", s)
    return s


def p(text, style="CNBody"):
    return Paragraph(esc(text), styles[style])


def heading(text, level=1):
    return Paragraph(esc(text), styles["CNH1" if level == 1 else "CNH2"])


def bullet(text):
    style = ParagraphStyle(
        name="BulletTmp",
        parent=styles["CNBody"],
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=4,
        wordWrap="CJK",
    )
    return Paragraph("• " + esc(text), style)


def make_table(headers, rows, widths, header_fill=LIGHT_BLUE):
    data = [[Paragraph(esc(h), styles["CNTableHead"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(esc(c), styles["CNTable"]) for c in row])
    table = Table(data, colWidths=[w * inch for w in widths], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), header_fill),
                ("GRID", (0, 0), (-1, -1), 0.45, GRID),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def callout(title, body, fill=HexColor("#EAF3F8")):
    table = Table(
        [[Paragraph(esc(title), styles["CNCalloutTitle"]), Paragraph(esc(body), styles["CNBodySmall"])]],
        colWidths=[1.35 * inch, 5.0 * inch],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.5, HexColor("#D9E2F3")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(72, 36, "IronBrother 合约审计报告 | BSC Mainnet")
    canvas.drawRightString(letter[0] - 72, 36, f"Page {doc.page}")
    canvas.restoreState()


story = [
    p("合约安全审计报告", "CNTitle"),
    p("IronBrother / CrudeTrust - BSC Mainnet 合约快照", "CNSubtitle"),
    HRFlowable(width="100%", thickness=1.2, color=BLUE, spaceAfter=10),
]

story += [
    make_table(
        ["项目", "内容"],
        [
            ("审计日期", "2026-05-19 / Asia/Shanghai"),
            ("审计范围", "contracts/IronBrother.sol；BSC Mainnet proxy 与关键运行配置"),
            ("主网 Proxy", "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3"),
            ("链上实现地址", "0x7dd8bc3bA3Be923dD73c5DF1D2F2cF6961bd4ED6"),
            ("USDT", "0x55d398326f99059fF775485246999027B3197955"),
            ("验证区块", "99,196,722"),
        ],
        [1.4, 5.1],
        LIGHT_GRAY,
    ),
    Spacer(1, 10),
    callout(
        "结论摘要",
        "未发现普通用户可直接盗取合约 USDT 的简单重入或任意转账漏洞；但存在 4 个需要优先处理的合约级风险：主网实现地址与仓库部署记录不一致、自动提现模式下奖励池余额为 0、推荐关系可形成环并影响动态奖励、Super Admin 权限过于集中。",
    ),
    Spacer(1, 8),
]

story += [
    heading("1. 审计方法与限制"),
    p("本报告基于本地源码静态审查、Hardhat 编译与合约专项测试、BSC Mainnet 只读链上查询形成。未进行私钥验证、未执行主网写交易、未部署新实现、未修改合约代码。"),
]
for item in [
    "静态范围：contracts/IronBrother.sol 的资金、权限、升级、注册推荐、收益结算与提现路径。",
    "动态验证：读取主网 proxy、ERC1967 implementation slot、关键配置、角色、合约 USDT 余额与账面奖励余额。",
    "工具限制：本机未安装 Slither，因此未纳入 Slither 自动扫描结果；报告以人工审计和 Hardhat 测试为准。",
]:
    story.append(bullet(item))

story += [
    heading("2. 主网运行快照"),
    make_table(
        ["字段", "当前值"],
        [
            ("Proxy", "0x25cCc567C5a72Bb164d0e75969ff6141a7d735E3"),
            ("Implementation (live slot)", "0x7dd8bc3bA3Be923dD73c5DF1D2F2cF6961bd4ED6"),
            ("Implementation (deployments/bsc.json)", "0x9a7B05b3e8C9F41BAaec9b8a1Af94d7440246ba4"),
            ("withdrawalApprovalRequired", "false - 新提现由合约奖励池自动打款"),
            ("合约 USDT 余额", "0.0 USDT"),
            ("totalRewardBalance", "181.005 USDT"),
            ("totalPendingWithdrawalAmount", "0.0 USDT"),
            ("totalUsers", "39"),
            ("totalDepositedAmount", "20,600.4 USDT"),
            ("totalWithdrawnAmount", "0.0 USDT"),
        ],
        [2.0, 4.5],
    ),
    p("注：上述主网数据来自 2026-05-19 读取的 BSC Mainnet 区块 99,196,722。", "CNBodySmall"),
]

story += [
    heading("3. 发现汇总"),
    make_table(
        ["编号", "等级", "问题", "影响面", "建议"],
        [
            ("IB-01", "High", "仓库部署记录与主网 implementation 不一致", "升级/运维真实性", "立即核对升级来源并更新部署元数据"),
            ("IB-02", "High", "自动提现模式下合约 USDT 余额为 0", "用户提现可用性", "充值奖励池或临时开启审批模式"),
            ("IB-03", "High", "推荐关系可形成环，动态奖励可能重复经过同一地址", "奖励完整性", "增加推荐链环检测并迁移异常关系"),
            ("IB-04", "Medium-High", "Super Admin 权限覆盖升级、资金提取和参数修改", "权限/治理", "迁移多签或拆分权限"),
            ("IB-05", "Medium", "withdrawContractFunds 可提走所有奖励池余额", "偿付能力", "限制只可提盈余"),
            ("IB-06", "Low-Medium", "未来 day 也可能被视为动态奖励已关闭", "逻辑严谨性", "改为仅允许 day < currentDay"),
        ],
        [0.55, 0.8, 2.0, 1.15, 2.0],
    ),
    PageBreak(),
    heading("4. 详细发现"),
]

details = [
    (
        "IB-01 - 主网 implementation 与仓库部署记录不一致",
        "High。链上 ERC1967 implementation slot 返回 0x7dd8bc3bA3Be923dD73c5DF1D2F2cF6961bd4ED6，但 deployments/bsc.json 和 .openzeppelin/bsc.json 仍记录 0x9a7B05b3e8C9F41BAaec9b8a1Af94d7440246ba4。风险：无法仅凭仓库部署文件确认当前主网运行代码是否与本地源码一致；后续升级、回滚和事故排查会出现证据断层。建议：立即从 BscScan 或编译产物验证 0x7dd8... 的源码/字节码；补齐升级交易、implementation、manifest 与部署 JSON；把“读取 implementation slot + 字节码比对”设为每次上线后验收项。",
    ),
    (
        "IB-02 - 自动提现模式下奖励池余额不足",
        "High。合约当前 withdrawalApprovalRequired=false，requestWithdrawRewards 会要求 usdt.balanceOf(address(this)) >= amount，然后由合约直接 safeTransfer 给用户。主网合约 USDT 余额为 0.0，但 totalRewardBalance 为 181.005。风险：用户账面奖励可见但无法自动提现，交易会 revert 为 insufficient payout balance。建议：短期向合约奖励池充值至少覆盖 totalRewardBalance；如果不能立即补足，临时 setWithdrawalApprovalRequired(true)，让 Admin 审批出币；中期增加偿付率监控。",
    ),
    (
        "IB-03 - 推荐关系可形成环",
        "High。_bindReferrer() 只禁止 referrer == user；如果 A 先把 B 自动注册为无上级账号，B 后续仍可绑定 A 为上级，形成 A <-> B。动态奖励结算最多沿 referrer 链走 40 代，环会让同一地址在一次结算中被重复访问。风险：奖励分配可能偏离真实层级；在双方有效代数足够时，可重复向环内地址累计动态奖励。建议：绑定推荐人时向上遍历 referrer 链，发现 newReferrer 的上级链包含 user 时 revert；同时输出现有链上关系巡检脚本，定位已经形成的环。",
    ),
    (
        "IB-04 - Super Admin 权限高度集中",
        "Medium-High。DEFAULT_ADMIN_ROLE 能升级 UUPS 实现、设置 Admin/Manager、修改收款地址、改提现模式、改收益和有效门槛、暂停/恢复合约，并可 withdrawContractFunds 提走合约 USDT。风险：单私钥泄露或误操作即可改变资金路径和核心业务规则。当前 0xAC25...1bD8 同时拥有 Admin 与 Manager。建议：将 DEFAULT_ADMIN_ROLE 迁移到多签；将升级、资金提取、运营结算、参数调整拆成独立角色；高风险操作增加 timelock 或二次确认。",
    ),
    (
        "IB-05 - 管理员可提走全部奖励池余额",
        "Medium。withdrawContractFunds 只检查合约 USDT 余额，不检查用户账面奖励负债 totalRewardBalance。即使自动提现依赖奖励池，也可以由 Super Admin 提走全部余额。风险：奖励池被提空后，用户提现重新失败；账面奖励和实际可兑付余额脱钩。建议：增加可提取上限：availableSurplus = usdt.balanceOf(address(this)) - totalRewardBalance - totalPendingWithdrawalAmount；或者只允许在审批模式/暂停状态下提取。",
    ),
    (
        "IB-06 - 动态奖励关闭日判断不严谨",
        "Low-Medium。_isDynamicRewardDayClosed(day) 返回 day < currentDay || day > currentDay * 2，未来很远的 day 会被视为已关闭。当前实际影响有限，因为未来 day 通常没有 dailyStakeVolume。建议：将条件收敛为 day < currentDay；如需兼容测试周期，测试网通过专门配置或脚本处理，不应让主网逻辑接受未来日。",
    ),
]
for title, body in details:
    story += [heading(title, 2), p(body)]

story += [heading("5. 未发现的高危模式")]
for item in [
    "普通用户不能直接调用 withdrawContractFunds；该路径受 onlySuperAdmin 限制。",
    "主要资金转账路径使用 SafeERC20，提现、充值、提取均带 nonReentrant。",
    "UUPS 升级入口 _authorizeUpgrade 受 onlySuperAdmin 限制；没有公开任意 delegatecall。",
    "静态收益 settleStake 以订单 settled 标记防止重复结算；动态奖励以 dynamicRewardSettled[user][day] 防止同一 source/day 重复结算。",
]:
    story.append(bullet(item))

story += [
    heading("6. 建议修复顺序"),
    make_table(
        ["顺序", "时限", "动作"],
        [
            ("1", "立即", "确认主网 implementation 0x7dd8... 的源码/字节码，补齐部署记录。"),
            ("2", "立即", "解决提现偿付：充值奖励池或开启审批模式。"),
            ("3", "短期", "增加推荐关系环检测，并巡检主网已存在关系。"),
            ("4", "短期", "限制 withdrawContractFunds 只能提盈余。"),
            ("5", "中期", "把 Super Admin 迁移到多签/时间锁，并拆分资金与运营权限。"),
            ("6", "中期", "修正 _isDynamicRewardDayClosed 条件并补充单元测试。"),
        ],
        [0.55, 0.8, 5.15],
    ),
    heading("7. 验证记录"),
    make_table(
        ["检查项", "结果", "说明"],
        [
            ("npx hardhat compile", "通过", "Nothing to compile"),
            ("npx hardhat test test\\IronBrother.test.cjs test\\dynamicRewards.test.cjs", "通过", "23 passing"),
            ("主网配置读取", "通过", "区块 99,196,722；读取 proxy、implementation、角色、余额、关键参数"),
            ("Slither", "未执行", "本机未安装 slither 命令"),
        ],
        [2.0, 0.9, 3.6],
        LIGHT_GRAY,
    ),
    PageBreak(),
    heading("附录 A - 关键源码证据"),
    make_table(
        ["证据", "位置", "含义"],
        [
            ("UUPS 升级授权", "contracts/IronBrother.sol:247", "_authorizeUpgrade(address newImplementation) internal override onlySuperAdmin"),
            ("充值收款轮转", "contracts/IronBrother.sol:265-266", "deposit 直接 safeTransferFrom 到 depositReceivers，不进入合约余额"),
            ("审批提现", "contracts/IronBrother.sol:376-396", "Admin 审批时从 msg.sender safeTransferFrom 给用户和 feeReceiver"),
            ("自动提现", "contracts/IronBrother.sol:423-456", "关闭审批时从合约余额 safeTransfer 给用户"),
            ("奖励池充值", "contracts/IronBrother.sol:462-465", "fundRewards 从调用者转 USDT 到合约"),
            ("管理员提走资金", "contracts/IronBrother.sol:468-474", "onlySuperAdmin 可提走合约 USDT"),
            ("推荐绑定", "contracts/IronBrother.sol:892-905", "_bindReferrer 仅禁止 self referrer，未检测环"),
            ("动态奖励结算", "contracts/IronBrother.sol:833-843", "沿 referrer 链按 eligibleGeneration 计奖"),
            ("关闭日判断", "contracts/IronBrother.sol:975-977", "day < currentDay || day > currentDay * 2"),
        ],
        [1.45, 1.8, 3.25],
    ),
    Spacer(1, 8),
    p("本报告为指定代码与链上快照下的安全审计结论，不等同于完整形式化验证或法律保证。后续任何合约升级、参数变更、角色变更、部署文件更新都会改变风险状态。", "CNBodySmall"),
]

doc = SimpleDocTemplate(
    str(PDF),
    pagesize=letter,
    rightMargin=72,
    leftMargin=72,
    topMargin=72,
    bottomMargin=60,
    title="IronBrother Contract Audit Report",
)
doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
print(PDF)
