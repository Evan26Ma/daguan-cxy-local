import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Security)
import Security
#endif

/// A JSON value used internally; bridge callbacks carry encoded Data, never this type.
public enum AIValue: Codable, Sendable, Equatable {
    case object([String: AIValue]), array([AIValue]), string(String), number(Double), bool(Bool), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([AIValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: AIValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    var object: [String: AIValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [AIValue] { if case .array(let v) = self { return v }; return [] }
    var text: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v.rounded() == v ? String(format: "%.0f", v) : String(v)
        case .bool(let v): return v ? "true" : "false"
        default: return ""
        }
    }
    var isTrue: Bool { self == .bool(true) }
    var isFalse: Bool { self == .bool(false) }
    func limited(_ count: Int = 120_000) -> String { String(text.prefix(count)) }
    static func decode(_ data: Data) throws -> AIValue { try JSONDecoder().decode(AIValue.self, from: data) }
    func encoded() throws -> Data { try JSONEncoder().encode(self) }
}

struct AIError: LocalizedError, Sendable {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

/// Implementations must never put secrets in profile JSON, logs, or backups.
public protocol AIKeyStore: Sendable {
    func read(profileID: String) throws -> String
    func write(_ key: String, profileID: String) throws
    func remove(profileID: String) throws
}

public struct KeychainAIKeyStore: AIKeyStore {
    private let service: String
    public init(service: String = "fun.plus-guide.daguan.ai") { self.service = service }
    #if canImport(Security)
    private func query(_ id: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: id,
         kSecAttrSynchronizable as String: false]
    }
    public func read(profileID: String) throws -> String {
        var q = query(profileID)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return "" }
        guard status == errSecSuccess, let data = result as? Data,
              let key = String(data: data, encoding: .utf8) else { throw AIError("无法读取 AI Key（Keychain \(status)）") }
        return key
    }
    public func write(_ key: String, profileID: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: Data(key.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query(profileID) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(profileID).merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw AIError("无法保存 AI Key（Keychain \(status)）") }
    }
    public func remove(profileID: String) throws {
        let status = SecItemDelete(query(profileID) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AIError("无法删除 AI Key（Keychain \(status)）") }
    }
    #else
    public func read(profileID: String) throws -> String { throw AIError("当前平台不支持 Keychain；测试必须注入 AIKeyStore") }
    public func write(_ key: String, profileID: String) throws { throw AIError("当前平台不支持 Keychain") }
    public func remove(profileID: String) throws { throw AIError("当前平台不支持 Keychain") }
    #endif
}

struct AIProfile: Codable, Sendable, Equatable {
    var id: String
    var name: String
    var baseUrl: String
    var model: String
    var streaming: Bool
    var active: Bool
    var capabilities: [String: AIValue]
    var createdAt: String
    var updatedAt: String

    func publicValue(key: String) -> AIValue {
        let hint = key.isEmpty ? "未设置" : key.count > 6 ? "\(key.prefix(3))••••\(key.suffix(3))" : "••••"
        return .object(["id": .string(id), "name": .string(name), "baseUrl": .string(baseUrl),
            "model": .string(model), "streaming": .bool(streaming), "active": .bool(active),
            "keyHint": .string(hint), "capabilities": .object(capabilities),
            "createdAt": .string(createdAt), "updatedAt": .string(updatedAt)])
    }
}
struct AIProfileFile: Codable { var version = 1; var profiles: [AIProfile] }
struct AIHistory: Codable, Sendable {
    var version = 1
    var profileId: String?
    var questionId: String?
    var messages: [AIMessage] = []
    var updatedAt: String?
}
struct AIMessage: Codable, Sendable {
    let role: String
    var content: String
    var at: String?
    var upstream: AIValue { .object(["role": .string(role), "content": .string(content)]) }
}

/// HTTP is allowed only for an explicitly saved literal local-network endpoint.
/// Hostnames resolving to LAN addresses should use HTTPS or a literal private IP.
public enum AIEndpoint {
    public static func validate(_ value: String) throws -> URL {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let c = URLComponents(string: text), let scheme = c.scheme?.lowercased(),
              ["https", "http"].contains(scheme), let host = c.host?.lowercased(), !host.isEmpty,
              let url = c.url else { throw AIError("AI API 地址必须是完整的 http:// 或 https:// 地址") }
        guard c.user == nil, c.password == nil else { throw AIError("API 地址不能内嵌账号或密码") }
        guard c.fragment == nil else { throw AIError("API 地址不能包含片段") }
        guard c.query == nil else { throw AIError("API 基地址不能包含查询参数") }
        if scheme == "http" && !isLocal(host) { throw AIError("公网 AI 接口必须使用 HTTPS；本机或局域网服务可以使用 HTTP") }
        return url
    }
    private static func isLocal(_ raw: String) -> Bool {
        let host = raw.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host.hasSuffix(".local") || host == "::1" { return true }
        if host.contains(":") {
            return host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80:")
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ Int($0).map { (0...255).contains($0) } == true }) else { return false }
        let a = Int(parts[0])!, b = Int(parts[1])!
        return a == 10 || a == 127 || a == 0 || (a == 169 && b == 254)
            || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168)
    }
    static func request(profile: AIProfile, key: String, path: String, payload: AIValue? = nil) throws -> URLRequest {
        let base = try validate(profile.baseUrl)
        var request = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 90)
        request.httpMethod = payload == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream, application/json", forHTTPHeaderField: "Accept")
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try payload?.encoded()
        return request
    }
}
