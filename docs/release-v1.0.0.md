# 大观园数学桌面版 v1.0.0 发布说明

首个桌面版使用 SemVer tag `v1.0.0`，用于 Electron 后台更新服务。桌面 Squirrel 安装器、`RELEASES` 和完整 nupkg 应一并附在同一个非草稿、非预发布 GitHub Release 中；更新服务需要这三项 Windows 资产。浏览器版仍手动更新。

## 本地学习

- 默认打开新版学习空间，旧版可切换；桌面版、浏览器版和两套页面共用本机服务及学习记录。
- 关闭桌面窗口会缩到系统托盘。完全退出前会提醒连接到共享服务的其他窗口即将断开。
- 桌面版会在后台检查并下载更新；只有用户确认“重启并安装更新”后才会重启安装。浏览器版保持手动更新。
- 学习数据、AI 配置和日志保存在本机；日志不会自动上传。卸载默认保留 `%LOCALAPPDATA%\DaguanMath\data`。
- 首次迁移旧浏览器备份时，可先预览，再备份和按修改时间合并进度、收藏、批注及学习位置。外观、快捷键和 AI 草稿不会从旧备份自动迁移。

## Windows 提示

首版按已确认选择未进行代码签名。Windows SmartScreen 可能提示“未知发布者”或显示运行警告。请只从本项目 GitHub Release 下载，并用随附的 SHA-256 校验文件后再安装。

## 下载资产

随此版本发布的文件及校验值如下。

- `DaguanMathDesktop-Setup.exe` — SHA-256 `2139a96a85cf3d5865acb3814ae4241edaa703b0e9ce95f86d327be15816f6ac`
- `DaguanMathDesktop-1.0.0-full.nupkg` — SHA-256 `2b76325236409ae28aeaf2bfe4d9704f9797bc3dd1dfcc7e948295fa891ba379`
- `RELEASES` — Squirrel Windows 更新索引，必须和安装器及完整 nupkg 同时发布
- `DaguanMath-windows-x64.zip` — SHA-256 `bd21f9a6f0827cd1679f900cab9ce2efe08b5e77ca5e5b1bbf9a603f42cdc40f`
- `DaguanMath-windows-x64.exe` — SHA-256 `3ed5c3757037726785d3a3d316fdc53dc85d27b9e952225065342676aeda4003`

每项资产均附有 `.sha256` 校验文件。

## 验收边界

QA Squirrel 身份 `DaguanMathStage4QA` 的 `0.9.0 → 0.9.1` 后台下载、人工确认重启、学习记录保留、跨窗口刷新与更新源不可用回归均已实测。按用户明确选择，正式 `DaguanMathDesktop-Setup.exe` 没有在干净 Windows 用户配置下实装；这项尚未验证，不能用 QA 身份安装替代。题库校验通过 6,342 题，但有 21 张题图缺失警告。
