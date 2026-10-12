import UIKit
import WebKit
import DaguanCore

@MainActor
final class DaguanViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var store: JSONDocumentStore!
    private var ai: AIRouter!
    private var resources: BundledResources!
    private var subscriptions = Set<String>()
    private var chats: [String: Task<Void, Never>] = [:]
    private var requests: [String: Task<Void, Never>] = [:]
    private var exports = Set<URL>()
    private var backgroundObserver: NSObjectProtocol?
    private var bridgeSource = ""
    private var refreshingSnapshot = false
    private var permittedDocumentURL: URL?

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        Task { await configure() }
    }

    private func configure() async {
        do {
            guard let root = Bundle.main.url(forResource: "Web", withExtension: nil) else {
                throw BridgeError.message("题库资源尚未打包。请先运行 prepare-web.mjs。")
            }
            resources = BundledResources(root: root)
            let dataDirectory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                            appropriateFor: nil, create: true).appendingPathComponent("DaguanPad", isDirectory: true)
            store = JSONDocumentStore(directory: dataDirectory)
            ai = AIRouter(dataDirectory: dataDirectory)
            var kv = try await store.readKV()
            kv["daguan_ui_version_v1"] = "new"
            let snapshot = try JSONSerialization.data(withJSONObject: kv, options: [.sortedKeys])
            let (bridgeData, _) = try resources.read("/ios/bridge.js")
            guard let bridge = String(data: bridgeData, encoding: .utf8) else { throw BridgeError.message("桥接脚本编码无效") }
            let content = WKUserContentController()
            content.add(WeakScriptHandler(target: self), name: "daguan")
            bridgeSource = bridge
            let bootstrap = "window.__DAGUAN_IOS_KV__ = " + String(decoding: snapshot, as: UTF8.self) + ";\n" + bridge
            content.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let configuration = WKWebViewConfiguration()
            configuration.userContentController = content
            configuration.websiteDataStore = .default()
            configuration.setURLSchemeHandler(BundleSchemeHandler(resources: resources), forURLScheme: "daguan")
            webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.isOpaque = false
            webView.backgroundColor = .systemBackground
            webView.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
            backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                                                           object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    for task in self.chats.values { task.cancel() }
                    self.chats.removeAll()
                    for task in self.requests.values { task.cancel() }
                    self.requests.removeAll()
                    self.webView.evaluateJavaScript("window.DaguanIOS?.flush?.().catch(() => {});", completionHandler: nil)
                }
            }
            webView.load(URLRequest(url: URL(string: "daguan://app/index.html?ui=new")!))
        } catch { showFailure(error.localizedDescription) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.scheme == "daguan", frameURL.host == "app",
              let body = message.body as? [String: Any], let id = body["id"] as? String,
              id.count <= 128, let operation = body["operation"] as? String else { return }
        if operation == "request" {
            guard requests.count < 128, requests[id] == nil else { receive(id, error: "请求数量超过限制或标识重复"); return }
            requests[id] = Task { [weak self] in
                await self?.dispatch(id: id, operation: operation, body: body)
                self?.requests.removeValue(forKey: id)
            }
        } else {
            Task { await dispatch(id: id, operation: operation, body: body) }
        }
    }

    private func dispatch(id: String, operation: String, body: [String: Any]) async {
        do {
            switch operation {
            case "resource":
                let rawPath = try string(body, "path")
                let path = String(rawPath.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
                do {
                    let (data, mime) = try resources.read(path)
                    receive(id, result: envelope(status: 200, data: data, headers: ["Content-Type": mime]))
                } catch {
                    receive(id, result: envelope(status: 404, data: Data("资源不存在".utf8), headers: ["Content-Type": "text/plain; charset=utf-8"]))
                }
            case "request":
                let path = try string(body, "path")
                let method = (body["method"] as? String ?? "GET").uppercased()
                guard path.hasPrefix("/api/"), !path.contains(".."), ["GET", "POST", "PATCH", "PUT", "DELETE"].contains(method) else {
                    throw BridgeError.message("请求不在允许范围")
                }
                let request = APIRequest(path: path, method: method, body: try payload(body))
                let response: APIResponse
                do {
                    if let local = try await store.handle(request) { response = local }
                    else if let remote = try await ai.handle(request) { response = remote }
                    else { response = APIResponse(status: 404, body: Data("{\"error\":\"此功能不适用于 iPad 独立版\"}".utf8), headers: ["Content-Type": "application/json"]) }
                } catch let error as APIError { response = try error.response() }
                receive(id, result: envelope(status: response.status, data: response.body, headers: response.headers))
                if method != "GET", (200..<300).contains(response.status) { await broadcastMutation(path) }
            case "kv":
                guard let values = body["values"] as? [String: String], values.count <= 10000,
                      values.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count }) <= 32 * 1024 * 1024 else {
                    throw BridgeError.message("本地缓存格式或体积无效")
                }
                try await store.writeKV(values)
                receive(id, result: ["saved": true])
            case "subscribe":
                guard subscriptions.count < 16 else { throw BridgeError.message("订阅数量超过限制") }
                let subscriptionID = try string(body, "subscriptionId")
                guard subscriptionID.count <= 128 else { throw BridgeError.message("订阅标识无效") }
                subscriptions.insert(subscriptionID)
                receive(id, result: ["subscriptionId": subscriptionID])
                await broadcastState(to: subscriptionID)
            case "unsubscribe":
                subscriptions.remove(try string(body, "subscriptionId"))
                receive(id, result: [:])
            case "chat":
                guard chats.count < 8, let payload = try payload(body) else { throw BridgeError.message("AI 请求无效或数量超过限制") }
                receive(id, result: [:])
                let service = ai!
                chats[id] = Task { [weak self] in
                    var continuation: AsyncStream<BridgeStreamEvent>.Continuation!
                    let events = AsyncStream<BridgeStreamEvent> { continuation = $0 }
                    let eventSink = continuation!
                    let producer = Task {
                        do {
                            try await service.startChat(body: payload) { name, data in
                                eventSink.yield(BridgeStreamEvent(name: name, data: data))
                            }
                        } catch {
                            let data = (try? JSONSerialization.data(withJSONObject: ["type": "error", "error": error.localizedDescription])) ?? Data()
                            eventSink.yield(BridgeStreamEvent(name: "error", data: data))
                        }
                        eventSink.finish()
                    }
                    await withTaskCancellationHandler(operation: {
                        for await event in events { self?.stream(id, name: event.name, data: event.data) }
                    }, onCancel: { producer.cancel() })
                    self?.chats.removeValue(forKey: id)
                }
            case "cancel-request":
                requests.removeValue(forKey: try string(body, "requestId"))?.cancel()
                receive(id, result: [:])
            case "cancel":
                let runID = try string(body, "runId")
                if let task = chats.removeValue(forKey: runID) { task.cancel() }
                _ = await ai.cancel(runID: runID)
                receive(id, result: [:])
            case "export":
                try presentExport(body)
                receive(id, result: ["presented": true])
            default: throw BridgeError.message("不支持的桥接操作")
            }
        } catch { receive(id, error: error.localizedDescription) }
    }

    private func string(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String, !value.isEmpty else { throw BridgeError.message("缺少参数 \(key)") }
        return value
    }

    private func payload(_ body: [String: Any]) throws -> Data? {
        guard let raw = body["body"] as? String else { return nil }
        guard raw.utf8.count <= 24 * 1024 * 1024 else { throw BridgeError.message("请求内容超过限制") }
        return Data(raw.utf8)
    }

    private func envelope(status: Int, data: Data, headers: [String: String]) -> [String: Any] {
        ["status": status, "body": data.base64EncodedString(), "headers": headers]
    }

    private func receive(_ id: String, result: [String: Any]) { send("receive", ["id": id, "ok": true, "result": result]) }
    private func receive(_ id: String, error: String) { send("receive", ["id": id, "ok": false, "error": error]) }
    private func stream(_ id: String, name: String, data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return }
        send("stream", ["id": id, "event": name, "data": json])
    }
    private func send(_ method: String, _ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let webView else { return }
        webView.evaluateJavaScript("window.DaguanIOS?.\(method)(\(String(decoding: data, as: UTF8.self)));", completionHandler: nil)
    }
    private func broadcastState(to subscription: String? = nil) async {
        guard let response = try? await store.handle(APIRequest(path: "/api/state")),
              let state = try? JSONSerialization.jsonObject(with: response.body) as? [String: Any] else { return }
        let targets = subscription.map { [$0] } ?? Array(subscriptions)
        for target in targets { send("event", ["subscriptionId": target, "type": "state", "data": ["revision": state["revision"] ?? 0]]) }
    }
    private func broadcastMutation(_ path: String) async {
        await broadcastState()
        let event = path.hasPrefix("/api/visit-history") ? "visit-history" : "study-activity"
        for id in subscriptions { send("event", ["subscriptionId": id, "type": event, "data": [:]]) }
    }

    private func presentExport(_ body: [String: Any]) throws {
        guard presentedViewController == nil else { throw BridgeError.message("请先关闭当前分享窗口") }
        let name = try string(body, "name")
        guard name == (name as NSString).lastPathComponent, !name.hasPrefix("."), name.count <= 180,
              ["json", "html", "txt"].contains((name as NSString).pathExtension.lowercased()),
              let base64 = body["base64"] as? String, base64.count <= 48 * 1024 * 1024,
              let data = Data(base64Encoded: base64) else { throw BridgeError.message("导出文件无效") }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("daguan-export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic) }
        catch { try? FileManager.default.removeItem(at: directory); throw error }
        exports.insert(directory)
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { [weak self] _, _, _, _ in
            try? FileManager.default.removeItem(at: directory)
            Task { @MainActor in self?.exports.remove(directory) }
        }
        present(share, animated: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "daguan", url.host == "app", url.path == "/index.html", navigationAction.targetFrame?.isMainFrame != false {
            var target = URLComponents(url: url, resolvingAgainstBaseURL: false)
            var current = webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
            target?.fragment = nil
            current?.fragment = nil
            let fragmentOnly = navigationAction.navigationType != .reload && url.fragment != nil && target?.url == current?.url
            if webView.url == nil || permittedDocumentURL == url || fragmentOnly {
                if permittedDocumentURL == url { permittedDocumentURL = nil }
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
                Task { await reloadWithFreshSnapshot(url) }
            }
        } else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "大观园", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "大观园", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确认", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    private func reloadWithFreshSnapshot(_ url: URL) async {
        guard !refreshingSnapshot else { return }
        refreshingSnapshot = true
        defer { refreshingSnapshot = false }
        do {
            _ = try await webView.callAsyncJavaScript("await window.DaguanIOS.prepareReload();", arguments: [:], in: nil, contentWorld: .page)
            var kv = try await store.readKV()
            kv["daguan_ui_version_v1"] = "new"
            let snapshot = try JSONSerialization.data(withJSONObject: kv, options: [.sortedKeys])
            let content = webView.configuration.userContentController
            content.removeAllUserScripts()
            content.addUserScript(WKUserScript(source: "window.__DAGUAN_IOS_KV__ = " + String(decoding: snapshot, as: UTF8.self) + ";\n" + bridgeSource,
                                              injectionTime: .atDocumentStart, forMainFrameOnly: true))
            subscriptions.removeAll()
            for task in chats.values { task.cancel() }
            chats.removeAll()
            for task in requests.values { task.cancel() }
            requests.removeAll()
            permittedDocumentURL = url
            webView.load(URLRequest(url: url))
        } catch {
            webView.evaluateJavaScript("window.DaguanIOS.resumeStorage();", completionHandler: nil)
            let alert = UIAlertController(title: "无法刷新", message: "当前编辑尚未确认保存：\(error.localizedDescription)", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "保留当前页面", style: .default))
            if presentedViewController == nil { present(alert, animated: true) }
        }
    }

    private func showFailure(_ text: String) {
        let label = UILabel()
        label.text = "大观园启动失败\n\n\(text)\n\n请保留现有应用数据，不要通过卸载修复。"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.frame = view.bounds.insetBy(dx: 24, dy: 24)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(label)
    }
    enum BridgeError: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
    }
}
