import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const RELEASE = "v2026.09.27-r27";
const files = [
  "README.md",
  "docs/Windows新手安装与配置.md",
  "web/index.html",
  "web/landing.html",
];

test("下载链接固定到当前部署 Release，不跟随 latest 漂移", () => {
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /releases\/latest\/download\//, file);
    assert.match(source, new RegExp(`releases/download/${RELEASE}/`), file);
  }
});
