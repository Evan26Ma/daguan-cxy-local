# SignPath 免费代码签名申请指南（桌面版）

## 当前申请对象

申请对象是 Electron 桌面版 `DaguanMathDesktop-Setup.exe`，当前公开版本为 [v1.0.3](https://github.com/Evan26Ma/daguan-cxy-local/releases/tag/v1.0.3)。该版本安装器未签名，SHA-256 为 `5bd38b60cc08aac401cb337cd9198b7e8d4ae797cc142a997e06e2a99f7cd412`。已停止维护的浏览器版单文件 EXE、ZIP 和旧版 `windows-release.yml` 工作流不属于此次申请范围。

SignPath Foundation 为符合条件的开源项目提供免费签名，但申请须由维护者同意其条款并通过人工审核。证书主体将是 SignPath Foundation，**不会自动把已经发布的 v1.0.3 变成已签名版本**；获批后仍需建立桌面版的公开 CI 构建和签名流程，并发布新的完整安装器和更新资产。

## 申请前核对

- [开源项目条件](https://signpath.org/terms.html)：项目须使用 OSI 认可的许可证，维护者拥有拟签产物的源码和构建流程，已发布并持续维护。仓库根目录为 GPL-3.0；内含题库及第三方素材的授权范围应由项目维护者确认，不能仅凭根目录许可证推断所有内容均符合条件。
- [代码签名政策](CODE_SIGNING_POLICY.md)须在公开 README 和下载页面可见；目前政策如实说明 v1.0.3 未签名及桌面版自动联网行为。申请前应将更新后的政策发布到 GitHub。
- GitHub 与 SignPath 维护者账号需启用多因素认证；申请表中的姓名、邮箱和条款勾选由维护者本人核对。
- 当前桌面版通过本机 `npm run package:desktop:windows` 构建并发布，尚无对应的 GitHub Actions 桌面签名工作流。申请中应明确说明：获批后将由 GitHub 托管的 Windows runner 从公开仓库构建、提交产物，逐次人工批准签名。不能把浏览器版工作流写成现有桌面签名流程。

## 申请表材料

申请入口：[SignPath Foundation Apply](https://signpath.org/apply)。以下文本用于桌面版；提交前核对公开页面、授权和实际运行行为。逐字段可直接照抄的英文申请草稿（含 Reputation 写法、提交前检查清单和申请被拒后的备选渠道）见[SignPath 申请材料草稿](SignPath申请材料草稿.md)。

| 字段 | 内容 |
|---|---|
| Project Name | `daguan-cxy-local (DaguanMath Desktop)` |
| Repository URL / Homepage URL | `https://github.com/Evan26Ma/daguan-cxy-local` |
| Download URL | `https://github.com/Evan26Ma/daguan-cxy-local/releases/tag/v1.0.3` |
| Privacy Policy URL | `https://github.com/Evan26Ma/daguan-cxy-local/blob/main/docs/CODE_SIGNING_POLICY.md` |
| License | `GPL-3.0`（仍需核对拟签产物中所有组件的授权） |
| Build System | `GitHub Actions`（计划中的桌面签名构建；当前 v1.0.3 是本机构建） |
| Maintainer Type | `Independent community project (no formal organization)` |
| Tagline | `A local-first Windows desktop workspace for practicing the Daguan mathematics question bank.` |

Description 建议：

> DaguanMath Desktop is an independent, local-first Windows application for practicing the Daguan mathematics question bank. It provides progress tracking, annotations, optional synchronization with the Daguan website, and an optional AI tutor configured by the user. The current public desktop release is v1.0.3, distributed as a Squirrel.Windows installer with a published SHA-256 checksum. It is currently unsigned. The desktop app checks for software and question-bank updates automatically; software installation requires user confirmation. We seek free code signing for future desktop releases built from this public repository on GitHub-hosted Windows runners, with each signing request manually approved. This is an unofficial community client and is not affiliated with the official Daguan service.

Reputation 一栏应只写可验证的本项目数据，例如当前 GitHub Release 下载数、Stars、真实社区使用反馈及链接；不要把相关教学视频的播放量写成本项目用户数，也不要复用旧指南中的过期数字。

## 获批后的工作

1. 新建桌面版 GitHub Actions 构建与 SignPath 提交流程，并在 SignPath 中登记可信工作流、产物元数据规则及逐次人工批准策略。
2. 用获批证书签署项目自身的桌面可执行文件和安装器；不要以本项目身份签署第三方上游二进制。
3. 验证安装器及安装后程序的 Authenticode 状态、Squirrel 更新资产、干净 Windows 用户环境中的全新安装与升级；然后发布新版本并更新网盘文件及 SHA-256。

申请获批和配置完成之前，仓库文档与发布说明都应继续明确标注桌面版为未签名。
