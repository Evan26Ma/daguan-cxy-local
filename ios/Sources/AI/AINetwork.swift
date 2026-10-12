import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum AIHTTPEvent: Sendable {
    case response(status: Int, contentType: String)
    case chunk(Data)
}

/// Each stream must terminate on cancellation; chunks may split UTF-8 and SSE records anywhere.
public protocol AINetworking: Sendable {
    func events(for request: URLRequest) -> AsyncThrowingStream<AIHTTPEvent, Error>
}

public struct URLSessionAINetwork: AINetworking {
    public init() {}
    public func events(for request: URLRequest) -> AsyncThrowingStream<AIHTTPEvent, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingOldest(256)) { continuation in
            let delegate = AIHTTPDelegate(continuation: continuation)
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 90
            config.timeoutIntervalForResource = 90
            config.httpCookieStorage = nil
            config.urlCredentialStorage = nil
            config.urlCache = nil
            let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
            let task = session.dataTask(with: request)
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                session.invalidateAndCancel()
            }
            task.resume()
        }
    }
}

private final class AIHTTPDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let continuation: AsyncThrowingStream<AIHTTPEvent, Error>.Continuation
    init(continuation: AsyncThrowingStream<AIHTTPEvent, Error>.Continuation) { self.continuation = continuation }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse else {
            continuation.finish(throwing: AIError("AI 服务未返回 HTTP 响应"))
            completionHandler(.cancel)
            return
        }
        continuation.yield(.response(status: response.statusCode,
            contentType: response.value(forHTTPHeaderField: "Content-Type") ?? ""))
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        switch continuation.yield(.chunk(data)) {
        case .dropped:
            continuation.finish(throwing: AIError("AI 返回速度过快，流式缓冲已满，请重试"))
            dataTask.cancel()
        case .terminated: dataTask.cancel()
        case .enqueued: break
        @unknown default: dataTask.cancel()
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { continuation.finish(throwing: error) } else { continuation.finish() }
        session.finishTasksAndInvalidate()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward bearer credentials to a redirected endpoint.
        completionHandler(nil)
    }
}

/// Byte-buffered SSE framing preserves partial UTF-8 sequences until a complete line exists.
/// Standard multiline data is joined; a final unterminated record is consumed at EOF.
public struct AISSEParser: Sendable {
    private var pending = Data()
    private var fields: [String] = []
    private var recordBytes = 0
    private let maximum = 2_000_000
    public init() {}
    public mutating func push(_ data: Data, final: Bool = false) throws -> [String] {
        pending.append(data)
        var records: [String] = []
        while let newline = pending.firstIndex(of: 10) {
            var line = pending.subdata(in: pending.startIndex..<newline)
            pending.removeSubrange(pending.startIndex...newline)
            if line.last == 13 { line.removeLast() }
            try consume(line, into: &records)
        }
        guard pending.count <= maximum else { throw AIError("AI 流式数据过大") }
        if final {
            if !pending.isEmpty { try consume(pending, into: &records); pending.removeAll() }
            flush(into: &records)
        }
        return records
    }
    private mutating func consume(_ data: Data, into records: inout [String]) throws {
        guard let line = String(data: data, encoding: .utf8) else { throw AIError("AI 返回无效 UTF-8") }
        if line.isEmpty { flush(into: &records); return }
        if line.hasPrefix("data:") {
            var text = String(line.dropFirst(5))
            if text.hasPrefix(" ") { text.removeFirst() }
            fields.append(text)
            recordBytes += data.count
            guard recordBytes <= maximum else { throw AIError("AI 流式数据过大") }
        }
    }
    private mutating func flush(into records: inout [String]) {
        if !fields.isEmpty { records.append(fields.joined(separator: "\n")) }
        fields.removeAll(keepingCapacity: true)
        recordBytes = 0
    }
}

/// Drop hidden reasoning, including tags split across upstream chunks.
public struct AIAnswerFilter: Sendable {
    private var pending = ""
    private var depth = 0
    public init() {}
    public mutating func push(_ chunk: String, final: Bool = false) -> String {
        pending += chunk
        var visible = ""
        while !pending.isEmpty {
            guard let start = pending.firstIndex(of: "<") else {
                if depth == 0 { visible += pending }; pending = ""; break
            }
            if depth == 0 { visible += pending[..<start] }
            pending = String(pending[start...])
            let end = pending.firstIndex(of: ">")
            if let next = pending.dropFirst().firstIndex(of: "<"), end == nil || next < end! {
                if depth == 0 { visible += pending[..<next] }
                pending = String(pending[next...]); continue
            }
            guard let end else { break }
            let tag = String(pending[...end])
            if tag.range(of: "^<(\\/)?(?:think|thinking)(?:\\s[^>]*)?>$", options: [.regularExpression, .caseInsensitive]) != nil {
                depth = tag.hasPrefix("</") ? max(0, depth - 1) : depth + 1
            } else if depth == 0 { visible += tag }
            pending = String(pending[pending.index(after: end)...])
        }
        if final {
            let partial = pending.range(of: "^<\\/?(?:t|th|thi|thin|think|thinki|thinkin|thinking)(?:\\s[^>]*)?$", options: [.regularExpression, .caseInsensitive]) != nil
            if depth == 0 && !partial { visible += pending }
            pending = ""
        }
        return visible
    }
    static func visible(_ text: String) -> String { var filter = Self(); return filter.push(text, final: true) }
}
