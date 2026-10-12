import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import DaguanCore

private final class TestKeys: AIKeyStore, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String: String] = [:]
    func read(profileID: String) throws -> String { lock.lock(); defer { lock.unlock() }; return keys[profileID] ?? "" }
    func write(_ key: String, profileID: String) throws { lock.lock(); defer { lock.unlock() }; keys[profileID] = key }
    func remove(profileID: String) throws { lock.lock(); defer { lock.unlock() }; keys.removeValue(forKey: profileID) }
}
private final class TestEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [(String, AIValue)] = []
    func emit(_ name: String, _ data: Data) {
        lock.lock(); defer { lock.unlock() }
        if let json = try? AIValue.decode(data) { values.append((name, json)) }
    }
    var events: [(String, AIValue)] { lock.lock(); defer { lock.unlock() }; return values }
}
private final class TestNetwork: AINetworking, @unchecked Sendable {
    private let lock = NSLock()
    private var queued: [[AIHTTPEvent]]
    private var captured: [URLRequest] = []
    init(_ events: [[AIHTTPEvent]]) { queued = events }
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return captured }
    func events(for request: URLRequest) -> AsyncThrowingStream<AIHTTPEvent, Error> {
        lock.lock()
        captured.append(request)
        let events = queued.isEmpty ? [] : queued.removeFirst()
        lock.unlock()
        return AsyncThrowingStream { continuation in
            events.forEach { continuation.yield($0) }
            continuation.finish()
        }
    }
}
private final class DeferredNetwork: AINetworking, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncThrowingStream<AIHTTPEvent, Error>.Continuation?
    var started: Bool { lock.lock(); defer { lock.unlock() }; return continuation != nil }
    func events(for request: URLRequest) -> AsyncThrowingStream<AIHTTPEvent, Error> {
        AsyncThrowingStream { continuation in
            self.lock.lock(); self.continuation = continuation; self.lock.unlock()
            continuation.yield(.response(status: 200, contentType: "application/json"))
        }
    }
    func finish(_ data: Data) {
        lock.lock(); let current = continuation; lock.unlock()
        current?.yield(.chunk(data)); current?.finish()
    }
}
private struct WaitingNetwork: AINetworking {
    func events(for request: URLRequest) -> AsyncThrowingStream<AIHTTPEvent, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.response(status: 200, contentType: "text/event-stream"))
            let task = Task {
                do { try await Task.sleep(nanoseconds: 60_000_000_000); continuation.finish() }
                catch { continuation.finish(throwing: CancellationError()) }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }
}

