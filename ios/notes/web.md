# iPad Web integration

The shared `web/` source is unchanged. Run from macOS with Node installed:

```sh
node ios/scripts/prepare-web.mjs --replace-generated
```

The default destination is `ios/Resources/Web`. `--out`, `--source`, and `--bridge-source` accept explicit paths for isolated verification. Rebuilding accepts only an output containing this generator's `resource-manifest.json`; unknown files or symlinks cause refusal before deletion. Without `--replace-generated`, output must be empty. Generated resources are not source snapshots to commit.

## Native contract

Load `daguan://app/index.html`. Inject a string-valued `window.__DAGUAN_IOS_KV__` object first, then the bundled `Web/ios/bridge.js`, as main-frame document-start WKUserScripts. An empty initialized store is `{}`; missing/invalid bootstrap is a visible failure and refuses cache writes. HTML links `ios/platform.css` but never loads bridge.js again.

Outbound messages use `window.webkit.messageHandlers.daguan.postMessage({id,operation,...fields})`. Return `window.DaguanIOS.receive({id,ok:true,result})` or `{id,ok:false,error}`; error may be a string or `{message}`. IDs are unique strings. The bridge rejects foreign schemes, hosts and credentials; external network fetch is never forwarded. Native must enforce its own path/operation policy as well.

| operation | fields | successful result |
| --- | --- | --- |
| request | path including query, method, body string or null | `{status,body:base64,headers}`; preserve HTTP error statuses |
| resource | path only, no query | same envelope; binary resources remain byte-exact |
| kv | values: complete string-to-string snapshot | resolve only after atomic durable persistence |
| subscribe | path `/api/state/events`, subscriptionId | `{subscriptionId}`; honor supplied subscriptionId |
| unsubscribe | subscriptionId | arbitrary acknowledgement |
| chat | body: JSON request string | acknowledgement before streaming, optionally `{runId}` |
| cancel | runId | arbitrary acknowledgement; support chat message id before started |
| cancel-request | requestId | fire-and-forget; cancel matching request task on JS abort or timeout |
| export | name, base64, mime | acknowledge once system share UI is presented, not when user saves |

`request` backs the existing `/api/access/status`, `/api/state`, `/api/state/questions/:id`, `/api/state/questions/:id/annotation`, `/api/state/last-study`, `/api/visit-history` and its existing suffixes, `/api/study-activity` and its existing suffixes, `/api/ai/profiles` and profile subroutes, and `/api/ai/conversations/:profile/:question`. AI chat and run DELETE use the specialized operations above. Official sync remains unavailable.

Native events call `DaguanIOS.event({subscriptionId,type,data})`. Initial events on the requested subscription ID are buffered until acknowledgement. EventSource implements readyState/constants, add/removeEventListener, onopen/onmessage/onerror and close; subscription failures retry after 3 seconds. Native event `data` strings are delivered as-is; objects are JSON serialized. Close unsubscribes and ignores late events.

Native streams call `DaguanIOS.stream({id,event,data})` using the original chat RPC id. event is `started`, `delta`, `done` or `error`. data is a JSON object or serialized JSON string. The bridge emits UTF-8 `data: <JSON>\n\n` bytes and preserves/adds the payload type. `started` supplies runId; `delta` supplies content; `error` supplies error. Terminal done/error closes the body after delivering the event. Native should ack before delivering events, keep stream order, and resolve cancellation using message id before runId exists. Aborting the request or canceling the reader cancels native chat.

Bounds: 128 pending RPCs, 8 chat streams, 16 subscriptions, 30-second RPC deadline, 180-second chat idle deadline, 2 MiB unread chat buffer, 8 MiB KV snapshot. Resource and ordinary API responses are standard Response objects; request cloning and AbortSignal are supported. Native should independently bound payloads.

## Persistence and reload

`localStorage` is a synchronous string cache seeded at document start. Mutations queue complete snapshots; only one KV operation runs at a time. The persistent status panel says when changes are still saving, retains write errors and offers retry. Failed writes keep the dirty cache; subsequent mutations never silently dismiss the failure. `await DaguanIOS.flush()` confirms durability or rejects and can be retried. Do not treat synchronous setItem return as a disk acknowledgement.

