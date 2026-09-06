import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SOURCE = "https://hsad.xyz/daguan-math";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function questionIdsFromShard(value) {
  return Array.isArray(value) ? value.map((item) => String(item?.id ?? item?.question_id ?? "")).filter(Boolean) : [];
}

export async function refreshCatalog(rootDir, progress = () => {}) {
  const dataDir = path.join(rootDir, "web", "data");
  const stageDir = path.join(dataDir, `.staging-${process.pid}-${randomUUID()}`);
  await fs.mkdir(stageDir, { recursive: true });
  try {
    const manifest = await fetchJson(`${SOURCE}/data/manifest.json`);
    if (!manifest || !manifest.shards || !Number.isFinite(Number(manifest.total))) throw new Error("官网题库 manifest 无效");
    const required = ["categories.json", "category_questions.json", "id_index.json", "search_index.json"];
    const files = [...required, ...Object.values(manifest.shards).map((meta) => meta.file)];
    const seen = new Set();
    let completed = 0;
    for (const file of files) {
      const target = path.join(stageDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const value = await fetchJson(`${SOURCE}/data/${file}`);
      if (file.startsWith("shards/")) {
        for (const id of questionIdsFromShard(value)) {
          if (seen.has(id)) throw new Error(`题库题号重复：${id}`);
          seen.add(id);
        }
      }
      await fs.writeFile(target, JSON.stringify(value));
      completed += 1;
      progress({ completed, total: files.length, file });
    }
    if (seen.size !== Number(manifest.total)) throw new Error(`题库数量校验失败：manifest ${manifest.total}，分片 ${seen.size}`);
    manifest.asset_base = "./data/assets/";
    manifest.synced_at = new Date().toISOString();
    await fs.writeFile(path.join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of [...files, "manifest.json"]) {
      const from = path.join(stageDir, file);
      const to = path.join(dataDir, file);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
    return { ok: true, total: seen.size, files: files.length + 1, version: manifest.version || manifest.synced_at };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}
