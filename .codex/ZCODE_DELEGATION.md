# Codex → ZCode-supervisor → 并行 worker

本项目按维护者要求使用完整 Codex Review。Codex 负责规划、allowed files、validation、调度、结果回收、diff 审计、冲突处理、修复、最终测试和验收；ZCode 只实现 packet。worker 的 success 永远停在 awaiting_review。

ZCode worker 默认以无头 CLI 形式运行：通过 `scripts/zcode-env.py` 调用 ZCode-supervisor，再使用已安装客户端附带的 `F:\Tools\ZCode\resources\glm\zcode.cjs`。执行在后台进行，日志、结果和 diff 自动回收；每个 worker 使用独立 workspace、HOME 与运行目录。除用户明确要求客户端交互外，不启动 ZCode 桌面窗口。16 是本地最大并发数，实际启动数量按可独立任务数和服务端允许并发确定。

## 开发入口

1. Codex 读取项目规则与当前 Git 状态，把可独立实现的任务拆成互不冲突的 packet。不同任务的 allowed_files 必须互斥，且都是精确相对文件路径。需要修改同一文件的任务按依赖顺序分批。
2. 在 `.codex/zcode/` 写 manifest。实现任务默认 `isolation: worktree`；每个 worker 有独立 detached worktree、HOME、SQLite、TEMP、日志和结果文件。当前 tracked 未提交改动以 patch 带入，未跟踪输入只通过 input_files 显式提供。项目真实 data 目录与账号密钥不进入 packet。
3. 运行 `python scripts/zcode-pool.py run --manifest .codex/zcode/<batch>.json`。默认最大并发 16，配置以 `.codex/zcode-pool.json` 为准，同账号的多个 batch 共享本机锁。1302/429 等限流或套餐错误会暂停后续派发并保留结果；不轮换账号、不清除有效锁、不修改 ZCode 二进制。
4. 自动收集每个 worker 的 result-N.json、collection-N.json、diff-N.patch，以及整批 state.json。读取 `.codex/zcode/latest-run.json` 找到本批 RUN。
5. Codex 检查所有 diff、实际输出与验证结果，写 review JSON，再运行 `python scripts/zcode-pool.py review --run RUN --decisions REVIEW.json`。
6. 对有效且范围安全的实现提出 `request_changes` 和更窄的 repair_objective。调度层自动回到同一 worker workspace，仍使用原 allowed_files 和 validation，最多两轮修复；修复结果必须重新 Review。
7. 所有结果 approve 后，运行 `python scripts/zcode-pool.py integrate --run RUN --validation "<最终验证命令>"` 预查冲突，再加 `--apply` 合入允许的文件并执行最终测试。最终测试失败会恢复本次合入的文件；原始工作树冲突、结果篡改或尚未 Review 都会阻止合入。Codex 确认测试覆盖和结果后才汇报完成。

## Manifest

```json
{
  "version": 1,
  "isolation": "worktree",
  "tasks": [
    {
      "id": "task-a",
      "backend": "packet",
      "objective": "明确的实现目标与完成条件",
      "allowed_files": ["src/a.mjs", "test/a.test.mjs"],
      "input_files": [],
      "validation": "node --test test/a.test.mjs"
    },
    {
      "id": "task-b",
      "backend": "auto-route",
      "objective": "Implement 独立的第二个目标",
      "allowed_files": ["src/b.mjs"],
      "input_files": [],
      "validation": "node --check src/b.mjs"
    }
  ]
}
```

`packet` 后端调用上游 packet + `zcodectl run-packet`；`auto-route` 后端调用上游 `zcode-auto-route --execute`。高风险路线仍由上游拦截。只读任务用 packet 后端、`read_only: true` 和 Plan 权限，任何写入都拒收。低风险 smoke 使用 `fixture` 隔离，只复制显式输入，输出保留在 F 盘测试目录。

每个 task 使用独立进程。正常实现任务没有改动时拒收；只有 Codex 显式指定 allow_no_change 的幂等检查允许零差异，仍须通过验证与 Review。具体实现 worker 使用隔离环境中的 Full Access，以便无人值守完成工具调用；allowed_files 是执行后的审计边界，并不是操作系统沙盒。Git worktree 也共享 Git 元数据。Codex 应只派发有界、低风险实现，不派发凭据操作、安装依赖、破坏性 Git、迁移、发布或最终验收。

validation 使用直接 Node/npm/Python 命令，不包装 PowerShell/cmd/bash。Windows 的 npm 使用 `npm.cmd`。依赖由 Codex 先在隔离目录准备；每个 worktree 的 node_modules 需分别配置，不能让 worker 在共享目录装依赖。服务测试显式隔离 DAGUAN_DATA_DIR，桌面测试另隔离 profile。

## Review 数据

```json
{
  "tasks": [
    {
      "id": "task-a",
      "revision": 1,
      "result_fingerprint": "从 state.json 复制",
      "decision": "approve",
      "reason": "Codex 已核对实际差异、完成条件和验证结果"
    },
    {
      "id": "task-b",
      "revision": 1,
      "result_fingerprint": "从 state.json 复制",
      "decision": "request_changes",
      "reason": "说明需要修正的具体问题",
      "repair_objective": "只修复该问题，遵守原 allowed_files 和 validation"
    }
  ]
}
```

Review 必须覆盖所有任务。失败或越界结果不能 approve；可用 reject 保留诊断证据。账号/网络故障不进入代码修复循环。修复后 revision 与 fingerprint 变化，旧 Review 不能接受新结果。Codex 亲自生成 Review，worker 没有最终接受权。

## 安装与验证

上游来源： https://github.com/AkiGarage/ZCode-supervisor ，PyPI zcode-supervisor 0.0.2。机器路径在不入库的 `.codex/zcode-pool.local.json`；公共并发策略在 `.codex/zcode-pool.json`。CLI 使用现有安装的 bundled headless 文件，不改 ZCode 程序。凭据仅保留在受限的 F 盘 runtime HOME，不写入仓库、packet 或报告。

```powershell
python scripts/zcode-env.py zcode --version
python scripts/zcode-env.py zcodectl cli-preflight
python scripts/zcode-env.py zcode-auto-route --workspace . --objective 'Implement smoke report' --allowed reports/smoke.md --validation 'node --version'
python test/zcode-pool.test.py
python scripts/zcode-pool.py run --manifest .codex/zcode-smoke.json
```

`F:\AI\zcode-launchers` 中提供同名命令，并已加入用户 PATH；新开的终端可直接用 zcode / zcodectl / zcode-auto-route / zcode-install-repo。当前窗口也可用上述 repo launcher。上游 installer 已实际运行，写入 `.codex/zcode-routing.json`、本文、`.agents/mcp.json` 与 AGENTS 路由入口。再次运行不加 --force，避免覆盖项目的并行规则。

按用户明确授权，concurrency 和 account_concurrency 均设置为 16，多个 batch 共享这一账号本地调度上限。服务端实际限制仍优先；并发、额度或 provider 错误触发原有暂停派发与退避机制，不轮换账号或绕过限制。本地 16-worker 调度与锁测试仅验证本地机制；当前两个真实 worker 的 smoke 不能作为真实 16-worker 账号压力验证。

进程崩溃时保留锁和 workspace，先核对锁 PID 及该批状态，再由 Codex 恢复。锁文件没有自动过期删除。验收后保留报告与 diff，按 F 盘范围核验后清理本批 runtime credentials 和不再需要的隔离工作树。使用 git worktree remove 前确认该目录属于该批，且实现已经回收。
