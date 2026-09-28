import fs from "node:fs/promises";
import path from "node:path";

export async function prepareDesktopPackage(buildPath) {
  const dataDirectory = path.join(buildPath, "web", "data");
  const shardDirectory = path.join(dataDirectory, "shards");
  const manifestPath = path.join(dataDirectory, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  let index = 0;
  for (const shard of Object.values(manifest.shards)) {
    index += 1;
    const original = path.join(dataDirectory, shard.file);
    const packagedFile = `shards/shard-${String(index).padStart(2, "0")}.json`;
    await fs.rename(original, path.join(dataDirectory, packagedFile));
    shard.file = packagedFile;
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const remaining = await fs.readdir(shardDirectory, { withFileTypes: true });
  let orphanIndex = 0;
  for (const entry of remaining) {
    if (!/[^\x00-\x7F]/.test(entry.name)) continue;
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      throw new Error(`Desktop package contains an unexpected non-ASCII shard entry: ${entry.name}`);
    }
    orphanIndex += 1;
    const packagedFile = `shards/unreferenced-${String(orphanIndex).padStart(2, "0")}.json`;
    await fs.rename(path.join(shardDirectory, entry.name), path.join(dataDirectory, packagedFile));
  }
  const packagedEntries = await fs.readdir(shardDirectory);
  if (packagedEntries.some((filename) => /[^\x00-\x7F]/.test(filename))) {
    throw new Error("Desktop package contains non-ASCII question shard filenames");
  }
}
