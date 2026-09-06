const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { getRawAsset } = require("node:sea");

const BUNDLE_KEY = "app.bundle.tgz";
const APP_NAME = "DaguanMath";
const SUBPATH = "daguan-math";

function appRoot() {
  const portable = path.join(path.dirname(process.execPath), `.${APP_NAME}`);
  try {
    fs.mkdirSync(portable, { recursive: true });
    fs.accessSync(portable, fs.constants.W_OK);
    return portable;
  } catch {
    const base = process.env.LOCALAPPDATA || path.dirname(process.execPath);
    return path.join(base, APP_NAME);
  }
}

function readString(buffer, offset, length) {
  return buffer.toString("utf8", offset, offset + length).replace(/\0.*$/, "");
}

function readTarSize(buffer, offset) {
  const value = readString(buffer, offset, 12).trim();
  return value ? parseInt(value, 8) : 0;
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(`/${value}`).slice(1);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`非法打包路径：${value}`);
  }
  return normalized;
}

async function extractTarGz(destination) {
  const raw = Buffer.from(getRawAsset(BUNDLE_KEY));
  const tar = zlib.gunzipSync(raw);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const relative = safeRelativePath(prefix ? `${prefix}/${name}` : name);
    const size = readTarSize(header, 124);
    const type = header[156];
    const target = path.join(destination, ...relative.split("/"));
    if (!target.startsWith(`${destination}${path.sep}`)) throw new Error("打包路径越界");
    if (type === 53) {
      await fsp.mkdir(target, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, tar.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

async function ensureAppFiles(root) {
  const appDir = path.join(root, "app");
  const marker = path.join(root, "bundle.sha256");
  const raw = Buffer.from(getRawAsset(BUNDLE_KEY));
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  let current = "";
  try { current = await fsp.readFile(marker, "utf8"); } catch {}
  try {
    await fsp.access(path.join(appDir, "local-server", "server.mjs"));
    await fsp.access(path.join(appDir, "web", "index.html"));
  } catch {
    current = "";
  }
  if (current.trim() === digest) return appDir;
  const staging = `${appDir}.new-${process.pid}`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  await extractTarGz(staging);
  await fsp.rm(appDir, { recursive: true, force: true });
  await fsp.rename(staging, appDir);
  await fsp.writeFile(marker, `${digest}\n`, "utf8");
  return appDir;
}

async function isConsoleHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    const data = await response.json();
    return data?.service === "daguan-local-console";
  } catch {
    return false;
  }
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(error.code !== "ECONNREFUSED"));
    socket.setTimeout(800, () => finish(true));
  });
}

async function choosePort() {
  for (let port = 8080; port <= 8099; port += 1) {
    if (await isConsoleHealthy(port)) return { port, reuse: true };
    if (!(await isPortBusy(port))) return { port, reuse: false };
  }
  throw new Error("8080-8099 端口均不可用，请关闭占用端口的程序后重试");
}

function openBrowser(url) {
  const command = process.env.ComSpec || "cmd.exe";
  spawn(command, ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function main() {
  const root = appRoot();
  await fsp.mkdir(root, { recursive: true });
  const choice = await choosePort();
  const url = `http://127.0.0.1:${choice.port}/`;
  if (choice.reuse && !process.argv.includes("--check")) {
    openBrowser(url);
    return;
  }
  const appDir = await ensureAppFiles(root);
  if (process.argv.includes("--check")) {
    console.log(`package-ok ${url}`);
    return;
  }
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(choice.port);
  process.env.DAGUAN_DATA_DIR = path.join(root, "data");
  setTimeout(() => openBrowser(url), 900);
  await import(pathToFileURL(path.join(appDir, "local-server", "server.mjs")).href);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
