import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore } from "../local-server/store.mjs";
import { createAiService, validateBaseUrl } from "../local-server/ai-service.mjs";

test("AI 地址策略拒绝凭据和公网 HTTP", async () => {
  await assert.rejects(() => validateBaseUrl("https://user:pass@example.com/v1"), /不能内嵌/);
  await assert.rejects(() => validateBaseUrl("http://example.com/v1"), /HTTPS/);
  assert.equal(await validateBaseUrl("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1");
});

test("AI 服务档案只返回掩码 Key，图形失败时降级安全 SVG", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-ai-"));
  const service = createAiService({ store: createStore(root) });
  const profile = await service.upsert({ name: "测试", baseUrl: "http://127.0.0.1:1234/v1", key: "sk-secret-key", model: "mock", active: true });
  assert.match(profile.keyHint, /••••/);
  assert.equal(profile.key, undefined);
  const rendered = await service.diagram({ kind: "polyline", points: [[0, 0], [1, 2]], title: "安全图" });
  assert.match(rendered.svg, /^<svg/);
  assert.doesNotMatch(rendered.svg, /script|foreignObject|onload/i);
  await fs.rm(root, { recursive: true, force: true });
});
