# Code signing policy（代码签名政策）

**Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).**

## 当前状态与签名范围

项目正在准备申请 SignPath Foundation 的免费开源代码签名。截至桌面版 v1.0.3，申请尚未获批，`DaguanMathDesktop-Setup.exe` 和安装后的 `DaguanMath.exe` 均未签名。旧版 `windows-release.yml` 只为已停止维护的浏览器单文件版预留签名步骤，不能为当前桌面版提供签名。

申请获批后，计划从本仓库的公开 GitHub Actions Windows 构建产物中签署桌面版的安装器与本项目自己的可执行文件。每次签名请求由批准者人工核准。第三方 Electron、Squirrel 等组件按其上游许可及签名处理，不冒充本项目自主开发的二进制。正式签名范围和验证方法将在首次签名发布时按实际产物更新；未签名前的版本只以 Release 附带的 SHA-256 校验完整性。

当前公开桌面版：[v1.0.3 Release](https://github.com/Evan26Ma/daguan-cxy-local/releases/tag/v1.0.3)。该版本的 `DaguanMathDesktop-Setup.exe` SHA-256 为 `5bd38b60cc08aac401cb337cd9198b7e8d4ae797cc142a997e06e2a99f7cd412`。百度网盘分享中的文件版本应对实际下载文件单独校验。

## 团队角色

| 角色 | 职责 | 成员 |
|---|---|---|
| Authors | 维护源码与构建脚本 | [@Evan26Ma](https://github.com/Evan26Ma) |
| Reviewers | 审阅外部贡献 | [@Evan26Ma](https://github.com/Evan26Ma) |
| Approvers | 人工批准每次签名请求 | [@Evan26Ma](https://github.com/Evan26Ma) |

申请和签名之前，维护者须确认 GitHub 与 SignPath 账号均启用多因素认证。

## 联网与隐私说明

桌面版启动后约 15 秒检查 GitHub Release 软件更新，之后每 6 小时检查一次；如有新版本，会在后台下载，安装需要用户确认。桌面服务联网后会自动检查官网题库，之后每天检查一次并下载经校验的新题库。这些请求会向相应服务器暴露常规网络请求信息，例如 IP 地址、请求时间和访问的版本或资源路径。

官网学习进度同步需用户在界面中确认；AI 助教仅在用户配置服务并主动发起对话时访问所填的 API 地址。学习进度、易错标记、批注、AI Key、服务档案和聊天记录默认保存在本机 `%LOCALAPPDATA%\DaguanMath\data`。本项目不提供遥测或自动上传这些本机学习记录的功能。相关服务的隐私政策由其各自提供者负责。

## 校验方法

```powershell
Get-AuthenticodeSignature .\DaguanMathDesktop-Setup.exe | Format-List Status, SignerCertificate
(Get-FileHash .\DaguanMathDesktop-Setup.exe -Algorithm SHA256).Hash
```

v1.0.3 的签名状态应为 `NotSigned`；哈希应与该版本 Release 公布的值一致。未来的签名版本应以其 Release 中写明的签名主体、文件范围和 SHA-256 为准。代码签名不能保证安全软件永不提示或拦截。

## 向杀毒软件厂商提交误报

未签名的安装器可能被杀毒软件提示、拦截或隔离。判断是不是误报，先做第一步校验：

1. 按 SHA-256 核对下载到的文件与对应版本 Release 公布的值是否一致。**不一致的不是误报**，是文件被改包或下载不完整，直接重新下载；一致仍被拦截时，才按厂商流程提交误报。
2. 不要为了让安装继续而关闭杀毒软件或 Windows 安全防护；确认校验值一致后，可临时把该文件加入杀毒软件的信任区。

提交误报前准备：

- 被拦截的文件（或其 SHA-256）；
- 杀毒软件显示的检测名称与拦截时间；
- 拦截记录截图：火绒在主界面菜单或托盘右键菜单的「安全日志」查看；Windows 安全中心在「病毒和威胁防护」→「保护历史记录」查看。

### 火绒（Huorong）

- 官方网站：<https://www.huorong.cn>。
- 官方论坛「病毒查杀问题反馈」版块（下设「样本误报」等分类；发帖需注册登录）：<https://bbs.huorong.cn/forum-44-1.html>。
- 流程：注册后在上述版块发帖，说明文件名、SHA-256、检测名称和拦截场景，附检测文件或安全日志截图，等待火绒官方分析；确认为误报后由官方处理。不要在其他版块或仿冒站点提交样本。

### Microsoft Defender

- 提交入口（Security Intelligence「提交文件以进行恶意软件分析」）：<https://www.microsoft.com/en-us/wdsi/filesubmission>。
- 流程：提交者身份选择「Software developer」，判定类别选择「Incorrectly detected as malware/malicious」，填写检测名称与安全智能版本后上传文件。
- 页面限制单个文件 50 MB，且建议提交被检测的具体文件而非大型安装包。本项目安装器约 425 MB 超出上限；此时可提交安装器释放出的、被实际检测的具体文件，并附安装器 SHA-256 与检测名称。
