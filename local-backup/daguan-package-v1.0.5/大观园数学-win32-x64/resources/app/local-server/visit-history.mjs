import fs from "node:fs/promises";
import path from "node:path";

const empty = () => ({ version: 1, migrated: true, entries: {} });
const validId = value => /^\d+$/.test(String(value ?? "")) && Number(value) > 0;
const validTime = value => {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function normalizeEntry(value, fallbackId) {
  if (!value || typeof value !== "object") return null;
  const questionId = String(value.question_id ?? fallbackId ?? "");
  if (!validId(questionId)) return null;
  return {
    question_id: questionId,
    category_id: value.category_id == null ? null : String(value.category_id),
    chapter_id: value.chapter_id == null ? null : String(value.chapter_id),
    visited_at: validTime(value.visited_at),
    time_kind: value.time_kind === "legacy" ? "legacy" : "visit",
  };
}

export function createVisitHistory(dataDir, readState) {
  const file = path.join(dataDir, "visit-history.json");
  let queue = Promise.resolve();
  const locked = task => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
  async function save(value) {
    await fs.mkdir(dataDir, { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  }
  async function read() {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      if (value?.version === 1 && value.migrated === true && value.entries && typeof value.entries === "object") return value;
      throw new Error("做题历史格式无效");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const value = empty();
      const state = await readState();
      for (const [id, progress] of Object.entries(state.progress || {})) {
        if (!validId(id) || !progress || typeof progress !== "object") continue;
        if (!(progress.seen || progress.answered || progress.last_practiced_at || progress.mastery && progress.mastery !== "not_started")) continue;
        value.entries[id] = normalizeEntry({ question_id: id, visited_at: progress.last_practiced_at || progress.updated_at, time_kind: "legacy" });
      }
      await save(value);
      return value;
    }
  }
  return {
    list: () => locked(async () => Object.values((await read()).entries).sort((a, b) => (Date.parse(b.visited_at) || 0) - (Date.parse(a.visited_at) || 0))),
    visit: input => locked(async () => {
      const entry = normalizeEntry({ ...input, visited_at: validTime(input?.visited_at) || new Date().toISOString(), time_kind: "visit" });
      if (!entry) throw Object.assign(new Error("题目 ID 无效"), { status: 400 });
      const value = await read();
      const previous = value.entries[entry.question_id];
      if (!previous || (Date.parse(entry.visited_at) || 0) >= (Date.parse(previous.visited_at) || 0)) value.entries[entry.question_id] = entry;
      await save(value);
      return entry;
    }),
    remove: id => locked(async () => {
      if (!validId(id)) throw Object.assign(new Error("题目 ID 无效"), { status: 400 });
      const value = await read();
      delete value.entries[String(id)];
      await save(value);
    }),
    clear: () => locked(async () => save(empty())),
    merge: input => locked(async () => {
      if (!Array.isArray(input)) throw Object.assign(new Error("历史记录格式无效"), { status: 400 });
      const value = await read();
      for (const raw of input) {
        const entry = normalizeEntry(raw);
        if (!entry) continue;
        const previous = value.entries[entry.question_id];
        if (!previous || (Date.parse(entry.visited_at) || 0) > (Date.parse(previous.visited_at) || 0)) value.entries[entry.question_id] = entry;
      }
      await save(value);
      return Object.keys(value.entries).length;
    }),
  };
}
