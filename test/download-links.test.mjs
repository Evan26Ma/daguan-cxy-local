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

test("普通用户入口区分 Electron 桌面版与本地浏览器版", () => {
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
    assert.match(source, /surl=VJwUxgElbURfw7Aj4Gpy4Q/, `${file}: web package link`);
    assert.match(source, /wweb/, `${file}: web package code`);
    assert.match(source, /本地浏览器版/, `${file}: browser edition label`);
    assert.match(source, /Electron 桌面版/, `${file}: Electron edition label`);
  }
});

test("浏览器版安装快捷方式使用独立名称，Electron 产品身份保持不变", () => {
  const installer = fs.readFileSync(new URL("../packaging/windows/install.ps1", import.meta.url), "utf8");
  const uninstaller = fs.readFileSync(new URL("../packaging/windows/uninstall.ps1", import.meta.url), "utf8");
  const forge = fs.readFileSync(new URL("../forge.config.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(installer, /大观园浏览器本地版\.lnk/);
  assert.match(installer, /停止浏览器本地服务\.lnk/);
  assert.match(uninstaller, /大观园浏览器本地版\.lnk/);
  assert.match(uninstaller, /停止浏览器本地服务\.lnk/);
  assert.doesNotMatch(installer, /ProgramsRoot.*大观园数学/);
  assert.match(forge, /name:\s*process\.env\.DAGUAN_SQUIRREL_NAME\s*\|\|\s*"DaguanMathDesktop"/);
  assert.match(forge, /executableName:\s*"DaguanMath"/);
  assert.equal(packageJson.name, "daguan-math-local");
  assert.equal(packageJson.productName, "大观园数学");
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
