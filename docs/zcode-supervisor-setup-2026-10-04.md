# ZCode-supervisor 配置与验收记录

2026-10-04，项目 `F:\AI\大观园本地`，分支 main，HEAD `3d407d5`。开工时已有题库与文档改动，本次保留。未提交、推送、打包或发布。

## 已安装和配置

- 现有 ZCode：`F:\Tools\ZCode\ZCode.exe`，桌面版 3.14.3.7762；bundled CLI `resources/glm/zcode.cjs`，0.16.9。版本、help、doctor 和真实 headless 执行均已验证。
- 通过 PyPI 安装上游最新 `zcode-supervisor==0.0.2`，工具环境位于 `F:\AI\zcode-supervisor-tools`。上游来源：[AkiGarage/ZCode-supervisor](https://github.com/AkiGarage/ZCode-supervisor)。源代码参考 checkout 为 `557a777ae2ca336ce0006c43a91c612d1ca3a6f2`，tag v0.0.2。
- 已实际执行 zcode-install-repo，并再次确认幂等安装返回 ok=true。生成 `.codex/zcode-routing.json`、`.codex/ZCODE_DELEGATION.md`、`.agents/mcp.json` 与 AGENTS 路由入口。
- 上游按单个 packet 执行；新增 `scripts/zcode-pool.py` 作为外层调度，保留上游 packet、snapshot、scope audit、secret scan、validation 与路由风险检查。
- 初始配置并发 8，多个 batch 共享账号锁；之后按用户明确授权提高到 16，见末尾升级记录。初始 14 项本地测试含八线程同时运行，但真实 provider smoke 为两个 worker，不构成真实八并发稳定性证明。
- 每个实现 worker 使用独立 worktree 或 fixture、HOME、数据库、TEMP 和结果目录；F 盘存储。Codex 明确 allowed_files 与验证，回收完整差异，发出 Review 和修复意见，执行最终测试并保留最终接受权。
- `F:\AI\zcode-launchers` 提供 zcode、zcodectl、zcode-supervisor、zcode-install-repo、zcode-auto-route 同名命令，并加入用户 PATH。当前应用进程如尚未刷新 PATH，可使用 `python scripts/zcode-env.py <命令>`。

## Windows 与 provider 兼容处理

uv 的 Python launcher 在本机以 Low 完整性运行，直接写入主项目被拒；改用已安装系统 Python 调用原安装包模块。python3 helper 所需的可写临时目录单独放在 F 盘私有隔离树。没有降低主项目或真实用户数据目录的权限。

CLI 0.16.9 需要新版 provider registry，其默认 bundled provider JSON 路径与桌面包布局不一致。通过 CLI 已支持的 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 和 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指定原安装资源与隔离配置，没有修改 ZCode 二进制。

首次真实探测发现现有默认 MiMo 返回 402（余额不足），旧 BigModel Coding Plan key 返回 1309（套餐过期）。配置阶段停止这些失败路线，后续真实验收使用本机已有 DeepSeek key 与 `deepseek-flash`，通过 openai-compatible API。旧 BigModel 配置保留空模型列表以兼容上游 legacy preflight，不参与执行。桌面版的用户配置保持原状。运行配置和密钥只存于 F 盘私有 runtime，不入库、不写入 packet；临时 worker 的 96 份凭据配置副本已按文件清理。

当前 ZCode 文件 SHA-256：

- ZCode.exe：`A21B8D878F7B969C34AEE965A31070A7AE234866A46F953C8317C8C5A86CB6B0`
- zcode.cjs：`B1DF2EF3E5BD76C4AF3ECB296BC003A10D3F13191A26610BD0BA940FEADAD529`

本次没有写入这些安装文件。项目、脚本、下载、缓存与测试产物均放 F 盘；用户 PATH 的小型系统配置更新是唯一系统配置改动。没有需要清理的本次 C 盘临时项目。

## 真实流程验收

成功批次：`F:\AI\tmp\daguan-zcode-pool\20261004-081813-eb2a4f91`。

| 阶段 | 证据与结果 |
| --- | --- |
| Codex 规划 | `.codex/zcode-smoke.json`：仅复制 package.json，两个互斥 report 文件，分别配置精确内容验证命令 |
| 并行 ZCode 实现 | entrypoints 经 auto-route --execute；checks 经 zcodectl run-packet。两个独立 workspace 与 runtime，首轮约 21.62 秒 |
| 自动回收 | result/route JSON、collection JSON、完整 diff 和 state.json 均自动生成；只修改各自允许的 report 文件 |
| Codex Review | 核对所有命令与 package.json；要求去除额外脚本说明和未经读取代码验证的运行行为推断 |
| 自动修复 | review 子命令自动调度两个同 scope 的修复，约 21.93 秒；结果 revision=2，原 Review 不继承到新版本 |
| 第二次 Codex Review | 检查两份新报告和完整 diff，scope audit 和 validation 均为 true，两个结果均 approve |
| 合入预查 | 检查源文件基线与输出指纹，dry-run 成功 |
| 最终测试 | 合入两份低风险报告后执行 `node scripts/zcode-smoke-validate.mjs`，退出 0 |
| 最终接受 | state.json：status=complete，final_acceptance=accepted_by_codex_after_tests |

最终报告见 `reports/entrypoints.md` 与 `reports/checks.md`。业务源码、真实学习数据和原始 package.json 未由 worker 修改。

## 最终本地检查

- `python test/zcode-pool.test.py`：14 项通过。覆盖八 worker 同时运行、跨调度器账号上限、冲突/不安全路径拒绝、越界结果拒收、worker 自报成功不能接受、独立重跑原验证、审查后篡改拦截、provider 错误暂停派发、源文件冲突、修复后重新审查、失败回滚、真正的独立 Git worktree 和已有改动保留、重复/过期 Review 拒绝、显式授权的幂等 smoke。
- `node scripts/zcode-smoke-validate.mjs`：通过。
- zcode-install-repo：ok=true；zcodectl cli-preflight：ok=true、prompt_ready=true；auto-route dry run：delegate_zcode。
- `npm run verify`：通过，6889 题和 6889 个唯一题号；有既存的 42 张缺图警告。
- `git diff --check`：通过；Git 对既有题库文件显示 LF/CRLF 提示。

额外尝试上游完整 Python 测试，Windows 运行中出现两个 E 标记并长期未结束，已停止该进程；没有把它记为通过。本次验收依据是上述本机回归、真实并行执行/修复、独立范围检查和最终内容验证，没有声称上游完整测试或项目 npm test 全套已经通过。

## 后续约束

实现按 `.codex/ZCODE_DELEGATION.md` 使用 pool。用户随后明确要求提高到 16，当前本地 worker 与账号调度上限均为 16；账号额度和服务端并发限制仍优先。服务端拒绝会暂停派发；没有账号轮换、限额绕过或二进制补丁。

worktree 和 allowed_files 提供隔离与事后审计，Full Access worker 不是操作系统级沙盒。Codex 继续负责有界任务、所有 diff 的审查、冲突处理、适合改动的最终测试以及最终验收。运行 success 只是待审查状态。

## 用户授权提高到 16

2026-10-04，用户明确要求“提高到16”。已将 `.codex/zcode-pool.json` 中 concurrency 和 account_concurrency 同步设为 16，并同步路由元数据与 AGENTS/委派规则。max_concurrency 仍为 16，服务端错误暂停与退避、独立 workspace、范围审计、Codex Review 和最终测试继续保留。

升级后的 `python test/zcode-pool.test.py`：14 项通过，耗时 4.568 秒。并行测试覆盖 8 和 16 个 worker 同时到达 barrier；共享账号锁测试覆盖 16/32 个本地竞争线程分别只能同时取得 8/16 个槽，测试结束无残留槽锁。实际 config() 与路由加载结果均为 16，共享账号目录没有活动槽锁；`git diff --check` 通过。

这是本地调度验证，未新增真实 16-worker provider 压力测试。初始两个真实 worker 的执行与修复证据仍保持原始记录；服务端若拒绝并发，将按原机制暂停派发，不绕过账号限制。
