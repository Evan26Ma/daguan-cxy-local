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
#if DEBUG && targetEnvironment(simulator)
    private var smokeStarted = false
    private var smokeFinished = false
    private var smokeTimeout: Task<Void, Never>?
    private var smokeStages: [[String: Any]] = []
    private let smokeStartTime = ProcessInfo.processInfo.systemUptime
    private var smokeEnabled: Bool { ProcessInfo.processInfo.arguments.contains("--daguan-smoke") }
    private func smokeArgument(_ name: String) -> String {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--\(name)=") }.map { String($0.dropFirst(name.count + 3)) } ?? ""
    }
#endif

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
#if DEBUG && targetEnvironment(simulator)
        if smokeEnabled {
            recordSmokeStage("viewDidLoad")
            smokeTimeout = Task { [weak self] in
                // Cold CI WebKit auxiliary processes have taken 63s to launch.
                do { try await Task.sleep(nanoseconds: 120_000_000_000) } catch { return }
                self?.finishSmoke(["ok": false, "error": "App/WKWebView smoke exceeded 120 seconds"])
            }
        }
#endif
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
            let initialURL = URL(string: "daguan://app/index.html?ui=new")!
            // WebKit may expose the provisional URL before the policy callback.
            // Authorize this native load without attempting to flush an unloaded bridge.
            permittedDocumentURL = initialURL
#if DEBUG && targetEnvironment(simulator)
            recordSmokeStage("configure-ready")
#endif
            webView.load(URLRequest(url: initialURL))
#if DEBUG && targetEnvironment(simulator)
            recordSmokeStage("initial-load-requested")
#endif
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

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
#if DEBUG && targetEnvironment(simulator)
        recordSmokeStage("navigation-started")
#endif
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if DEBUG && targetEnvironment(simulator)
        recordSmokeStage("navigation-finished")
        guard smokeEnabled, !smokeStarted, !smokeFinished else { return }
        smokeStarted = true
        Task {
            do {
                // Keep the explicit Any? type: the async WebKit overload returns an optional.
                let value: Any? = try await webView.callAsyncJavaScript(Self.smokeJavaScript,
                    arguments: ["phase": smokeArgument("phase"), "marker": smokeArgument("marker")],
                    in: nil, contentWorld: .page)
                guard let json = value as? String,
                      let data = json.data(using: .utf8),
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw BridgeError.message("Smoke JavaScript did not return a JSON object string")
                }
                finishSmoke(result)
            } catch { finishSmoke(["ok": false, "error": "callAsyncJavaScript: \(error.localizedDescription)"]) }
        }
#endif
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
#if DEBUG && targetEnvironment(simulator)
        finishSmoke(["ok": false, "error": "didFail: \(error.localizedDescription)"])
#endif
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
#if DEBUG && targetEnvironment(simulator)
        finishSmoke(["ok": false, "error": "didFailProvisionalNavigation: \(error.localizedDescription)"])
#endif
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
#if DEBUG && targetEnvironment(simulator)
        finishSmoke(["ok": false, "error": "WKWebView content process terminated"])
#endif
    }

