const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createDesktopUpdater, STARTUP_DELAY_MS, UPDATE_INTERVAL_MS, UPDATE_FEED_URL } = require("../desktop/updater.cjs");

function setup(overrides = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.setFeedURL = (options) => { autoUpdater.feed = options.url; };
  autoUpdater.checkForUpdates = async () => { autoUpdater.checkCalls = (autoUpdater.checkCalls || 0) + 1; };
  const logs = [];
  const states = [];
  const timers = [];
  let installed = 0;
  const updater = createDesktopUpdater({
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    autoUpdater,
    log: async (line) => { logs.push(line); },
    onState: (state) => states.push(state),
    platform: "win32",
    env: {},
    setTimeoutFn: (callback, delay) => { const item = { callback, delay, unref() {} }; timers.push(item); return item; },
    clearTimeoutFn: (timer) => { timer.cleared = true; },
    ...overrides,
  });
  updater.start({ installUpdate: async () => { installed++; } });
  return { updater, autoUpdater, logs, states, timers, get installed() { return installed; } };
}

test("Windows packaged updater uses the x64 GitHub feed and checks quietly in the background", async () => {
  const h = setup();
  assert.equal(h.autoUpdater.feed, `${UPDATE_FEED_URL}/1.0.0`);
  assert.equal(h.timers[0].delay, STARTUP_DELAY_MS);
  h.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.autoUpdater.checkCalls, 1);
  h.autoUpdater.emit("checking-for-update");
  h.autoUpdater.emit("update-not-available");
  assert.deepEqual(h.states, ["checking", "not-available"]);
  assert.ok(h.timers.some((timer) => timer.delay === UPDATE_INTERVAL_MS));
  h.updater.stop();
});

test("downloaded update remains pending until the user explicitly chooses restart", async () => {
  const h = setup();
  h.autoUpdater.emit("update-downloaded");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.installed, 0);
  assert.equal(h.updater.getState().updateDownloaded, true);
  assert.deepEqual(h.states, ["downloaded"]);
  // Leaving the renderer button untouched represents choosing "later".
  assert.equal(h.installed, 0);
  // The button's confirmation calls this method only after explicit user input.
  await h.updater.installDownloadedUpdate();
  assert.equal(h.installed, 1);
  h.updater.stop();
});

test("feed override is supported for isolated Squirrel tests and errors are sanitized", async () => {
  const h = setup({ env: { DAGUAN_UPDATE_FEED_URL: "http://127.0.0.1:8123/0.9.0" } });
  assert.equal(h.autoUpdater.feed, "http://127.0.0.1:8123/0.9.0");
  h.autoUpdater.emit("error", Object.assign(new Error("https://user:secret@example.test/feed?token=private"), { code: "ERR_INVALID_URL" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.logs.includes("error:ERR_INVALID_URL"));
  assert.doesNotMatch(h.logs.join("\n"), /secret|token=private|example\.test/);
  h.updater.stop();
});

test("unpackaged and non-Windows runs do not configure or check for updates", async () => {
  for (const overrides of [{ platform: "win32", app: { isPackaged: false, getVersion: () => "1.0.0" } }, { platform: "linux" }]) {
    const h = setup(overrides);
    assert.equal(h.updater.getState().feedConfigured, false);
    assert.equal(h.autoUpdater.feed, undefined);
    assert.equal(h.timers.length, 0);
    assert.equal(await h.updater.checkNow(), false);
    h.updater.stop();
  }
});
