# SignPath Foundation 申请材料草稿（未提交）

> 用途：维护者（@Evan26Ma）向 SignPath Foundation 申请免费开源代码签名时，可从本文直接照抄。
> 核对日期：2026-09-29。申请入口 <https://signpath.org/apply> 与条款 <https://signpath.org/terms.html> 当日均实测可访问；申请表为 JS 渲染，字段名以实际表单为准。

## 一、申请前先知道的差距（如实评估）

- **声誉是主要变数。** SignPath 条款明确：以他们名义签发的可执行文件要求「可验证声誉」（条款原文表述为 *cannot sign binaries based on source code that nobody knows*；开发者库/组件不要求）。本仓库 2026-09-06 创建，GitHub API 实测 4 stars、全部 Release 资产累计下载 124 次（2026-09-29）。声誉证据偏弱，是最可能被婉拒的原因。若被拒，先积累真实用户与下载量，隔一段时间再申请，不要反复提交。
- **不要求注册组织或 GitHub 组织。** 条款未把申请者限定为法人或组织；单人维护、个人 GitHub 账号持有仓库即可申请。要求是：签名团队就是开发维护该项目的团队（拥有源码仓库），Authors / Reviewers / Approvers 三个角色齐备（可同一人兼任），且 GitHub 与 SignPath 账号均开启多因素认证（MFA）。
- **证书签发给 SignPath Foundation 本身**，不是项目或个人；官网说明不需要个人身份证明，验证方式是确认二进制由公开仓库构建。
- **审核周期官方未公布**，提交后以邮件沟通为准（推断：同类开源项目经验为若干个工作日）。
- **政策页必须先公开。** 申请信息中的下载页面/主页必须能读到 Code signing policy 段落（含指定英文原文 "Free code signing provided by SignPath.io, certificate by SignPath Foundation"）。本仓库 `README.md` 与 `docs/CODE_SIGNING_POLICY.md` 已具备内容，但**当前改动尚未提交推送**；提交申请前必须先把这两页推上 GitHub。
- **签名对象必须是公开 CI 从本仓库源码构建的产物。** 当前桌面版 v1.0.3 用 `npm run package:desktop:windows` 在本机构建，尚无桌面版 GitHub Actions 签名工作流；申请表中如实写「获批后建立」，不要把浏览器版工作流说成现有桌面签名流程。
- **许可范围。** 仓库根目录为 GPL-3.0；仓库内题库数据与第三方素材的授权范围由维护者自行确认，申请时主动说明项目为非官方客户端、题库权利归原权利人。

## 二、申请入口

- 申请表：<https://signpath.org/apply>（用 GitHub 账号登录）。
- 条款（含资格条件与义务）：<https://signpath.org/terms.html>。
- Microsoft 官方文档同样推荐该计划：符合条件的开源项目可获 SignPath Foundation 免费签名（见 Microsoft Learn《Code signing options for Windows app developers》）。

## 三、表单字段草稿（英文照抄，字段名以实际表单为准）

| 字段 | 填写内容 |
|---|---|
| Project Name | `daguan-cxy-local (DaguanMath Desktop)` |
| Repository URL | `https://github.com/Evan26Ma/daguan-cxy-local` |
| Homepage URL | `https://github.com/Evan26Ma/daguan-cxy-local`（无独立官网，仓库首页即主页） |
| Download URL | `https://github.com/Evan26Ma/daguan-cxy-local`（填仓库主页，保证该页可见 Code signing policy 段落；也可填 v1.0.3 Release 页） |
| Privacy Policy URL | `https://github.com/Evan26Ma/daguan-cxy-local/blob/main/docs/CODE_SIGNING_POLICY.md`（含联网与隐私说明一节） |
| License | `GPL-3.0` |
| Build System | `GitHub Actions`（备注：桌面版签名构建为获批后计划；当前已发布版本为本机构建） |
| Maintainer Type | `Independent community project (no formal organization)` |
| Primary Discovery Channel | `Developer platforms (e.g. GitHub)` |
| First Name | `Ningyuan` |
| Last Name | `Ma` |
| Email | `mnyrorschach@gmail.com` |
| Company Name | 留空 |

Tagline：

> A local-first Windows desktop workspace for practicing the Daguan mathematics question bank.

Description：

> DaguanMath Desktop is an independent, local-first Windows application for practicing the Daguan mathematics question bank. It provides progress tracking, annotations, optional synchronization with the Daguan website after explicit user confirmation, and an optional AI tutor configured by the user with their own API credentials. The current public desktop release is v1.0.3, distributed as a Squirrel.Windows installer with a published SHA-256 checksum; it is currently unsigned. The desktop app checks for software and question-bank updates automatically; software updates are downloaded in the background and installed only after user confirmation. Study progress, annotations, and API keys are stored locally. We seek free code signing for future desktop releases built from this public repository on GitHub-hosted Windows runners, with every signing request manually approved by the maintainer. This is an unofficial community client, not affiliated with the official Daguan service; question bank content and related rights belong to their original owners.

