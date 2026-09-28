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

test("普通用户入口只推荐桌面版，浏览器迁移包仅在归档说明中保留", () => {
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /releases\/latest\/download\//, file);
  }
  for (const file of ["README.md", "docs/Windows新手安装与配置.md", "docs/使用教程.md", "web/index.html", "web/landing.html", "web/legacy.html"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /surl=VrW0Z-ThDSM7f_xx7uCUZw/, `${file}: desktop link`);
    assert.match(source, /dgy1/, `${file}: desktop code`);
  }
  for (const file of ["README.md", "docs/Windows新手安装与配置.md", "docs/使用教程.md", "web/landing.html"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /surl=VJwUxgElbURfw7Aj4Gpy4Q/, `${file}: no web package download`);
  }
  const archive = fs.readFileSync(new URL("../docs/百度网盘下载与引导页配置.md", import.meta.url), "utf8");
  assert.match(archive, /surl=VJwUxgElbURfw7Aj4Gpy4Q/);
  assert.match(archive, /停止维护/);
});

test("落地页指向 main 上的网盘下载与配置指南", () => {
  const landing = fs.readFileSync(new URL("../web/landing.html", import.meta.url), "utf8");
  assert.match(landing, /github\.com\/Evan26Ma\/daguan-cxy-local\/blob\/main\/docs\/百度网盘下载与引导页配置\.md/);
});

test("v1.0.0 发布说明只列出桌面安装及其更新资产", () => {
  const releaseNotes = fs.readFileSync(new URL("../docs/release-v1.0.0.md", import.meta.url), "utf8");
  assert.match(releaseNotes, /DaguanMathDesktop-Setup\.exe/);
  assert.match(releaseNotes, /DaguanMathDesktop-1\.0\.0-full\.nupkg/);
  assert.match(releaseNotes, /`RELEASES`/);
  assert.doesNotMatch(releaseNotes, /DaguanMath-windows-x64\.(?:exe|zip)/);
});

test("v1.0.1 发布说明记录桌面在线更新所需资产与校验值", () => {
  const releaseNotes = fs.readFileSync(new URL("../docs/release-v1.0.1.md", import.meta.url), "utf8");
  assert.match(releaseNotes, /DaguanMathDesktop-Setup\.exe/);
  assert.match(releaseNotes, /DaguanMathDesktop-1\.0\.1-full\.nupkg/);
  assert.match(releaseNotes, /`RELEASES`/);
  assert.match(releaseNotes, /重启并安装更新/);
  assert.doesNotMatch(releaseNotes, /DaguanMath-windows-x64\.(?:exe|zip)/);
});
