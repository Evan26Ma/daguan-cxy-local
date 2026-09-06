import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(ROOT, ".build", "windows-release");
const ZIP = path.join(DIST, "大观园数学题库-windows-x64.zip");
const EXE = path.join(DIST, "大观园数学题库.exe");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`);
}

if (process.platform !== "win32") throw new Error("Windows 发布包必须在 Windows 上构建");
run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run package:windows"]);
await fs.rm(STAGE, { recursive: true, force: true });
await fs.mkdir(STAGE, { recursive: true });
await fs.copyFile(EXE, path.join(STAGE, path.basename(EXE)));
await fs.copyFile(path.join(ROOT, "安装大观园数学题库.cmd"), path.join(STAGE, "安装大观园数学题库.cmd"));
await fs.mkdir(path.join(STAGE, "packaging", "windows"), { recursive: true });
await fs.copyFile(path.join(ROOT, "packaging", "windows", "install.ps1"), path.join(STAGE, "packaging", "windows", "install.ps1"));
await fs.copyFile(path.join(ROOT, "packaging", "windows", "安装说明.txt"), path.join(STAGE, "安装说明.txt"));
await fs.mkdir(DIST, { recursive: true });
await fs.rm(ZIP, { force: true });
const ps = `$ErrorActionPreference = 'Stop'; Compress-Archive -Path '${STAGE.replaceAll("'", "''")}\\*' -DestinationPath '${ZIP.replaceAll("'", "''")}' -Force`;
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
const digest = crypto.createHash("sha256").update(await fs.readFile(ZIP)).digest("hex");
await fs.writeFile(`${ZIP}.sha256`, `${digest}  ${path.basename(ZIP)}\n`, "utf8");
console.log(`发布包已生成：${ZIP}`);
console.log(`SHA256：${digest}`);