Reputation（提交前用 GitHub API 刷新数字；只写可核实的本项目数据）：

> DaguanMath Desktop is a young but actively maintained local-first Windows study application
> for the Daguan mathematics question bank, serving Chinese graduate-entrance-exam (kaoyan)
> students who prefer a distraction-free desktop client.
>
> - The repository was created on 2026-09-06 and has 22 public releases since 2026-09-07,
>   all built and shipped in public: https://github.com/Evan26Ma/daguan-cxy-local/releases
> - The desktop line (v1.0.0–v1.0.3, latest published 2026-09-29) ships with Squirrel
>   update assets and per-asset SHA-256 checksum files; all release assets together show
>   124 downloads on GitHub (checked 2026-09-29 via the GitHub API). Additional distribution
>   to non-technical students runs through a Chinese netdisk mirror whose download counts
>   are visible only to the maintainer and can be provided on request.
> - The app is a companion to the widely used Daguan (大观园) online mathematics question bank
>   and links each question to its matching Bilibili lecture; the surrounding lecture series
>   has millions of cumulative views, which indicates the size of the study community this
>   tool serves (ecosystem evidence, not app user counts).
> - End-user documentation ships in the repository (a zero-experience Windows install guide),
>   an automated Node.js test suite runs on every change, and a code signing policy page
>   (https://github.com/Evan26Ma/daguan-cxy-local/blob/main/docs/CODE_SIGNING_POLICY.md)
>   documents the planned SignPath signing scope and the app's network behavior.
> - The project is early-stage by design (single maintainer); we are applying now because the
>   unsigned installer triggers Windows SmartScreen "unknown publisher" warnings, which is the
>   main friction for non-technical students, and unsigned installers are more likely to be
>   flagged by third-party antivirus products.

勾选框（以实际表单为准）：

- 同意 SignPath Foundation Code of Conduct，并理解证书以 SignPath Foundation 名义签发、违规可被吊销——**必须勾选**；
- 同意 SignPath 存储和处理个人数据——**必须勾选**；
- 接收 SignPath 其他通讯——自选。

## 四、提交前检查清单

- [ ] `README.md` 与 `docs/CODE_SIGNING_POLICY.md`（含联网与隐私说明、误报提交说明）已提交并推送到 GitHub `main`；
- [ ] GitHub 账号已开启 2FA；注册 SignPath 后同样开启 MFA；
- [ ] 用 GitHub API 刷新 stars / 下载数字后替换 Reputation 中的数值；
- [ ] 邮箱 `mnyrorschach@gmail.com` 可正常收信（审核沟通走该邮箱）；
- [ ] 保存申请确认邮件；被拒时记录拒绝理由，作为下次申请或改走备选渠道的依据。

## 五、获批后的工作（详见申请指南）

1. 新建桌面版 GitHub Actions 构建与 SignPath 提交流程，在 SignPath 登记可信工作流与产物元数据规则；
2. 每次发布在 SignPath 控制台人工批准签名请求；
3. 验证 Authenticode 状态与 Squirrel 更新资产后发布新版本，并同步更新百度网盘文件与 SHA-256。

## 六、如果申请被婉拒：备选渠道（仅列已核实事实）

| 渠道 | 核实到的事实（2026-09-29） | 说明 |
|---|---|---|
| [Certum Open Source Code Signing](https://shop.certum.eu/data-safety/open-source-code-signing.html) | 套装（含加密卡与读卡器）€69.00 起；证书主体为自然人，名称带 "Open Source Developer" 前缀；实测页面当日显示缺货，库存随时间变化 | 面向开源开发者的低价 OV 证书，签给个人，可积累 SmartScreen 信誉 |
| [Azure Artifact Signing（原 Trusted Signing）](https://azure.microsoft.com/en-us/pricing/details/trusted-signing/) | 微软托管的付费签名服务，分 Basic / Premium 两档、按月计费并有签名次数配额；定价页本次抓取未显示具体金额，历史公开资料 Basic 档约 $9.99/月（**待确认**） | 需 Azure 订阅；适合愿意付费、追求微软生态信誉的场景 |
| 自签名证书 / Sigstore | 免费 | 不被 Windows 信任链采纳，不能消除 SmartScreen「未知发布者」，不作为替代 |

## 七、相关文档

- 签名状态与政策、误报提交入口：`docs/CODE_SIGNING_POLICY.md`
- 申请与配置流程：`docs/SignPath免费代码签名申请指南.md`