final class AIRouterTests: XCTestCase {
    private var directory: URL!
    override func setUpWithError() throws {
        let root = ProcessInfo.processInfo.environment["DAGUAN_TEST_TMP"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory
        directory = root.appendingPathComponent("daguan-ai-tests-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
    private func json(_ value: [String: AIValue]) throws -> Data { try AIValue.object(value).encoded() }
    private func route(_ router: AIRouter, _ path: String, _ method: String = "GET",
                       _ input: [String: AIValue]? = nil) async throws -> (Int, AIValue) {
        let request = APIRequest(path: path, method: method, body: try input.map { try json($0) })
        let optional = try await router.handle(request)
        let result = try XCTUnwrap(optional)
        XCTAssertEqual(result.headers["Cache-Control"], "no-store")
        return (result.status, try AIValue.decode(result.body))
    }
    private func create(_ router: AIRouter, streaming: Bool = true, vision: Bool = false) async throws -> String {
        let (status, value) = try await route(router, "/api/ai/profiles", "POST", ["name": .string("测试服务"),
            "baseUrl": .string("https://example.com/v1/"), "model": .string("test-model"),
            "key": .string("secret-key-abcdef"), "streaming": .bool(streaming),
            "capabilities": .object(["vision": .string(vision ? "passed" : "unknown")])])
        XCTAssertEqual(status, 200)
        return try XCTUnwrap(value.object["profile"]?.object["id"]?.text)
    }
    private func chat(_ router: AIRouter, _ id: String, _ qid: String = "42", includePrivate: Bool = false,
                      images: [AIValue] = [], events: TestEvents) async throws {
        let body = try json(["profileId": .string(id), "prompt": .string("讲解"), "includePrivate": .bool(includePrivate),
            "images": .array(images), "question": .object(["id": .string(qid), "stem": .string("题干"),
            "annotation": .string("private-note"), "mastery": .string("mastered")])])
        try await router.startChat(body: body, emit: { name, data in events.emit(name, data) })
    }
    private func completion(_ content: String = "回答") throws -> [AIHTTPEvent] {
        [.response(status: 200, contentType: "application/json"),
         .chunk(try json(["choices": .array([.object(["message": .object(["content": .string(content)])])])]))]
    }

    func testProfilesKeychainBlankKeyLimitsAndNoSecretInFiles() async throws {
        let keys = TestKeys(), router = AIRouter(dataDirectory: directory, keyStore: keys, network: TestNetwork([]))
        let id = try await create(router)
        let (_, edited) = try await route(router, "/api/ai/profiles/\(id)", "PATCH", ["key": .string(""), "streaming": .bool(false)])
        XCTAssertEqual(try keys.read(profileID: id), "secret-key-abcdef")
        XCTAssertEqual(edited.object["profile"]?.object["streaming"], .bool(false))
        let (_, list) = try await route(router, "/api/ai/profiles")
        XCTAssertEqual(list.object["profiles"]?.array.first?.object["keyHint"]?.text, "sec••••def")
        XCTAssertNil(list.object["profiles"]?.array.first?.object["key"])
        for _ in 1..<12 { _ = try await create(router) }
        let (status, _) = try await route(router, "/api/ai/profiles", "POST", ["baseUrl": .string("https://example.com/v1")])
        XCTAssertEqual(status, 400)
        let data = try Data(contentsOf: directory.appendingPathComponent("ai/profiles.json"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("secret-key"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("\"key\""))
        _ = try await route(router, "/api/ai/profiles/\(id)", "DELETE", ["clearHistory": .bool(false)])
        XCTAssertEqual(try keys.read(profileID: id), "")
        let unknown = try await router.handle(APIRequest(path: "/api/state"))
        XCTAssertNil(unknown)
        let chatRoute = try await router.handle(APIRequest(path: "/api/ai/chat", method: "POST"))
        XCTAssertNil(chatRoute)
    }

    func testSSEEventsAnswerFilteringAndPersistence() async throws {
        let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"<thi\"}}]}\n\n"
            + "data: {\"choices\":[{\"delta\":{\"content\":\"nk>秘密</think>中文🧮\"}}]}\r\n\r\n"
            + "data: [DONE]\n\n"
        let chunks = Data(stream.utf8).map { AIHTTPEvent.chunk(Data([$0])) }
        let network = TestNetwork([[.response(status: 200, contentType: "text/event-stream")] + chunks])
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router), events = TestEvents()
        try await chat(router, id, events: events)
        XCTAssertEqual(events.events.map { $0.0 }, ["started", "delta", "done"])
        XCTAssertEqual(events.events[1].1.object["content"]?.text, "中文🧮")
        XCTAssertEqual(events.events[0].1.object["type"]?.text, "started")
        let (_, history) = try await route(router, "/api/ai/conversations/\(id)/42")
        XCTAssertEqual(history.object["messages"]?.array.count, 2)
        XCTAssertEqual(history.object["messages"]?.array.last?.object["content"]?.text, "中文🧮")
        let payload = try AIValue.decode(XCTUnwrap(network.requests.first?.httpBody))
        XCTAssertEqual(payload.object["stream"], .bool(true))
        XCTAssertFalse(payload.object["messages"]?.array.last?.object["content"]?.text.contains("private-note") == true)
    }

    func testNonstreamVisionAndProfileQuestionIsolation() async throws {
        let network = TestNetwork([try completion("<think>secret</think>answer"), try completion("second")])
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router, streaming: false, vision: true), events = TestEvents()
        let images = (0..<6).map { AIValue.string("data:image/png;base64,\($0)") }
        try await chat(router, id, includePrivate: true, images: images, events: events)
        XCTAssertEqual(events.events.map { $0.0 }, ["started", "delta", "done"])
        let payload = try AIValue.decode(XCTUnwrap(network.requests.first?.httpBody))
        let content = try XCTUnwrap(payload.object["messages"]?.array.last?.object["content"]?.array)
        XCTAssertEqual(content.count, 5)
        XCTAssertTrue(content.first?.object["text"]?.text.contains("private-note") == true)
        try await chat(router, id, "43", events: TestEvents())
        let (_, original) = try await route(router, "/api/ai/conversations/\(id)/42")
        XCTAssertEqual(original.object["messages"]?.array.last?.object["content"]?.text, "answer")
        let (_, absent) = try await route(router, "/api/ai/conversations/another/42")
        XCTAssertEqual(absent.object["messages"]?.array, [])
        XCTAssertEqual(absent.object["updatedAt"], .null)
        _ = try await route(router, "/api/ai/conversations/\(id)/42", "DELETE")
        let (_, cleared) = try await route(router, "/api/ai/conversations/\(id)/42")
        XCTAssertEqual(cleared.object["messages"]?.array, [])
        _ = try await route(router, "/api/ai/profiles/\(id)", "DELETE", ["clearHistory": .bool(true)])
        let (_, removedHistory) = try await route(router, "/api/ai/conversations/\(id)/43")
        XCTAssertEqual(removedHistory.object["messages"]?.array, [])
    }

    func testNonstreamProfileAggregatesUnexpectedUpstreamSSE() async throws {
        let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"一\"}}]}\n\n"
            + "data: {\"choices\":[{\"delta\":{\"content\":\"二\"},\"finish_reason\":\"stop\"}]}\n\n"
        let network = TestNetwork([[.response(status: 200, contentType: "text/event-stream"), .chunk(Data(stream.utf8))]])
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router, streaming: false), events = TestEvents()
        try await chat(router, id, events: events)
        XCTAssertEqual(events.events.map { $0.0 }, ["started", "delta", "done"])
        XCTAssertEqual(events.events[1].1.object["content"], .string("一二"))
    }

    func testModelsTestsUsageAndCapabilitiesFormats() async throws {
        let models = try json(["data": .array([.object(["id": .string("m1")]), .object(["name": .string("m2")])])])
        let answer = try json(["choices": .array([.object(["message": .object(["content": .string("视觉测试通过")])])]),
                              "usage": .object(["total_tokens": .number(5)])])
        let network = TestNetwork([[.response(status: 200, contentType: "application/json"), .chunk(models)],
                                   [.response(status: 200, contentType: "application/json"), .chunk(answer)]])
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router)
        let (_, result) = try await route(router, "/api/ai/profiles/\(id)/models")
        XCTAssertEqual(result.object["models"], .array([.string("m1"), .string("m2")]))
        XCTAssertEqual(result.object["status"], .number(200))
        XCTAssertEqual(network.requests.first?.url?.absoluteString, "https://example.com/v1/models")
        let (_, tested) = try await route(router, "/api/ai/profiles/\(id)/test", "POST", ["kind": .string("vision")])
        XCTAssertEqual(tested.object["kind"], .string("vision"))
        XCTAssertEqual(tested.object["response"], .string("视觉测试通过"))
        XCTAssertEqual(tested.object["usage"]?.object["total_tokens"], .number(5))
        let (_, list) = try await route(router, "/api/ai/profiles")
        XCTAssertEqual(list.object["profiles"]?.array.first?.object["capabilities"]?.object["vision"], .string("passed"))
        XCTAssertEqual(list.object["profiles"]?.array.first?.object["capabilities"]?.object["text"], .bool(true))
    }

    func testFailureEmptyMalformedAndTruncatedChatsNeverPersist() async throws {
        let errorJSON = try json(["error": .object(["message": .string("secret-key-abcdef")])])
        let runs: [[AIHTTPEvent]] = [
            [.response(status: 401, contentType: "application/json"), .chunk(errorJSON)],
            [.response(status: 200, contentType: "application/json"), .chunk(errorJSON)],
            [.response(status: 200, contentType: "application/json"), .chunk(Data("invalid".utf8))],
            try completion("<think>hidden only</think>"),
            [.response(status: 200, contentType: "text/event-stream"),
             .chunk(Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8))]
        ]
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: TestNetwork(runs))
        let id = try await create(router)
        for _ in runs {
            let events = TestEvents()
            try await chat(router, id, events: events)
            XCTAssertEqual(events.events.last?.0, "error")
            XCTAssertFalse(events.events.contains { $0.0 == "done" })
            XCTAssertFalse(events.events.last?.1.object["error"]?.text.contains("secret-key") == true)
            let (_, history) = try await route(router, "/api/ai/conversations/\(id)/42")
            XCTAssertEqual(history.object["messages"]?.array, [])
        }
    }

    func testHistoryBoundAndRecentContext() async throws {
        let network = TestNetwork(try (0..<201).map { _ in try completion() })
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router)
        var lastEvents = TestEvents()
        for _ in 0..<201 { lastEvents = TestEvents(); try await chat(router, id, events: lastEvents) }
        let (_, history) = try await route(router, "/api/ai/conversations/\(id)/42")
        XCTAssertEqual(history.object["messages"]?.array.count, 400)
        XCTAssertEqual(lastEvents.events.first?.1.object["historyTruncated"], .bool(true))
        let payload = try AIValue.decode(XCTUnwrap(network.requests.last?.httpBody))
        XCTAssertEqual(payload.object["messages"]?.array.count, 26)
    }

    func testCancelRunAndParentTaskDoNotPersist() async throws {
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: WaitingNetwork())
        let id = try await create(router)
        for useRunID in [true, false] {
            let events = TestEvents()
            let task = Task { try await self.chat(router, id, events: events) }
            for _ in 0..<1000 {
                if !events.events.isEmpty { break }
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            let runID = try XCTUnwrap(events.events.first?.1.object["runId"]?.text)
            if useRunID {
                let cancelled = await router.cancel(runID: runID)
                XCTAssertTrue(cancelled)
            } else { task.cancel() }
            try await task.value
            XCTAssertEqual(events.events.last?.0, "error")
            let (_, history) = try await route(router, "/api/ai/conversations/\(id)/42")
            XCTAssertEqual(history.object["messages"]?.array, [])
            let absent = await router.cancel(runID: runID)
            XCTAssertFalse(absent)
        }
    }

    func testStaleCapabilityResultCannotValidateChangedEndpointOrKey() async throws {
        for changeKey in [false, true] {
            let network = DeferredNetwork()
            let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
            let id = try await create(router)
            let task = Task { try await self.route(router, "/api/ai/profiles/\(id)/test", "POST", ["kind": .string("vision")]) }
            for _ in 0..<1000 {
                if network.started { break }
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            let started = network.started
            XCTAssertTrue(started)
            _ = try await route(router, "/api/ai/profiles/\(id)", "PATCH", changeKey
                ? ["key": .string("replacement-key")]
                : ["baseUrl": .string("https://another.example.com/v1")])
            network.finish(try json(["choices": .array([.object(["message": .object(["content": .string("passed")])])])]))
            _ = try await task.value
            let (_, list) = try await route(router, "/api/ai/profiles")
            let profile = list.object["profiles"]?.array.first { $0.object["id"]?.text == id }
            XCTAssertEqual(profile?.object["capabilities"]?.object["vision"], .string("unknown"))
            XCTAssertNil(profile?.object["capabilities"]?.object["text"])
        }
    }

    func testCancelledCapabilityTestCannotCommitSuccess() async throws {
        let network = DeferredNetwork()
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: network)
        let id = try await create(router)
        let task = Task { try await self.route(router, "/api/ai/profiles/\(id)/test", "POST", ["kind": .string("vision")]) }
        for _ in 0..<1000 {
            if network.started { break }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        task.cancel()
        network.finish(try json(["choices": .array([.object(["message": .object(["content": .string("passed")])])])]))
        let (status, _) = try await task.value
        XCTAssertEqual(status, 400)
        let (_, list) = try await route(router, "/api/ai/profiles")
        let capabilities = list.object["profiles"]?.array.first?.object["capabilities"]?.object
        XCTAssertEqual(capabilities?["vision"], .string("unknown"))
        XCTAssertNil(capabilities?["text"])
    }

    func testDiagramUnavailableHasExplicitResponse() async throws {
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: TestNetwork([]))
        let (status, value) = try await route(router, "/api/ai/diagram", "POST", ["kind": .string("function")])
        XCTAssertEqual(status, 501)
        XCTAssertFalse(value.object["error"]?.text.isEmpty ?? true)
    }

    func testCorruptProfilesArePreserved() async throws {
        let folder = directory.appendingPathComponent("ai", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("profiles.json"), corrupt = Data("broken".utf8)
        try corrupt.write(to: file)
        let router = AIRouter(dataDirectory: directory, keyStore: TestKeys(), network: TestNetwork([]))
        let (status, _) = try await route(router, "/api/ai/profiles", "POST", ["baseUrl": .string("https://example.com/v1")])
        XCTAssertEqual(status, 400)
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }
}
