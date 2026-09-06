#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="20.19.3"
RUNTIME_ROOT="$ROOT/.runtime"

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "不支持的 Linux 架构：$(uname -m)" >&2; exit 1 ;;
  esac
}

ARCH="$(detect_arch)"
if [[ "$ARCH" == "x64" ]]; then
  NODE_SHA256="76272878069683c3a36b933d2f4842436a26b527daa930ae9346b477011ee2f3"
else
  NODE_SHA256="8e6939f63b736470bf2cbda596ab62393f26d9af9d7046d61270899880d4f149"
fi
NODE_DIR="$RUNTIME_ROOT/node-v$NODE_VERSION-linux-$ARCH"
NODE_BIN="$NODE_DIR/bin/node"

system_node=""
if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]]; then
  system_node="$(command -v node)"
fi

if [[ -n "$system_node" ]]; then
  NODE_BIN="$system_node"
else
  mkdir -p "$RUNTIME_ROOT"
  archive="$RUNTIME_ROOT/node-v$NODE_VERSION-linux-$ARCH.tar.xz"
  url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz"
  if [[ ! -x "$NODE_BIN" ]]; then
    command -v curl >/dev/null 2>&1 || { echo "需要 curl 才能自动安装 Node.js" >&2; exit 1; }
    echo "未检测到 Node.js 20，正在下载便携运行时..."
    curl -fL "$url" -o "$archive"
    actual="$(sha256sum "$archive" | awk '{print $1}')"
    [[ "$actual" == "$NODE_SHA256" ]] || { echo "Node.js 下载校验失败" >&2; exit 1; }
    tar -xJf "$archive" -C "$RUNTIME_ROOT"
  fi
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"
mkdir -p "$ROOT/data/cxyonly-backups"
"$NPM_BIN" ci --ignore-scripts --no-audit --no-fund

if command -v systemctl >/dev/null 2>&1; then
  service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$service_dir"
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__NODE__#$NODE_BIN#g" deploy/daguan-math.service > "$service_dir/daguan-math.service"
  systemctl --user daemon-reload
  systemctl --user enable --now daguan-math.service
  echo "已安装并启动 systemd 用户服务 daguan-math.service"
else
  echo "未检测到 systemd，直接启动本地中控台。"
  exec "$NODE_BIN" "$ROOT/local-server/server.mjs"
fi
