# 大观园数学题库本地版

本项目是一个本地优先的数学题库 Web/PWA。Node 中控台负责保存本地学习状态，并直接调用大观园 API 读取、写入和导出掌握状态；默认不需要浏览器扩展，也不需要打开大观园官网标签页。

`android/` 保留原 Flutter 客户端和兼容数据格式，`web/` 是刷题页面，`local-server/` 是本地中控台，`sync-extension/` 仅作为旧版浏览器桥接兼容方案保留。

## 一键启动

### Windows

双击根目录的 `启动本地题库.cmd`：

1. 自动检查 Node.js 20；
2. 没有 Node.js 时下载并校验便携运行时；
3. 自动执行 `npm ci`；
4. 启动本地中控台；
5. 打开 `http://127.0.0.1:8080/`。

第一次进入页面后，点击“设置同步”，输入大观园登录码即可完成配置。

如果希望发给没有 Node.js 的新电脑，可在本机执行：

```powershell
npm run package:windows
```

生成的 `dist/大观园数学题库.exe` 是 Windows 单文件便携程序，双击即可启动；运行数据保存在当前 Windows 用户的 `%LOCALAPPDATA%\DaguanMath\data`，升级程序不会覆盖进度和登录配置。

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

首页“数据同步中心”提供：

- 检查差异：读取官网掌握、收藏、最近学习和活动，生成统一对账计划；
- 应用对账：先备份并写入本地，再按计划写入官网并复读校验；
- 导出本地数据：导出本地状态 JSON；
- 导出官网快照：直接从大观园读取并导出当前状态。

默认行为：启动后只检查本地中控台和登录状态；官网掌握、收藏、最近学习和活动请在同步中心手动检查差异并确认应用。

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
