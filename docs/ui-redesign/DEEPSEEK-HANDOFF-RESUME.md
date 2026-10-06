# DeepSeek Harness 续做：整改关 1 剩余复验

工作目录 `F:\AI\大观园本地`。只处理 `docs/ui-redesign/REMEDIATION-CONTROL.md` 的功能兼容关 1；完成后停下，等待 Codex 独立验收。保全全部未提交和未跟踪文件，不执行 reset、clean、stash、提交、推送、部署，不触碰真实凭据、真实 `data/` 或真实官网同步。仅使用隔离 `DAGUAN_DATA_DIR` 和模拟 AI/同步接口。

此前 DeepSeek V4 Flash 的 `hub-2-muj4y7l8` 已开展复验，随后 Harness 重启，该旧 job 的结果无法再通过 MCP 取回。会话留下的 `docs/ui-redesign/remediation-1-feedback-to-codex.md` 记录了 F1/F2/F3 三项新缺陷及最小修复，涉及旧版数组式收藏、last-study 慢写导航、笔记页备忘绑定；`web/app-new.js` 和 `test/new-ui-compat.test.mjs` 已有相应修改。不要重做这些修改；先独立核对源码和现存证据，再做剩余工作。此前的 115/115 单测与 F1/F2/F3 浏览器结果只是实施者记录，仍需自己复验。

本次 DSH Crew Flash 已切到 Harness `standard` 预设（模型仍为 `deepseek-official / deepseek-v4-flash`）。原 `minimal` 预设的持久 `pwsh` 在长命令后出现输入回显错乱和 `rite-Output`；另有一次模型工具参数无效 JSON。为避免再次失败，保持每次 `pwsh` 命令短小，长脚本写成文件后分步运行，避免把完整 Python 程序和多层引号塞进一个工具参数。遇到工具失败先读取实际错误，不要假定产品代码失败。若连续工具层失败，留下准确状态并停止，不要循环尝试同一巨型命令。

需要完成：

1. 按 `docs/ui-redesign/remediation-1-acceptance.md` 和 `docs/ui-redesign/DEEPSEEK-HANDOFF.md` 核对关 1 已修问题，先复验 F1/F2/F3 和现有工作树，不覆盖现有隔离数据。先检查 18098/18099 两个现存测试服务的进程用途，必要时使用新的隔离端口与数据目录。
2. 完成尚未做的备份/恢复（含合法、非法文件，刷新、旧版导入、服务端不可用回滚、待对账、409 重试）、批注和学习记录 409/500 失败路径、延迟 AI 流拒绝/确认切换、未发送草稿跨版本、在线/离线新旧版同题和收藏批注往返。
3. 至少重跑原 `.build/ui-redesign/remediation-1/qa/remediation-qa.py` 的 15 项真实点击，以及 `npm test`、`npm run verify`、`node --check web/app-new.js`。保存检查结果和截图，明确失败与未测项。
4. 按实测更新 `docs/ui-redesign/remediation-1-report.md`，保留 `remediation-1-feedback-to-codex.md` 的事实依据。最后只回报“整改关 1 待 Codex 复验”及文件/检查摘要；不要进入视觉关。
