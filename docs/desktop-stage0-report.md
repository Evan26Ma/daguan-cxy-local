# 桌面版阶段 0 基线记录

日期：2026-09-27（Asia/Hong_Kong）

## Git 与恢复点

- 原工作区 `F:\AI\大观园本地` 保持在 `main` / `origin/main`，HEAD `c0c8cc9d00f9e78e5abad0d56674d3de1d20008e`；检查前后 `git status --short --branch` 一致，所有原有未跟踪文件仍在原处。
- 未找到适用的 `AGENTS.md`。旧版归档分支 `legacy/pre-redesign-2026-09-27` 与其远端跟踪引用均为 `28a1a6cafd0f6f57e5b3d9baed545e0158b2cefc`。
- 独立工作分支 `codex/daguan-desktop-stage0` 位于 `F:\AI\daguan-desktop-stage0-worktree`，从上述 main HEAD 创建；当前只增加本基线记录。
- 可恢复快照：`F:\AI\daguan-desktop-stage0-snapshot-20260927-213634`。`main.bundle` 保存 main 可达历史；`untracked/` 保留原工作区当时 27 个未跟踪文件副本，`untracked-files.txt` 和 `untracked-sha256.json` 记录路径与哈希。快照未包含被忽略的 `data/`，个人数据留在原目录且检查前后校验一致。

## 当前产品与打包基线

- `package.json` 提供 Node 服务启动、Windows SEA 构建、Release ZIP 打包、题库同步、校验和自动测试命令；Node 运行时为 `v24.15.0`，npm 为 `11.12.1`。
- Windows SEA 入口在 `packaging/sea-entry.cjs`：单文件内嵌 web 与 Node 服务，默认页面为 `index.html`，选择 8080–8099 的本机端口，可复用健康服务；数据目录为 `%LOCALAPPDATA%\DaguanMath\data`。源码开发服务默认使用仓库 `data/`，也支持 `DAGUAN_DATA_DIR` 覆盖。SEA 现有二进制会在首次运行释放内置应用文件。
- 检查时 `dist/` 已有 2026-09-06 生成的 EXE 与 ZIP（单文件 EXE 367,804,416 字节，ZIP 310,302,886 字节）；没有重新打包或改动这些产物。用隔离目录 `F:\AI\daguan-desktop-stage0-snapshot-20260927-213634\existing-sea-check` 执行既有 EXE 的 `--check`，退出码 0，返回 `package-ok http://127.0.0.1:8080/`。只有 Node SEA 实验功能提示。
- 双版本入口和兼容性覆盖在 `web/index.html`、`web/legacy.html`、`web/app2.js`、`web/app-legacy.js`、`web/ui-version.js` 及 `test/dual-ui.test.mjs`。HTTP 实测新版入口 `/index.html?ui=new&layout=sidebar-v112` 与显式旧版 `/legacy.html?ui=old` 均返回 200；页面标题分别为“学习空间 · 本地大观园”和“大观园 · 本地刷题”。两者依赖本地服务共享记录的完整交互由既有自动化覆盖；此阶段没有进行人工做题/保存操作。

## 自动验证

在独立 worktree 执行：

- `npm ci`：成功，lockfile 对应 1 个 package，无已知漏洞。
- `npm test`：134/134 通过，0 失败，0 跳过。命令运行 `test/web-sync.test.mjs`、`sync-extension/test/protocol.test.js`、本地服务、AI、章节导航、UI 合约、入口/下载、双版本、兼容性、搜索等列出的套件。
- `npm run verify`：通过，6342 道题、6342 个唯一题号；现存警告为缺少 21 张题图，需后续提供 `DAGUAN_ASSET_TOKEN` 执行 `npm run sync:data` 才能补齐。本阶段未同步或修改题库。

## 数据与原工作区不变证据

- 检查前后对 `F:\AI\大观园本地\data` 递归文件逐项比较 SHA-256、长度与文件数量：29 个文件、15,096,378 字节，哈希差异 0、增删 0。数据含个人进度、AI 配置和历史备份；清单/哈希记录在快照 `data-before-sha256.json`。内容未打印、未复制进工作分支。
- 检查前后原工作区 27 个未跟踪文件全部仍存在且与快照逐文件哈希一致；差异 0。
- 检查时 `http://127.0.0.1:8080/api/health` 返回 `daguan-local-console` 健康；检查后服务仍可读取健康端点。新版与旧版页面只进行了 GET 检查。

## 尚待独立验收与限制

- 需要验收者亲自看当前浏览器画面与控制台，并在浏览器版完成最小学习操作、确认服务仍运行且原记录可见。本阶段没有截图、没有操作浏览器做题，也没有验证界面实际渲染与记录写入。
- 21 张题图缺失是既有题库校验警告。SEA `--check` 证明旧包可启动检查，不代表它与当前 `main` 构建一致；当前 dist 产物比双版本 main 早约三周。
- 阶段范围止于基线，没有开始共享服务或桌面实现，没有推送、发布、提交历史归档分支，也未运行可能覆盖 `dist/` 的重新打包命令。
