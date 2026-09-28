# SignPath 免费代码签名申请指南

> 面向维护者（@Evan26Ma）。仓库侧的工作流、元数据脚本与产物配置都已经写好并随代码提交，本文只讲**怎么把证书申请下来、把工作流接上**。

## 一、当前状态

| 项目 | 状态 |
|---|---|
| GPL-3.0 许可证（`LICENSE`） | ✅ 已添加到仓库根目录（与 upstream 一致） |
| 代码签名政策页面（本文件同级的 [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md) + [README 的代码签名政策](../README.md#代码签名政策)） | ✅ 已写好，含 SignPath 要求的两句原文 |
| PE 产品元数据（`ProductName` / `ProductVersion` / `CompanyName`） | ✅ 构建时自动写入，不再残留 “Node.js” |
| 工作流签名步骤（`.github/workflows/windows-release.yml`） | ✅ 已接入，配置为空时自动跳过 |
| SignPath 产物配置（[`packaging/signpath/artifact-configuration.xml`](../packaging/signpath/artifact-configuration.xml)） | ✅ 已写好，等粘贴到控制台 |
| SignPath 组织 / 项目 / API Token / 证书 | ❌ **需要你本人申请**（无法由代码完成） |

申请通过之前，工作流照常构建和发布**未签名**的 EXE，不会报错。

## 二、申请前先自查硬条件

| SignPath 要求 | 本项目 |
|---|---|
| OSI 认可的开源许可证，无商业双许可、无专有组件 | GPL-3.0 ✅（注意：`android/`、`sync-extension/` 亦为 GPL-3.0） |
| 项目已发布、有文档、活跃维护 | 有 Release 与 `docs/` ✅ |
| 只签自己项目、由自己源码构建的产物 | 全部由本仓库 CI (`windows-latest`) 构建 ✅ |
| 所有签名相关 workflow job 必须跑在 GitHub 托管 runner | ✅ 工作流只有 `runs-on: windows-latest` |
| 所有成员开启 MFA，并区分 Authors / Reviewers / Approvers | 需你在 GitHub 账号上确认已开 2FA，并在申请表中声明 ✅ |
| 项目首页有 Code signing policy 段落（含指定原文） | ✅ 已写入 README |
| 产物用元数据限制锁定 product name / version | ✅ `artifact-configuration.xml` |

**⚠️ 最大的变数：可验证声誉（verifiable reputation）。** SignPath 条款明确写着「对可执行文件要求一定的可验证声誉，声誉不足的源码我们签不了」——审核方会看 star 数、下载量、社区活跃度。本仓库 4 star、2026-09-06 才创建，属于最可能被婉拒的情况。另外本项目是**非官方客户端**且转发题库内容，审核方可能在版权口径上追问，申请时建议主动说明：代码是独立的本地学习工作区、题库权利归原权利人、不替代官网（README 已有一致的表述可引用）。

## 三、申请步骤

1. 打开 <https://signpath.org/apply>（免费开源计划入口），用 GitHub 账号登录。
2. 填写**组织**（Organization）与**项目**（Project）信息：
   - Repository：`https://github.com/Evan26Ma/daguan-cxy-local`
   - License：`GPL-3.0`
   - 项目主页与 Code signing policy：填仓库首页，政策段落在 `README.md#代码签名政策`，完整政策在 `docs/CODE_SIGNING_POLICY.md`
   - 构建方式：GitHub Actions（GitHub-hosted runner），产物由本仓库源码构建
3. 在 **Team** 里把自己同时放到 Authors / Reviewers / Approvers 三个角色（单人开源项目是允许的），并确认已开启 2FA。
4. 提交后等待人工审核（通常几个工作日）。若被以“声誉不足”婉拒，可先积累 star 与正式 Release，或在第七节里选备选方案。

## 四、申请表逐项填写参考（可直接复制）

申请表在 <https://signpath.org/apply>，是 HubSpot 托管的英文表单。字段与下拉选项如下（实测抓取），**审核方按英文阅读，全部用英文填写**。

### 文本字段

| 字段 | 建议填法 |
|---|---|
| **Project Name*** | `daguan-cxy-local (DaguanMath)`（提示要求「Google 搜这个名字能明确找到你的项目」，用仓库名最稳） |
| **Repository URL*** | `https://github.com/Evan26Ma/daguan-cxy-local` |
| **Homepage URL*** | `https://github.com/Evan26Ma/daguan-cxy-local`（没有独立官网时，仓库首页即官方主页） |
| **Download URL** | `https://github.com/Evan26Ma/daguan-cxy-local` ⚠️ **要求这个页面必须提到项目使用 SignPath Foundation 签名**——所以 README 里的代码签名政策段落**必须先 push 到 GitHub** 再提交申请，否则必被拒 |
| **Privacy Policy URL** | `https://github.com/Evan26Ma/daguan-cxy-local/blob/main/docs/CODE_SIGNING_POLICY.md`（该文件含 SignPath 要求的隐私声明原文） |
| **Wikipedia URL (optional)** | 留空 |
| **Tagline*** | `A local-first Windows desktop workspace for practicing the Daguan mathematics question bank.` |
| **Description*** | `DaguanMath is a local-first desktop application for Windows that makes the Daguan mathematics question bank easier to practice continuously. Users download a single executable from GitHub Releases, run it, and the question bank opens in their local browser, with progress, annotations and AI settings stored on their own machine. An optional AI tutor can be connected via any OpenAI-compatible API, and progress can optionally be synced to the Daguan website after explicit confirmation. The project is an independent community client, not affiliated with the official Daguan service; question bank content and related rights belong to their original owners. Binaries (EXE and ZIP) are built by GitHub Actions from this public repository and are distributed free of charge.` |
| **Reputation*** | 见下方「声誉字段怎么写」 |
| **First Name*** / **Last Name*** | 你的真实姓名（会用这个在 SignPath 建账号；中文名可写拼音，避免编码问题） |
| **Email*** | 你能正常收信的邮箱，审核与后续沟通都走这里 |
| **Company Name** | 留空 |
| **Please specify the exact source (optional)** | `GitHub search` 或留空 |

### 下拉字段（选项已实测）

| 字段 | 选什么 |
|---|---|
| **Maintainer Type** | `Independent community project (no formal organization)`（单选：另有 Non-profit foundation / For-profit company / Individual maintainer(s) / Other） |
| **Build System*** | `GitHub Actions`（该下拉只有 GitHub Actions 与 GitLab CI/CD 两项） |
| **Primary Discovery Channel*** | `Developer platforms (e.g. GitHub)`（另有 Organic search / AI·LLM tools / Community platforms / Social media / Events / Referral / Direct contact / Other） |

### 勾选框

| 勾选框 | 建议 |
|---|---|
| 我已阅读并同意 SignPath Foundation Code of Conduct，且理解证书以 SignPath Foundation 名义签发、违反条款可能被吊销 | **必须勾** |
| 我同意接收 SignPath 的其他通讯 | 随意 |
| 我同意 SignPath 存储和处理我的个人数据 | **必须勾** |

### 声誉字段怎么写

这是最容易卡住的一项，审核方想看「项目被广泛使用或信任」的证据。**下面是可直接粘贴的英文版本**，数字取自 GitHub API 实测（2026-09-28），提交前请重新核对一遍：

```
This is a young but actively maintained project: the first release was published on
2026-09-06, and it already serves a real user base in the Chinese graduate-entrance-exam
(Kaoyan) mathematics study community.

- 20 public releases between 2026-09-06 and 2026-09-28 (three weeks);
- Release assets have been downloaded 100+ times in that period; the most downloaded
  Windows packages are v2026.09.27-r27 (~30 downloads), v2026.09.19-r10 (~27) and
  v2026.09.07-r8 (~19): https://github.com/Evan26Ma/daguan-cxy-local/releases
- The project is a companion client for the widely used Daguan (大观园) online mathematics
  question bank, and builds on the earlier community project nbntg/daguanyuan-for-android,
  which distributes the same question bank workflow to mobile users;
- The study ecosystem it serves is substantial: the lecture series curated in the project
  README has 18 videos on Bilibili covering calculus, linear algebra and probability, with
  roughly 11.5 million cumulative views — e.g. "函数极限连续大观"
  (https://www.bilibili.com/video/BV1NKVpzREDV/, ~1.33M views),
  "线性代数大观（上篇）" (https://www.bilibili.com/video/BV1aeUWYUEiT/, ~1.43M views) and
  "积分大观" (https://www.bilibili.com/video/BV1gmReBDEUz/, ~760K views). The application links
  every question to its matching lecture segment, so students move between the question bank
  and these videos inside the app;
- It is maintained continuously and built entirely in public: GitHub Actions workflows build
  every release, 134 automated tests run on every change, and each release asset ships with a
  SHA-256 checksum file;
- End-user documentation is part of the repository (zero-experience Windows install guide and
  a usage tutorial), together with the code signing policy required by this program;
- The project is an unofficial client; question bank content and related rights belong to
  their original owners, and binaries are distributed only through this GitHub repository.

The project is early-stage by design (single maintainer, first release three weeks ago), and
we are applying now because the Windows "unknown publisher" SmartScreen warning is the main
source of friction for non-technical students. Release download statistics, CI logs, or
additional references can be provided on request.
```

补充说明：

- **B 站视频播放量是这份申请里最硬的证据**，已经写进上面的稿子。数字是 2026-09-28 用 B 站公开接口（`api.bilibili.com/x/web-interface/view`）逐个视频抓的，18 个视频合计 11,543,384 次播放；提交前可以重跑一遍刷新。
- 如果项目还有**真实社区传播的其它证据**（QQ/微信群、贴吧、知乎回答、B 站专栏等），也补进 `Reputation`，把链接贴在第一条后面；
- 不要写「很多人在用」这类无法核实的说法，审核方会自己核对下载量、视频链接与仓库活跃度；
- 4 star、9 月建的仓库，这一栏仍然偏单薄（视频播放量属于**生态系统**的热度，不等同于本项目用户数，所以稿子里写的是 "the study ecosystem it serves"，没有混为一谈）。**如果被婉拒，先积累一段时间的 star 与下载量再申请**，不要反复提交。

## 五、审核通过后的配置

### 1. SignPath 控制台

| 要拿到的东西 | 在哪里 |
|---|---|
| Organization ID | 左侧 Organization → Settings，形如 `xxxxxxxx-xxxx-...` |
| Project slug | Projects → 你的项目，URL 与项目页里的 slug |
| Signing policy slug | 项目 → Signing policies，用 `release-signing`（正式发布策略，需人工批准） |
| Artifact configuration slug | 项目 → Artifact configurations 新建一个，把 [`packaging/signpath/artifact-configuration.xml`](../packaging/signpath/artifact-configuration.xml) 的内容粘贴进去，slug 例如 `windows-exe` |
| API Token | 右上角用户菜单 → API tokens，新建一个只勾选本项目、权限最小的 token |

`artifact-configuration.xml` 里的 `product-name="大观园数学题库"` 必须与构建脚本写入 PE 的值一致；`product-version` 由工作流通过 `parameters` 传入（取自 `dist/DaguanMath-version.txt`），不需要手改。

### 2. GitHub 仓库配置

打开 `Settings → Secrets and variables → Actions`：

**Secrets**（加密，不显示在日志里）

| 名称 | 值 |
|---|---|
| `SIGNPATH_API_TOKEN` | 上一步生成的 API Token |

**Variables**（明文，工作流用 `vars.*` 读取）

| 名称 | 值示例 |
|---|---|
| `SIGNPATH_ORGANIZATION_ID` | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `SIGNPATH_PROJECT_SLUG` | `daguan-cxy-local` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | `windows-exe` |

只要 `SIGNPATH_ORGANIZATION_ID` 为空，工作流就会跳过全部签名步骤 —— 所以你可以先只填这一项验证，填错时删掉即可回退。

### 3. SignPath 侧信任 GitHub 工作流

在 SignPath 项目里登记本仓库的 workflow 路径（`.github/workflows/windows-release.yml`）与分支/tag 规则，让签名请求能校验来源。

## 六、发版验证

1. 打一个 tag 并推送：`git tag v2026.09.28-r28 && git push origin v2026.09.28-r28`；
2. 在 GitHub Actions 里看 `Windows release` 工作流，会依次出现：
   - `Build unsigned Windows executable`（日志里会打印 `PE 元数据版本：...`）
   - `Upload unsigned executable` → `Submit SignPath signing request`（**这里会暂停，等你到 SignPath 页面人工批准**）
   - `Verify and adopt signed executable` → `Assemble Windows release package` → `Publish GitHub release assets`
3. 到 SignPath 控制台批准这次签名请求；
4. 工作流跑完后下载 Release 里的 EXE 校验：

```powershell
Get-AuthenticodeSignature .\DaguanMath-windows-x64.exe | Format-List Status, SignerCertificate
```

期望 `Status: Valid`、签名主体为 `SignPath Foundation`。成功后，Windows 的 SmartScreen「未知发布者」提示会变成带发行者名称的正常提示。

## 七、如果申请不下来

| 备选 | 成本 | 说明 |
|---|---|---|
| [Azure Trusted Signing](https://azure.microsoft.com/products/trusted-signing) | $9.99/月 | 微软托管签名，个人开发者可用，SmartScreen 效果好 |
| [Certum 开源代码签名](https://certumcodesign.cn) | 免费档要求 GitHub star > 1k 且已发布 Release；付费云版约 €329/年 | 本仓库 star 数不满足免费档 |
| 自签名证书 | 免费 | 用户未安装根证书时仍显示“未知发布者”，**消除不了** SmartScreen 警告 |
| Sigstore / cosign | 免费 | 签名可验证，但 Windows 不认，同样不改善 SmartScreen |

不论走哪条路，本文档里的 PE 元数据写入（`scripts/build-windows-exe.mjs` 的 `applyWindowsMetadata`）都是前提：只有 `ProductName` 正确，签名工具才愿意签，用户看到的发行者信息也才对。

## 八、本地手动验证签名流程

想在不发版的情况下检查元数据写入是否正常：

```powershell
npm run package:windows
Get-Item dist\大观园数学题库.exe | Select-Object -ExpandProperty VersionInfo | Format-List ProductName, ProductVersion, CompanyName, FileVersion
```

应当看到 `ProductName: 大观园数学题库`、`CompanyName: Evan26Ma`。需要跳过这一步时设 `DAGUAN_SKIP_EXE_METADATA=1`。
