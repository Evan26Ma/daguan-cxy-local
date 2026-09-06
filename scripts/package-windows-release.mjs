import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(ROOT, ".build", "windows-release");
const VERIFY = path.join(ROOT, ".build", "windows-release-verify");
const ZIP = path.join(DIST, "DaguanMath-windows-x64.zip");
const EXE = path.join(DIST, "大观园数学题库.exe");
const RELEASE_EXE = path.join(DIST, "DaguanMath-windows-x64.exe");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`);
}

if (process.platform !== "win32") throw new Error("Windows 发布包必须在 Windows 上构建");
run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run package:windows"]);
await fs.rm(STAGE, { recursive: true, force: true });
await fs.rm(VERIFY, { recursive: true, force: true });
await fs.mkdir(STAGE, { recursive: true });
await fs.copyFile(EXE, RELEASE_EXE);
await fs.copyFile(EXE, path.join(STAGE, path.basename(EXE)));
await fs.copyFile(path.join(ROOT, "安装大观园数学题库.cmd"), path.join(STAGE, "安装大观园数学题库.cmd"));
await fs.mkdir(path.join(STAGE, "packaging", "windows"), { recursive: true });
const installScript = path.join(STAGE, "packaging", "windows", "install.ps1");
await fs.copyFile(path.join(ROOT, "packaging", "windows", "install.ps1"), installScript);
await fs.copyFile(path.join(ROOT, "packaging", "windows", "安装说明.txt"), path.join(STAGE, "安装说明.txt"));
await fs.mkdir(DIST, { recursive: true });
await fs.rm(ZIP, { force: true });

function checkPowerShellSyntax(file) {
  const literal = file.replaceAll("'", "''");
  const command = [
    "$parseErrors = $null",
    `$null = [System.Management.Automation.Language.Parser]::ParseFile('${literal}', [ref]$null, [ref]$parseErrors)`,
    "if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
  ].join("; ");
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
}

checkPowerShellSyntax(installScript);
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installScript, "-PackageRoot", STAGE, "-ValidateOnly"]);

const ps = `$ErrorActionPreference = 'Stop'; Compress-Archive -Path '${STAGE.replaceAll("'", "''")}\\*' -DestinationPath '${ZIP.replaceAll("'", "''")}' -Force`;
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);

const verifyPs = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '${ZIP.replaceAll("'", "''")}' -DestinationPath '${VERIFY.replaceAll("'", "''")}' -Force`;
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", verifyPs]);
await fs.access(path.join(VERIFY, path.basename(EXE)));
const extractedInstallScript = path.join(VERIFY, "packaging", "windows", "install.ps1");
await fs.access(extractedInstallScript);
checkPowerShellSyntax(extractedInstallScript);
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", extractedInstallScript, "-PackageRoot", VERIFY, "-ValidateOnly"]);

async function writeChecksum(file) {
  const digest = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
  await fs.writeFile(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`, "utf8");
  return digest;
}

const zipDigest = await writeChecksum(ZIP);
const exeDigest = await writeChecksum(RELEASE_EXE);
console.log(`发布包已生成：${ZIP}`);
console.log(`单文件 EXE 已生成：${RELEASE_EXE}`);
console.log(`ZIP SHA256：${zipDigest}`);
console.log(`EXE SHA256：${exeDigest}`);
