import Foundation

/// Shared wire types for the WebKit bridge, storage router, and AI router.
public struct APIRequest: Sendable {
    public let path: String
    public let method: String
    public let body: Data?
    public init(path: String, method: String = "GET", body: Data? = nil) {
        self.path = path; self.method = method.uppercased(); self.body = body
    }
}

public struct APIResponse: Sendable {
    public let status: Int
    public let body: Data
    public let headers: [String: String]
    public init(status: Int, body: Data, headers: [String: String] = [:]) {
        self.status = status; self.body = body; self.headers = headers
    }
    public static func json(_ value: JSONValue, status: Int = 200, headers: [String: String] = [:]) throws -> APIResponse {
        var result = ["Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"]
        result.merge(headers) { _, new in new }
        return APIResponse(status: status, body: try JSONEncoder().encode(value), headers: result)
    }
}

public struct APIError: Error, Sendable, LocalizedError {
    public let status: Int
    public let code: String?
    public let message: String
    public let current: JSONValue?
    public var errorDescription: String? { message }
    public init(status: Int, code: String? = nil, message: String, current: JSONValue? = nil) {
        self.status = status; self.code = code; self.message = message; self.current = current
    }
    public func response() throws -> APIResponse {
        var value: JSONValue = ["ok": false, "code": code.map(JSONValue.string) ?? .null, "error": .string(message)]
        if let current { value["current"] = current }
        return try .json(value, status: status)
    }
}

/// No Any/NSDictionary crosses an actor boundary, including under Swift 6.
public enum JSONValue: Sendable, Equatable, Codable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
    public var objectValue: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
    public var arrayValue: [JSONValue]? { if case .array(let v) = self { return v }; return nil }
    public var stringValue: String? { if case .string(let v) = self { return v }; return nil }
    public var numberValue: Double? { if case .number(let v) = self { return v }; return nil }
    public var boolValue: Bool? { if case .bool(let v) = self { return v }; return nil }
    public subscript(_ key: String) -> JSONValue {
        get { objectValue?[key] ?? .null }
        set { var values = objectValue ?? [:]; values[key] = newValue; self = .object(values) }
    }
    public var text: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v.rounded() == v ? String(format: "%.0f", v) : String(v)
        case .bool(let v): return String(v)
        case .null: return "null"
        default: return (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? ""
        }
    }
    var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .string(let s): return !s.isEmpty
        default: return true
        }
    }
    func merging(_ other: JSONValue) -> JSONValue {
        .object((objectValue ?? [:]).merging(other.objectValue ?? [:]) { _, new in new })
    }
}
extension JSONValue: ExpressibleByNilLiteral { public init(nilLiteral: ()) { self = .null } }
extension JSONValue: ExpressibleByBooleanLiteral { public init(booleanLiteral value: Bool) { self = .bool(value) } }
extension JSONValue: ExpressibleByIntegerLiteral { public init(integerLiteral value: Int) { self = .number(Double(value)) } }
extension JSONValue: ExpressibleByFloatLiteral { public init(floatLiteral value: Double) { self = .number(value) } }
extension JSONValue: ExpressibleByStringLiteral { public init(stringLiteral value: String) { self = .string(value) } }
extension JSONValue: ExpressibleByArrayLiteral { public init(arrayLiteral elements: JSONValue...) { self = .array(elements) } }
extension JSONValue: ExpressibleByDictionaryLiteral {
    public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(elements, uniquingKeysWith: { _, new in new })) }
}

struct StorageDates {
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static func parse(_ value: JSONValue, numericStrings: Bool = false) -> Date? {
        if let n = value.numberValue, n.isFinite, abs(n) <= 8_640_000_000_000_000 { return Date(timeIntervalSince1970: n / 1000) }
        guard let s = value.stringValue, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        if numericStrings, let n = Double(s), n.isFinite, abs(n) <= 8_640_000_000_000_000 { return Date(timeIntervalSince1970: n / 1000) }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: s) { return d }
        formatter.formatOptions = [.withInternetDateTime]
        if let d = formatter.date(from: s) { return d }
        let day = DateFormatter(); day.locale = Locale(identifier: "en_US_POSIX"); day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"; day.isLenient = false
        return day.date(from: s)
    }
    static func recordTime(_ value: JSONValue) -> Date? {
        parse(value["updated_at"].truthy ? value["updated_at"] : value["updatedAt"], numericStrings: true)
    }
    static func digits(_ id: String, positive: Bool = false) -> Bool {
        !id.isEmpty && id.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } && (!positive || id.contains { $0 != "0" })
    }
    static func learned(_ p: JSONValue) -> Bool {
        p["seen"].truthy || p["answered"].truthy || p["last_practiced_at"].truthy || ["learning", "mastered", "forgot"].contains(p["mastery"].text)
    }
}
