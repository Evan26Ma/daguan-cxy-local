# iPad 移植候选验证记录

日期：2026-10-12。初次 Windows 开发验证使用 `codex/service-startup-recovery` 工作区。用户随后授权独立分支推送和云端构建；从干净基线 `ad14926c7c600e012488bfffea6f48b614c170e6` 创建 `codex/ipad-native`，只提交 iPad 相关文件。云端使用已提交前端和资源，未混入桌面未提交改动；main 和公开 Release 未变，未安装真实设备。

## 已执行

- `node --test test/ios-bridge.test.mjs test/ios-packaging.test.mjs test/ios-browser.test.mjs`：13 项通过，0 失败、0 跳过。包含 9 项桥协议 VM 测试、3 项实际资源打包测试、1 项 Chromium DOM 测试。
- 请求测试覆盖 Request 方法/正文/信号、响应二进制封装、外部来源与路径限制、取消与超时、迟到响应清理；AI 流覆盖事件格式、关闭、中止与缓冲上限。
- 持久化测试覆盖串行保存、磁盘失败后保留未保存状态、手动重试、缺少原生快照拒绝写入、导出前排空、重载冻结与失败恢复。
- 资源测试使用实际 web 目录，检查文件哈希、可重复构建、缺图题号、overlay 扫描、未知文件拒绝删除和上游转换点变化时中止。
- Chromium 测试验证复制后的安全渲染接受受限 daguan 图片、隐藏不支持入口、保存错误提示和 Files 文件输入。**这不验证 WKWebView 自定义协议或真实 Files 交互。**
- `npm test`：404 项中 403 通过，1 失败，0 跳过。唯一失败为既有 `test/explanations-v2.test.mjs` 数据契约：`#7947 不在题库 id_index 里`。该失败在原有 v1.0.14 文档中已有记录；本次没有修改题库消除它。完整测试运行后增加的重载及打包用例已在最终 13 项专门测试中重新执行。
- `npm run verify`：通过，7,119 道题和 7,119 个唯一题号；警告缺少 41 张图片，涉及 42 个题号。实际生成资源清单包含 3,436 个文件、515,681,290 字节（不含清单自身），其中题图 3,318 个、字体 60 个。这是未压缩资源大小，不是 IPA 大小。移植包保留缺图诊断与缺图占位，不宣称全部内容完整离线。
- 已清理本次独立资源验证目录和 Swift 语法解析器临时依赖，共释放 521,521,825 字节，约 497.4 MiB；测试自身临时目录自动清理。未在仓库保留整份资源副本，构建时可重新生成。
- 15 个 Swift 文件（Sources、Tests 和 Package.swift）通过 tree-sitter 语法解析，0 语法错误；这不等于 Swift 编译或类型检查。已有活动、历史和手账相关 Node 契约测试另运行 14 项，全部通过。
- 构建脚本通过 `bash -n`；针对新增原生容器和核心做静态复核，修正 Swift 语言模式、重载快照覆盖、处理器持有循环、流式事件顺序、陈旧 IPA 条目、过期模型测试结果和原生请求取消等问题。

## 云端原生编译与测试（已执行）

Swift XCTest 共 31 项：Storage 13 项，AI parser 6 项，AI router 12 项。覆盖 revision、损坏文件保护、批注、活动和历史、备份合并、KV 重启、UTF-8 分块、思考过滤、Keychain 隔离、模型测试、视觉上下文、聊天历史上限、失败与取消、配置变更竞态等。