#if DEBUG && targetEnvironment(simulator)
    private func recordSmokeStage(_ stage: String) {
        guard smokeEnabled, !smokeFinished else { return }
        smokeStages.append(["stage": stage, "elapsedSeconds": ProcessInfo.processInfo.systemUptime - smokeStartTime])
        NSLog("Daguan smoke stage: %@", stage)
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                        appropriateFor: nil, create: true)
            let progress: [String: Any] = ["phase": smokeArgument("phase"), "marker": smokeArgument("marker"), "stages": smokeStages]
            try JSONSerialization.data(withJSONObject: progress, options: [.prettyPrinted, .sortedKeys])
                .write(to: documents.appendingPathComponent("smoke-progress.json"), options: .atomic)
        } catch { NSLog("Daguan smoke stage write failed: %@", error.localizedDescription) }
    }

    private func finishSmoke(_ result: [String: Any]) {
        guard smokeEnabled, !smokeFinished else { return }
        smokeFinished = true
        smokeTimeout?.cancel()
        var output = result
        output["phase"] = smokeArgument("phase")
        output["marker"] = smokeArgument("marker")
        output["url"] = webView?.url?.absoluteString ?? ""
        output["stages"] = smokeStages
        output["timestamp"] = ISO8601DateFormatter().string(from: Date())
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                        appropriateFor: nil, create: true)
            let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: documents.appendingPathComponent("smoke-result.json"), options: .atomic)
            NSLog("Daguan smoke result: %@", String(decoding: data, as: UTF8.self))
        } catch { NSLog("Daguan smoke artifact write failed: %@", error.localizedDescription) }
    }

    // Runs inside the real main-frame page, using its production fetch bridge and UI modules.
    private static let smokeJavaScript = #"""
    const report = { ok: false, checks: [], phase, marker };
    let step = 'arguments';
    const check = (condition, message) => { if (!condition) throw new Error(message); report.checks.push(message); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const json = async (path, init) => {
        const response = await fetch(path, init);
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        return response.json();
    };
    try {
        check(['write', 'read'].includes(phase) && /^daguan-smoke-[a-zA-Z0-9-]+$/.test(marker), 'valid isolated smoke arguments');
        step = 'DOM and application startup';
        const startupDeadline = Date.now() + 20000;
        while (!(document.readyState !== 'loading' && window.App && window.DaguanIOS &&
                 window.DaguanNewData && window.DataService && window.AppState?.manifest?.shards &&
                 Object.keys(window.AppState.idIndex || {}).length && window.AppState.searchIndex?.length &&
                 window.StateSync?.hydrated && window.StateSync.available && document.querySelector('#app-main .home-content'))) {
            if (Date.now() >= startupDeadline) throw new Error('DOM/App/DaguanIOS/DaguanNewData/state hydration not ready within 20s');
            await wait(100);
        }
        check(location.protocol === 'daguan:' && location.host === 'app', 'real daguan://app page');
        report.startupText = document.querySelector('#app-main').innerText.slice(0, 1500);
        check(report.startupText.trim().length > 0, 'home DOM contains rendered text');
        check(document.documentElement.dataset.platform === 'ios', 'iOS platform mounted');
        const scripts = [...document.scripts].filter(script => script.src).map(script => new URL(script.src));
        check(scripts.every(url => url.protocol === 'daguan:' && url.host === 'app'), 'page scripts are bundled local resources');
        check(['new-data.js', 'app-new.js'].every(name => scripts.some(url => url.pathname === '/' + name)), 'actual new-data and App scripts present');
        check([...document.styleSheets].some(sheet => sheet.href?.includes('styles-new.css')) &&
              getComputedStyle(document.querySelector('.app-container')).display === 'flex', 'bundled stylesheet applied by WebKit');
        const logo = document.querySelector('.brand-mark');
        check(logo?.complete && logo.naturalWidth > 0, 'bundled image decoded by WebKit');
        step = 'native API and bundled JSON';
        let state = await json('./api/state');
        check(Number.isSafeInteger(state.revision) && state.revision >= 0, 'native API state revision fetched');
        const index = await json('./data/id_index.json');
        const search = await json('./data/search_index.json');
        check(Array.isArray(search) && search.length > 0, 'search_index JSON fetched and parsed');
        const qid = Object.keys(index).find(id => /^\d+$/.test(id));
        check(!!qid && AppState.idIndex[qid] === index[qid], 'valid question selected from actual id_index');
        report.questionID = qid;
        report.searchCount = search.length;
        report.revisionBefore = state.revision;
        if (phase === 'read') {
            check(state.favorites.includes(qid) && state.progress[qid]?.favorite === true, 'favorite restored from native disk after cold launch');
            check(state.annotations[qid]?.markdown === marker, 'annotation marker restored from native disk after cold launch');
            check(StorageService.isFavorite(qid), 'hydrated frontend favorite restored');
            check(StorageService.getAnnotation(qid).content === marker, 'hydrated frontend annotation restored');
        }
        step = 'actual question and DOM rendering';
        const question = await DataService.getQuestion(qid);
        check(String(question?.id) === qid && String(question.stem || question.question || '').trim().length > 0, 'actual question shard loaded through DataService');
        await App.openQuestionFromList(qid);
        const rendered = document.querySelector('#question-content .question-wrapper');
        check(rendered?.dataset.questionId === qid, 'actual question rendered into DOM');
        report.questionText = rendered.innerText.slice(0, 2000);
        report.stemText = rendered.querySelector('.question-stem')?.innerText.slice(0, 1500) || '';
        check(report.stemText.trim().length > 0, 'rendered question stem contains text');
        // Rendering records a visit/seen state. Drain those writes before direct API mutations.
        await StateSync.ensureFlushed();
        if (phase === 'write') {
            step = 'revision-checked favorite and annotation writes';
            const patch = async (suffix, fields) => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    const current = await json('./api/state');
                    const response = await fetch(`./api/state/questions/${qid}${suffix}`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...fields, revision: current.revision })
                    });
                    if (response.status === 409 && attempt < 2) { await wait(100); continue; }
                    const result = await response.json();
                    check(response.ok && result.ok === true && result.state?.revision === current.revision + 1,
                          `native PATCH ${suffix || 'favorite'} advances revision`);
                    return result.state;
                }
            };
            await patch('', { favorite: true });
            await patch('/annotation', { markdown: marker });
        }
        step = 'durable state verification';
        state = await json('./api/state');
        check(state.favorites.includes(qid) && state.progress[qid]?.favorite === true, 'native favorite verified');
        check(state.annotations[qid]?.markdown === marker, 'native annotation marker verified');
        if (phase === 'read') check(rendered.querySelector('[data-shortcut-hint="favorite"]')?.classList.contains('active'), 'restored favorite visible on question DOM');
        await DaguanIOS.flush();
        check(!DaguanIOS.persistence.dirty && !DaguanIOS.persistence.error, 'frontend cache acknowledged durable by native store');
        report.revisionAfter = state.revision;
        report.ok = true;
    } catch (error) {
        report.error = `${step}: ${error.stack || error.message || error}`;
    }
    report.domText = document.body?.innerText.slice(0, 3000) || '';
    report.readyState = document.readyState;
    return JSON.stringify(report);
    """#
#endif

    private func showFailure(_ text: String) {
#if DEBUG && targetEnvironment(simulator)
        finishSmoke(["ok": false, "error": "configure: \(text)"])
#endif
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
