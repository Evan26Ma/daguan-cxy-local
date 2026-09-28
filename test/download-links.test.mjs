import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const RELEASE = "v1.0.0";
const files = [
  "README.md",
  "docs/Windows新手安装与配置.md",
  "web/index.html",
  "web/landing.html",
];

test("下载链接固定到桌面版首发 SemVer Release，不跟随 latest 漂移", () => {
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /releases\/latest\/download\//, file);
    assert.match(source, new RegExp(`releases/download/${RELEASE}/`), file);
  }
});
