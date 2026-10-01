# Local backup, 2026-10-01

This branch preserves local work and the two archive directories as found. It is a backup, not an integrated or tested product release.

## Source snapshots

- `codex/backup-20261001/main-local-files`: `1bcab61231ce0abde8f474831bf3b63459ceb827`; 32 local files from `F:\AI\大观园本地`.
- `codex/backup-20261001/ui-redesign-worktree`: `d1dfe68169aee3691d106267dc92ac32e09169c9`; 5 local files from `F:\AI\daguan-cxy-local`.
- `codex/backup-20261001/release-v1.0.4-worktree`: `6e085a1107536a77ca46c00d004a80893f4232db`; 6 local files from `F:\AI\daguan-release-v1.0.4`.
- `codex/backup-20261001/desktop-v1.0.3-build-log`: `6f0867577038a1a3abf12e9894624e8f8cfd5abb`; 1 local files from `F:\AI\daguan-desktop-v1.0.3`.
- `codex/backup-20261001/desktop-stage0-local-files`: `b73be3418b2ca9e017b84a9a16bf56d2a367881b`; 1 local files from `F:\AI\daguan-desktop-stage0-worktree`.
- `codex/daguan-desktop-stage0`: original 5 previously unpushed commits, ending at `b30ce0ef181aed1a99503a60eb989baef0a03840`.
- `codex/backup-20261001/snapshot-bundle-history`: imported original `main.bundle` HEAD `c0c8cc9d00f9e78e5abad0d56674d3de1d20008e`.

## Restoring archives

Install Git LFS, clone this branch, and run `git lfs pull`. The two original directories are under `local-backup/`. `manifest.json` records every original archive filename, byte length, SHA-256, and Git blob ID. Text files were stored without newline conversion. A byte-for-byte restore should use `git -c core.autocrlf=false clone --branch codex/backup-20261001/archives https://github.com/Evan26Ma/daguan-cxy-local.git`.

Existing source worktrees, their indexes, and their checked-out branches were preserved. Personal runtime data, ignored dependency directories and ignored build caches from source worktrees are excluded; the two explicitly requested archive directories are preserved in full.
