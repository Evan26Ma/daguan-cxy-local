# 大观园 iPad 独立版开发候选

此目录包含 Swift/WKWebView 移植工程。网页复用仓库当前新版界面；题库随包，学习记录保存到 iOS 应用沙盒，联网 AI 由原生 URLSession 请求，密钥保存到 Keychain。

**当前状态：31 项原生测试、云端 macOS/Xcode 编译及真实 iPad 模拟器 WKWebView 启动/冷重启恢复检查通过。** 候选构建见 [Actions 38269386161](https://github.com/Evan26Ma/daguan-cxy-local/actions/runs/38269386161)，源码 commit `3573348`。unsigned IPA 用于个人重签；尚未进行个人签名或真实 iPad 安装验收，实机键盘、分屏、Files 与用户 AI 服务仍待验证。首次 `3aefd93` 包存在中文 ZIP 路径标记和版本字段问题，已修正，不推荐安装旧包。

## 构建

需要 macOS、Xcode 16 或更新版本、Node.js 22、XcodeGen。构建使用当前工作区 `web/` 内容，请在正式构建前确认基线；不会读取桌面版用户数据。

```sh
brew install xcodegen
bash ios/build.sh simulator
bash ios/build.sh device
```

模拟器命令先生成题库资源和 Xcode 工程，运行 `swift test`，再编译模拟器应用。device 命令生成 `ios/build/DaguanPad-unsigned.ipa`，它是待签名输入，不能直接安装。生成物均不入库。

`.github/workflows/ios-build.yml` 在 `codex/ipad-native` 分支推送相关文件时自动构建，也保留手动入口。工作流已实际运行，不公开 Release；Actions 产物保留 7 天，下载后的 IPA 可本地保留。

## 自签与安装

在 Mac 上打开生成的 `ios/DaguanPad.xcodeproj`，选择 DaguanPad target，在 Signing & Capabilities 中选择自己的 Apple Team、设置唯一 Bundle Identifier，再选连接的 iPad 构建安装。必要时在设备上开启开发者模式并信任签名。

也可以用支持当前 iPadOS 的个人侧载工具重签 unsigned IPA；工具使用自己的 Apple ID 和设备注册生成 Apple 开发签名。免费个人账号的签名通常约 7 天，需要续签；付费开发账号的有效期及设备规则按 Apple 当前要求执行。不要把 Apple 密码、证书或 provisioning profile 写进仓库。

保持 Bundle Identifier 和签名安装方式一致，更新前导出学习备份。删除应用会删除沙盒数据；续签和升级的保留行为须实测，不能把卸载当成续签步骤。

## 数据与功能边界

- 首版只提供新版界面，Windows 运行、存储迁移、远程隧道与官网账号同步入口不提供。
- 题库、公式字体、文字与已具备的图片解析打包到应用；讲解视频和 AI 需要网络。
- 当前题图引用存在缺失。资源脚本会产出哈希清单及缺图报告，缺图必须补齐或明确告知；不能据打包成功声称全题库完整离线。
- 学习 JSON 备份继续采用现有格式；当前格式不包含 AI 档案密钥或聊天历史。导出会打开系统分享窗口，实际保存操作由用户完成。
- iOS 原生 JSON 存储保留 revision、批注历史、访问历史和活动事件。损坏文件保留并报错，不自动清空。同一沙盒只使用一个存储 actor，首版限制单应用场景；各 JSON 文件原子写入，备份恢复不是跨文件事务，磁盘故障或中断可能需要重试。
- 网页同步存储使用内存快照，原生异步确认落盘；发生落盘错误会显示可重试提示。突然强制终止前未确认的操作不能宣称已保存，必须用实机测试确定恢复边界。
- AI 密钥在 Keychain，聊天记录在沙盒；Keychain 的卸载/重装保留行为和分享备份相互独立。Python 图形生成不在 iOS 上执行，原生图形增强接口当前明确返回不可用；新版普通 AI 对话仍提供文字与公式回答。

## 验收门槛

1. Mac 上通过 `swift test`、模拟器构建和设备构建；检查 app 内资源闭包及缺图清单。
2. iPad 飞行模式冷启动，搜索、做题、打开解析、收藏、批注、笔记、学习记录均可使用。
3. 检查后台切换、强制结束、重启和同标识升级后的已确认数据；损坏文件保护与 revision 冲突有测试证据。
4. 电脑版与 iPad 学习备份往返；Files 导入、分享导出和恢复确认窗口可用。
5. AI 档案、模型测试、流式/非流式、题图、停止、断网及后台取消通过；失败回答不写成成功历史。
6. 横竖屏、分屏、软键盘、长题目与长解析通过；校验桥仅主页面可调用、外链由系统浏览器打开。

实际验证证据见 `VALIDATION.md`。未通过的项目不得记作完成。
