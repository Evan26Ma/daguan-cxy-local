# 前端模块与安全渲染

新版继续使用普通 `defer` 脚本，不依赖打包器。入口顺序为公共工具、DOMPurify、`safe-render.js`、`new-data.js`、`new-state.js`、`new-ai.js`，最后加载 `app-new.js`。

- **safe-render**：新旧界面共用。`create({ assetUrl })` 返回 `markdown(text)`、`html(markup)` 和 `svg(markup)`；缺少清洗库时返回转义文本。Markdown 先清理不可信样式与动作，再插入 `trust: false` 的 KaTeX 结果，最后清洗。`html` 用于题库原生解析片段：先按 raw 配置清洗（保留 MathML、表格与 data: 图片，去掉脚本、事件、动作属性、内联样式，并连同内容丢弃 `annotation/annotation-xml`），再仅在普通文本节点里识别独立定界的 TeX（`$$...$$`、`$...$`、`\[...\]`、`\(...\)`，跳过已有 `math`/`svg`/KaTeX 与 `code/pre/script/style`），用 `trust:false`、`throwOnError:false`、`strict:'ignore'` 的 KaTeX 渲染后走 final 配置再清洗一次；不把整段原生 HTML 交给 marked/KaTeX，也不改动原生 MathML、表格或图片 URL。SVG 禁止外部引用和动态内容。调用方只能在结果外包裹可信界面模板，不能追加未经转义的内容。
- **new-data**：`create({ AppState, fetch })` 创建独立的题库读取与分片缓存实例；失败的分片请求释放占位，允许重试。
- **new-state**：存储格式兼容、批注、草稿、待同步日志、revision、SSE 和恢复对账。工厂显式接收存储、请求和界面回调；`getAccess/getRenderer/getApp` 延迟取得入口对象，避免初始化循环。服务端读取失败保留本机缓存。
- **new-ai**：档案、上下文、SSE、历史、请求中止及 AI 面板。工厂返回 AIService、AIViews、AIController 和提示词。入口保留原有静态方法作为薄适配层；阅读位置和段落追问继续使用既有模块。

模块无独立启动副作用。入口负责初始化、导航和生命周期监听。全局 App/DataService/StorageService/StateSync/AIService 等兼容入口保留，旧版仅接入共享安全渲染。

DOMPurify 固定版本在 package.json/package-lock.json 中声明，分发文件及许可证位于 web/vendor；更新依赖时同时更新分发文件。桌面打包测试校验两者一致。修改脚本加载路径时同步更新 Service Worker 清单和缓存版本。

`npm test` 先验证浏览器可启动，再运行所有 test/*.test.mjs、test/*.test.cjs 及同步扩展测试，缺少浏览器环境会失败。Windows 默认临时目录为 F:\AI\tmp，Chromium 缓存为其 playwright-browsers 子目录。可用 DAGUAN_TEST_TMP 与 PLAYWRIGHT_BROWSERS_PATH 指定其他非 C 盘路径；安装浏览器前也必须设置 PLAYWRIGHT_BROWSERS_PATH。测试入口移除继承的 DAGUAN_DATA_DIR，各服务用例自行建立隔离目录。

这次没有修改学习战报、全面迁移内联事件或收紧全站 CSP，也未发布或替换已安装程序。
