# iPad 原生 AI 接口

`DaguanCore` 中的 `AIRouter` 是独立 actor，仅负责联网 AI；题库和学习记录离线使用。初始化传入应用数据目录：

```swift
let ai = AIRouter(dataDirectory: dataDirectory)
let response: APIResponse? = try await ai.handle(request)
try await ai.startChat(body: jsonData) { eventName, payloadData in
    // eventName = started / delta / done / error
    // payloadData 是完整 UTF-8 JSON，含 type；桥接层转交网页。
}
let stopped: Bool = await ai.cancel(runID: runID)
```

`handle(_:) async throws -> APIResponse?` 使用 Storage 的共享 `APIRequest(path:method:body:)` 和 `APIResponse(status:body:headers:)`。不属于 AI 的路由和 `/api/ai/chat` 返回 nil，chat 由桥接层单独拦截。AI 路由自身把错误转成 HTTP 400 `{error}`；JSON 响应均含 `Cache-Control: no-store`。支持的格式沿用 `web/ai-settings.js`、`web/new-ai.js`、`local-server/ai-service.mjs` 和 `server.mjs`：

- GET/POST `/api/ai/profiles` → `{ok,profiles}` / `{ok,profile}`。
- PATCH/DELETE `/api/ai/profiles/:id` → `{ok,profile}` / `{ok}`；DELETE 支持 `clearHistory`。
- GET `/api/ai/profiles/:id/models` → `{ok,models,status,latencyMs}`。
- POST `/api/ai/profiles/:id/test`，`kind` 为 text 或 vision → `{ok,kind,status,latencyMs,model,response,usage}`。
- GET/DELETE `/api/ai/conversations/:profileId/:questionId` → `{ok,version,messages,updatedAt,profileId?,questionId?}` / `{ok}`。
- DELETE `/api/ai/runs/:runId` → `{ok:Bool}`。
- POST `/api/ai/diagram` → HTTP 501 `{error}`；旧版页面显示“图形暂时不可用，文字解答仍然保留”。实际 SVG 回退在 Node 服务内部，不在共享前端中；此原生版本没有图形生成器，不运行 Python。

`startChat(body:emit:) async throws` 的 callback 类型为 `@escaping @Sendable (String, Data) -> Void`，运行于非 MainActor 上下文，调用方负责切回主线程更新 WKWebView。启动前检查失败会抛出，桥接层将其作为请求失败传回。启动后的网络、取消或存储错误发出 error 后正常返回。事件载荷为：

- started：`{type:"started",runId,historyTruncated}`。
- delta：`{type:"delta",content}`。
- done：`{type:"done",runId,message:{role:"assistant",content}}`。
- error：`{type:"error",runId,error}`。

桥接层保存启动调用的 Task，网页断开、切题或终止时 cancel Task；取消会传递给内部任务和 URLSession。也可使用 started 中的 runId 调用 cancel；未知 runId 返回 false。原生回调不需要合成 SSE HTTP 响应头；网页桥接应从 started 事件记录 runId。

最多保存 12 个服务，同时运行最多两个 chat。服务公开字段为 id/name/baseUrl/model/streaming/active/keyHint/capabilities/createdAt/updatedAt。Key 编辑留空保持原值；未设置显示“未设置”。通常沿用前三后三的提示，长度不超过六的 Key 仅显示掩码，防止提示暴露完整短密钥。Key 只保存在不可同步、当前设备、解锁可读的 Keychain generic-password 中，默认 service 为 `fun.plus-guide.daguan.ai`。删除服务删除 Keychain 条目；无 Security 的平台默认实现明确失败，测试必须注入 AIKeyStore，绝不自动改用明文。

