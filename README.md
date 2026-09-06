# 大观园数学题库本地版

本项目提供一个可离线运行或部署到服务器的本地 Web/PWA 刷题站，并通过浏览器扩展安全地与大观园官网同步掌握状态和收藏。

目录中的 `android/` 保留原 Flutter 客户端，作为移动端进度格式和题图资源参考；Web 端刷题入口是 `web/`。

---

## ⚡ 最快开始（快速上手）

### Windows 用户（推荐一键启动）
直接双击仓库根目录下的 **`启动本地题库.cmd`** 即可自动运行本地服务并拉起浏览器打开 `http://localhost:8080/`。

> 详细图文与进阶使用说明，请参阅 📖 **[完整使用教程](docs/使用教程.md)**。

---

## 本地启动（手动方式）

```bash
# Python 3
python3 -m http.server 8080 --directory web
```

打开 `http://localhost:8080/`。

## Docker 启动

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```
Windows 用户亦可双击 `启动本地题库-Docker.cmd` 启动。

## 官网同步

首次使用时，首页的“数据同步中心”会打开配置向导，按“安装扩展 → 登录官网 → 绑定扩展 → 测试读取”完成配置。

1. 在 Chrome 或 Edge 中加载 `sync-extension/` 未打包扩展。
2. 打开并登录 `https://www.cxyonly.fans/math`。
3. 从扩展弹窗复制扩展 ID，粘贴到向导中。
4. 点击“测试读取官网数据”确认通信正常。
5. 以后直接从首页点击“从官网读取”或“同步到官网”。

首页也提供了“数据同步中心”，配置完成后可以直接点击“从官网读取”或“同步到官网”，不必再从侧栏进入。

浏览器不允许普通网页静默安装扩展，也不允许网页自动读取另一个域名的登录 Cookie。因此扩展安装和官网登录仍需用户确认；完成一次配置后，日常同步都在本地网页中操作。

同步只处理掌握状态和收藏，不传输登录令牌、手写数据或文字笔记。写入官网前会先自动下载官网状态备份。

页面也暴露了 `sync.status()`（以及稳定别名 `daguanSync.status()`）、`pullOnlineProgress()`、`previewPush()` 和 `pushProgress()`；它们仍通过扩展转发，不会让本地页面直接接触官网令牌。

## 数据同步

当前题库数据来自线上静态题库。执行以下命令可重新下载题库和本地依赖：

```bash
npm run sync:data
```

如果题图接口要求登录令牌，设置临时环境变量后再运行：

```bash
# PowerShell
$env:DAGUAN_ASSET_TOKEN = "临时令牌"
npm run sync:data
```

令牌不会写入仓库。缺少题图时，页面会显示本地占位图，不会回退请求外部 URL。

当前快照已复用 Android 客户端中 1297 张同哈希题图；线上题库新增或需要权限的题图仍需提供临时 `DAGUAN_ASSET_TOKEN` 后补齐。

## 验证

```bash
npm test
npm run verify
```
