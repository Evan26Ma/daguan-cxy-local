# Code signing policy（代码签名政策）

**Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).**

本项目的 Windows 发布包由 SignPath Foundation 提供的证书进行 Authenticode 签名（免费开源签名计划）。

## 签名的内容

| 文件 | 说明 |
|---|---|
| `DaguanMath-windows-x64.exe` | GitHub Release 中的单文件版，Windows 用户直接双击运行的那个 EXE |
| `DaguanMath-windows-x64.zip` | 安装包，内含上面同一个已签名的 EXE |

签名只覆盖**由本仓库源码、在公开 CI 中构建**出来的产物。构建与签名流程：

1. 推送 `v*` tag → GitHub Actions 在 GitHub 托管的 `windows-latest` runner 上构建单文件 EXE；
2. 未签名 EXE 作为工作流产物上传，提交给 SignPath；
3. SignPath 校验该产物的来源与 PE 元数据，经人工批准后签名；
4. 签名后的 EXE 覆盖回构建目录，再生成 ZIP 与 SHA256，发布到 GitHub Release。

对应文件：[windows-release.yml](../.github/workflows/windows-release.yml)、[artifact-configuration.xml](../packaging/signpath/artifact-configuration.xml)。

## 团队角色与成员

| 角色 | 职责 | 成员 |
|---|---|---|
| Authors（提交者） | 有权直接向仓库提交源码改动 | [@Evan26Ma](https://github.com/Evan26Ma) |
| Reviewers（审阅者） | 审阅来自非提交者的改动 | [@Evan26Ma](https://github.com/Evan26Ma) |
| Approvers（批准者） | 决定某次发布是否可以签名，逐次人工批准签名请求 | [@Evan26Ma](https://github.com/Evan26Ma) |

所有成员均已启用 GitHub 多因素认证（MFA）。

## 隐私政策

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

即：本程序不会向任何其他网络系统传输信息，除非用户或安装、操作它的人明确要求。具体地——

- **AI 数学助教**：只有在你自行配置服务档案并主动发起对话时，才会访问你填写的 API 地址；
- **官网进度同步**：只有在你点击并确认之后，才会访问大观园官网接口；
- **本地数据**：刷题进度、易错标记、批注、AI Key、服务档案与聊天记录全部保存在本机，不上传官网、不写入导出文件、不写入日志；
- 其余联网行为、第三方组件与端口监听范围见 [README 的安全边界](../README.md#安全边界)。

## 如何校验下载到的文件

```powershell
Get-AuthenticodeSignature .\DaguanMath-windows-x64.exe | Format-List Status, SignerCertificate
```

也可以使用 Windows SDK 的 `signtool`：

```powershell
signtool verify /pa /v .\DaguanMath-windows-x64.exe
```

- `Status` 为 `Valid`，签名主体（Signer）为 **SignPath Foundation**，说明该文件确实由本仓库的公开构建流程产出、且未被篡改；
- 再配合 Release 附件里的 `.sha256` 文件校验完整性：

```powershell
(Get-FileHash .\DaguanMath-windows-x64.exe -Algorithm SHA256).Hash
Get-Content .\DaguanMath-windows-x64.exe.sha256
```

两个值应当一致。校验方法同样适用于 `DaguanMath-windows-x64.zip`。