配置保存在 `<dataDirectory>/ai/profiles.json`，无 key 字段；历史位于 `<dataDirectory>/ai/history/<base64url-profile>/<base64url-question>.json`。分目录避免分隔符冲突，限定题号和档案标识不超过 160 UTF-8 字节。历史与配置均原子保存，拒绝覆盖无法解码的现存文件。应用自己的学习记录备份不应包含 Keychain；即使用户选择备份 AI 配置，也只能得到不含 key 的配置 JSON。iOS 文件设置 completeUntilFirstUserAuthentication 保护。

题目上下文完整沿用 id、category_path、source、type、stem、options[].label/content_md、userAnswer、answer、explanation。只有 includePrivate 严格为 true 才追加 annotation、mastery、errorProne、favorite。vision 能力为 passed 时才发送最多四张图片；当前网页负责生成题图 data URL，服务兼容现有图片 URL 格式。固定数学导师 system prompt 与 Node 版本一致。历史按服务＋题号隔离，向上游最多发送最近 24 条，落盘最多保留 400 条。成功提交时重新读取历史，防止并行成功请求丢失另一轮记录。取消、空答案、错误、未正常终结的 SSE 均不保存本轮；清空历史和删除服务先取消关联运行。

网络使用 URLSession ephemeral 配置，不缓存或保存 cookie/凭据，不跟随重定向，不向客户端暴露上游原始错误正文或系统网络详情。最多缓冲 256 个网络块，溢出明确中止。能力测试成功提交前检查任务取消状态，并比较完整原始档案和 Keychain 密钥，避免用户改配置期间旧结果验证新配置。chat 总时限为 90 秒，模型/测试 URLSession 资源时限为 90 秒。上游支持 SSE 或普通 JSON，包括非流式配置收到 SSE 时的聚合回退。SSE 使用字节缓冲保留 UTF-8 跨块边界，支持 CRLF、注释、多行 data、EOF 最后一条记录，过滤跨块 think/thinking 标签；只有 `[DONE]` 或非空 finish_reason 才认定 SSE 正常完成。兼容标准服务的显式终结；仅依赖 EOF 的非标准服务将提示中断而不落盘。回答上限 2MB，响应总量上限 8MB，请求上限 10MB。

默认使用 HTTPS。HTTP 仅允许明确保存的 localhost、`.local` 或字面量私网 IPv4/IPv6；不会通过 DNS 将公网 HTTP 或不明主机默认为内网。与 Node 的 DNS 内网识别不同，普通局域网域名需使用 HTTPS、`.local` 名称或私网 IP。拒绝内嵌账号、片段和基地址查询参数，避免查询密钥进入配置备份。iOS ATS 仍独立生效：合法的 HTTP 配置可能被 ATS 拒绝；产品要支持 HTTP LAN 时须在 App Info.plist 显式配置适当本地网络 ATS 例外（例如 NSAllowsLocalNetworking，数字 IP 的行为需实机验证）及 Local Network 使用说明，避免全局放开公网 HTTP。当前代码不修改 App 配置。

## 验证状态

新增 `AIParserTests.swift` 和 `AIRouterTests.swift`，使用注入式假网络和内存密钥库。覆盖 UTF-8 每个切分边界、逐字节 SSE、CRLF、多行 data、隐藏推理过滤、端点校验、上下文隐私、配置/模型/测试 JSON、Key 留空与不落盘、24/400 历史边界、视觉限制、非流式回退、成功持久化、失败/空答案/中断/取消不持久化及损坏配置保留。测试临时目录可由 DAGUAN_TEST_TMP 指定；本仓库 Windows 开发时应指向 F:\AI\tmp，TEMP/TMP 同样放 F 盘。测试 teardown 仅清理自己创建的 UUID 目录。

本次环境是 Windows，未发现 Swift/macOS/WSL 编译工具链；这些 Swift 测试尚未编译或执行。后续需在 macOS Swift 5.9+ 运行 ios 下的 `swift test`，并在 iOS 16+ 实机验证 Keychain、ATS/本地网络权限、WK 桥接取消与真实上游流式连接。没有以 Node 回归测试冒充 Swift 编译或 iPad 验收。
