# 大观园数学题库本地版

本项目是一个本地优先的数学题库 Web/PWA。Node 中控台负责保存本地学习状态，并直接调用大观园 API 读取、写入和导出掌握状态；默认不需要浏览器扩展，也不需要打开大观园官网标签页。

更新记录见 [CHANGELOG.md](CHANGELOG.md)，当前版本为 r7 简明官网同步流程。

`android/` 保留原 Flutter 客户端和兼容数据格式，`web/` 是刷题页面，`local-server/` 是本地中控台，`sync-extension/` 仅作为旧版浏览器桥接兼容方案保留。

## 一键启动

### Windows

如果是开发者或已经安装 Node.js 的用户，双击根目录的 `启动本地题库.cmd`：

1. 自动检查 Node.js 20；
2. 没有 Node.js 时下载并校验便携运行时；
3. 自动执行 `npm ci`；
4. 启动本地中控台；
5. 打开 `http://127.0.0.1:8080/`。

第一次进入页面后，点击“同步进度”，再按引导完成登录、只读测试和首次同步。

普通用户建议直接从 [GitHub Releases](https://github.com/Evan26Ma/daguanyuan-math-local-sync/releases) 下载 `大观园数学题库-windows-x64.zip`：

1. 解压完整 ZIP 文件；
2. 双击 `安装大观园数学题库.cmd`；
3. 安装器会创建桌面和开始菜单快捷方式，并自动启动。

该安装包不需要 Node.js，详细说明见 [Windows 安装说明](packaging/windows/安装说明.txt)。

如果需要自行构建 Windows 单文件程序，可在本机执行：

```powershell
npm run package:windows
npm run package:windows:release
```

生成的 `dist/大观园数学题库-windows-x64.zip` 是可分发的一键安装包。运行数据保存在当前 Windows 用户的 `%LOCALAPPDATA%\DaguanMath\data`，升级程序不会覆盖进度和登录配置。

### 适用设备

- 推荐：Windows 10 22H2 或 Windows 11，64 位 x64 台式机、笔记本和教学机；
- 浏览器：Microsoft Edge 或 Google Chrome 最新稳定版；
- 建议：8 GB 内存、至少 2 GB 可用磁盘空间、1920×1080 或更高分辨率；
- 可在 1366×768、平板式 Windows 窗口和 125%/150% 缩放下使用，但题目区会自动进入紧凑布局；
- 当前发布包不提供 32 位 Windows、原生 ARM64、Firefox 和移动端安装包；Linux/Docker 仍需使用对应脚本。

### Linux

```bash
bash scripts/install-linux.sh
```

脚本会检查或安装 Node.js 20、安装依赖、创建 systemd 用户服务并启动本地中控台。

### Docker

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

`data/` 会挂载到容器外，登录信息、学习状态、同步备份和日志会在重启后保留。

## 同步流程

首次连接和日常同步的逐步说明见 [使用教程](docs/使用教程.md#2-配置大观园同步)。

首页“数据同步中心”提供：

- 同步进度：先只读检查两边变化，再确认更新本地或上传官网；
- 完成后：先备份并写入本地，再按确认内容写入官网并复读校验；
- 高级选项：导出本地数据、官网快照和 Android 兼容包。

默认行为：启动后只检查本地中控台和登录状态；首页点击“同步进度”会自动开始只读检查，涉及官网写入时必须明确确认。

Token 只保存在本机 `data/cxyonly-integration.json`，不会返回给网页、写入导出文件或写入日志。

## 开发与验证

```bash
npm ci
npm start
npm test
npm run verify
```

默认服务地址：`http://127.0.0.1:8080/`。

重新下载题库资源：

```bash
npm run sync:data
```

题库缺图时，可按 `tools/sync-web-data.mjs` 的说明提供临时 `DAGUAN_ASSET_TOKEN`；本地页面不会回退加载外部图片或 CDN。

## 安全边界

- Node 默认只监听 `127.0.0.1`；
- Token 文件和同步备份不纳入 Git；
- 官网 API 发生变化时，只需调整 `local-server/cxyonly-client.mjs`；
- `sync-extension/` 不参与默认同步流程；
- 本项目不是大观园官方客户端，题库内容及相关权利归原权利人所有。
