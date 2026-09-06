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

## 配置

可通过环境变量调整：

```text
PORT=8080
HOST=127.0.0.1
DAGUAN_BASE_URL=https://www.cxyonly.fans
DAGUAN_PULL_INTERVAL_MINUTES=30
```

如需局域网访问，必须同时配置反向代理、HTTPS 和本地 API 访问保护；不要直接把未保护的中控台暴露到公网。
