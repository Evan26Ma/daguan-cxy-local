# Linux / Docker 部署

## Docker

在仓库根目录执行：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

默认仅绑定本机 `127.0.0.1:8080`。首次打开后，在本地配置向导输入大观园登录码。

## Linux 原生安装

```bash
bash scripts/install-linux.sh
```

脚本会自动安装或使用 Node.js 20，并创建 systemd 用户服务。默认只监听 `127.0.0.1`。

### 从 GitHub 自动更新

服务器版可以安装定时更新器。它每 15 分钟检查当前分支的上游 GitHub 分支；只有工作区干净、远端提交可以快进合并，并且新版本通过 `npm test` 和 `npm run verify` 时，才会更新代码并重启服务：

```bash
sudo install -m 644 deploy/daguan-cxy-update.service /etc/systemd/system/daguan-cxy-update.service
sudo install -m 644 deploy/daguan-cxy-update.timer /etc/systemd/system/daguan-cxy-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now daguan-cxy-update.timer
```

查看更新器状态和日志：

```bash
systemctl status daguan-cxy-update.timer
journalctl -u daguan-cxy-update.service -n 80 --no-pager
```

更新器不会覆盖本地未提交改动；发现工作区不干净时会跳过本轮检查。

## 配置

可通过环境变量调整：

```text
PORT=8080
HOST=127.0.0.1
DAGUAN_BASE_URL=https://www.cxyonly.fans
DAGUAN_PULL_INTERVAL_MINUTES=30
# 公开预览版：开启后题库可浏览，但收藏、错题、批注、同步和 AI 等个人功能需要密钥
DAGUAN_PREVIEW_MODE=1
DAGUAN_PREVIEW_KEY=请替换为随机长密钥
```

配置预览版时，建议把密钥放在服务环境文件中，不要写进仓库或前端代码。例如 Linux 可以创建 `/etc/daguan-cxy-preview.env`：

```text
DAGUAN_PREVIEW_MODE=1
DAGUAN_PREVIEW_KEY=请替换为随机长密钥
```

预览密钥只用于解锁个人操作，不等同于大观园官网登录码。未配置 `DAGUAN_PREVIEW_KEY` 时，应用保持普通本地模式；配置后，未解锁访客只能浏览题库和查看答案解析。解锁会写入一个 HttpOnly 会话 Cookie，默认有效 365 天，前端版本更新或服务重启不会要求重新输入。

如果前面还部署了“信任设备 / Token”网关，公开预览时还需要将网关设置为 `CXY_AUTH_PUBLIC_PREVIEW=1`，否则访客仍会先看到网关的 Token 页面。启用后由本地中控台的 `DAGUAN_PREVIEW_KEY` 保护个人功能。

如需局域网访问，必须同时配置反向代理、HTTPS 和本地 API 访问保护；不要直接把未保护的中控台暴露到公网。
