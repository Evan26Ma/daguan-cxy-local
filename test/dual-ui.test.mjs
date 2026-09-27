import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../web/ui-version.js", import.meta.url), "utf8");
function fixture(initial = {}, pathname = "/index.html") {
  const data = new Map(Object.entries(initial));
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const redirects = [];
  const window = { localStorage: storage, document: { documentElement: { dataset: {} } }, location: { pathname, href: `http://localhost${pathname}?entry=resume`, replace: url => redirects.push(url) } };
  vm.runInNewContext(source, { window, URL });
  return { api: window.DaguanVersions, data, storage, redirects };
}
test("first visit defaults to new; saved old preference redirects once and retains entry", () => {
  assert.equal(fixture().redirects.length, 0);
  const old = fixture({ daguan_ui_version_v1: "old" });
  assert.equal(old.redirects[0], "http://localhost/legacy.html?entry=resume");
  assert.equal(fixture({ daguan_ui_version_v1: "old" }, "/legacy.html").redirects.length, 0);
  assert.equal(fixture({ daguan_ui_version_v1: "corrupt" }).redirects.length, 0);
});
test("explicit old entry is allowed and remembered", () => {
  const f = fixture({ daguan_ui_version_v1: "new" }, "/legacy.html");
  assert.equal(f.redirects.length, 0);
  assert.equal(f.api.selected(f.storage), "old");
});
test("appearance migration preserves existing data and is idempotent", () => {
  const prefs = JSON.stringify({ theme: "custom", backgroundColor: "#123456" });
  const f = fixture({ daguan_ui_preferences_v1: prefs, daguan_local_progress_v1: "KEEP" });
  assert.equal(f.data.get(f.api.appearanceKeys.old), prefs);
  assert.equal(JSON.parse(f.data.get(f.api.appearanceKeys.new)).theme, "orange-white");
  f.storage.setItem(f.api.appearanceKeys.new, '{"theme":"eye-care"}');
  f.api.migrate(f.storage);
  assert.equal(JSON.parse(f.data.get(f.api.appearanceKeys.new)).theme, 'eye-care');
  assert.equal(f.data.get("daguan_local_progress_v1"), "KEEP");
});
test("switch URL preserves path prefix, query and hash; marks restoration", () => {
  const { api } = fixture();
  assert.equal(api.targetUrl("https://example.test/math/legacy.html?entry=resume&x=2#q", "new", true), "https://example.test/math/index.html?entry=resume&x=2&uiSwitch=1#q");
  assert.notEqual(api.draftKey("1"), api.draftKey("2"));
});
for (const name of ["app2.js", "app-legacy.js"]) {
  const app = fs.readFileSync(new URL(`../web/${name}`, import.meta.url), "utf8");
  test(`${name}: switch no-op, save failure, and AI cancellation prevent navigation`, async () => {
    const start = app.indexOf("  async function setUiVersion(");
    const end = app.indexOf("\n  function saveUiPrefs", start);
    const run = async ({ current = "new", busy = false, confirm = true, fail = false } = {}) => {
      const calls = [];
      const context = vm.createContext({
        switchingVersion: false, window: { DaguanVersions: { current }, location: { assign: () => calls.push("navigate") } },
        aiStreamStates: new Set(busy ? [1] : []), state: { aiRuns: new Map() },
        confirm: () => confirm, document: { querySelectorAll: () => [] },
        saveAiDraft: () => { calls.push("save"); if (fail) throw new Error("disk full"); },
        toast: message => calls.push(message),
      });
      vm.runInContext(app.slice(start, end) + '\nthis.switchVersion = setUiVersion;', context);
      await context.switchVersion("new");
      return calls;
    };
    assert.deepEqual(await run(), []);
    assert.deepEqual(await run({ current: "old", busy: true, confirm: false }), []);
    const failure = await run({ current: "old", fail: true });
    assert.equal(failure[0], "save");
    assert.match(failure[1], /disk full/);
    assert.ok(!failure.includes("navigate"));
  });
  test(`${name}: preserves multi-teacher filters and shared learning keys`, () => {
    for (const teacher of ["帕拉迪宇讲过", "李艳芳讲过", "没咋了讲过"]) assert.ok(app.includes(teacher));
    for (const key of ["daguan_local_progress_v1", "daguan_local_favorites_v1", "daguan_question_annotations_v1"]) assert.ok(app.includes(key));
  });
}

test("Windows bundle retains both frontends and new logo in its offline shell", () => {
  const build = fs.readFileSync(new URL("../scripts/build-windows-exe.mjs", import.meta.url), "utf8");
  const start = build.indexOf("const WINDOWS_EXCLUDED_WEB_FILES");
  const end = build.indexOf("function writeField", start);
  const ctx = vm.createContext({ Buffer });
  vm.runInContext(build.slice(start, end) + '\nthis.bundle = shouldBundle; this.transform = packageServiceWorker;', ctx);
  const sw = fs.readFileSync(new URL("../web/service-worker.js", import.meta.url));
  const packaged = ctx.transform("web/service-worker.js", sw).toString();
  for (const asset of ["index.html", "legacy.html", "app2.js", "app-legacy.js", "ui-version.js", "design-tokens.css", "assets/landing/local-mark.svg"]) {
    assert.equal(ctx.bundle(`web/${asset}`), true, asset);
    assert.ok(packaged.includes(`./${asset}`), asset);
  }
  assert.equal(ctx.bundle("web/landing.html"), false);
  assert.ok(!packaged.includes('"./landing.html"'));
});
