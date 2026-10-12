import Foundation

/// Thin convenience wrapper; the bridge can call store.handle directly.
public struct LocalAPIRouter: Sendable {
    public let store: JSONDocumentStore
    public init(store: JSONDocumentStore) { self.store = store }
    public func handle(_ request: APIRequest) async throws -> APIResponse? { try await store.handle(request) }
}

extension JSONDocumentStore {
    /// Returns nil for routes/methods owned by another module. Known API failures
    /// become server-compatible JSON; Foundation I/O failures become HTTP 500.
    public func handle(_ request: APIRequest) async throws -> APIResponse? {
        guard let url = URLComponents(string: request.path) else {
            return try APIError(status: 400, message: "请求路径无效").response()
        }
        var path = url.path
        if path.hasPrefix("/daguan-math/") { path = String(path.dropFirst("/daguan-math".count)) }
        if path.hasPrefix("./") { path = "/" + path.dropFirst(2) }
        if !path.hasPrefix("/") { path = "/" + path }
        let method = request.method.uppercased()
        let query = Dictionary((url.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, new in new })
        // Do not parse unrelated request bodies (AI can accept other formats).
        guard owns(path, method: method, source: query["source"] ?? "local") else { return nil }
        do { return try dispatch(path, method: method, query: query, body: request.body) }
        catch let error as APIError { return try error.response() }
        catch { return try APIError(status: 500, code: "DATA_WRITE_FAILED", message: "本地数据操作失败：\(error.localizedDescription)").response() }
    }

