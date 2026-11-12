# 大观园数学桌面版 v1.0.18

本版优化新版 AI 提问输入，并修复中文输入法选词回车误发送。发布候选从 `origin/main` 的 `0ac4206` 独立整理，未纳入主工作区既有的模拟考试、李林题库导入及其他未提交改动。

## 修复行为

- 输入框高度由独立、不可见的测量器计算，缓存字体与宽度，并把同一帧内的多次输入合并为一次测量；高度不变时不重写可见输入框。
- 中文组合输入期间暂停量高，选词结束后合并处理；普通回车发送和 Shift+Enter 换行继续保留。
- 输入法组合状态、`isComposing` 和 `keyCode === 229` 均会阻止误发送。
- 保留一至五行自动增高、长草稿滚动、回删收缩、切题草稿、字号与面板宽度变化，以及测量器清理。
- 本版同时交付 v1.0.17 后已合入主线的全库搜索 v2、真题题号修正、概率题库精讲、朱红奶白默认主题，以及题目返回来源列表与浏览位置保留。

## 验证记录

- 独立锁定依赖的发布候选 `npm test`：368 项，367 通过、1 失败、0 取消、0 跳过。唯一失败为主线既有的图片附卷题号契约：`2012数二-img` 缺少 10 而包含 23；与本次输入修复无关，题库数据及该测试均未改动。
- 新增 Chromium 输入回归 7/7 通过，覆盖 IME、普通回车/Shift+Enter、同步与异步几何读取、合帧测量、1–5 行、回删、字号/宽度、切题草稿与断开清理。相同 AI 模块的隔离 WebKit 回归已在网站修复阶段 7/7 通过，不把 Windows WebKit 测量等同于真实 iPad 软键盘验收。
- `npm run verify`：7,599 道唯一题目通过，保留 95 张既有题图缺失警告。
- 实际打包的 `DaguanMath.exe` 使用 F 盘独立数据目录与 profile 启动，包内、主进程及新旧界面版本均为 `1.0.18`；新旧界面脚本错误为 0。新版 IME Enter/229/组合状态保护、普通 Enter、Shift+Enter、1→3→5→1 行高度变化与组合输入延后量高全部通过。验收关闭应用后，隔离目录已删除。
- nupkg 内 8 个 AI/入口/缓存文件与候选逐字节一致；随包题库 7,599 题，分片名已 ASCII 化，未包含个人数据、实例锁或测试/文档/报告目录。
- Squirrel `RELEASES` 指向 `DaguanMathDesktop-1.0.18-full.nupkg`，大小 577,881,696 字节，SHA-1 `3cfc76874f1a880d2d5faa592bba4f7ab89adbc9`；三份资产与三份 SHA-256 sidecar 已核验。

## 构建与发布

- package/app version：`1.0.18`；目标 tag：`v1.0.18`。
- 使用 `npm ci` 安装锁定依赖；Electron Forge CLI / maker-squirrel 为 7.11.2，Electron 为 44.4.5。
- Electron 官方 Windows x64 ZIP 的 SHA-256：`11c395820a5aaa8ebcc0686b476d0ac98a730274ebfbdc8cf5538a7c2815cb5d`。
- 构建源提交：`bddb3f21b93bab541fb8af1568dd52bc848a0741`；命令为 `npm run package:desktop:windows`。后续验收记录只修改本发布文档，不改变应用代码或随包资源。
- 正式资产为 `DaguanMathDesktop-Setup.exe`、`DaguanMathDesktop-1.0.18-full.nupkg`、`RELEASES` 及三份 SHA-256 sidecar。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `DaguanMathDesktop-Setup.exe` | 578470400 | `6350c8ba3ccf0d9c819cc9c2b0976fa7650835a5d3e95a91feab7e8e32d1bc03` |
| `DaguanMathDesktop-1.0.18-full.nupkg` | 577881696 | `d68cdcdac207f720a40aa916b24f932efa31270ab6126e39d84f29faccedfb42` |
| `RELEASES` | 89 | `14683e4b546bbc2965fb6195c7bb7540d9e6f05e68c3480d415ec7af425685e3` |

## 使用边界

- 沿用未签名发行；真实 iPad Safari 软键盘体验与 Windows 上的 WebKit 测量分别记录，不将后者写成真机验收。
- 当前随包题库仍为 7,599 道题，题图缺失警告以本次 `npm run verify` 输出为准；线上活动题库属于独立部署，不能以随包数据覆盖。
- 正式 Setup 在干净 Windows 用户配置中的安装，以及通过公开旧版自动更新完成升级的情况，均以实际验收记录为准。
- 本次不更换百度网盘分享中的旧安装器；公开版本与新安装包以 [GitHub Release v1.0.18](https://github.com/Evan26Ma/daguan-cxy-local/releases/tag/v1.0.18) 为准。
