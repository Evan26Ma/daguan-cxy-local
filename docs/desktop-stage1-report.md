# 桌面版阶段 1：共享服务实施记录

日期：2026-09-27（Asia/Hong_Kong）
工作区/分支：`F:\AI\daguan-desktop-stage0-worktree` / `codex/daguan-desktop-stage0`
基线：阶段 0 已由负责人独立验收通过。本阶段未进入 Electron、安装器或发布工作。

## 实施内容

- 新增 `local-server/instance-lock.mjs`。服务在共享数据目录内用独占创建的 `.service-instance.json` 取得租约；记录 PID、端口、实例 UUID、启动时间、数据目录和 API 协议号。并发启动者连接已持有租约且协议兼容的服务，不会再创建第二个写入进程。
- 服务健康端点和锁文件都声明 `apiProtocol: 1`。新版浏览器启动脚本、SEA 启动入口和服务端均校验协议与实例 UUID。协议不匹配或健康检查失败时拒绝连接/抢占，错误信息列出 PID、端口、数据目录和锁文件路径，并说明先确认没有服务进程再移除锁。死 PID 的锁自动回收；损坏锁有 15 秒写入宽限期后回收。运行中 PID 的健康检查失败不会自动删除锁，避免因 PID 复用造成双写。
- 服务监听地址固定为 `127.0.0.1`；锁文件中的服务地址也必须是该回环地址，避免错误配置或无效锁将其暴露到局域网。
- `local-server/store.mjs` 将整份状态写入排队并串行校验 revision；REST 整份替换与迁移也进入服务写锁。所有经状态服务写入的进度、收藏、批注和学习位置变更都会产生 SSE 事件。关闭服务时结束 SSE 并调用 `server.close()` 排空现有 HTTP 请求，等请求和状态写入完成后再释放租约。
- 新版和旧版界面监听 SSE，按 revision 重新读取共享状态；EventSource 断开时显示自动重连提示，恢复后提示连接恢复。新版在未保存批注时不重绘题目，在随手记未保存时不重绘笔记页；AI 草稿输入本身继续即时写入既有本地草稿键。旧版保护正在编辑的批注和本地较新的编辑。
- 浏览器版脚本与 SEA 使用 `%LOCALAPPDATA%\DaguanMath\data`，支持任一方先启动并复用同一服务。原有双版本页面仍由同一服务提供，缓存版本号已递增以触发客户端刷新。

## 启动方式

- 更新后的独立浏览器目录运行 `scripts\start-windows.ps1`。它会发现同一数据目录内兼容的服务并打开其页面；找不到时选择本机空闲端口并启动服务。
- 开发时可设置 `DAGUAN_DATA_DIR` 和 `PORT` 后运行 `node local-server/server.mjs`。自动化集成测试只在系统临时目录创建隔离数据。
- SEA 启动入口 `packaging/sea-entry.cjs` 使用同一数据目录和健康协议；SEA 实际重打包将在后续打包阶段进行。

## 验证结果

- `npm test`：阶段 1 原有服务回归加上后台恢复用例后共 144/144 通过，0 失败。本次全量运行设置了 Playwright 模块及 Chrome 路径，因此真实双页用例也实际运行；在没有 Playwright 的环境该用例会跳过，其他自动化仍正常运行。
- 自动化覆盖浏览器/桌面入口两种启动顺序、六进程竞争启动、协议不兼容拒绝复用、两个 SSE 客户端接收事件、并发 revision 写入与冲突重试、正常退出及锁释放、强制崩溃后的数据恢复、上传状态过程中优雅退出等待写入完成，以及双浏览器页切后台/恢复与服务重启后的 SSE 重连。
- `npm run verify`：通过，6342 道题、6342 个唯一题号。既有警告仍为缺少 21 张题图；补齐需要 `DAGUAN_ASSET_TOKEN`，本阶段未下载或改动题库。
- `node --check packaging/sea-entry.cjs`、`node --check web/app-new.js`、`node --check web/app-legacy.js`、`node --check web/app2.js`：通过。
- PowerShell AST 解析 `scripts/start-windows.ps1`：通过。
- `git diff --check`：通过；仅 Git 提示工作区 LF 文件可能在后续写入时转换为 CRLF。

## 数据安全与待独立验收

- 本阶段的服务集成测试均使用 `os.tmpdir()` 下新建的隔离目录，并在结束后删除。没有启动现有浏览器服务、没有访问/修改用户的 `data/`，没有连接官网，没有打包或推送。
- 父任务仍需独立查看实际 diff 和工作区运行画面/控制台，并亲自验证更新浏览器包与未来桌面版以两种顺序启动、双窗口做题及保存、批注编辑时同步刷新、断网/服务重启自动恢复、明确退出和学习位置/收藏的一致性。当前自动化的“browser/desktop 启动顺序”使用两个启动方标签调用同一个 Node 服务入口，未启动既有 SEA 二进制；桌面 Electron 窗口也尚未存在，因此跨二进制和真实 UI 行为留待实际包及阶段 2 验收。
- 若 Windows PID 被复用且对应服务健康端点不可达，系统保留租约并提示人工确认进程和端口；这是保守阻断而不是自动判断 PID 身份。确认原服务不再写入前不要手动删除锁。

## 阶段 1 复验整改：后台窗口与 SSE 重连

- 修复新版和旧版的可见性恢复路径：页面重新可见时重新读取最新服务状态。新版不再让未提交的本地待同步队列无限期挡住远端刷新；实际写请求仍会短暂排队，`hydrate` 的合并逻辑保留本地待同步值。新版 SSE 断开后 `onopen` 也会补读一次；旧版连接恢复时补读一次。
- 新增 `test/visibility-browser.test.mjs`，用两个真实 Chromium 页面连接隔离服务。浏览器测试使用 Chromium 页面，并通过测试脚本设置 `document.visibilityState` 和发送浏览器 `visibilitychange` 生命周期事件，因为当前 headless Chromium 不提供后台标签可见性切换 API。
- 实际 Playwright 回归证据：收藏写入后，B 页后台收到事件但保留 `revision=2`、收藏按钮未激活；重新可见后 A/B 两页按钮均 `active=true`，服务端 `favorite=true`，两页均到 `revision=3`，浏览器页错误 0。随后优雅重启服务模拟 SSE 断开/重连，写入易错状态后 B 页记录到 `disconnects=1`、`reconnects=1`；服务端、A 页、B 页均到 `revision=4`，两页易错按钮均激活。
- 有 Playwright 的运行方式：设置 `DAGUAN_PLAYWRIGHT_MODULE` 为 Playwright Node 包目录，并可设置 `DAGUAN_TEST_BROWSER` 为 Chromium/Chrome 可执行文件，然后运行 `node --test test/visibility-browser.test.mjs`。标准 `npm test` 在未安装 Playwright 的环境会跳过真实浏览器用例；可见性纯单元回归仍会运行。
