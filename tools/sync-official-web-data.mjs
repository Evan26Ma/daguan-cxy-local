#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncOfficialQuestionBank } from "../local-server/official-question-bank.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "web", "data");
const result = await syncOfficialQuestionBank({ targetDir: dataDir });
console.log(`官网 ${result.sourceTotal} 题 + 本地专有 ${result.total - result.sourceTotal} 题 = ${result.total} 题；缺少 ${result.missingAssets} 张官网题图`);
