# 大观园数学题库 Android 版

大观园数学题库 Android 版是一款使用 Flutter 编写的离线数学学习应用。本项目基于公益题库网站 [大观园数学题库](https://www.cxyonly.fans/math) 制作，旨在方便用户在 Android 设备上离线浏览题目、作答、复习并记录笔记。

应用不使用 WebView，不申请联网权限；题库、题图、学习状态和书写画布均在本地工作。

## 项目来源与说明

- 原题库网站：[大观园数学题库](https://www.cxyonly.fans/math)
- 题库制作人主页：[哔哩哔哩空间](https://space.bilibili.com/6536560)

本项目是在原题库内容基础上制作的非官方 Android 客户端，与原网站及题库制作者不存在官方隶属或授权背书关系，除非后续另有明确说明。

本仓库所收录的题目、解析、题图、网站名称及相关素材仅供个人学习与技术交流，相关权利归原作者或原权利人所有。如相关权利人认为本项目存在不当使用或侵权，请通过项目 Issue 联系，核实后将立即删除或调整相关内容。

本项目内置的是离线题库快照，题目数量、内容和更新进度可能与原站当前题库存在出入；如需以最新资料为准，请以原站内容为准。

## 主要功能

- 按学科和章节浏览离线题库。
- 选择题作答、掌握度标记、收藏本和复习本。
- 每道题独立的矢量书写画布、文字笔记和 LaTeX 渲染。
- 画布 PNG、PDF 和分级批量导出。
- 本地 JSON 进度导入与导出。
- 恢复上次学习位置。

## 原站数据导入与导出

Android 应用与原站之间的收藏、掌握状态同步，需要配合“大观园数据桥接”浏览器插件完成，应用本身不直接连接原站。

- 从原站导入到 Android：先在原站使用插件“导出到移动端”，再在应用的数据页面导入生成的 JSON。
- 从 Android 导出到原站：先在应用中导出进度 JSON，再在原站使用插件“备份并导入”。
- 导入和导出只同步掌握状态、收藏等标记，不同步手写画布和文字笔记。

文件格式：

- Android 应用导出：`format: "daguan-android-progress"`，`version: 2`，题目标记及近期复习时间位于根节点 `states`。
- 浏览器插件导出：`format: "daguan-browser-sync"`，`version: 1`，题目标记位于 `question_states.states`。

浏览器插件下载地址：

`https://github.com/nbntg/daguan-math-browser-bridge`

仓库内置的是空白初始进度，不包含任何账号、收藏、复习记录或学习历史。

## 开发环境

- Flutter `3.44.8` stable
- Dart `3.12.2`
- JDK 17
- Android SDK

Gradle 由仓库内的 Gradle Wrapper 自动下载。Flutter 和 Android SDK 不需要放进源码仓库。

## 构建

在仓库根目录执行：

```powershell
flutter pub get
node tool/verify_project.js
flutter analyze
flutter test
flutter build apk --release
```

生成的 APK 位于：

```text
build/app/outputs/flutter-apk/app-release.apk
```

Windows 用户也可以双击 `构建APK.cmd`。脚本会执行检查，在源码目录的上一层创建 `daguan-math-v1.1.6-release` 发布目录并放入 APK。源码目录中的 `build` 会保留以加快后续构建，但已被 Git 忽略，不会上传。有发布密钥时 APK 名为 `daguan-math-v1.1.6.apk`，否则名为 `daguan-math-community-v1.1.6.apk`。

### APK 签名说明

官方 Release APK 使用维护者私下保存的发布密钥签名，密钥和密码不会进入本仓库。

公开源码在没有 `android/key.properties` 时，会自动使用本机调试密钥生成可安装的社区构建。社区构建与官方 APK 功能一致，但签名和 SHA-256 不同，也不能直接覆盖安装官方版本。

如需使用自己的发布密钥，在本机创建未被 Git 跟踪的 `android/key.properties`：

```properties
storeFile=your-release.keystore
storePassword=your-store-password
keyAlias=your-key-alias
keyPassword=your-key-password
```

将密钥文件放在 `android/app/`，或在 `storeFile` 中填写相对于 `android/app/` 的路径。

## 目录结构

```text
android/                 Android 原生工程和 Gradle Wrapper
assets/                  离线题库、章节、空白初始进度和题图
lib/                     Flutter 应用源码
test/                    自动化测试和视觉基准
tool/verify_project.js   离线题库与隐私边界校验
```

## 隐私

应用不申请联网权限、不包含分析统计 SDK，也不内置个人学习数据。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 许可

本项目自行编写的应用程序代码采用 [GNU General Public License v3.0 only](LICENSE) 发布。发布或分发代码修改版本时，需要继续公开相应源码、保留版权和许可声明，并使用相同许可证。

题库数据、题目解析、题图、网站名称、网站图标及其他第三方内容不属于 GPL-3.0-only 的授权范围。本仓库不会代替原权利人向这些内容授予 GPL、MIT、Creative Commons 或其他许可。完整范围说明见 [CONTENT_NOTICE.md](CONTENT_NOTICE.md)。

Copyright © 2026 大观园数学题库 Android 版贡献者。此版权声明仅适用于本项目自行编写的程序代码，不适用于题库及其他第三方内容。
