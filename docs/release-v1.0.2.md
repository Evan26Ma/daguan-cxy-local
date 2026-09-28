# 大观园数学桌面版 v1.0.2

v1.0.2 为 Windows x64 桌面版增加旧浏览器服务安全接管、官网题库自动更新，并修复普通本地模式错误显示访问 Token 入口的问题。已安装的 v1.0.1 可通过桌面内的“检查更新”或后台更新安装本版本。

## 更新内容

- 桌面版启动时识别并优雅接管同一数据目录中的兼容浏览器服务，沿用原端口；身份不明、健康检查失败、停止超时或锁状态变化时停止启动，避免出现两个写入者。
- 桌面服务联网后自动检查官网题库，之后每日检查一次。下载并校验新题库后原子切换；断网或更新失败时继续使用上次可用题库。
- 普通本地模式无需访问 Token；只读预览模式仍保留解锁控制。
- 本版随包内置 6,473 道题（6,314 道官网题及 159 道本地题）。当前有 40 张官网图片无法匿名获取，图片接口需要维护者凭据；这不影响题目、答案及解析更新。
- 附带最后一个浏览器迁移包归档。浏览器版已停止维护，旧安装不会自动显示迁移提示。

桌面更新会在后台下载，用户确认“重启并安装更新”后才安装；更新不会自动中断正在使用的窗口。未签名，Windows SmartScreen 可能显示未知发布者提示。

## Windows x64 资产与 SHA-256

桌面在线更新需要同时保留 Setup、匹配的完整 nupkg 及 `RELEASES` 索引。

| 资产 | SHA-256 |
|---|---|
| `DaguanMathDesktop-Setup.exe` | `ac405fff7270a4a2ffbfafaf5cdcfcdad136b99fce5dc3fd424254291a1c097b` |
| `DaguanMathDesktop-1.0.2-full.nupkg` | `18152251080342cfca2e33cca8fa219dfea4545e242e42c549e79458c777c8f8` |
| `RELEASES` | `a1e9704ba87a47ce32cd2c181920818cd983d6224eea85aa4605c4f19c2e27c1` |
| `DaguanMath-windows-x64.zip`（迁移归档） | `9938081e654b69f756171429b2e2c0e96960ef6204385a2a74eac0c2c0a25152` |
| `DaguanMath-windows-x64.exe`（迁移归档） | `34b8bdc521e88159fcdd53ed3756a548ea8022f78c8b15142fdeee8b7b886bd3` |

每项资产随附 `.sha256` 校验文件。桌面安装包和迁移归档均由最新 `main` 构建。

## 验证

- `npm run verify`：6,473 个唯一题号通过；报告 40 张无法匿名获取的图片。
- `node --test test/ui-contract.test.mjs`：43 项通过。
- `node --test test/desktop-package.test.mjs`：1 项通过。
- 桌面包检查：nupkg 内 0 个非 ASCII 路径，题库清单为 6,473 题，Token 隐藏修复存在于包内。
- 浏览器迁移归档通过安装脚本校验和 SEA `--check`。

正式 Squirrel 安装器未在干净 Windows 用户配置中进行全新安装验收；隔离安装/更新证据和边界见 `docs/desktop-stage3-report.md` 与 `docs/desktop-stage4-report.md`。
