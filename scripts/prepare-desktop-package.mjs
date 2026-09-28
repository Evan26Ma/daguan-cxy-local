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
  const remaining = await fs.readdir(shardDirectory);
  if (remaining.some((filename) => /[^\x00-\x7F]/.test(filename))) {
    throw new Error("Desktop package contains non-ASCII question shard filenames");
  }
}
