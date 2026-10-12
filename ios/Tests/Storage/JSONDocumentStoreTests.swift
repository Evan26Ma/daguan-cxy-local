import Foundation
import XCTest
@testable import DaguanCore

final class JSONDocumentStoreTests: XCTestCase {
    private let fixedNow = StorageDates.parse("2026-10-03T12:00:00Z")!
    private func fixture() throws -> (URL, JSONDocumentStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("daguan-storage-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: directory) }
        let now = fixedNow
        return (directory, JSONDocumentStore(directory: directory, clock: { now }))
    }
    private func call(_ store: JSONDocumentStore, _ path: String, _ method: String = "GET", _ input: JSONValue? = nil) async throws -> (Int, JSONValue) {
        let request = APIRequest(path: path, method: method, body: try input.map { try JSONEncoder().encode($0) })
        let optional = try await store.handle(request)
        let response = try XCTUnwrap(optional)
        XCTAssertEqual(response.headers["Cache-Control"], "no-store")
        return (response.status, try JSONDecoder().decode(JSONValue.self, from: response.body))
    }
    private func event(_ serial: Int, _ id: Int, _ type: String, _ at: String, _ extra: JSONValue = [:]) -> JSONValue {
        let base: JSONValue = ["event_id": .string(String(format: "event-%08d", serial)), "question_id": .string(String(id)), "type": .string(type),
            "at": .string(at), "chapter_id": "chapter", "chapter_name": "积分", "correct": true, "reliable": true, "answer_seen": false]
        return base.merging(extra)
    }

    func testRevisionConflictAndConcurrentPatchesDoNotLoseWrites() async throws {
        let (_, store) = try fixture()
        let initial = try await call(store, "/api/state")
        XCTAssertEqual(initial.1["revision"], 0)
        let missing = try await call(store, "/api/state/questions/1", "PATCH", ["mastery": "learning"])
        XCTAssertEqual(missing.0, 409); XCTAssertEqual(missing.1["code"], "REVISION_REQUIRED")
        async let first = call(store, "/api/state/questions/1", "PATCH", ["mastery": "forgot", "favorite": true, "revision": 0])
        async let second = call(store, "/api/state/questions/2", "PATCH", ["mastery": "mastered", "revision": 0])
        let results = try await [first, second]
        XCTAssertEqual(results.filter { $0.0 == 200 }.count, 1)
        let conflict = try XCTUnwrap(results.first { $0.0 == 409 })
        XCTAssertEqual(conflict.1["code"], "STATE_CONFLICT"); XCTAssertEqual(conflict.1["current"]["revision"], 1)
        let retry = try await call(store, "/api/state/questions/1", "PATCH", ["mastery": "forgot", "favorite": true, "answered": true, "last_ok": false, "revision": 1])
        XCTAssertEqual(retry.0, 200); XCTAssertEqual(retry.1["state"]["progress"]["1"]["mastery"], "learning")
        XCTAssertEqual(retry.1["state"]["progress"]["1"]["error_prone"], true)
        XCTAssertEqual(retry.1["state"]["favorites"], ["1"])
        let invalid = try await call(store, "/api/state/questions/3", "PATCH", ["mastery": "bad", "revision": 2])
        XCTAssertEqual(invalid.0, 400)
        let after = try await store.readState()
        XCTAssertEqual(after["revision"], 2)
    }

    func testAnnotationHistoryLastStudyAndReopen() async throws {
        let (directory, store) = try fixture()
        for revision in 0..<13 {
            let result = try await call(store, "/api/state/questions/42/annotation", "PATCH", ["markdown": .string("note \(revision)"), "revision": .number(Double(revision))])
            XCTAssertEqual(result.0, 200)
        }
        let repeated = try await call(store, "/api/state/questions/42/annotation", "PATCH", ["markdown": "note 12", "revision": 13])
        // Node keeps nine before appending, so unchanged markdown retains nine.
        XCTAssertEqual(repeated.1["state"]["annotations"]["42"]["history"].arrayValue?.count, 9)
        let saved = try await call(store, "/api/state/last-study", "PATCH", ["category_id": "223", "question_id": "42", "mode": "single", "revision": 14])
        XCTAssertEqual(saved.0, 200)
        XCTAssertEqual(saved.1["state"]["last_study"]["revision"], .null)
        let reopened = try await JSONDocumentStore(directory: directory).readState()
        XCTAssertEqual(reopened["annotations"]["42"]["markdown"], "note 12")
        XCTAssertEqual(reopened["last_study"]["question_id"], "42")
    }

    func testMigrationPreservesMetadataAndOnlyNewerValidRecordsWin() async throws {
        let (_, store) = try fixture()
        let current: JSONValue = ["revision": 0, "progress": ["1": ["mastery": "learning", "updated_at": 2000], "2": ["mastery": "mastered", "updated_at": "bad"]],
            "annotations": ["1": ["markdown": "keep", "updated_at": 2000]], "favorites": ["1"], "picked": ["2"],
            "last_study": ["question_id": "1", "updated_at": 2000], "pending_remote_operations": [["questionId": "1"]],
            "pending_unknown_states": ["999": ["mastery": "mastered"]], "remote_seeded_at": "seed", "remote_activity": ["count": 12], "local_activity": ["count": 3]]
        let initialWrite = try await call(store, "/api/state", "PUT", current)
        XCTAssertEqual(initialWrite.0, 200)
        let incoming: JSONValue = ["progress": ["1": ["mastery": "mastered", "updated_at": 3000], "2": ["mastery": "learning", "updated_at": 999999], "3": ["mastery": "forgot"]],
            "annotations": ["1": ["markdown": "", "updated_at": 9000]], "favorites": ["1", "3"], "picked": ["4"], "last_study": [:],
            "pending_remote_operations": [], "remote_seeded_at": "different", "local_activity": [:]]
        let result = try await call(store, "/api/state/migrate", "POST", incoming)
        XCTAssertEqual(result.0, 200)
        let state = result.1["state"]
        XCTAssertEqual(state["progress"]["1"]["mastery"], "mastered")
        XCTAssertEqual(state["progress"]["2"]["mastery"], "mastered", "Invalid local timestamp keeps local record")
        XCTAssertEqual(state["progress"]["3"]["error_prone"], true)
        XCTAssertEqual(state["annotations"]["1"]["markdown"], "keep")
        XCTAssertEqual(state["last_study"]["question_id"], "1")
        XCTAssertEqual(state["remote_seeded_at"], "seed")
        XCTAssertEqual(state["pending_remote_operations"], current["pending_remote_operations"])
        XCTAssertEqual(state["pending_unknown_states"], current["pending_unknown_states"])
        XCTAssertEqual(state["local_activity"], current["local_activity"])
        let activity = try await call(store, "/api/study-activity/export")
        XCTAssertEqual(activity.1["events"], [:]); XCTAssertNotEqual(activity.1["baseline"]["3"], .null)
    }

    func testKVSnapshotAtomicDeltaAndCorruptionPreservesBytes() async throws {
        let (directory, store) = try fixture()
        try await store.writeKV(["theme": "dark", "daguan_pending_visits_v1": "{}"])
        try await store.updateKV(["theme": "light", "daguan_pending_visits_v1": nil, "font": "18"])
        let values = try await JSONDocumentStore(directory: directory).readKV()
        XCTAssertEqual(values, ["theme": "light", "font": "18"])
        let file = directory.appendingPathComponent("frontend-kv.json"), corrupt = Data("{broken".utf8)
        try corrupt.write(to: file)
        do { try await store.writeKV([:]); XCTFail("Must preserve corrupt file") }
        catch let error as APIError { XCTAssertEqual(error.code, "DATA_CORRUPT") }
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }

    func testEveryCorruptDocumentRefusesMutationAndRetainsOriginal() async throws {
        let (directory, store) = try fixture()
        let cases: [(String, JSONValue, String, String, JSONValue)] = [
            ("state.json", .null, "/api/state/questions/1", "PATCH", ["revision": 0, "seen": true]),
            ("visit-history.json", ["version": 2, "entries": [:]], "/api/visit-history", "DELETE", [:]),
            ("study-activity.json", ["version": 1, "started_at": "bad", "events": [:], "baseline": [:]], "/api/study-activity/events", "POST", ["events": []])]
        for (name, invalid, path, method, body) in cases {
            let bytes = try JSONEncoder().encode(invalid), file = directory.appendingPathComponent(name)
            try bytes.write(to: file)
            let response = try await call(store, path, method, body)
            XCTAssertEqual(response.0, 500); XCTAssertEqual(response.1["code"], "DATA_CORRUPT")
            XCTAssertEqual(try Data(contentsOf: file), bytes)
            try FileManager.default.removeItem(at: file)
        }
        let studyFile = directory.appendingPathComponent("study-activity.json")
        let corrupt = Data("{bad".utf8); try corrupt.write(to: studyFile)
        let result = try await call(store, "/api/state", "PUT", ["revision": 0, "progress": ["1": ["seen": true]]])
        XCTAssertEqual(result.0, 500)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("state.json").path), "Import must preflight activity before writing state")
        XCTAssertEqual(try Data(contentsOf: studyFile), corrupt)
    }

    func testMalformedNestedStateIsNotNormalizedOverExistingBytes() async throws {
        let (directory, store) = try fixture()
        let file = directory.appendingPathComponent("state.json")
        let malformed: [JSONValue] = [.null, [], "broken", 12]
        for field in ["progress", "annotations"] {
            for bad in malformed {
                let document = JSONValue.object(["revision": 0, field: ["1": bad]])
                let bytes = try JSONEncoder().encode(document)
                try bytes.write(to: file)
                let result = try await call(store, "/api/state/questions/2", "PATCH", ["revision": 0, "seen": true])
                XCTAssertEqual(result.0, 500); XCTAssertEqual(result.1["code"], "DATA_CORRUPT")
                XCTAssertEqual(try Data(contentsOf: file), bytes)
            }
        }
    }

    func testUnsafePersistedRevisionFailsBeforeIntegerConversionOrWrite() async throws {
        let (directory, store) = try fixture()
        let file = directory.appendingPathComponent("state.json")
        for revision in [1e100, 1.5, -1.0, 9_007_199_254_740_992] {
            let document: JSONValue = ["revision": .number(revision), "progress": [:]]
            let bytes = try JSONEncoder().encode(document); try bytes.write(to: file)
            let result = try await call(store, "/api/state/migrate", "POST", ["progress": ["1": ["seen": true]]])
            XCTAssertEqual(result.0, 500); XCTAssertEqual(result.1["code"], "DATA_CORRUPT")
            XCTAssertEqual(try Data(contentsOf: file), bytes)
        }
        let maximum: JSONValue = ["revision": .number(9_007_199_254_740_991), "progress": [:]]
        let bytes = try JSONEncoder().encode(maximum); try bytes.write(to: file)
        let limit = try await call(store, "/api/state/questions/1", "PATCH", ["revision": maximum["revision"], "seen": true])
        XCTAssertEqual(limit.0, 409); XCTAssertEqual(limit.1["code"], "REVISION_LIMIT")
        XCTAssertEqual(try Data(contentsOf: file), bytes)
    }

    func testFirstQuestionPatchDoesNotBecomeLegacyActivityBaseline() async throws {
        let (_, store) = try fixture()
        _ = try await call(store, "/api/state/questions/1", "PATCH", ["revision": 0, "seen": true, "mastery": "learning"])
        _ = try await call(store, "/api/study-activity/events", "POST", ["events": .array([event(1, 1, "answer", "2026-10-03T08:00:00Z")])])
        let exported = try await call(store, "/api/study-activity/export")
        XCTAssertEqual(exported.1["baseline"]["1"], .null)
        let summary = try await call(store, "/api/study-activity")
        XCTAssertEqual(summary.1["metrics"]["newQuestions"], 1)
        XCTAssertEqual(summary.1["metrics"]["firstPass"], 1)
    }

    func testVisitsRemainSeparateFromStudyAndClearDoesNotRemigrate() async throws {
        let (directory, store) = try fixture()
        _ = try await call(store, "/api/state", "PUT", ["revision": 0, "progress": ["11": ["seen": true, "updated_at": "2026-01-02T00:00:00Z"], "12": ["mastery": "not_started"]]])
        let legacy = try await call(store, "/api/visit-history")
        XCTAssertEqual(legacy.1["entries"].arrayValue?.count, 1)
        XCTAssertEqual(legacy.1["entries"].arrayValue?.first?["time_kind"], "legacy")
        _ = try await call(store, "/api/visit-history", "POST", ["question_id": "11", "category_id": 223, "chapter_id": 601, "visited_at": "2026-10-02T08:00:00Z"])
        _ = try await call(store, "/api/visit-history/merge", "POST", ["entries": [["question_id": "11", "visited_at": "2020-01-01T00:00:00Z"], ["question_id": "13", "visited_at": "2025-01-01T00:00:00Z"]]])
        let entries = try await call(store, "/api/visit-history").1["entries"].arrayValue ?? []
        XCTAssertEqual(entries.count, 2); XCTAssertEqual(entries.first?["category_id"], "223")
        let summary = try await call(store, "/api/study-activity?days=365")
        XCTAssertEqual(summary.1["metrics"]["learned"], 0); XCTAssertEqual(summary.1["achievements"]["newQuestions"], 0)
        _ = try await call(store, "/api/visit-history", "DELETE")
        let reopened = try await call(JSONDocumentStore(directory: directory), "/api/visit-history")
        XCTAssertEqual(reopened.1["entries"], [])
    }

    func testEventsDedupeRestoreAndInvalidBatchHasNoPartialWrites() async throws {
        let (_, store) = try fixture()
        let failed = event(1, 1, "answer", "2026-10-01T08:00:00Z", ["correct": false])
        let correct = event(2, 1, "answer", "2026-10-02T08:00:00Z")
        async let a = call(store, "/api/study-activity/events", "POST", ["events": .array([failed])])
        async let b = call(store, "/api/study-activity/events", "POST", ["events": .array([failed, correct])])
        _ = try await [a, b]
        let exported = try await call(store, "/api/study-activity/export").1
        XCTAssertEqual(exported["events"].objectValue?.count, 2)
        let invalid = failed.merging(["event_id": "bad"])
        let invalidBatch = try await call(store, "/api/study-activity/events", "POST", ["events": .array([event(3, 2, "study", "2026-10-02T08:00:00Z"), invalid])])
        let afterInvalid = try await call(store, "/api/study-activity/export")
        XCTAssertEqual(invalidBatch.0, 400)
        XCTAssertEqual(afterInvalid.1, exported)
        let backup: JSONValue = ["version": 1, "started_at": "2026-01-01T00:00:00Z", "events": exported["events"], "baseline": [:]]
        _ = try await call(store, "/api/study-activity/merge", "POST", backup)
        _ = try await call(store, "/api/study-activity/merge", "POST", backup)
        let summary = try await call(store, "/api/study-activity?days=3&timeZone=Asia%2FHong_Kong")
        XCTAssertEqual(summary.1["metrics"]["learned"], 1); XCTAssertEqual(summary.1["metrics"]["conquered"], 1)
        XCTAssertEqual(summary.1["metrics"]["firstPass"], 0)
        let restore = try await call(store, "/api/study-activity/merge", "POST", ["version": 1, "started_at": "2026-01-01T00:00:00Z", "baseline": ["1": [:], "99": [:]], "events": [:], "importedBaseline": true])
        XCTAssertEqual(restore.0, 200)
        let restored = try await call(store, "/api/study-activity/export").1
        XCTAssertEqual(restored["baseline"]["1"], .null); XCTAssertNotEqual(restored["baseline"]["99"], .null)
    }

    func testStudySummaryAndJournalMatchEventClassification() throws {
        let events = [event(1, 1, "answer", "2026-10-01T08:00:00Z", ["correct": false]), event(2, 1, "answer", "2026-10-02T08:00:00Z"),
            event(3, 1, "answer", "2026-10-02T08:01:00Z"), event(4, 2, "study", "2026-10-02T19:59:00Z"), event(5, 3, "study", "2026-10-02T20:00:00Z"),
            event(6, 99, "answer", "2026-10-02T08:02:00Z"), event(7, 4, "favorite", "2026-10-02T08:00:00Z", ["source": "manual"]), event(8, 5, "reveal", "2026-10-02T08:00:00Z")]
        let map = Dictionary(uniqueKeysWithValues: events.enumerated().map { index, raw -> (String, JSONValue) in var e = raw; e["order"] = .number(Double(index)); return (e["event_id"].text, e) })
        let data: JSONValue = ["version": 1, "started_at": "2026-09-01T00:00:00Z", "baseline": ["99": [:]], "events": .object(map)]
        let result = try StudySummary.journal(data, now: fixedNow)
        let day = try XCTUnwrap(result["daily"].arrayValue?.first { $0["day"] == "2026-10-02" })
        XCTAssertEqual(day["count"], 3); XCTAssertEqual(day["newQuestions"], 1); XCTAssertEqual(day["reviewed"], 2); XCTAssertEqual(day["conquered"], 1)
        XCTAssertEqual(day["groups"].arrayValue?.first?["questions"].arrayValue?.count, 2)
        XCTAssertEqual(result["badges"].arrayValue?.first { $0["id"] == "comeback" }?["earnedOn"], "2026-10-02")
        XCTAssertEqual(result["badges"].arrayValue?.first { $0["id"] == "start" }?["earnedOn"], "2026-10-01")
        XCTAssertEqual(result["daily"].arrayValue?.last?["count"], 1)
        XCTAssertThrowsError(try StudySummary.journal(data, end: "2026-02-31", now: fixedNow))
        XCTAssertThrowsError(try StudySummary.journal(data, end: "2026-10-04", now: fixedNow))
    }

    func testCalendarBoundaryDSTAndFirstPassExclusions() throws {
        for (at, zone, expected) in [("2026-09-29T19:59:59Z", "Asia/Hong_Kong", "2026-09-29"), ("2026-09-29T20:00:00Z", "Asia/Hong_Kong", "2026-09-30"),
            ("2026-01-01T02:00:00Z", "UTC", "2025-12-31"), ("2026-03-08T07:30:00Z", "America/New_York", "2026-03-07"), ("2026-03-08T08:00:00Z", "America/New_York", "2026-03-08")] {
            XCTAssertEqual(try StudySummary.studyDay(StorageDates.parse(.string(at))!, timeZone: zone), expected)
        }
        let at = "2026-10-03T08:00:00Z"
        let events = [event(1, 1, "answer", at), event(2, 2, "reveal", at), event(3, 2, "answer", at), event(4, 3, "answer", at, ["reliable": false]), event(5, 4, "answer", at, ["answer_seen": true]), event(6, 99, "answer", at)]
        let map = Dictionary(uniqueKeysWithValues: events.enumerated().map { index, raw -> (String, JSONValue) in var e = raw; e["order"] = .number(Double(index)); return (e["event_id"].text, e) })
        let result = try StudySummary.analyze(["started_at": "2026-01-01T00:00:00Z", "baseline": ["99": [:]], "events": .object(map)], now: fixedNow).summary
        XCTAssertEqual(result["metrics"]["learned"], 5); XCTAssertEqual(result["metrics"]["newQuestions"], 4); XCTAssertEqual(result["metrics"]["firstPass"], 1)
        XCTAssertEqual(result["chapters"].arrayValue?.first?["sample"], 1)
        XCTAssertThrowsError(try StudySummary.studyDay(fixedNow, timeZone: "invalid"))
    }

    func testRouteFallthroughExportHeadersAndMalformedBody() async throws {
        let (_, store) = try fixture()
        let unknown = try await store.handle(APIRequest(path: "/api/ai/profiles", body: Data("not-json".utf8)))
        XCTAssertNil(unknown)
        let remote = try await store.handle(APIRequest(path: "/api/integrations/cxyonly/export?source=remote"))
        XCTAssertNil(remote)
        let badResponse = try await store.handle(APIRequest(path: "/api/state", method: "PUT", body: Data("{bad".utf8)))
        let bad = try XCTUnwrap(badResponse)
        XCTAssertEqual(bad.status, 400)
        let exportResponse = try await store.handle(APIRequest(path: "./api/integrations/cxyonly/export?source=android"))
        let export = try XCTUnwrap(exportResponse)
        XCTAssertTrue(export.headers["Content-Disposition"]?.contains("daguan-android-2026-10-03.json") == true)
        let android = try JSONDecoder().decode(JSONValue.self, from: export.body)
        XCTAssertEqual(android["format"], "daguan-android-progress"); XCTAssertEqual(android["version"], 2)
        let eventsResponse = try await store.handle(APIRequest(path: "/api/state/events"))
        let events = try XCTUnwrap(eventsResponse)
        XCTAssertTrue(String(decoding: events.body, as: UTF8.self).hasPrefix("event: state\ndata: "))
        let access = try await call(store, "/daguan-math/api/access/status")
        let bank = try await call(store, "/api/question-bank/status")
        XCTAssertEqual(access.1["unlocked"], true)
        XCTAssertEqual(bank.1, ["enabled": false, "activeId": "bundled"])
    }
}
