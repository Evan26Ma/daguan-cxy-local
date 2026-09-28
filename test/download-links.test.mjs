import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const RELEASE = "v1.0.0";
const files = [
  "README.md",
  "docs/Windows新手安装与配置.md",
  "docs/使用教程.md",
  "web/index.html",
  "web/landing.html",
  "web/legacy.html",
];

test("Windows 下载入口只指向固定版本的桌面安装器", () => {
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /releases\/latest\/download\//, file);
    assert.match(source, new RegExp(`releases/download/${RELEASE}/DaguanMathDesktop-Setup\\.exe`), file);
    assert.doesNotMatch(source, /releases\/download\/v\d+\.\d+\.\d+\/DaguanMath-windows-x64\.(?:exe|zip)/, file);
  }
});

test("落地页的 Windows 安装指南指向 main 上的桌面教程", () => {
  const landing = fs.readFileSync(new URL("../web/landing.html", import.meta.url), "utf8");
  assert.match(landing, /github\.com\/Evan26Ma\/daguan-cxy-local\/blob\/main\/docs\/Windows新手安装与配置\.md/);
});

test("v1.0.0 发布说明只列出桌面安装及其更新资产", () => {
  const releaseNotes = fs.readFileSync(new URL("../docs/release-v1.0.0.md", import.meta.url), "utf8");
  assert.match(releaseNotes, /DaguanMathDesktop-Setup\.exe/);
  assert.match(releaseNotes, /DaguanMathDesktop-1\.0\.0-full\.nupkg/);
  assert.match(releaseNotes, /`RELEASES`/);
  assert.doesNotMatch(releaseNotes, /DaguanMath-windows-x64\.(?:exe|zip)/);
});
