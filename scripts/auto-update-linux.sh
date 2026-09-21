#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${DAGUAN_SERVICE_NAME:-daguan-cxy.service}"
LOCK_FILE="${DAGUAN_UPDATE_LOCK:-/run/lock/daguan-cxy-update.lock}"
GIT_USER="${DAGUAN_UPDATE_USER:-ubuntu}"

git_as_user() {
  runuser -u "$GIT_USER" -- git -c "safe.directory=$ROOT" "$@"
}

log() {
  printf '[daguan-update] %s\n' "$*"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "已有更新任务运行，跳过本次检查"
  exit 0
fi

cd "$ROOT"

branch="$(git_as_user symbolic-ref --quiet --short HEAD || true)"
if [[ -z "$branch" ]]; then
  log "当前不是普通分支，跳过自动更新"
  exit 0
fi

upstream="$(git_as_user rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$upstream" ]]; then
  log "分支 $branch 没有上游分支，跳过自动更新"
  exit 0
fi

if [[ -n "$(git_as_user status --porcelain --untracked-files=normal)" ]]; then
  log "工作区存在本地改动，跳过自动更新；请先提交或妥善处理这些改动"
  exit 0
fi

log "检查 GitHub 更新：$upstream"
git_as_user fetch --prune origin "$branch"

local_commit="$(git_as_user rev-parse HEAD)"
remote_commit="$(git_as_user rev-parse "$upstream")"
if [[ "$local_commit" == "$remote_commit" ]]; then
  log "已经是最新版本：${local_commit:0:12}"
  exit 0
fi

if ! git_as_user merge-base --is-ancestor "$local_commit" "$remote_commit"; then
  log "远端不是当前版本的快进更新，跳过以避免覆盖本地历史"
  exit 0
fi

worktree="$(runuser -u "$GIT_USER" -- mktemp -d /tmp/daguan-cxy-update.XXXXXX)"
cleanup() {
  git_as_user worktree remove --force "$worktree" >/dev/null 2>&1 || true
  git_as_user worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "在临时工作树校验新版本：${remote_commit:0:12}"
git_as_user worktree add --detach "$worktree" "$remote_commit" >/dev/null
if ! runuser -u "$GIT_USER" -- bash -c 'cd "$1" && npm test && npm run verify' -- "$worktree"; then
  log "新版本校验失败，保留当前运行版本"
  exit 1
fi

git_as_user worktree remove --force "$worktree" >/dev/null
trap - EXIT
git_as_user worktree prune >/dev/null 2>&1 || true

log "快进更新到 ${remote_commit:0:12}"
git_as_user merge --ff-only "$remote_commit"
systemctl restart "$SERVICE_NAME"
log "更新完成，已重启 $SERVICE_NAME"
