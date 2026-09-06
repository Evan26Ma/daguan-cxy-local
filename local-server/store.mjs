import fs from "node:fs/promises";
import path from "node:path";
import { normalizeLocalState } from "./sync-format.mjs";

export function createStore(rootDir, dataDirOverride = process.env.DAGUAN_DATA_DIR) {
  const dataDir = path.resolve(dataDirOverride || path.join(rootDir, "data"));
  const backupDir = path.join(dataDir, "cxyonly-backups");
  const stateFile = path.join(dataDir, "state.json");
  const progressFile = path.join(dataDir, "cxyonly-progress.json");
  const integrationFile = path.join(dataDir, "cxyonly-integration.json");
  const historyFile = path.join(dataDir, "sync-history.jsonl");
  const aiProfilesFile = path.join(dataDir, "ai-profiles.json");
  const aiHistoryDir = path.join(dataDir, "ai-history");

  async function ensure() {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(aiHistoryDir, { recursive: true });
    if (process.platform !== "win32") {
      await fs.chmod(dataDir, 0o700).catch(() => {});
    }
  }

  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
  }

  async function writeJson(file, value, mode = 0o600) {
    await ensure();
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    await fs.rename(temp, file);
    if (process.platform !== "win32") await fs.chmod(file, mode).catch(() => {});
  }

  return {
    dataDir,
    backupDir,
    async readState() {
      return normalizeLocalState(await readJson(stateFile, { format: "daguan-local-state", version: 3, progress: {}, favorites: [], picked: [], updated_at: null }));
    },
    async writeState(value, options = {}) {
      const current = await this.readState();
      const expected = options.expectedRevision == null ? null : Number(options.expectedRevision);
      if (expected != null && current.revision !== expected) {
        const error = new Error(`本地状态版本已变化（当前 ${current.revision}，请求 ${expected}）`);
        error.code = "STATE_CONFLICT";
        error.status = 409;
        error.current = current;
        throw error;
      }
      const next = normalizeLocalState(value);
      if (options.increment !== false) next.revision = current.revision + 1;
      next.updated_at = new Date().toISOString();
      await writeJson(stateFile, next);
      return next;
    },
    async readProgress() { return readJson(progressFile, null); },
    async writeProgress(value) { return writeJson(progressFile, value); },
    async readIntegration() { return readJson(integrationFile, null); },
    async writeIntegration(value) { return writeJson(integrationFile, value); },
    async clearIntegration() { await fs.rm(integrationFile, { force: true }); },
    async writeBackup(prefix, value) {
      await ensure();
      const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
      const file = path.join(backupDir, `${prefix}-${stamp}.json`);
      await writeJson(file, value);
      return file;
    },
    async appendHistory(entry) {
      await ensure();
      await fs.appendFile(historyFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
    },
    async readAiProfiles() { return readJson(aiProfilesFile, { version: 1, profiles: [] }); },
    async writeAiProfiles(value) { return writeJson(aiProfilesFile, value); },
    async readAiHistory(key) { return readJson(path.join(aiHistoryDir, `${key}.json`), { version: 1, messages: [], updatedAt: null }); },
    async writeAiHistory(key, value) { return writeJson(path.join(aiHistoryDir, `${key}.json`), value); },
    async clearAiHistory(key) { await fs.rm(path.join(aiHistoryDir, `${key}.json`), { force: true }); },
    async aiHistoryFiles() { await ensure(); return fs.readdir(aiHistoryDir); },
  };
}
