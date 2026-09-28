# 大观园数学桌面版 v1.0.1

v1.0.1 为 Windows x64 桌面版提供新版品牌图形，并通过现有 Squirrel 更新通道向已安装的 v1.0.0 提供在线更新。进度、收藏、批注、学习位置和本机 AI 配置保持在原数据目录中。

桌面程序启动后约 15 秒开始检查更新，之后每 6 小时检查一次。更新在后台下载；下载完成后，用户可以在桌面程序或托盘菜单中选择“重启并安装更新”。更新不会自动打断正在使用的窗口。

## 发布资产与 SHA-256

- `DaguanMathDesktop-Setup.exe` — `30e62de0a02f403f17ea4011b3f443d112a9b8ba93153b94cbbba17512d61e91`
- `DaguanMathDesktop-1.0.1-full.nupkg` — `6d6f137e56122fbc6c8d504d88aa1af8aabd5547967732a9120302de016acc29`
- `RELEASES` — `e475cb5d41acb114faf64dbd5cfcc51a9230ab6f71f8f7ec53a473c048ebcf8b`

在线更新必须保留 `RELEASES` 与匹配的完整 `.nupkg` 文件。单独上传安装器或源码推送不会触发已安装客户端更新。当前版本未进行代码签名，Windows SmartScreen 仍可能提示未知发布者。

题库校验通过 6,342 道题；现有数据仍有 21 张缺失题图警告。
