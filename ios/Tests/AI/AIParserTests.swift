import XCTest
import Foundation
@testable import DaguanCore

final class AIParserTests: XCTestCase {
    func testEveryByteSplitPreservesUTF8AndCRLF() throws {
        let source = Data("data: {\"choices\":[{\"delta\":{\"content\":\"中文 ∑ 🧮\"}}]}\r\n\r\ndata: [DONE]\n\n".utf8)
        for split in 0...source.count {
            var parser = AISSEParser()
            var records = try parser.push(Data(source.prefix(split)))
            records += try parser.push(Data(source.dropFirst(split)), final: true)
            XCTAssertEqual(records.count, 2, "split \(split)")
            let json = try AIValue.decode(Data(records[0].utf8))
            XCTAssertEqual(json.object["choices"]?.array.first?.object["delta"]?.object["content"]?.text, "中文 ∑ 🧮")
            XCTAssertEqual(records[1], "[DONE]")
        }
        var parser = AISSEParser()
        var output: [String] = []
        for byte in source { output += try parser.push(Data([byte])) }
        output += try parser.push(Data(), final: true)
        XCTAssertEqual(output.count, 2)
    }

    func testMultilineRecordsCommentsAndUnterminatedEOF() throws {
        var parser = AISSEParser()
        let records = try parser.push(Data(": keepalive\nevent: message\ndata: {\"a\":\ndata: 1}\n\ndata: [DONE]".utf8), final: true)
        XCTAssertEqual(records, ["{\"a\":\n1}", "[DONE]"])
    }

    func testRejectsInvalidUTF8AndOversizedPartialLine() {
        var invalid = AISSEParser()
        XCTAssertThrowsError(try invalid.push(Data([0xff, 10])))
        var huge = AISSEParser()
        XCTAssertThrowsError(try huge.push(Data(repeating: 97, count: 2_000_001)))
    }

    func testThinkingTagsAcrossEveryCharacterBoundary() {
        let input = "前文<think>隐私<thinking>内部</thinking>推理</think>答案 **保留** <b>标签</b>"
        var filter = AIAnswerFilter(), visible = ""
        for character in input { visible += filter.push(String(character)) }
        visible += filter.push("", final: true)
        XCTAssertEqual(visible, "前文答案 **保留** <b>标签</b>")
        XCTAssertEqual(AIAnswerFilter.visible("<THINK attr=\"x\">secret</THINK>结果<thi"), "结果")
        XCTAssertEqual(AIAnswerFilter.visible("<think>unfinished"), "")
        XCTAssertEqual(AIAnswerFilter.visible("x < 3"), "x < 3")
    }

    func testEndpointPolicy() throws {
        for url in ["https://api.example.com/v1", "http://localhost:8080/v1", "http://192.168.1.2:3000/v1",
                    "http://10.1.2.3/v1", "http://172.31.0.1/v1", "http://[::1]:8000/v1", "http://box.local/v1"] {
            XCTAssertNoThrow(try AIEndpoint.validate(url), url)
        }
        for url in ["http://api.example.com/v1", "http://172.32.0.1/v1", "ftp://example.com", "https://user:key@host/v1",
                    "https://host/v1#token", "https://host/v1?key=secret", "http://999.1.2.3", "relative/v1"] {
            XCTAssertThrowsError(try AIEndpoint.validate(url), url)
        }
        let profile = AIProfile(id: "p", name: "p", baseUrl: "https://example.com/v1", model: "m", streaming: true,
            active: true, capabilities: [:], createdAt: "", updatedAt: "")
        let request = try AIEndpoint.request(profile: profile, key: "test-key", path: "chat/completions")
        XCTAssertEqual(request.url?.absoluteString, "https://example.com/v1/chat/completions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
    }

    func testContextPrivacyExactFieldsAndTutorPrompt() {
        let question: [String: AIValue] = ["id": .number(42), "category_path": .string("高数/极限"),
            "stem": .string("求极限"), "annotation": .string("private-note"), "mastery": .string("mastered"),
            "errorProne": .bool(true), "favorite": .bool(true),
            "options": .array([.object(["label": .string("A"), "content_md": .string("1")])])]
        let plain = AIRouter.context(question, includePrivate: false)
        XCTAssertTrue(plain.contains("题号：42"))
        XCTAssertTrue(plain.contains("知识路径：高数/极限"))
        XCTAssertTrue(plain.contains("选项：\nA. 1"))
        XCTAssertTrue(plain.contains("用户作答：未作答"))
        XCTAssertFalse(plain.contains("private-note"))
        let privateContext = AIRouter.context(question, includePrivate: true)
        XCTAssertTrue(privateContext.contains("本地批注：\nprivate-note"))
        XCTAssertTrue(privateContext.contains("易错：是\n\n收藏：是"))
        XCTAssertTrue(AIRouter.tutorPrompt.contains("考研大纲"))
        XCTAssertTrue(AIRouter.tutorPrompt.contains("daguan-diagram JSON"))
    }
}