Before native reload/navigation replaces the document, call and await `DaguanIOS.prepareReload()`. This freezes cache writes synchronously, then flushes. On rejection the freeze is removed. On success, native must read a fresh KV snapshot and replace its document-start bootstrap before loading the new document. Keep the native reload gate singleflight. If native subsequently cannot reload/read the snapshot, call `DaguanIOS.resumeStorage()` so edits resume. A frozen page displays its paused state and rejects mutations. Pagehide attempts a final flush but cannot guarantee persistence during process termination; native lifecycle handling is still required.

Backups and pre-migration backups call awaited `DaguanIOS.exportBlob(blob,name)` after flush and show “share opened / save to Files” wording. The pre-migration “I saved the backup” checkbox still requires explicit user confirmation. Existing restore/migration `<input type=file>` remains for WKWebView's Files picker. Print/export-preview UI is hidden on iPad; it is not claimed as a supported single-file export.

## Reviewed transformations of packaged copies

The script fails closed if expected transformation anchors change:

- `index.html`: adds data-platform and platform CSS, removes desktop storage, browser retirement, remote access, official bank updater, and webmanifest references. Bridge remains native injection only.
- `ui-bootstrap.js`: forces the new UI even when an old UI preference/query exists, disables unsupported Service Worker cache purge.
- `app-new.js`: disables Service Worker registration and automatic official-sync status requests; replaces backup and migration Blob-anchor exports with awaited native sharing and accurate status messages.
- `safe-render.js`: allows `daguan://app/` in DOMPurify's URI regexp while leaving `ALLOW_UNKNOWN_PROTOCOLS:false`. The existing image hook additionally permits daguan sources only under `/data/assets/` or `/assets/`, rejects foreign hosts and API image paths, and retains the original event/action/SVG restrictions. No DOMPurify vendor file is modified.

Capability targeting uses exact selectors in bridge.js and CSS. It hides legacy switch, desktop storage/remote/server controls, official sync card/wizard, preview lock controls, unsupported print/export-preview and the sync tutorial step. AI service settings, local study features, backup and Files inputs remain. Failed images receive a labelled `assets/missing-image.svg` placeholder.

## Resource inventory and known limits

Allowlist includes the new entry's scripts/styles, referenced KaTeX fonts, DOMPurify license, runtime data indices and manifest-listed shards, all product assets under `assets/` and `data/assets/`, and the native-solutions overlay. Backups, developer/private content, local banks, obsolete pages, audit data and user records are excluded. No asset credentials or environment files are read. Resource manifest lists byte counts and SHA-256 in sorted order; it contains no generation timestamp. Missing report includes missing filenames, source files, qids and references, also scanning nested explanations/native overlay fields and unrecognized image URLs.

The final source scan produced 3,436 hashed resource entries totaling 515,681,290 bytes (excluding resource-manifest.json itself), including all 3,318 data asset files and 60 font files. It found 41 absent hashed image files across 42 qids, with 0 additional unrecognized image references. Source files are data/search_index.json plus the 历年真题、高等数学、线性代数、模拟哥专区 shards. The current native-solutions/explanations overlay adds no missing image, and a synthetic nested-overlay test verifies missing filename/qid detection. Those 41 are confirmed missing references, not repaired images. `completeOffline` is false. Authorized asset retrieval remains a separate step; no token was supplied or read.

Final owned tests: 13 passed, 0 failed, 0 skipped (9 VM transport, 3 packaging, 1 Chromium DOM). `node tools/verify-web-data.mjs` passed all 7,119 unique qids with the expected 41-missing-image warning. The coordinator's full project run reported 404 tests, 403 passed and 1 failed in the existing #7947 absent-index assertion; no skipped tests. Validation covers VM transport, Request/Response/abort/timeouts/bounds, chat SSE/cancel, subscription initial-event race/close, KV serialize/failure/retry, reload freeze, awaited export, full asset byte preservation, deterministic rebuild, unknown-output protection and synthetic missing-overlay qids. A Chromium DOM test uses real DOMPurify/CSS and a simulated daguan origin to exercise sanitizer, capability selectors, persistence error retry and file input selection. This is not a WKWebView scheme-handler or iPad Files/share integration test. macOS Xcode build, simulator, signing, device installation and actual iPad WebKit acceptance must be performed by the container owner.
