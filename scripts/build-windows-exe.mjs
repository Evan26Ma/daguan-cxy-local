import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.resolve(process.env.DAGUAN_PACKAGE_ROOT || ROOT);
const BUILD = path.join(ARTIFACT_ROOT, ".build", "sea");
const DIST = path.join(ARTIFACT_ROOT, "dist");
const OUT = path.join(DIST, "大观园数学题库.exe");
const NODE_SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function writeField(buffer, offset, length, value) {
  Buffer.from(String(value)).copy(buffer, offset, 0, Math.min(length, Buffer.byteLength(String(value))));
}

function octal(value, length) {
  return `${Number(value).toString(8).padStart(length - 1, "0")}\0`;
}

function tarHeader(relative, size, mode = 0o644) {
  const header = Buffer.alloc(512, 0);
  const normalized = relative.replaceAll(path.sep, "/");
  let name = normalized;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const slash = name.lastIndexOf("/", 155);
    if (slash < 1 || Buffer.byteLength(name.slice(slash + 1)) > 100) throw new Error(`路径过长：${name}`);
    prefix = name.slice(0, slash);
    name = name.slice(slash + 1);
  }
  writeField(header, 0, 100, name);
  writeField(header, 100, 8, octal(mode, 8));
  writeField(header, 108, 8, octal(0, 8));
  writeField(header, 116, 8, octal(0, 8));
  writeField(header, 124, 12, octal(size, 12));
  writeField(header, 136, 12, octal(Math.floor(Date.now() / 1000), 12));
  header.fill(0x20, 148, 156);
  header[156] = 48;
  writeField(header, 257, 6, "ustar\0");
  writeField(header, 263, 2, "00");
  writeField(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

async function walk(directory) {
  const result = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function makeBundle(output) {
  const files = [
    ...(await walk(path.join(ROOT, "web"))),
    ...(await walk(path.join(ROOT, "local-server"))),
  ];
  const chunks = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    const data = await fsp.readFile(file);
    chunks.push(tarHeader(relative, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  await fsp.writeFile(output, zlib.gzipSync(Buffer.concat(chunks), { level: 9 }));
  return { files: files.length, bytes: (await fsp.stat(output)).size };
}

function run(command, args) {
  const isBatch = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const commandArgs = isBatch
    ? ["/d", "/s", "/c", [command, ...args].map(String).join(" ")]
    : args;
  const executable = isBatch ? (process.env.ComSpec || "cmd.exe") : command;
  const result = spawnSync(executable, commandArgs, { cwd: ROOT, stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`);
}

await fsp.rm(BUILD, { recursive: true, force: true });
await fsp.mkdir(BUILD, { recursive: true });
await fsp.mkdir(DIST, { recursive: true });
if (process.platform !== "win32") throw new Error("Windows exe 必须在 Windows 上构建");
const disk = fs.statfsSync(BUILD);
const freeBytes = disk.bavail * disk.bsize;
if (freeBytes < 450 * 1024 * 1024) {
  throw new Error(`构建磁盘空间不足：至少需要约 450 MB，可用 ${(freeBytes / 1024 / 1024).toFixed(0)} MB。设置 DAGUAN_PACKAGE_ROOT 到空间更大的磁盘后重试。`);
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) throw new Error("构建单文件程序需要 Node.js 20.12+，建议使用 Node.js 24");

const bundlePath = path.join(BUILD, "app.bundle.tgz");
const bundleInfo = await makeBundle(bundlePath);
const configPath = path.join(BUILD, "sea-config.json");
const blobPath = path.join(BUILD, "sea-prep.blob");
const entryPath = path.join(ROOT, "packaging", "sea-entry.cjs");
await fsp.writeFile(configPath, JSON.stringify({
  main: entryPath,
  output: blobPath,
  assets: { "app.bundle.tgz": bundlePath },
}, null, 2));

run(process.execPath, ["--experimental-sea-config", configPath]);
await fsp.copyFile(process.execPath, OUT);
run(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "postject", OUT, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", NODE_SEA_FUSE]);
const checkRoot = path.join(BUILD, "runtime-check");
const previousCheckRoot = process.env.DAGUAN_RUNTIME_ROOT;
process.env.DAGUAN_RUNTIME_ROOT = checkRoot;
try {
  run(OUT, ["--check"]);
} finally {
  if (previousCheckRoot === undefined) delete process.env.DAGUAN_RUNTIME_ROOT;
  else process.env.DAGUAN_RUNTIME_ROOT = previousCheckRoot;
}
console.log(`单文件程序已生成：${OUT}`);
console.log(`内置文件：${bundleInfo.files} 个，压缩资源：${(bundleInfo.bytes / 1024 / 1024).toFixed(1)} MB`);
