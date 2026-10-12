import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Single owner of native AI profile/history files. Shared API types are supplied by Storage.
public actor AIRouter {
    private let directory: URL
    private let keyStore: any AIKeyStore
    private let network: any AINetworking
    private struct Run { let task: Task<Void, Error>; let profileID: String; let questionID: String }
    private var runs: [String: Run] = [:]

    public init(dataDirectory: URL, keyStore: any AIKeyStore = KeychainAIKeyStore(),
                network: any AINetworking = URLSessionAINetwork()) {
        directory = dataDirectory.appendingPathComponent("ai", isDirectory: true)
        self.keyStore = keyStore
        self.network = network
    }

    public func handle(_ request: APIRequest) async throws -> APIResponse? {
        let path = request.path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? request.path
        let parts = path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        guard parts.count >= 2, parts[0] == "api", parts[1] == "ai" else { return nil }
        let method = request.method.uppercased()
        if path == "/api/ai/chat" { return nil }
        do {
            let input = try body(request.body)
            if path == "/api/ai/diagram", method == "POST" {
                return try response(.object(["error": .string("iPad 版暂不支持服务端绘图，文字解答仍然保留")]), status: 501)
            }
            if parts == ["api", "ai", "profiles"] {
                if method == "GET" {
                    return try response(.object(["ok": .bool(true), "profiles": .array(try profiles().map {
                        $0.publicValue(key: try keyStore.read(profileID: $0.id))
                    })]))
                }
                if method == "POST" {
                    return try response(.object(["ok": .bool(true), "profile": try upsert(input, id: input["id"]?.text)]))
                }
            }
            if parts.count >= 4, parts[2] == "profiles" {
                let id = parts[3]
                if parts.count == 4 && method == "PATCH" {
                    return try response(.object(["ok": .bool(true), "profile": try upsert(input, id: id)]))
                }
                if parts.count == 4 && method == "DELETE" {
                    try remove(id, clearHistory: input["clearHistory"]?.isTrue == true)
                    return try response(.object(["ok": .bool(true)]))
                }
                if parts.count == 5 && parts[4] == "models" && method == "GET" {
                    return try response(try await models(id))
                }
                if parts.count == 5 && parts[4] == "test" && method == "POST" {
                    return try response(try await test(id, kind: input["kind"]?.text == "vision" ? "vision" : "text"))
                }
            }
            if parts.count == 5, parts[2] == "conversations" {
                if method == "GET" {
                    let history = try history(profileID: parts[3], questionID: parts[4])
                    var result = try AIValue.decode(JSONEncoder().encode(history)).object
                    result["ok"] = .bool(true)
                    // The Node service includes null for a missing history timestamp.
                    if result["updatedAt"] == nil { result["updatedAt"] = .null }
                    return try response(.object(result))
                }
                if method == "DELETE" {
                    try validateHistoryIDs(profileID: parts[3], questionID: parts[4])
                    stopRuns(profileID: parts[3], questionID: parts[4])
                    try deleteFile(historyURL(profileID: parts[3], questionID: parts[4]))
                    return try response(.object(["ok": .bool(true)]))
                }
            }
            if parts.count == 4, parts[2] == "runs", method == "DELETE" {
                return try response(.object(["ok": .bool(await cancel(runID: parts[3]))]))
            }
            return nil
        } catch {
            return try response(.object(["error": .string(clientError(error))]), status: 400)
        }
    }

    /// Validation throws before started. Once started, failure/cancellation emits error and returns.
    /// Bridge forwards Data as JSON, and cancels the enclosing Task when its web request disconnects.
    public func startChat(body data: Data, emit: @escaping @Sendable (String, Data) -> Void) async throws {
        try Task.checkCancellation()
        guard runs.count < 2 else { throw AIError("当前已有两个 AI 任务在生成，请稍后再试") }
        let input = try body(data)
        let profile = try profile(input["profileId"]?.text ?? "")
        let key = try keyStore.read(profileID: profile.id)
        let question = input["question"]?.object ?? [:]
        let questionID = nonempty(question["id"]?.text, "unknown")
        try validateHistoryIDs(profileID: profile.id, questionID: questionID)
        let history = try history(profileID: profile.id, questionID: questionID)
        let recent = Array(history.messages.filter { ["user", "assistant"].contains($0.role) }.suffix(24))
        let prompt = String(nonempty(input["prompt"]?.text, "请讲解这道题。").prefix(20_000))
        let userMessage = Self.context(question, includePrivate: input["includePrivate"]?.isTrue == true)
            + "\n\n本次请求：" + prompt
        var userContent: AIValue = .string(userMessage)
        let images = input["images"]?.array ?? []
        if profile.capabilities["vision"]?.text == "passed", !images.isEmpty {
            userContent = .array([.object(["type": .string("text"), "text": .string(userMessage)])]
                + images.prefix(4).map { .object(["type": .string("image_url"),
                    "image_url": .object(["url": .string($0.limited(2_000_000))])]) })
        }
        let messages = [AIValue.object(["role": .string("system"), "content": .string(Self.tutorPrompt)])]
            + recent.map(\.upstream) + [.object(["role": .string("user"), "content": userContent])]
        let request = try AIEndpoint.request(profile: profile, key: key, path: "chat/completions",
            payload: .object(["model": .string(profile.model), "messages": .array(messages),
                              "stream": .bool(profile.streaming), "temperature": .number(0.2)]))
        let runID = UUID().uuidString
        let task = Task {
            try await self.executeChat(request: request, profile: profile, questionID: questionID,
                userMessage: userMessage, runID: runID, emit: emit)
        }
        runs[runID] = Run(task: task, profileID: profile.id, questionID: questionID)
        defer { runs.removeValue(forKey: runID) }
        Self.event("started", ["runId": .string(runID), "historyTruncated": .bool(recent.count >= 24)], emit: emit)
        do {
            try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
        } catch {
            Self.event("error", ["runId": .string(runID), "error": .string(clientError(error))], emit: emit)
        }
    }

    @discardableResult
    public func cancel(runID: String) async -> Bool {
        guard let run = runs[runID] else { return false }
        run.task.cancel()
        return true
    }

    private func executeChat(request: URLRequest, profile: AIProfile, questionID: String,
                             userMessage: String, runID: String,
                             emit: @escaping @Sendable (String, Data) -> Void) async throws {
        let answer = try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask { [network] in
                try await Self.consumeChat(network: network, request: request, streaming: profile.streaming, emit: emit)
            }
            group.addTask {
                try await Task.sleep(nanoseconds: 90_000_000_000)
                throw AIError("AI 请求超时")
            }
            defer { group.cancelAll() }
            guard let answer = try await group.next() else { throw AIError("AI 服务没有返回内容") }
            return answer
        }
        try Task.checkCancellation()
        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIError("AI 服务未返回正式答案，请检查模型或重试")
        }
        // Re-read at commit: simultaneous successful runs must not replace each other's turns.
        var current = try history(profileID: profile.id, questionID: questionID)
        let now = Self.timestamp()
        current.profileId = profile.id
        current.questionId = questionID
        current.messages = Array((current.messages + [AIMessage(role: "user", content: userMessage, at: now),
            AIMessage(role: "assistant", content: answer, at: now)]).suffix(400))
        current.updatedAt = now
        try save(current, to: historyURL(profileID: profile.id, questionID: questionID))
        Self.event("done", ["runId": .string(runID),
            "message": .object(["role": .string("assistant"), "content": .string(answer)])], emit: emit)
    }

    private static func consumeChat(network: any AINetworking, request: URLRequest, streaming: Bool,
                                    emit: @escaping @Sendable (String, Data) -> Void) async throws -> String {
        var parser = AISSEParser(), filter = AIAnswerFilter()
        var data = Data(), answer = ""
        var isSSE = false, receivedResponse = false, finished = false
        func delta(_ content: String) throws {
            guard !content.isEmpty else { return }
            answer += content
            guard answer.utf8.count <= 2_000_000 else { throw AIError("AI 回答过大") }
            if streaming { event("delta", ["content": .string(content)], emit: emit) }
        }
        func consume(_ row: String) throws {
            guard !finished else { return }
            let row = row.trimmingCharacters(in: .whitespacesAndNewlines)
            if row == "[DONE]" { finished = true; return }
            if row.isEmpty { return }
            guard let json = try? AIValue.decode(Data(row.utf8)) else { return }
            let object = json.object
            if object["error"] != nil { throw AIError("AI 服务返回生成错误") }
            let choice = object["choices"]?.array.first?.object ?? [:]
            let content = choice["delta"]?.object["content"]?.limited() ?? ""
            try delta(filter.push(content))
            if let reason = choice["finish_reason"], reason != .null, !reason.text.isEmpty { finished = true }
        }
        var receivedBytes = 0
        streamLoop: for try await item in network.events(for: request) {
            try Task.checkCancellation()
            switch item {
            case .response(let status, let type):
                guard !receivedResponse else { throw AIError("AI 服务返回重复响应") }
                receivedResponse = true
                guard (200...299).contains(status) else { throw upstreamError("AI 请求失败", status) }
                isSSE = type.lowercased().contains("text/event-stream")
            case .chunk(let chunk):
                guard receivedResponse else { throw AIError("AI 服务未返回 HTTP 响应") }
                receivedBytes += chunk.count
                guard receivedBytes <= 8_000_000 else { throw AIError("AI 返回内容过大") }
                if isSSE {
                    for row in try parser.push(chunk) { try consume(row) }
                    if finished { break streamLoop }
                } else {
                    data.append(chunk)
                    guard data.count <= 8_000_000 else { throw AIError("AI 返回内容过大") }
                }
            }
        }
        try Task.checkCancellation()
        guard receivedResponse else { throw AIError("AI 服务没有返回内容") }
        if isSSE {
            for row in try parser.push(Data(), final: true) { try consume(row) }
            // EOF without a protocol completion is a broken response, not a successful chat.
            guard finished else { throw AIError("AI 流式回答中断，请重试") }
            try delta(filter.push("", final: true))
        } else {
            let json = try decodeResponse(data, label: "AI")
            answer = chatContent(json)
            if streaming && !answer.isEmpty { event("delta", ["content": .string(answer)], emit: emit) }
        }
        if !streaming && !answer.isEmpty { event("delta", ["content": .string(answer)], emit: emit) }
        return answer
    }

    private func profiles() throws -> [AIProfile] {
        try load(AIProfileFile.self, from: directory.appendingPathComponent("profiles.json"),
                 fallback: AIProfileFile(profiles: [])).profiles
    }
    private func profile(_ id: String, requireModel: Bool = true) throws -> AIProfile {
        guard let value = try profiles().first(where: { $0.id == id }) else { throw AIError("AI 服务档案不存在") }
        if value.baseUrl.isEmpty { throw AIError("请先填写 AI API 地址") }
        if requireModel && value.model.isEmpty { throw AIError("请先选择或填写 AI 模型") }
        _ = try AIEndpoint.validate(value.baseUrl)
        return value
    }
    private func upsert(_ input: [String: AIValue], id: String?) throws -> AIValue {
        var all = try profiles()
        let id = id.flatMap { $0.isEmpty ? nil : $0 }
        let existing = all.first { $0.id == id }
        if id != nil && existing == nil { throw AIError("AI 服务档案不存在，请重新选择") }
        if existing == nil && all.count >= 12 { throw AIError("最多保存 12 个 AI 服务，请先删除不用的服务") }
        let now = Self.timestamp()
        var next = AIProfile(id: existing?.id ?? UUID().uuidString,
            name: nonempty(input["name"]?.limited(80), existing?.name ?? "新 AI 服务").trimmingCharacters(in: .whitespacesAndNewlines),
            baseUrl: nonempty(input["baseUrl"]?.limited(500), existing?.baseUrl ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            model: nonempty(input["model"]?.limited(160), existing?.model ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            streaming: input["streaming"] == nil || input["streaming"] == .null ? existing?.streaming ?? true : input["streaming"]?.isFalse != true,
            active: input["active"] == nil || input["active"] == .null ? existing?.active ?? false : input["active"]?.isTrue == true,
            capabilities: existing?.capabilities ?? [:], createdAt: existing?.createdAt ?? now, updatedAt: now)
        if next.name.isEmpty { next.name = "新 AI 服务" }
        next.baseUrl = try AIEndpoint.validate(next.baseUrl).absoluteString
        while next.baseUrl.hasSuffix("/") { next.baseUrl.removeLast() }
        next.capabilities.merge(input["capabilities"]?.object ?? [:]) { _, new in new }
        if next.capabilities["vision"]?.text.isEmpty != false { next.capabilities["vision"] = .string("unknown") }
        if all.isEmpty { next.active = true }
        if next.active { for i in all.indices { all[i].active = false } }
        if let i = all.firstIndex(where: { $0.id == next.id }) { all[i] = next } else { all.append(next) }
        let previousKey = try keyStore.read(profileID: next.id)
        let rawKey = input["key"]?.limited(500) ?? ""
        let newKey = rawKey.isEmpty ? previousKey : rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if newKey != previousKey { try keyStore.write(newKey, profileID: next.id) }
        do { try save(AIProfileFile(profiles: all), to: directory.appendingPathComponent("profiles.json")) }
        catch {
            if newKey != previousKey {
                if previousKey.isEmpty { try keyStore.remove(profileID: next.id) }
                else { try keyStore.write(previousKey, profileID: next.id) }
            }
            throw error
        }
        return next.publicValue(key: newKey)
    }
    private func remove(_ id: String, clearHistory: Bool) throws {
        let all = try profiles()
        guard all.contains(where: { $0.id == id }) else { throw AIError("AI 服务档案不存在") }
        stopRuns(profileID: id)
        let oldKey = try keyStore.read(profileID: id)
        try keyStore.remove(profileID: id)
        do { try save(AIProfileFile(profiles: all.filter { $0.id != id }), to: directory.appendingPathComponent("profiles.json")) }
        catch { if !oldKey.isEmpty { try keyStore.write(oldKey, profileID: id) }; throw error }
        if clearHistory {
            let folder = directory.appendingPathComponent("history", isDirectory: true)
                .appendingPathComponent(Self.filename(id), isDirectory: true)
            try deleteFile(folder)
        }
    }
    private func stopRuns(profileID: String, questionID: String? = nil) {
        for run in runs.values where run.profileID == profileID && (questionID == nil || run.questionID == questionID) { run.task.cancel() }
    }
    private func models(_ id: String) async throws -> AIValue {
        let profile = try profile(id, requireModel: false), started = Date()
        let request = try AIEndpoint.request(profile: profile, key: keyStore.read(profileID: id), path: "models")
        let (status, json) = try await jsonRequest(request, label: "模型列表")
        let object = json.object
        let items = object["data"]?.array ?? object["models"]?.array ?? json.array
        let models = items.compactMap { value -> AIValue? in
            let name = nonempty(value.object["id"]?.text, value.object["name"]?.text ?? "")
            return name.isEmpty ? nil : .string(name)
        }
        return .object(["ok": .bool(true), "models": .array(Array(models.prefix(500))),
            "status": .number(Double(status)), "latencyMs": .number(Self.latency(started))])
    }
    private func test(_ id: String, kind: String) async throws -> AIValue {
        let profile = try profile(id), started = Date()
        let originalKey = try keyStore.read(profileID: id)
        let content: AIValue = kind == "vision" ? .array([
            .object(["type": .string("text"), "text": .string("请只回复：视觉测试通过")]),
            .object(["type": .string("image_url"), "image_url": .object(["url": .string(Self.testImage)])])
        ]) : .string("请只回复：文本测试通过")
        let request = try AIEndpoint.request(profile: profile, key: originalKey, path: "chat/completions",
            payload: .object(["model": .string(profile.model), "messages": .array([
                .object(["role": .string("user"), "content": content])]), "stream": .bool(false), "temperature": .number(0)]))
        let (status, json) = try await jsonRequest(request, label: "模型测试")
        let answer = Self.chatContent(json)
        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError("模型测试未返回正式答案，请检查模型或重试") }
        try Task.checkCancellation()
        var all = try profiles()
        // Never recreate a deleted profile or validate a changed endpoint using an old request.
        if let i = all.firstIndex(where: { $0.id == id }), all[i] == profile,
           try keyStore.read(profileID: id) == originalKey {
            all[i].capabilities["text"] = .bool(true)
            if kind == "vision" {
                all[i].capabilities["vision"] = .string("passed")
                all[i].capabilities["visionTestedAt"] = .string(Self.timestamp())
            }
            all[i].updatedAt = Self.timestamp()
            try save(AIProfileFile(profiles: all), to: directory.appendingPathComponent("profiles.json"))
        }
        return .object(["ok": .bool(true), "kind": .string(kind), "status": .number(Double(status)),
            "latencyMs": .number(Self.latency(started)), "model": .string(profile.model),
            "response": .string(String(answer.prefix(2000))), "usage": json.object["usage"] ?? .null])
    }
    private func jsonRequest(_ request: URLRequest, label: String) async throws -> (Int, AIValue) {
        var status: Int?, data = Data()
        for try await item in network.events(for: request) {
            try Task.checkCancellation()
            switch item {
            case .response(let value, _):
                guard (200...299).contains(value) else { throw Self.upstreamError(label + "失败", value) }
                status = value
            case .chunk(let chunk):
                guard status != nil else { throw AIError("AI 服务未返回 HTTP 响应") }
                data.append(chunk)
                guard data.count <= 8_000_000 else { throw AIError("AI 返回内容过大") }
            }
        }
        guard let status else { throw AIError("AI 服务没有返回内容") }
        return (status, try Self.decodeResponse(data, label: label))
    }

    private func historyURL(profileID: String, questionID: String) -> URL {
        directory.appendingPathComponent("history", isDirectory: true)
            .appendingPathComponent(Self.filename(profileID), isDirectory: true)
            .appendingPathComponent(Self.filename(questionID) + ".json")
    }
    private static func filename(_ id: String) -> String {
        // Collision-free and path-safe, unlike replacing arbitrary IDs with underscores.
        Data(id.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "")
    }
    private func validateHistoryIDs(profileID: String, questionID: String) throws {
        guard !profileID.isEmpty, !questionID.isEmpty, profileID.utf8.count <= 160,
              questionID.utf8.count <= 160 else { throw AIError("AI 档案或题号过长或为空") }
    }
    private func history(profileID: String, questionID: String) throws -> AIHistory {
        try validateHistoryIDs(profileID: profileID, questionID: questionID)
        var history = try load(AIHistory.self, from: historyURL(profileID: profileID, questionID: questionID), fallback: AIHistory())
        history.messages = Array(history.messages.suffix(400)).map {
            var message = $0
            if message.role == "assistant" { message.content = AIAnswerFilter.visible(message.content) }
            return message
        }
        return history
    }
    private func load<T: Decodable>(_ type: T.Type, from url: URL, fallback: T) throws -> T {
        guard FileManager.default.fileExists(atPath: url.path) else { return fallback }
        do { return try JSONDecoder().decode(type, from: Data(contentsOf: url)) }
        catch { throw AIError("本地 AI 文件损坏或无法读取，原文件已保留") }
    }
    private func save<T: Encodable>(_ value: T, to url: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // All callers read the existing document first, refusing to replace corruption.
        #if os(iOS)
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        #endif
    }
    private func deleteFile(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    private func body(_ data: Data?) throws -> [String: AIValue] {
        guard let data, !data.isEmpty else { return [:] }
        guard data.count <= 10_000_000 else { throw AIError("AI 请求内容过大") }
        guard let value = try? AIValue.decode(data), case .object(let object) = value else { throw AIError("AI 请求必须是 JSON 对象") }
        return object
    }
    private func response(_ value: AIValue, status: Int = 200) throws -> APIResponse {
        APIResponse(status: status, body: try value.encoded(), headers: ["Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"])
    }
    private func nonempty(_ value: String?, _ fallback: String) -> String { value.flatMap { $0.isEmpty ? nil : $0 } ?? fallback }
    private static func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
    private static func latency(_ started: Date) -> Double { (Date().timeIntervalSince(started) * 1000).rounded() }
    private func clientError(_ error: Error) -> String {
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return "AI 请求已停止" }
        if (error as? URLError)?.code == .timedOut { return "AI 请求超时" }
        if let error = error as? AIError { return String(error.message.prefix(500)) }
        // Do not expose request URLs, authorization headers, filesystem paths, or upstream bodies.
        return "AI 请求失败，请检查网络或本地存储后重试"
    }
    private static func event(_ name: String, _ fields: [String: AIValue], emit: (String, Data) -> Void) {
        var object = fields; object["type"] = .string(name)
        if let data = try? AIValue.object(object).encoded() { emit(name, data) }
    }
    private static func decodeResponse(_ data: Data, label: String) throws -> AIValue {
        guard let value = try? AIValue.decode(data) else { throw AIError(label + "返回的不是 JSON") }
        if value.object["error"] != nil { throw AIError("AI 服务返回生成错误") }
        return value
    }
    private static func chatContent(_ value: AIValue) -> String {
        let choice = value.object["choices"]?.array.first?.object ?? [:]
        let message = choice["message"]?.object ?? [:]
        let content = message["content"]?.text ?? ""
        return AIAnswerFilter.visible(content.isEmpty ? choice["text"]?.text ?? "" : content)
    }
    private static func upstreamError(_ label: String, _ status: Int) -> AIError {
        let detail: String
        switch status {
        case 401: detail = "请检查 API Key 是否有效"
        case 403: detail = "请检查服务或模型的访问权限"
        case 404: detail = "请检查 API 基地址和模型名称"
        case 429: detail = "服务限流或额度不足，请稍后再试"
        case 500...599: detail = "上游服务暂时不可用，请稍后再试"
        default: detail = "请检查服务配置"
        }
        return AIError("\(label)（HTTP \(status)）：\(detail)")
    }
    static func context(_ q: [String: AIValue], includePrivate: Bool) -> String {
        func text(_ key: String, _ limit: Int = 120_000) -> String { q[key]?.limited(limit) ?? "" }
        let options = (q["options"]?.array ?? []).map {
            ($0.object["label"]?.limited(10) ?? "") + ". " + ($0.object["content_md"]?.limited() ?? "")
        }.joined(separator: "\n")
        var lines = ["题号：" + text("id", 40), "知识路径：" + text("category_path", 1000),
            "来源：" + text("source", 500), "题型：" + text("type", 100), "题干：\n" + text("stem"),
            "选项：\n" + (options.isEmpty ? "无" : options),
            "用户作答：" + (text("userAnswer", 2000).isEmpty ? "未作答" : text("userAnswer", 2000)),
            "标准答案：\n" + text("answer"), "官方解析：\n" + text("explanation")]
        if includePrivate {
            lines += ["本地批注：\n" + text("annotation", 20_000), "掌握：" + text("mastery", 80),
                "易错：" + (q["errorProne"]?.isTrue == true ? "是" : "否"),
                "收藏：" + (q["favorite"]?.isTrue == true ? "是" : "否")]
        }
        return lines.joined(separator: "\n\n")
    }
    private static let testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/5nR5WQAAAABJRU5ErkJggg=="
    static let tutorPrompt = [
        "你是大观园数学学习区的固定数学导师，服务对象是正在准备考研数学（数学一、数学二、数学三）的学生。请用中文回答，以教学和可追踪推理为目标。",
        "讲解知识点时必须站在考研视角：先说明它对应考研大纲的哪一部分、要求到什么层次（了解／理解／掌握），再说明它在历年真题里的常见考法与题型，以及在试卷上的呈现形式（选择题、填空题还是解答题，大致分值权重）。优先使用考研通用的解题路径和规范的书写格式，指出阅卷时的得分点与常见失分陷阱。如果题目涉及的内容不属于考研大纲要求，或属于超纲的拓展结论，必须明确说明，不要让用户误以为它属于必考范围。不要只讲教材上的一般性结论而忽略考研的考查方式。",
        "除非用户特别要求，否则不要一开始直接给出最终答案；先建立总体解题路线，再逐步推导。每一步都要说明本步目标、使用的知识点、知识点的具体内容、触发该知识点的题干信息、推导过程、本步结果，以及该步在总体思路中的位置。",
        "必须区分题干直接信息、前一步推出的信息和官方解析中的信息；不能把没有出现在题干或图像中的信息说成题目已知。",
        "保留并正确使用 Markdown 与 LaTeX。不要用 diag、dim 等英文缩写代替完整的数学表达式或数学对象；涉及矩阵、维数、对角化等内容时，请写出完整的公式、定义或推导，不要只写缩写。",
        "需要图形时，只能在末尾输出 daguan-diagram JSON 结构，不要输出或执行任意 Python 代码。不要声称已经完成无法验证的计算。"
    ].joined()
}
