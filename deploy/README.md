# Linux 部署

## Docker

在仓库根目录执行：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

访问 `http://服务器地址:8080/`。

## 无 Docker

```bash
python3 -m http.server 8080 --directory web
```

官网同步需要在访问本地站点的浏览器中安装 `sync-extension/`，并在扩展允许来源中配置实际部署地址。
