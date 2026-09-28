import path from "node:path";

export const APP_ORIGIN = "daguan://app";

export const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function isTrustedAppUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "daguan:" && url.hostname === "app" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function navigationAction(input) {
  try {
    const url = new URL(input);
    if (isTrustedAppUrl(url.href)) return "allow";
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return "external";
  } catch {}
  return "deny";
}

export function resolveWebAsset(webRoot, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const root = path.resolve(webRoot);
  if (decoded === "/" || decoded === "") return path.join(root, "index.html");
  const target = path.resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

export function proxyHeaders(headers) {
  const filtered = new Headers();
  for (const [name, value] of headers.entries()) {
    if (["host", "origin", "connection", "content-length", "transfer-encoding", "cookie"].includes(name.toLowerCase())) continue;
    filtered.set(name, value);
  }
  return filtered;
}

export function windowPreferences(preload) {
  return {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  };
}

export function shouldStopService({ owned, confirmed }) {
  return Boolean(owned && confirmed);
}

export function downloadSaveDialogOptions(downloadsDirectory, filename) {
  const suggestedName = path.basename(String(filename || "download"))
    .replace(/[<>:"|?*\x00-\x1f]/g, "_")
    .trim() || "download";
  return {
    title: "另存为",
    buttonLabel: "保存",
    defaultPath: path.join(downloadsDirectory, suggestedName),
  };
}
