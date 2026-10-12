import Foundation

/// One instance per sandbox directory. Every transaction is synchronous inside
/// this actor, so awaiting another actor never separates a read from its write.
public actor JSONDocumentStore {
    public let directory: URL
    private let clock: @Sendable () -> Date
    public init(directory: URL) { self.directory = directory; self.clock = { Date() } }
    init(directory: URL, clock: @escaping @Sendable () -> Date) { self.directory = directory; self.clock = clock }
    var now: Date { clock() }
    var nowISO: JSONValue { .string(StorageDates.iso(now)) }

    func readDocument(_ name: String, fallback: JSONValue) throws -> JSONValue {
        let url = directory.appendingPathComponent(name)
        let data: Data
        do { data = try Data(contentsOf: url) }
        catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return fallback }
            throw APIError(status: 500, code: "DATA_READ_FAILED", message: "本地文件无法读取：\(name)。原文件已保留，请检查文件或从备份恢复。")
        }
        do { return try JSONDecoder().decode(JSONValue.self, from: data) }
        catch { throw corrupt(name) }
    }
    func corrupt(_ name: String) -> APIError {
        APIError(status: 500, code: "DATA_CORRUPT", message: "本地文件损坏：\(name)。原文件已保留，请检查文件或从备份恢复。")
    }
    func writeDocument(_ name: String, _ value: JSONValue) throws {
        // Includes JSON/schema validation before replacing any existing bytes.
        let previous = try readDocument(name, fallback: .null)
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) { try validateDocument(name, previous) }
        try validateDocument(name, value)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        var data = try encoder.encode(value); data.append(0x0a)
        try data.write(to: directory.appendingPathComponent(name), options: .atomic)
    }
    func validateDocument(_ name: String, _ value: JSONValue) throws {
        guard value.objectValue != nil else { throw corrupt(name) }
        if name == "state.json" {
            if value["revision"] != .null {
                let revision = value["revision"].numberValue ?? Double(value["revision"].stringValue ?? "")
                guard let revision, revision.isFinite, revision >= 0, revision.rounded() == revision, revision <= 9_007_199_254_740_991 else { throw corrupt(name) }
            }
            for key in ["progress", "annotations", "local_activity", "pending_unknown_states"] {
                if value[key] != .null && value[key].objectValue == nil { throw corrupt(name) }
            }
            for key in ["favorites", "picked", "pending_remote_operations"] {
                if value[key] != .null && value[key].arrayValue == nil { throw corrupt(name) }
            }
            for key in ["progress", "annotations"] {
                for record in (value[key].objectValue ?? [:]).values {
                    guard record.objectValue != nil else { throw corrupt(name) }
                }
            }
            for key in ["last_study", "remote_last_study", "remote_activity"] {
                if value[key] != .null && value[key].objectValue == nil { throw corrupt(name) }
            }
            for annotation in (value["annotations"].objectValue ?? [:]).values {
                if annotation["markdown"] != .null && annotation["markdown"].stringValue == nil { throw corrupt(name) }
                if annotation["history"] != .null {
                    guard let history = annotation["history"].arrayValue, history.allSatisfy({ $0.objectValue != nil }) else { throw corrupt(name) }
                }
            }
        } else if name == "visit-history.json" {
            guard value["version"] == 1, value["migrated"] == true, let entries = value["entries"].objectValue else { throw corrupt(name) }
            for (id, entry) in entries {
                guard normalizeVisit(entry, fallbackID: id) != nil else { throw corrupt(name) }
            }
        } else if name == "study-activity.json" {
            guard value["version"] == 1, value["events"].objectValue != nil, value["baseline"].objectValue != nil,
                  StorageDates.parse(value["started_at"]) != nil else { throw corrupt(name) }
            for (key, event) in value["events"].objectValue ?? [:] {
                guard key == event["event_id"].text else { throw corrupt(name) }
                do { _ = try normalizeEvent(event, validateFuture: false) } catch { throw corrupt(name) }
            }
        } else if name == "frontend-kv.json" {
            guard value.objectValue?.values.allSatisfy({ $0.stringValue != nil }) == true else { throw corrupt(name) }
        }
    }

    public func readKV() throws -> [String: String] {
        let value = try readDocument("frontend-kv.json", fallback: [:])
        try validateDocument("frontend-kv.json", value)
        return (value.objectValue ?? [:]).mapValues { $0.stringValue! }
    }
    /// Complete snapshot replacement; bridge must keep API keys in Keychain.
    public func writeKV(_ values: [String: String]) throws {
        try writeDocument("frontend-kv.json", .object(values.mapValues(JSONValue.string)))
    }
    public func updateKV(_ changes: [String: String?]) throws {
        var values = try readKV()
        for (key, value) in changes { values[key] = value }
        try writeKV(values)
    }

    static func normalizeState(_ source: JSONValue) -> JSONValue {
        var progress = source["progress"].objectValue ?? [:]
        for (id, raw) in progress {
            var item = raw.objectValue == nil ? JSONValue.object([:]) : raw
            let forgot = item["mastery"] == "forgot"
            if !["not_started", "learning", "mastered"].contains(item["mastery"].text) { item["mastery"] = forgot ? "learning" : "not_started" }
            item["error_prone"] = .bool(item["error_prone"] == true || forgot)
            if forgot { item["legacy_mastery"] = "forgot" }
            progress[id] = item
        }
        func unique(_ raw: JSONValue) -> JSONValue {
            var seen = Set<String>()
            return .array((raw.arrayValue ?? []).map(\.text).filter { seen.insert($0).inserted }.map(JSONValue.string))
        }
        let r = source["revision"].numberValue ?? Double(source["revision"].stringValue ?? "") ?? 0
        var value: JSONValue = ["format": "daguan-local-state", "version": 3,
            "revision": .number(r.isFinite ? max(0, floor(r)) : 0), "progress": .object(progress),
            "annotations": .object(source["annotations"].objectValue ?? [:]), "favorites": unique(source["favorites"]), "picked": unique(source["picked"]),
            "last_study": source["last_study"].objectValue == nil ? .null : source["last_study"],
            "local_activity": .object(source["local_activity"].objectValue ?? [:]),
            "remote_activity": source["remote_activity"].objectValue == nil ? .null : source["remote_activity"],
            "remote_last_study": source["remote_last_study"].objectValue == nil ? .null : source["remote_last_study"],
            "remote_seeded_at": source["remote_seeded_at"], "pending_unknown_states": .object(source["pending_unknown_states"].objectValue ?? [:]),
            "pending_remote_operations": .array(source["pending_remote_operations"].arrayValue ?? []), "updated_at": source["updated_at"]]
        if !value["remote_seeded_at"].truthy { value["remote_seeded_at"] = .null }
        if !value["updated_at"].truthy { value["updated_at"] = .null }
        return value
    }
    public func readState() throws -> JSONValue {
        let value = try readDocument("state.json", fallback: [:])
        try validateDocument("state.json", value)
        return Self.normalizeState(value)
    }
    public func writeState(_ value: JSONValue, expectedRevision: Int) throws -> JSONValue {
        let current = try readState()
        try checkRevision(current, expected: expectedRevision)
        // Node initializes activity before accepting requests. Lazy native
        // initialization must likewise snapshot progress before its first write.
        guard (current["revision"].numberValue ?? 0) < 9_007_199_254_740_991 else {
            throw APIError(status: 409, code: "REVISION_LIMIT", message: "状态 revision 已达到安全数值上限", current: current)
        }
        _ = try readActivity()
        var next = Self.normalizeState(value)
        next["revision"] = .number((current["revision"].numberValue ?? 0) + 1)
        next["updated_at"] = nowISO
        try writeDocument("state.json", next)
        return next
    }
    func checkRevision(_ current: JSONValue, expected: Int) throws {
        guard expected >= 0, current["revision"].numberValue == Double(expected) else {
            throw APIError(status: 409, code: "STATE_CONFLICT", message: "本地状态版本已变化，请重新合并", current: current)
        }
    }
    func revision(_ input: JSONValue, coerce: Bool = false) throws -> Int {
        let raw = input["revision"]
        let value = raw.numberValue ?? (coerce ? Double(raw.stringValue ?? "") : nil)
        guard let value, value.isFinite, value >= 0, value.rounded() == value, value <= 9_007_199_254_740_991, value < Double(Int.max) else {
            throw APIError(status: 409, code: "REVISION_REQUIRED", message: "状态写入必须携带 revision")
        }
        return Int(value)
    }
    func migrationMerge(_ current: JSONValue, _ incoming: JSONValue) -> JSONValue {
        let source = Self.normalizeState(incoming)
        var result = current
        func mergeRecord(_ old: JSONValue, _ new: JSONValue) -> JSONValue {
            guard new.objectValue != nil, !((new.objectValue ?? [:]).isEmpty) else { return old }
            // Empty imported annotation/location cannot erase existing records.
            if new["markdown"] == "" && old["markdown"].truthy { return old }
            if old.objectValue == nil { return new }
            guard let newTime = StorageDates.recordTime(new), let oldTime = StorageDates.recordTime(old), newTime > oldTime else { return old }
            return old.merging(new)
        }
        for field in ["progress", "annotations"] {
            var map = current[field].objectValue ?? [:]
            for (id, new) in source[field].objectValue ?? [:] { map[id] = mergeRecord(map[id] ?? .null, new) }
            result[field] = .object(map)
        }
        for field in ["favorites", "picked"] {
            var seen = Set<String>()
            result[field] = .array(((current[field].arrayValue ?? []) + (source[field].arrayValue ?? [])).filter { seen.insert($0.text).inserted })
        }
        let position = source["last_study"]
        if position["question_id"].truthy || position["last_question_id"].truthy { result["last_study"] = mergeRecord(current["last_study"], position) }
        return result
    }

    func patchQuestion(_ id: String, _ input: JSONValue) throws -> JSONValue {
        guard StorageDates.digits(id) else { throw APIError(status: 400, message: "题目 ID 无效") }
        let expected = try revision(input), current = try readState()
        try checkRevision(current, expected: expected)
        var next = current, entry = current["progress"][id].objectValue == nil ? JSONValue.object([:]) : current["progress"][id]
        let at = input["updated_at"].truthy ? input["updated_at"] : nowISO
        if input["mastery"] != .null {
            guard ["not_started", "learning", "mastered", "forgot"].contains(input["mastery"].text) else { throw APIError(status: 400, message: "掌握状态无效") }
            entry["mastery"] = input["mastery"] == "forgot" ? "learning" : input["mastery"]
            if input["mastery"] == "forgot" { entry["error_prone"] = true }
            entry["mastery_updated_at"] = at; entry["seen"] = .bool(input["seen"] != false)
        }
        for field in ["seen", "answered", "last_ok"] where input[field] != .null { entry[field] = .bool(input[field] == true) }
        if input["last_practiced_at"] != .null { entry["last_practiced_at"] = input["last_practiced_at"] }
        if input["error_prone"] != .null { entry["error_prone"] = .bool(input["error_prone"] == true); entry["error_prone_updated_at"] = at }
        if input["favorite"] != .null || input["is_favorite"] != .null {
            entry["favorite"] = input["favorite"] != .null ? input["favorite"] : .bool(input["is_favorite"] == true)
            entry["favorite_updated_at"] = at
        }
        entry["updated_at"] = at
        var progress = next["progress"].objectValue ?? [:]; progress[id] = entry; next["progress"] = .object(progress)
        var favorites = Set((next["favorites"].arrayValue ?? []).map(\.text))
        if entry["favorite"].truthy { favorites.insert(id) } else { favorites.remove(id) }
        next["favorites"] = .array(favorites.sorted { (Double($0) ?? 0) < (Double($1) ?? 0) }.map(JSONValue.string))
        return try writeState(next, expectedRevision: expected)
    }
    func patchAnnotation(_ id: String, _ input: JSONValue) throws -> JSONValue {
        guard StorageDates.digits(id) else { throw APIError(status: 400, message: "题目 ID 无效") }
        let expected = try revision(input, coerce: true), current = try readState()
        try checkRevision(current, expected: expected)
        var next = current, annotations = next["annotations"].objectValue ?? [:]
        let previous = annotations[id] ?? ["history": []]
        let markdown = String((input["markdown"].truthy ? input["markdown"].text : "").prefix(100_000))
        var history = Array((previous["history"].arrayValue ?? []).suffix(9))
        if previous["markdown"] != .string(markdown) { history.append(["markdown": previous["markdown"].truthy ? previous["markdown"] : "", "updated_at": previous["updated_at"].truthy ? previous["updated_at"] : nowISO]) }
        annotations[id] = ["markdown": .string(markdown), "updated_at": input["updated_at"].truthy ? input["updated_at"] : nowISO, "history": .array(history)]
        next["annotations"] = .object(annotations)
        return try writeState(next, expectedRevision: expected)
    }
    func patchLastStudy(_ input: JSONValue) throws -> JSONValue {
        let expected = try revision(input, coerce: true)
        var next = try readState(), position = input.objectValue ?? [:]
        try checkRevision(next, expected: expected)
        position.removeValue(forKey: "revision"); next["last_study"] = .object(position)
        return try writeState(next, expectedRevision: expected)
    }

    func normalizeVisit(_ raw: JSONValue, fallbackID: String? = nil) -> JSONValue? {
        guard raw.objectValue != nil else { return nil }
        let id = raw["question_id"] == .null ? (fallbackID ?? "") : raw["question_id"].text
        guard StorageDates.digits(id, positive: true) else { return nil }
        return ["question_id": .string(id), "category_id": raw["category_id"] == .null ? .null : .string(raw["category_id"].text),
                "chapter_id": raw["chapter_id"] == .null ? .null : .string(raw["chapter_id"].text),
                "visited_at": StorageDates.parse(raw["visited_at"]).map { .string(StorageDates.iso($0)) } ?? .null,
                "time_kind": raw["time_kind"] == "legacy" ? "legacy" : "visit"]
    }
    func readVisits() throws -> JSONValue {
        let value = try readDocument("visit-history.json", fallback: .null)
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent("visit-history.json").path) {
            try validateDocument("visit-history.json", value); return value
        }
        var entries: [String: JSONValue] = [:]
        for (id, p) in try readState()["progress"].objectValue ?? [:] {
            if StorageDates.digits(id, positive: true), p.objectValue != nil,
               p["seen"].truthy || p["answered"].truthy || p["last_practiced_at"].truthy || (p["mastery"].truthy && p["mastery"] != "not_started") {
                entries[id] = normalizeVisit(["question_id": .string(id), "visited_at": p["last_practiced_at"].truthy ? p["last_practiced_at"] : p["updated_at"], "time_kind": "legacy"])
            }
        }
        let initial: JSONValue = ["version": 1, "migrated": true, "entries": .object(entries)]
        try writeDocument("visit-history.json", initial); return initial
    }
    func visit(_ input: JSONValue) throws -> JSONValue {
        var raw = input
        raw["visited_at"] = StorageDates.parse(input["visited_at"]).map { .string(StorageDates.iso($0)) } ?? nowISO
        raw["time_kind"] = "visit"
        guard let entry = normalizeVisit(raw) else { throw APIError(status: 400, message: "题目 ID 无效") }
        var data = try readVisits(), entries = data["entries"].objectValue ?? [:]
        let id = entry["question_id"].text
        if entries[id] == nil || visitTime(entry) >= visitTime(entries[id] ?? .null) { entries[id] = entry }
        data["entries"] = .object(entries); try writeDocument("visit-history.json", data)
        return entry
    }
    func visitTime(_ value: JSONValue) -> TimeInterval { StorageDates.parse(value["visited_at"])?.timeIntervalSince1970 ?? 0 }
    func mergeVisits(_ input: JSONValue) throws -> Int {
        guard let input = input.arrayValue else { throw APIError(status: 400, message: "历史记录格式无效") }
        var data = try readVisits(), entries = data["entries"].objectValue ?? [:]
        for raw in input {
            guard let entry = normalizeVisit(raw) else { continue }
            let id = entry["question_id"].text
            if entries[id] == nil || visitTime(entry) > visitTime(entries[id] ?? .null) { entries[id] = entry }
        }
        data["entries"] = .object(entries); try writeDocument("visit-history.json", data); return entries.count
    }

    func normalizeEvent(_ raw: JSONValue, validateFuture: Bool = true) throws -> JSONValue {
        let id = raw["event_id"].stringValue ?? "", qid = raw["question_id"].text, type = raw["type"].text
        guard id.range(of: "^[A-Za-z0-9_-]{8,100}$", options: .regularExpression) != nil,
              raw["question_id"].truthy, StorageDates.digits(qid), ["study", "answer", "reveal", "favorite"].contains(type) else { throw APIError(status: 400, message: "学习事件格式无效") }
        guard let at = StorageDates.parse(raw["at"]), !validateFuture || at <= now.addingTimeInterval(60) else { throw APIError(status: 400, message: "学习事件时间无效") }
        if type == "answer", raw["correct"].boolValue == nil { throw APIError(status: 400, message: "作答结果无效") }
        if type == "favorite", !["manual", "automatic"].contains(raw["source"].text) { throw APIError(status: 400, message: "收藏来源无效") }
        return ["event_id": .string(id), "question_id": .string(qid), "type": .string(type), "at": .string(StorageDates.iso(at)),
            "chapter_id": raw["chapter_id"] == .null ? .null : .string(raw["chapter_id"].text),
            "chapter_name": .string(String((raw["chapter_name"].truthy ? raw["chapter_name"].text : "未分类").prefix(200))),
            "session_id": .string(String((raw["session_id"].truthy ? raw["session_id"].text : "").prefix(100))),
            "correct": .bool(raw["correct"] == true), "reliable": .bool(raw["reliable"] == true),
            "answer_seen": .bool(raw["answer_seen"] == true), "source": raw["source"].truthy ? raw["source"] : .null]
    }
    func readActivity() throws -> JSONValue {
        let value = try readDocument("study-activity.json", fallback: .null)
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent("study-activity.json").path) {
            try validateDocument("study-activity.json", value); return value
        }
        var baseline: [String: JSONValue] = [:]
        for (id, p) in try readState()["progress"].objectValue ?? [:] where StorageDates.learned(p) {
            baseline[id] = ["failed": .bool(p["last_ok"] == false || p["error_prone"] == true)]
        }
        var initial: JSONValue = ["version": 1, "started_at": nowISO, "baseline": .object(baseline), "events": [:]]
        try saveActivity(&initial); return initial
    }
    func saveActivity(_ value: inout JSONValue) throws {
        value["revision"] = .number((value["revision"].numberValue ?? 0) + 1)
        try writeDocument("study-activity.json", value)
    }
    func observeImport(_ state: JSONValue, activity: inout JSONValue) {
        let known = Set((activity["events"].objectValue ?? [:]).values.filter { ["study", "answer"].contains($0["type"].text) }.map { $0["question_id"].text })
        var baseline = activity["baseline"].objectValue ?? [:]
        for (id, p) in state["progress"].objectValue ?? [:] where StorageDates.learned(p) && !known.contains(id) && baseline[id] == nil {
            baseline[id] = ["failed": .bool(p["last_ok"] == false || p["error_prone"] == true)]
        }
        activity["baseline"] = .object(baseline)
    }
    func appendEvents(_ raw: JSONValue) throws -> JSONValue {
        guard let input = raw.arrayValue, input.count <= 1000 else { throw APIError(status: 400, message: "学习事件批次无效") }
        let normalized = try input.map { try normalizeEvent($0) }
        var data = try readActivity(), events = data["events"].objectValue ?? [:], order = events.count
        for var event in normalized where events[event["event_id"].text] == nil {
            order += 1; event["order"] = .number(Double(order)); events[event["event_id"].text] = event
        }
        data["events"] = .object(events); try saveActivity(&data)
        return .array(normalized.map { $0["event_id"] })
    }
    func mergeActivity(_ input: JSONValue) throws -> Int {
        guard input["version"] == 1, input["events"].objectValue != nil, input["baseline"].objectValue != nil, StorageDates.parse(input["started_at"]) != nil else {
            throw APIError(status: 400, message: "学习战报备份无效")
        }
        // Validate all input before changing a file, and ignore incoming order.
        let incoming = try (input["events"].objectValue ?? [:]).values.sorted {
            let a = $0["order"].numberValue ?? 0, b = $1["order"].numberValue ?? 0
            if a != b { return a < b }
            if $0["at"].text != $1["at"].text { return $0["at"].text < $1["at"].text }
            return $0["event_id"].text < $1["event_id"].text
        }.map { try normalizeEvent($0) }
        var data = try readActivity(), events = data["events"].objectValue ?? [:], baseline = data["baseline"].objectValue ?? [:]
        if input["started_at"].text < data["started_at"].text { data["started_at"] = input["started_at"] }
        let known = Set(events.values.filter { ["study", "answer"].contains($0["type"].text) }.map { $0["question_id"].text })
        for (id, p) in input["baseline"].objectValue ?? [:] where StorageDates.digits(id) && (input["importedBaseline"] != true || !known.contains(id)) {
            baseline[id] = ["failed": .bool(p["failed"] == true || baseline[id]?["failed"] == true)]
        }
        for event in incoming where ["study", "answer"].contains(event["type"].text) {
            let id = event["question_id"].text
            if input["baseline"][id] == .null && !known.contains(id) { baseline.removeValue(forKey: id) }
        }
        var order = events.count
        for var event in incoming where events[event["event_id"].text] == nil { order += 1; event["order"] = .number(Double(order)); events[event["event_id"].text] = event }
        data["events"] = .object(events); data["baseline"] = .object(baseline); try saveActivity(&data)
        return events.count
    }
}
