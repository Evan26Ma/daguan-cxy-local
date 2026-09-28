# 本地大观园

<div align="center">
  <a href="https://space.bilibili.com/6536560">
    <img src="https://i1.hdslb.com/bfs/face/57ae07cd5d54f25f86bc6df213de143aed9f6491.jpg" width="112" height="112" alt="澄潇宇 B 站头像">
  </a>
  <h2>🌟 特别鸣谢：澄潇宇（帕拉迪宇）</h2>
  <p><strong>本项目特别感谢澄潇宇提供的支持，以及他对“大观”系列的系统整理、讲解与公开分享。</strong></p>
</div>

> 👤 **B 站账号：** [澄潇宇·大观全系列](https://space.bilibili.com/6536560) · [帕拉迪宇·早期账号](https://space.bilibili.com/3546659988441400)
>
> **账号说明：** “帕拉迪宇”是早期账号；下方已单独列出“极限大观”，其余课程按澄潇宇的“考研数学大观全系列”合集整理。

## 🎬 大观视频导航

### ⭐ 先看使用教程

- **[CXY-000#0《大观使用说明：一个视频教给你如何使用数学大观》](https://www.bilibili.com/video/BV1KSDxBkEKJ/)**
- **[《考研数学大观全系列》合集入口（共 17 个视频）](https://www.bilibili.com/video/BV1THN36xE41/)**

### 📘 高等数学公共部分

1. [积分计算大观](https://www.bilibili.com/video/BV1gmReBDEUz/)
2. [积分应用大观](https://www.bilibili.com/video/BV1yHE56FEaf/)
3. [反常积分大观](https://www.bilibili.com/video/BV1hEykBjEdX/)
4. [二重积分大观](https://www.bilibili.com/video/BV1rPtQegEtk/)
5. [极限大观](https://www.bilibili.com/video/BV1NKVpzREDV/)
6. [一元微分大观](https://www.bilibili.com/video/BV1z9H4z2EyY/)
7. [多元微分大观](https://www.bilibili.com/video/BV1FShNzVErn/)
8. [微分方程大观](https://www.bilibili.com/video/BV1CpM8ztEaX/)

### 📙 高等数学（数学一、数学三专项）

1. [级数大观](https://www.bilibili.com/video/BV1THN36xE41/)

### 📗 线性代数

1. [线性代数大观（上篇）](https://www.bilibili.com/video/BV1aeUWYUEiT/)
2. [线性代数大观（下篇）](https://www.bilibili.com/video/BV1shzdYqEXq/)
3. [二次型大观（上篇）](https://www.bilibili.com/video/BV1wh4y1P7rj/)
4. [二次型大观（中篇）](https://www.bilibili.com/video/BV1K34y1K7rx/)
5. [二次型大观（下篇）](https://www.bilibili.com/video/BV1Wu411A78B/)

### 📕 概率论与数理统计

1. [概率论](https://www.bilibili.com/video/BV1LDqJB6ELz/)
2. [数理统计（上篇）](https://www.bilibili.com/video/BV1FN41177AD/)
3. [数理统计（下篇）](https://www.bilibili.com/video/BV1UN411V769/)

---

> **Windows 桌面版（推荐）：**普通用户从百度网盘下载，桌面版会在后台检查更新，下载后等你确认重启。
> [⬇️ 下载桌面版 `DaguanMathDesktop-Setup.exe`（提取码 dgy1）](https://pan.baidu.com/netdisk/share?surl=VrW0Z-ThDSM7f_xx7uCUZw) · [网页版服务包 ZIP（提取码 wweb）](https://pan.baidu.com/netdisk/share?surl=VJwUxgElbURfw7Aj4Gpy4Q) · [📖 Windows 安装教程](docs/Windows新手安装与配置.md)

一个在自己电脑上运行的大观园数学题库增强版：题目更适合连续刷，学习进度保存在本机，可选同步官网进度，也可选连接 AI 助教。普通 Windows 用户安装桌面版即可开始学习，不需要安装 Node.js 或使用命令行。

## 源码版本怎么选

| 分支 | 用途 |
|---|---|
| [`main`](https://github.com/Evan26Ma/daguan-cxy-local/tree/main) | 当前源码主线：默认打开新版学习空间，保留可切换的旧版界面。 |
| [`legacy/pre-redesign-2026-09-27`](https://github.com/Evan26Ma/daguan-cxy-local/tree/legacy/pre-redesign-2026-09-27) | 改版前完整旧版的归档分支，固定在提交 `28a1a6c`；适合回看或从旧版源码继续开发。 |

桌面版默认使用新版，也可切换到旧版；两套学习界面共用本机学习数据，外观偏好分别保存。桌面版后台检查 GitHub Release 更新，下载完成后由用户决定何时重启。

## 它和原版大观园有什么不同？

本项目不是大观园官方客户端，也不替代官网账号体系、题库版权和官方服务。原版大观园负责题库、官网学习数据和账号服务；本项目是在本地增加一层学习工作区，重点改进“怎么刷题”和“怎么理解题目”：

- **沉浸式单题模式**：隐藏多余导航，集中显示当前题目；切题、答案、掌握程度、收藏、易错和 AI 均可用快捷键完成；
- **官网式章节导航**：父级目录只展开，末级小节才进入刷题；支持面包屑、同级切换、上一节/下一节和手机抽屉导航；
- **题目中心化界面**：题目信息、题干和操作栏分层展示，数学公式保持清晰，窄屏和 125%/150% 缩放自动紧凑布局；
- **AI 数学助教**：从题目卡片打开右侧抽屉，默认带入题干、选项、标准答案和解析，不会自动发起请求；聊天记录按题目和服务档案隔离；
- **OpenAI 兼容 API**：只要服务兼容 OpenAI 的 `/models` 和 `/chat/completions` 协议，就可以接入不同厂商、自建服务或中转站；流式输出、视觉输入能力按服务实际支持情况启用；
- **辅助画图解释**：AI 可返回受限 SVG 或结构化绘图参数；Python 绘图只调用固定的 Matplotlib 模板，不执行模型生成的 Python 代码，适合函数、区域、向量、极坐标和二重积分示意；
- **本地优先与简明同步**：刷题状态逐题保存在本机，官网同步采用“自动检查 → 看清变化 → 确认同步”，易错、批注、AI Key、服务档案和聊天记录永不上传官网。

AI 能力取决于你配置的服务：普通文本模型不能自动获得视觉或绘图能力；API 费用、速率限制、内容策略和服务稳定性由对应厂商或中转站负责。

更新记录见 [CHANGELOG.md](CHANGELOG.md)。桌面版首发使用 SemVer 版本 `v1.0.0`。

`android/` 保留原 Flutter 客户端和兼容数据格式，`web/` 是刷题页面，`local-server/` 是本地中控台，`sync-extension/` 仅作为旧版浏览器桥接兼容方案保留。

## 一键启动

### Windows

#### 普通用户（推荐）

普通用户可从[百度网盘下载桌面安装器 `DaguanMathDesktop-Setup.exe`](https://pan.baidu.com/netdisk/share?surl=VrW0Z-ThDSM7f_xx7uCUZw)（提取码 `dgy1`）并运行。桌面版使用系统托盘管理窗口和共享服务，默认不开机启动；关闭窗口会缩到托盘。另有[网页版本机服务包 ZIP](https://pan.baidu.com/netdisk/share?surl=VJwUxgElbURfw7Aj4Gpy4Q)（提取码 `wweb`）。

首版未签名，Windows 可能显示 SmartScreen 警告。桌面安装器 SHA-256：`2139a96a85cf3d5865acb3814ae4241edaa703b0e9ce95f86d327be15816f6ac`。首次安装建议阅读 [Windows 新手安装与配置教程](docs/Windows新手安装与配置.md)；维护者更换网盘地址请看[百度网盘下载与引导页配置](docs/百度网盘下载与引导页配置.md)。

#### 开发者从源码启动

如果是开发者或已经安装 Node.js 的用户，双击根目录的 `启动本地题库.cmd`：

1. 自动检查 Node.js 20；
2. 没有 Node.js 时下载并校验便携运行时；
3. 自动执行 `npm ci`；
4. 启动本地中控台；
5. 打开 `http://127.0.0.1:8080/`。

维护者可在本机执行下列命令构建独立浏览器容器，用于兼容性测试；该包不是当前公开发布的 Windows 安装版本：

```powershell
npm run package:windows
npm run package:windows:release
```

生成的 `dist/DaguanMath-windows-x64.exe` 与 `dist/DaguanMath-windows-x64.zip` 仅用于本地测试，不随桌面版 Release 提供。普通 Windows 用户请使用上方的 Electron 桌面版安装器。运行数据统一保存在当前 Windows 用户的 `%LOCALAPPDATA%\DaguanMath\data`，程序升级不会覆盖进度和登录配置。

### 适用设备

- 推荐：Windows 10 22H2 或 Windows 11，64 位 x64 台式机、笔记本和教学机；
- 浏览器：Microsoft Edge 或 Google Chrome 最新稳定版；
- 建议：8 GB 内存、至少 2 GB 可用磁盘空间、1920×1080 或更高分辨率；
- 可在 1366×768、平板式 Windows 窗口和 125%/150% 缩放下使用，但题目区会自动进入紧凑布局；
- 当前发布包不提供 32 位 Windows、原生 ARM64、Firefox 和移动端安装包；Linux/Docker 仍需使用对应脚本。

### Linux

```bash
bash scripts/install-linux.sh
```

脚本会检查或安装 Node.js 20、安装依赖、创建 systemd 用户服务并启动本地中控台。

### Docker

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

`data/` 会挂载到容器外，登录信息、学习状态、同步备份和日志会在重启后保留。

## 同步流程

首次连接和日常同步的逐步说明见 [使用教程](docs/使用教程.md#2-配置大观园同步)。

首页“数据同步中心”提供：

- 同步进度：先只读检查两边变化，再确认更新本地或上传官网；
- 完成后：先备份并写入本地，再按确认内容写入官网并复读校验；
- 高级选项：导出本地数据、官网快照和 Android 兼容包。

默认行为：启动后只检查本地中控台和登录状态；首页点击“同步进度”会自动开始只读检查，涉及官网写入时必须明确确认。

Token 只保存在本机 `data/cxyonly-integration.json`，不会返回给网页、写入导出文件或写入日志。

## AI 接口配置

进入“工具区 → 界面设置/AI 服务”新增服务档案，填写服务名称、OpenAI 兼容 API 根地址、Key 和模型。根地址只允许 HTTP/HTTPS，地址中不能写账号密码；公网服务应使用 HTTPS。

配置后可以分别测试模型列表、普通文本回复和视觉能力。通过视觉测试后，题目图片才会随 AI 请求发送。Key 只保存在本机 Node 配置文件，前端只显示掩码，不进入进度导出、Android 包、Git 或官网同步。

推荐在 AI 服务商文档中确认以下兼容项：

- `GET /models` 或可手动填写模型名；
- `POST /chat/completions`；
- 可选：流式 SSE、图片输入、用量字段。

AI 画图说明：模型不会直接执行 Python。系统只接受安全 SVG 或受限绘图参数；Python 可用时由本地固定模板绘制，失败后自动退回 SVG 和文字解答。

## 开发与验证

```bash
npm ci
npm start
npm test
npm run verify
```

默认服务地址：`http://127.0.0.1:8080/`。

重新下载题库资源：

```bash
npm run sync:data
```

题库缺图时，可按 `tools/sync-web-data.mjs` 的说明提供临时 `DAGUAN_ASSET_TOKEN`；本地页面不会回退加载外部图片或 CDN。

## 安全边界

- Node 默认只监听 `127.0.0.1`；
- Token 文件和同步备份不纳入 Git；
- 官网 API 发生变化时，只需调整 `local-server/cxyonly-client.mjs`；
- `sync-extension/` 不参与默认同步流程；
- 本项目不是大观园官方客户端，题库内容及相关权利归原权利人所有。