首次云端 run [38260632064](https://github.com/Evan26Ma/daguan-cxy-local/actions/runs/38260632064) 对独立分支 commit `3aefd931a766315d12dea71d87e9390071edd230` 执行，使用 macOS-15 / Xcode 16.4 / iOS SDK 18.5。31 项 XCTest 全部通过；模拟器 `BUILD SUCCEEDED` 和 arm64 设备 `ARCHIVE SUCCEEDED`，产出 unsigned IPA，最低 iPadOS 16.0；首次包核验发现 Info.plist 使用了 XcodeGen 默认版本 1.0，后续已显式设置为 0.1.0。没有个人签名或真实 iPad 安装结果。

首次下载核验发现 Mac 默认 zip 未给中文分片文件名设置 UTF-8 flag。已改为 Python ZipFile 创建标准 UTF-8 IPA，并添加 CRC/文件名检查；旧 `3aefd93` 包不作为最终推荐安装包。后续候选还增加 DEBUG-only iPad 模拟器实际启动与冷重启保存检查，结果以对应云端运行及下载核验为准。

## 实际启动排错记录

- run 38263271851 暴露首次导航被误判为重载，已在原生 load 前授权一次性初始 URL；随后 run 38264575440 确认导航允许，但云端 WebKit 冷启动约 62 秒超过原 45 秒测试限时。DEBUG 测试限时调整为 120 秒，未改变生产加载策略。
- run 38266010816 和 38268101681 使用 SDK 同版本 iOS 18.5 运行环境。后者控制台与 `.ips` 明确显示 `DYLD Library missing: /usr/lib/swift/libswiftWebKit.dylib`，应用尚未进入 viewDidLoad 就退出。原因对应 [WebKit bug 293831](https://bugs.webkit.org/show_bug.cgi?id=293831)，影响较低 deployment target 使用 Swift WebKit overlay 的 18.4/18.5 模拟器；云端测试改用已修复的 iOS 18.6 运行环境，保留应用最低 iPadOS 16.0。
- 启动诊断仅在 DEBUG 模拟器条件编译，逐阶段原子保存进度并收集控制台、进程和崩溃证据。生产包不包含测试运行入口。

## 实际 WKWebView 验收（已执行）

[run 38269386161](https://github.com/Evan26Ma/daguan-cxy-local/actions/runs/38269386161) 构建 commit `35733489e668855b2d2ebf0eaf859ec28f3961c7`，使用 iOS 18.6 iPad mini A17 Pro 模拟器。真实新版页面加载、document-start 桥注入、daguan 资源协议、CSS、图片解码、7,119 条搜索索引、题号 129 的公式和题干 DOM 均通过。写入阶段 19 项、冷重启读取阶段 22 项检查通过；revision 从 0 增至 3，终止进程后重新启动读到 revision 3，收藏与批注同时在磁盘、前端缓存和题目界面恢复。初次 navigation-finished 约 5.90 秒，冷重启约 1.19 秒。测试资源及数据都在新建并销毁的隔离模拟器中。

该证据覆盖真实 WKWebView 启动和已确认保存数据的进程重启恢复，不等于实机签名、飞行模式、触控、系统分享或全部功能验收。

同一 run 全部成功，设备 arm64 archive 成功，最终 `DaguanPad-unsigned.ipa` 下载后核验：429,557,224 字节（约 409.7 MiB），应用版本 0.1.0/build 1，iPad family 2，最低系统 16.0，嵌入 DaguanCore.framework。ZIP CRC、无重复条目、中文文件名 UTF-8 标记及 3,436 个随包资源 SHA-256 全部通过，没有签名 provisioning profile。IPA SHA-256：`f4558560ea8567e1515ab6121272d688cdd275b2b3c154eb48f95a4aa874997a`。缺图报告仍为 41 张、42 个题号，completeOffline=false。

## 尚待原生验收的限制

- 系统文件选择/分享仍需真实 iPad 验证。
- 飞行模式冷启动、内存占用、横竖屏/分屏、键盘、已确认数据保存、强制结束与同标识升级需实机证据。
- 普通 native 请求取消为协作式；取消不会撤回已完成的学习数据写入。
- 原生存储按单文件原子写入，状态、活动和历史导入不是跨文件事务。磁盘错误可能造成部分完成，需要保留备份并重试；不能宣称整份恢复具有全局原子性。
- 首版限制单应用场景，避免多个原生 store 实例同时写同一沙盒；没有提供跨进程写锁。
- 学习备份不包含 AI 密钥和聊天历史。视频和 AI 需要网络，图形增强接口明确不可用。
- 工作流已在专用分支实际运行并产出 Actions 资产，没有修改 main 或创建公开 Release。

Mac 上的入口为 `bash ios/build.sh simulator`、`bash ios/build.sh device`；源码和安装流程见 `README.md`。原生技术验证未通过前，本候选保持开发状态。
