import Foundation
import WebKit
import UniformTypeIdentifiers

struct BundledResources {
    let root: URL

    func file(for rawPath: String) throws -> URL {
        let path = rawPath.removingPercentEncoding ?? rawPath
        guard path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            throw ResourceError.invalidPath
        }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        let base = root.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        guard file.path.hasPrefix(base) else { throw ResourceError.invalidPath }
        return file
    }

    func read(_ path: String) throws -> (Data, String) {
        let file = try file(for: path)
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) <= 64 * 1024 * 1024 else {
            throw ResourceError.invalidPath
        }
        return (try Data(contentsOf: file, options: .mappedIfSafe), Self.mime(file.pathExtension))
    }

    static func mime(_ extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "js": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "html": return "text/html; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        default: return UTType(filenameExtension: extensionName)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    enum ResourceError: Error { case invalidPath }
}

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let resources: BundledResources
    init(resources: BundledResources) { self.resources = resources }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == "daguan", url.host == "app",
              (urlSchemeTask.request.httpMethod ?? "GET") == "GET" else {
            urlSchemeTask.didFailWithError(BundledResources.ResourceError.invalidPath)
            return
        }
        do {
            let (data, mime) = try resources.read(url.path.isEmpty ? "/index.html" : url.path)
            let response = URLResponse(url: url, mimeType: mime.components(separatedBy: ";")[0],
                                       expectedContentLength: data.count,
                                       textEncodingName: mime.contains("charset=utf-8") ? "utf-8" : nil)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
