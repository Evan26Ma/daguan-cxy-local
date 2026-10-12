import Foundation

/// Mirrors study-activity.mjs: classifications come exclusively from real
/// events, not visits or progress totals. Days start at 04:00 in the chosen zone.
enum StudySummary {
    struct Question { var old = false; var first: String?; var revealed = false; var attempted = false; var failed = false }
    struct Fact { let event: JSONValue; let day: String; let isNew: Bool; let conquered: Bool; let newCount: Int; let conqueredCount: Int }
    struct Analysis { let summary: JSONValue; let facts: [Fact] }

    static func studyDay(_ date: Date, timeZone: String) throws -> String {
        guard let zone = TimeZone(identifier: timeZone) else { throw APIError(status: 400, message: "时区或日期无效") }
        var local = Calendar(identifier: .gregorian); local.timeZone = zone
        let parts = local.dateComponents([.year, .month, .day, .hour], from: date)
        var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(secondsFromGMT: 0)!
        var day = utc.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day))!
        if (parts.hour ?? 0) < 4 { day = utc.date(byAdding: .day, value: -1, to: day)! }
        return key(day)
    }
    static func key(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.calendar = Calendar(identifier: .gregorian); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    static func shift(_ day: String, _ offset: Int) -> String {
        let date = StorageDates.parse(.string(day))!
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return key(calendar.date(byAdding: .day, value: offset, to: date)!)
    }
    static func analyze(_ data: JSONValue, days: Int = 1, timeZone: String = "Asia/Hong_Kong", now: Date) throws -> Analysis {
        guard [1, 3, 7, 30, 365].contains(days) else { throw APIError(status: 400, message: "统计范围无效") }
        let today = try studyDay(now, timeZone: timeZone), start = shift(today, 1 - days)
        func inRange(_ day: String) -> Bool { day >= start && day <= today }
        var questions: [String: Question] = [:], daily: [String: Set<String>] = [:], favorites: [String: Set<String>] = [:], chapters: [String: JSONValue] = [:]
        var learned = Set<String>(), newQuestions = Set<String>(), firstPass = Set<String>(), conquered = Set<String>(), allNew = Set<String>(), allConquered = Set<String>(), facts: [Fact] = []
        let events = (data["events"].objectValue ?? [:]).values.sorted {
            if $0["at"].text != $1["at"].text { return $0["at"].text < $1["at"].text }
            let a = $0["order"].numberValue ?? 0, b = $1["order"].numberValue ?? 0
            return a == b ? $0["event_id"].text < $1["event_id"].text : a < b
        }
        for event in events {
            guard let at = StorageDates.parse(event["at"]), at <= now else { continue }
            let id = event["question_id"].text, type = event["type"].text, day = try studyDay(at, timeZone: timeZone)
            var q = questions[id] ?? Question(old: data["baseline"][id].truthy)
            if type == "reveal" { q.revealed = true; questions[id] = q; continue }
            if type == "favorite" { if inRange(day) { favorites[id, default: []].insert(event["source"].text) }; questions[id] = q; continue }
            guard ["study", "answer"].contains(type) else { continue }
            daily[day, default: []].insert(id)
            let first = q.first == nil && !q.old
            if q.first == nil { q.first = day; if !q.old { allNew.insert(id) } }
            let independent = type == "answer" && event["reliable"] == true && event["answer_seen"] != true
            if !q.old && !q.attempted && independent && !q.revealed && inRange(day) {
                let chapterID = event["chapter_id"].truthy ? event["chapter_id"].text : "unknown"
                var c = chapters[chapterID] ?? ["id": .string(chapterID), "name": event["chapter_name"], "sample": 0, "correct": 0]
                c["sample"] = .number((c["sample"].numberValue ?? 0) + 1)
                if event["correct"] == true { c["correct"] = .number((c["correct"].numberValue ?? 0) + 1) }
                chapters[chapterID] = c
                if first && event["correct"] == true { firstPass.insert(id) }
            }
            let fixed = independent && event["correct"] == true && q.failed
            if fixed { allConquered.insert(id); if inRange(day) { conquered.insert(id) } }
            facts.append(Fact(event: event, day: day, isNew: !q.old && q.first == day, conquered: fixed, newCount: allNew.count, conqueredCount: allConquered.count))
            if independent && event["correct"] == true { q.failed = false }
            if type == "answer" && event["reliable"] == true && event["correct"] != true { q.failed = true }
            if type == "answer" && event["reliable"] == true { q.attempted = true }
            if inRange(day) { learned.insert(id); if !q.old, let first = q.first, inRange(first) { newQuestions.insert(id) } }
            questions[id] = q
        }
        let active = daily.keys.filter { $0 <= today }.sorted()
        var longest = 0, run = 0, previous: String?
        for day in active { run = previous.map { shift($0, 1) == day } == true ? run + 1 : 1; longest = max(longest, run); previous = day }
        var cursor = daily[today] != nil ? today : shift(today, -1), streak = 0
        while daily[cursor] != nil { streak += 1; cursor = shift(cursor, -1) }
        var sources: [String: JSONValue] = ["manual": 0, "automatic": 0, "both": 0]
        for values in favorites.values { let key = values.count > 1 ? "both" : (values.first ?? "manual"); sources[key] = .number((sources[key]?.numberValue ?? 0) + 1) }
        let chapterList = chapters.values.map { raw -> JSONValue in
            var c = raw
            let sample = c["sample"].numberValue ?? 0, rate = (c["correct"].numberValue ?? 0) / sample
            c["rate"] = .number(rate); c["weak"] = .bool(sample >= 5 && rate < 0.6)
            return c
        }.sorted { ($0["rate"].numberValue ?? 0) < ($1["rate"].numberValue ?? 0) }
        let achievements: JSONValue = ["newQuestions": .number(Double(allNew.count)), "conquered": .number(Double(allConquered.count)),
            "activeDays": .number(Double(active.count)), "currentStreak": .number(Double(streak)), "longestStreak": .number(Double(longest)),
            "bestDay": .number(Double(daily.values.map(\.count).max() ?? 0)),
            "newMilestones": .array([10, 50, 100, 500, 1000].map { ["target": .number(Double($0)), "reached": .bool(allNew.count >= $0)] }),
            "conqueredMilestones": .array([1, 10, 50, 100].map { ["target": .number(Double($0)), "reached": .bool(allConquered.count >= $0)] })]
        let summary: JSONValue = ["days": .number(Double(days)), "timeZone": .string(timeZone), "today": .string(today), "start": .string(start), "started_at": data["started_at"],
            "metrics": ["learned": .number(Double(learned.count)), "newQuestions": .number(Double(newQuestions.count)), "reviewed": .number(Double(learned.count - newQuestions.count)),
                "firstPass": .number(Double(firstPass.count)), "favorites": .number(Double(favorites.count)), "conquered": .number(Double(conquered.count))],
            "favoriteSources": .object(sources), "daily": .array((0..<days).map { let day = shift(start, $0); return ["day": .string(day), "count": .number(Double(daily[day]?.count ?? 0))] }),
            "chapters": .array(chapterList), "achievements": achievements]
        return Analysis(summary: summary, facts: facts)
    }

    static func journal(_ data: JSONValue, end requestedEnd: String? = nil, timeZone: String = "Asia/Hong_Kong", now: Date) throws -> JSONValue {
        let today = try studyDay(now, timeZone: timeZone), end = (requestedEnd?.isEmpty == false ? requestedEnd! : today)
        guard end.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
              let endDate = StorageDates.parse(.string(end)), key(endDate) == end, end <= today else { throw APIError(status: 400, message: "手账日期无效") }
        let start = shift(end, -6), analysis = try analyze(data, days: 7, timeZone: timeZone, now: now)
        struct Day { var ids = Set<String>(); var fresh = Set<String>(); var fixed = Set<String>(); var groups: [JSONValue] = [] }
        var days: [String: Day] = [:]
        for i in 0..<7 { days[shift(start, i)] = Day() }
        func badge(_ id: String, _ name: String, _ description: String, _ target: Int, _ kind: String) -> JSONValue {
            ["id": .string(id), "name": .string(name), "description": .string(description), "target": .number(Double(target)), "kind": .string(kind), "earnedOn": .null]
        }
        var badges = [badge("start", "提笔出发", "完成第一次有效练习", 1, "active"), badge("comeback", "迎难再来", "第一次独立重做答对旧错题", 1, "conquered")]
        for (target, name) in [(50, "积少成多"), (100, "百题成章"), (500, "步履不停"), (1000, "千题留痕")] { badges.append(badge("new-\(target)", name, "累计学习 \(target) 道不同新题", target, "new")) }
        badges += [badge("active-7", "常来常新", "累计在 7 个学习日练习，无需连续", 7, "active"), badge("conquered-10", "越过难关", "独立重做答对 10 道不同旧错题", 10, "conquered")]
        var active = Set<String>(), earliest = try studyDay(StorageDates.parse(data["started_at"])!, timeZone: timeZone)
        for fact in analysis.facts {
            let e = fact.event, day = fact.day, id = e["question_id"].text
            earliest = min(earliest, day); active.insert(day)
            for i in badges.indices {
                let kind = badges[i]["kind"].text
                let value = kind == "new" ? fact.newCount : kind == "conquered" ? fact.conqueredCount : active.count
                badges[i]["value"] = .number(Double(value))
                if badges[i]["earnedOn"] == .null, Double(value) >= (badges[i]["target"].numberValue ?? 0) { badges[i]["earnedOn"] = .string(day) }
            }
            guard var d = days[day] else { continue }
            d.ids.insert(id); if fact.isNew { d.fresh.insert(id) }; if fact.conquered { d.fixed.insert(id) }
            let at = StorageDates.parse(e["at"])!
            if d.groups.isEmpty || d.groups.last!["chapter_id"] != e["chapter_id"] || at.timeIntervalSince(StorageDates.parse(d.groups.last!["last_at"])!) > 30 * 60 {
                d.groups.append(["chapter_id": e["chapter_id"], "chapter_name": e["chapter_name"], "at": e["at"], "last_at": e["at"], "questions": []])
            }
            let index = d.groups.count - 1
            d.groups[index]["last_at"] = e["at"]
            var rows = d.groups[index]["questions"].arrayValue ?? []
            let previousIndex = rows.firstIndex { $0["question_id"].text == id }, previous = previousIndex.map { rows[$0] } ?? .null
            let result: JSONValue
            if e["type"] == "answer" {
                result = e["reliable"] == true ? (e["answer_seen"] == true ? "参考答案后作答" : e["correct"] == true ? "答对" : "待巩固") : "已作答（未自动判分）"
            } else { result = previous["result"].truthy ? previous["result"] : "已标记学习" }
            let row: JSONValue = ["question_id": .string(id), "isNew": .bool(fact.isNew), "conquered": .bool(fact.conquered || previous["conquered"] == true), "result": result]
            if let previousIndex { rows[previousIndex] = row } else { rows.append(row) }
            d.groups[index]["questions"] = .array(rows); days[day] = d
        }
        for i in badges.indices where badges[i]["value"] == .null { badges[i]["value"] = 0 }
        return ["today": .string(today), "start": .string(start), "end": .string(end), "earliest": .string(earliest), "timeZone": .string(timeZone), "started_at": data["started_at"],
                "achievements": analysis.summary["achievements"], "badges": .array(badges), "daily": .array((0..<7).map {
                    let day = shift(start, $0), d = days[day]!
                    return ["day": .string(day), "count": .number(Double(d.ids.count)), "newQuestions": .number(Double(d.fresh.count)), "reviewed": .number(Double(d.ids.count - d.fresh.count)),
                            "conquered": .number(Double(d.fixed.count)), "groups": .array(d.groups)]
                })]
    }
}