    private func owns(_ path: String, method: String, source: String) -> Bool {
        switch (path, method) {
        case ("/api/access/status", "GET"), ("/api/access/unlock", "POST"), ("/api/access/lock", "POST"), ("/api/question-bank/status", "GET"),
             ("/api/state", "GET"), ("/api/state", "PUT"), ("/api/state/events", "GET"), ("/api/state/migrate", "POST"), ("/api/state/last-study", "PATCH"),
             ("/api/visit-history", "GET"), ("/api/visit-history", "POST"), ("/api/visit-history", "DELETE"), ("/api/visit-history/merge", "POST"),
             ("/api/study-activity", "GET"), ("/api/study-activity/journal", "GET"), ("/api/study-activity/export", "GET"),
             ("/api/study-activity/events", "POST"), ("/api/study-activity/merge", "POST"): return true
        case ("/api/integrations/cxyonly/export", "GET"): return ["local", "android"].contains(source)
        default: return (path.hasPrefix("/api/state/questions/") && method == "PATCH") || (path.hasPrefix("/api/visit-history/") && method == "DELETE")
        }
    }
    private func bodyObject(_ data: Data?) throws -> JSONValue {
        guard let data, !data.isEmpty else { return [:] }
        guard data.count <= 10 * 1024 * 1024 else { throw APIError(status: 413, message: "请求体过大") }
        let value: JSONValue
        do { value = try JSONDecoder().decode(JSONValue.self, from: data) }
        catch { throw APIError(status: 400, message: "JSON 格式错误") }
        guard value.objectValue != nil else { throw APIError(status: 400, message: "请求体必须为 JSON 对象") }
        return value
    }
    private func stateResponse(_ state: JSONValue, includeRevision: Bool = true) throws -> APIResponse {
        var value: JSONValue = ["ok": true, "state": state]
        if includeRevision { value["revision"] = state["revision"] }
        return try .json(value)
    }
    private func dispatch(_ path: String, method: String, query: [String: String], body: Data?) throws -> APIResponse {
        switch (path, method) {
        case ("/api/access/status", "GET"):
            return try .json(["ok": true, "previewMode": false, "configured": false, "unlocked": true,
                "privateFeatures": ["收藏", "错题", "掌握度", "批注", "进度备份", "官网同步", "AI 服务与历史"]])
        case ("/api/access/unlock", "POST"), ("/api/access/lock", "POST"):
            // Offline native app has no web preview gate or persisted preview key.
            return try .json(["ok": true, "previewMode": false, "unlocked": true])
        case ("/api/question-bank/status", "GET"):
            return try .json(["enabled": false, "activeId": "bundled"])
        case ("/api/state", "GET"): return try .json(readState())
        case ("/api/state", "PUT"):
            let input = try bodyObject(body), expected = try revision(input, coerce: true)
            try checkRevision(readState(), expected: expected)
            var activity = try readActivity()
            let saved = try writeState(input, expectedRevision: expected)
            observeImport(saved, activity: &activity); try saveActivity(&activity)
            return try stateResponse(saved)
        case ("/api/state/migrate", "POST"):
            let input = try bodyObject(body), current = try readState()
            var activity = try readActivity()
            let saved = try writeState(migrationMerge(current, input), expectedRevision: Int(current["revision"].numberValue ?? 0))
            observeImport(saved, activity: &activity); try saveActivity(&activity)
            return try stateResponse(saved, includeRevision: false)
        case ("/api/state/last-study", "PATCH"): return try stateResponse(patchLastStudy(bodyObject(body)))
        case ("/api/state/events", "GET"):
            let state = try readState()
            let payload = try JSONEncoder().encode(JSONValue.object(["revision": state["revision"], "initial": true]))
            var data = Data("event: state\ndata: ".utf8); data.append(payload); data.append(Data("\n\n".utf8))
            // Finite snapshot only. WebKit bridge owns live EventSource delivery.
            return APIResponse(status: 200, body: data, headers: ["Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store"])
        case ("/api/visit-history", "GET"):
            let entries = try readVisits()["entries"].objectValue ?? [:]
            return try .json(["ok": true, "entries": .array(entries.values.sorted {
                let a = visitTime($0), b = visitTime($1)
                return a == b ? $0["question_id"].text < $1["question_id"].text : a > b
            })])
        case ("/api/visit-history", "POST"): return try .json(["ok": true, "entry": visit(bodyObject(body))])
        case ("/api/visit-history", "DELETE"):
            // Validate existing bytes before clearing; persist migrated=true so it
            // cannot repopulate old progress after a restart.
            try writeDocument("visit-history.json", ["version": 1, "migrated": true, "entries": [:]])
            return try .json(["ok": true])
        case ("/api/visit-history/merge", "POST"):
            return try .json(["ok": true, "count": .number(Double(mergeVisits(bodyObject(body)["entries"])))])
        case ("/api/study-activity", "GET"):
            let rawDays = query["days"].flatMap { $0.isEmpty ? nil : $0 } ?? "1"
            guard let numeric = Double(rawDays), numeric.isFinite, [1.0, 3.0, 7.0, 30.0, 365.0].contains(numeric) else { throw APIError(status: 400, message: "统计范围无效") }
            let zone = query["timeZone"].flatMap { $0.isEmpty ? nil : $0 } ?? "Asia/Hong_Kong"
            _ = try StudySummary.studyDay(now, timeZone: zone)
            return try .json(StudySummary.analyze(readActivity(), days: Int(numeric), timeZone: zone, now: now).summary)
        case ("/api/study-activity/journal", "GET"):
            let zone = query["timeZone"].flatMap { $0.isEmpty ? nil : $0 } ?? "Asia/Hong_Kong"
            // Validate parameters before first-run activity initialization.
            _ = try StudySummary.journal(["started_at": nowISO, "events": [:], "baseline": [:]], end: query["end"], timeZone: zone, now: now)
            return try .json(StudySummary.journal(readActivity(), end: query["end"], timeZone: zone, now: now))
        case ("/api/study-activity/export", "GET"): return try .json(readActivity())
        case ("/api/study-activity/events", "POST"): return try .json(["ok": true, "accepted": appendEvents(bodyObject(body)["events"])])
        case ("/api/study-activity/merge", "POST"): return try .json(["ok": true, "count": .number(Double(mergeActivity(bodyObject(body))))])
        case ("/api/integrations/cxyonly/export", "GET"):
            let source = query["source"] ?? "local", state = try readState()
            return try .json(source == "android" ? androidDocument(state) : state,
                headers: ["Content-Disposition": "attachment; filename=daguan-\(source)-\(StudySummary.key(now)).json"])
        default:
            if path.hasPrefix("/api/state/questions/") {
                let suffix = String(path.dropFirst("/api/state/questions/".count)), input = try bodyObject(body)
                if suffix.hasSuffix("/annotation") { return try stateResponse(patchAnnotation(String(suffix.dropLast("/annotation".count)), input)) }
                return try stateResponse(patchQuestion(suffix, input))
            }
            let id = String(path.dropFirst("/api/visit-history/".count))
            guard StorageDates.digits(id, positive: true) else { throw APIError(status: 400, message: "题目 ID 无效") }
            var data = try readVisits(), entries = data["entries"].objectValue ?? [:]
            entries.removeValue(forKey: id); data["entries"] = .object(entries); try writeDocument("visit-history.json", data)
            return try .json(["ok": true])
        }
    }
    private func androidDocument(_ state: JSONValue) -> JSONValue {
        let favorites = Set((state["favorites"].arrayValue ?? []).map(\.text))
        var states: [String: JSONValue] = [:]
        for (id, p) in state["progress"].objectValue ?? [:] where StorageDates.digits(id, positive: true) {
            let local = p["mastery"].text
            let mastery = ["not_started", "mastered", "needs_practice", "not_known"].contains(local) ? local : local == "forgot" ? "not_known" : local == "learning" ? "needs_practice" : "not_started"
            let favorite = favorites.contains(id)
            if mastery == "not_started" && !favorite { continue }
            states[id] = ["mastery": .string(mastery), "favorite": .bool(favorite), "updatedAt": StorageDates.parse(p["updated_at"], numericStrings: true).map { .string(StorageDates.iso($0)) } ?? .null]
        }
        for id in favorites where StorageDates.digits(id, positive: true) && states[id] == nil {
            states[id] = ["mastery": "not_started", "favorite": true, "updatedAt": .null]
        }
        return ["format": "daguan-android-progress", "version": 2, "updatedAt": nowISO, "states": .object(states), "events": [], "lastStudy": .null]
    }
}
