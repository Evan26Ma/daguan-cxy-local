import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// web/source-taxonomy.js 是经典 IIFE（root.DaguanSourceTaxonomy = api）。
// 因为 package.json 是 "type": "module"，直接 require() 那个 .js 会按 ESM 解析，
// module.exports 分支不生效，所以这里统一用 vm 沙箱加载。

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function loadTaxonomy({ withWindow = true } = {}) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  if (withWindow) sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(join(root, "web/source-taxonomy.js"), "utf8"), sandbox, { filename: "source-taxonomy.js" });
  return sandbox.DaguanSourceTaxonomy;
}

const tax = loadTaxonomy();

// vm 沙箱里造出来的数组属于另一个 realm，原型和本文件的 Array.prototype 不同，
// assert.deepEqual 会因为原型不一致而失败，所以统一转成本地数组再比。
const toArr = (value) => Array.from(value);

test("沙箱加载：脚本可运行且挂到全局", () => {
  assert.ok(tax, "globalThis.DaguanSourceTaxonomy 应该存在");
  for (const name of ["classify", "keySet", "matches", "primarySystem", "describe", "options", "labelOf", "legacyGroup", "tokenize"]) {
    assert.equal(typeof tax[name], "function", `${name} 应该是函数`);
  }
});

test("沙箱加载：没有 window 也能跑（node 侧不需要 window）", () => {
  const bare = loadTaxonomy({ withWindow: false });
  assert.equal(bare.classify("880题").systems[0], "t880");
});

test("结构不变量：体系/书目 id 唯一且相互引用成立", () => {
  const systemIds = tax.SYSTEMS.map(s => s.id);
  assert.equal(new Set(systemIds).size, systemIds.length, "体系 id 不应重复");
  assert.ok(systemIds.includes("other"), "必须存在 other 兜底体系");
  assert.equal(tax.SYSTEMS.length, 17);

  const bookIds = tax.BOOKS.map(b => b.id);
  assert.equal(new Set(bookIds).size, bookIds.length, "书目 id 不应重复");
  for (const book of tax.BOOKS) {
    assert.ok(systemIds.includes(book.system), `书目 ${book.id} 的 system=${book.system} 不在 SYSTEMS 里`);
  }
  for (const system of tax.SYSTEMS) {
    assert.ok(system.label && system.emoji, `体系 ${system.id} 缺少 label/emoji`);
    assert.notEqual(tax.labelOf(`sys:${system.id}`), `sys:${system.id}`, `labelOf 解析不了 sys:${system.id}`);
  }
  for (const book of tax.BOOKS) {
    assert.ok(book.label, `书目 ${book.id} 缺少 label`);
    assert.notEqual(tax.labelOf(`book:${book.id}`), `book:${book.id}`, `labelOf 解析不了 book:${book.id}`);
  }
});

test("options()：17 组两级树，other 组无子项", () => {
  const options = tax.options();
  assert.equal(options.length, 17);
  const other = options[options.length - 1];
  assert.equal(other.system.id, "other");
  assert.equal(other.key, "sys:other");
  assert.deepEqual(toArr(other.books), []);
  for (const group of options) {
    assert.equal(group.key, `sys:${group.system.id}`);
    for (const entry of group.books) {
      assert.equal(entry.key, `book:${entry.book.id}`);
      assert.equal(entry.book.system, group.system.id);
      assert.notEqual(entry.book.id, group.system.id, "书目 id 不应和体系 id 同名（否则选项重复）");
    }
  }
  const exam = options.find(g => g.system.id === "exam");
  assert.deepEqual(toArr(exam.books.map(b => b.book.id)), ["exam_national", "exam_school"]);
});

test("classify：单来源样本", () => {
  const samples = [
    ["1988数三", ["exam"], ["exam_national"]],
    ["🫚 真题同源150 第1章", ["jiang"], ["jiang_150"]],
    ["🐙 1000题 第2章", ["zhangyu"], ["zy_1000"]],
    ["🖐️ 基础严选题", ["wuzhongxiang"], ["wzx_basic"]],
    ["武忠祥 强化严选题", ["wuzhongxiang"], ["wzx_strong"]],
    ["李永乐 线代辅导讲义", ["liyongle"], ["lyl_line"]],
    ["李正元 例题", ["lizhengyuan"], ["lzy_example"]],
    ["没咋了 概率救命课", ["meizhale"], ["mzl_prob"]],
    ["880题", ["t880"], ["b880"]],
    ["660题", ["t660"], ["b660"]],
    ["900题", ["t900"], ["b900"]],
    ["1800", ["t1800"], ["b1800"]],
    ["108考点", ["kd108"], ["b108"]],
    ["30注例", ["zhangyu"], ["zy_30"]],
    ["张宇 30讲 第3讲", ["zhangyu"], ["zy_30"]],
    ["复习全书（红）", ["quanshu"], ["bquanshu"]],
    ["魔法练习册", ["magic"], ["bmagic"]],
    ["张八卷", ["mock"], ["mock_zhang8"]],
    ["李六卷", ["mock"], ["mock_li6"]],
    ["LYF三套卷", ["mock"], ["mock_lyf"]],
    ["Euclid 八月模考", ["mock"], ["mock_euclid"]],
    ["郭伟模考", ["mock"], ["mock_other"]],
    ["某大学 2020 年数学一", ["exam"], ["exam_school"]],
    ["竞赛题 第一题", ["contest"], ["contest"]],
    ["25 版 强化 33", ["other"], ["other"]],
    ["超越135", ["other"], ["other"]],
    ["", ["other"], ["other"]],
  ];
  for (const [source, systems, books] of samples) {
    const result = tax.classify(source);
    assert.deepEqual(toArr(result.systems), systems, `classify(${JSON.stringify(source)}).systems`);
    assert.deepEqual(toArr(result.books), books, `classify(${JSON.stringify(source)}).books`);
  }
});

test("classify：多来源题命中多个体系，顺序稳定", () => {
  const result = tax.classify("2000数一（8）；🐙30例16.20；880基础选择4；🖐️强化严选第七章8");
  assert.deepEqual(toArr(result.systems), ["exam", "zhangyu", "t880", "wuzhongxiang"]);
  assert.deepEqual(toArr(result.books), ["exam_national", "zy_30", "b880", "wzx_strong"]);
});

test("规则顺序：先判先赢的几个坑位", () => {
  // 竞赛在真题之前
  assert.equal(tax.primarySystem("1996老北京竞赛"), "contest");
  assert.equal(tax.primarySystem("北京市大学生数学竞赛题"), "contest");
  // 660 在 108考点 之前
  assert.deepEqual(toArr(tax.classify("25版660数一二三第108题").books), ["b660"]);
  // 复习全书（红）先于李永乐/李正元，不选边
  assert.deepEqual(toArr(tax.classify("李永乐 复习全书（红）").systems), ["quanshu"]);
  // Euclid / 郭伟模考 先于 mock_other
  assert.deepEqual(toArr(tax.classify("Euclid 八月模考").books), ["mock_euclid"]);
  assert.deepEqual(toArr(tax.classify("郭伟模考").books), ["mock_other"]);
  // 880 残片（第五章数二 A 类）也归 880
  assert.deepEqual(toArr(tax.classify("第五章数二 A 类").books), ["b880"]);
  // 姜晓千的讲义标记先于张宇
  assert.deepEqual(toArr(tax.classify("🫚 强化例题").systems), ["jiang"]);
});

test("tokenize：剥题号前缀、剥成对括号、丢弃纯标记", () => {
  assert.deepEqual(toArr(tax.tokenize("(0) 900 第三章数二 B 类 41")), ["900 第三章数二 B 类 41"]);
  assert.deepEqual(toArr(tax.tokenize("（3）880题；仅数三")), ["880题"]);
  assert.deepEqual(toArr(tax.tokenize("（重点）")), []);
  assert.deepEqual(toArr(tax.tokenize("（复习全书（红））")), ["复习全书（红）"]);
  assert.deepEqual(toArr(tax.tokenize("")), []);
});

test("matches / keySet：细目、旧粗桶兼容、空选全通过", () => {
  const examKeys = tax.keySet("1988数三");
  for (const key of ["sys:exam", "book:exam_national", "历年真题"]) {
    assert.ok(examKeys.has(key), `keySet("1988数三") 应该含 ${key}`);
  }
  const b880Keys = tax.keySet("880题");
  for (const key of ["sys:t880", "book:b880", "880 题库"]) {
    assert.ok(b880Keys.has(key), `keySet("880题") 应该含 ${key}`);
  }

  assert.equal(tax.matches([], "任意来源"), true, "空筛选应当全部通过");
  assert.equal(tax.matches(["sys:exam"], "1988数三"), true);
  assert.equal(tax.matches(["sys:jiang"], "🐙 1000题 第2章"), false);
  assert.equal(tax.matches(["book:zy_1000"], "🐙 1000题 第2章"), true);
  assert.equal(tax.matches(["历年真题"], "1988数三"), true, "旧版粗桶名要兼容");
  assert.equal(tax.matches(["sys:exam"], "🐙 1000题 第2章"), false);

  // 记录一个已知边界：annotations.json 的粗桶名是「真题」，不是 taxonomy 的「历年真题」。
  // 旧版前端靠 advSourceMatch 里的 coarse（A.src）回退兜底，taxonomy 侧不做臆测映射。
  assert.equal(tax.matches(["真题"], "1988数三"), false);
});

test("legacyGroup：与 app-new.js 的 sourceGroup 桶名保持一致", () => {
  const cases = [
    ["1988数三", "历年真题"],
    ["880题", "880 题库"],
    ["660题", "660 题库"],
    ["🫚 真题同源150", "真题同源"],
    ["🫚 强化例题", "强化练习"],
    ["🖐️ 基础严选题", "基础练习"],
    ["张八卷", "其他来源"],
    ["张八模拟卷", "模拟练习"],
    ["25 版 强化 33", "强化练习"],
  ];
  for (const [source, bucket] of cases) {
    assert.equal(tax.legacyGroup(source), bucket, `legacyGroup(${JSON.stringify(source)})`);
  }
});

test("describe / labelOf / primarySystem", () => {
  assert.equal(tax.describe("🫚 真题同源150 第1章; 🐙 1000题 第2章"), "姜晓千 · 真题同源150；张宇 · 1000题");
  assert.equal(tax.describe("25 版 强化 33"), "其他来源 · 25 版 强化 33");
  assert.equal(tax.describe(""), "其他来源");
  assert.equal(tax.describe("880题"), "880题");
  assert.equal(tax.describe("复习全书（红）"), "复习全书（红皮）");
  assert.equal(tax.describe("2000数一；🐙1000题 第1章；880题", 2), "历年真题 · 统考真题；张宇 · 1000题");

  assert.equal(tax.labelOf("sys:exam"), "历年真题");
  assert.equal(tax.labelOf("book:zy_1000"), "1000题");
  assert.equal(tax.labelOf("真题"), "真题");
  assert.equal(tax.labelOf("sys:不存在"), "sys:不存在");

  assert.equal(tax.primarySystem("2000数一（8）；🐙30例16.20"), "exam");
  assert.equal(tax.primarySystem(""), "other");
});

test("全库回归：所有 source 都能分类，未识别来源占比极低", async () => {
  const dataDir = join(root, "web/data");
  const manifestPath = join(dataDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    assert.ok(true, "缺少 manifest.json，跳过全库回归");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const shards = Object.values(manifest.shards || {});
  if (shards.length === 0) {
    assert.ok(true, "manifest 没有分片，跳过全库回归");
    return;
  }

  const knownSystems = new Set(tax.SYSTEMS.map(s => s.id));
  const knownBooks = new Set(tax.BOOKS.map(b => b.id));
  const counts = new Map();
  let total = 0;

  for (const meta of shards) {
    const file = join(dataDir, meta.file);
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const questions = Array.isArray(raw) ? raw : (raw.questions || []);
    for (const question of questions) {
      total += 1;
      const result = tax.classify(question && question.source);
      for (const id of result.systems) {
        assert.ok(knownSystems.has(id), `未知体系 id ${id}（source=${JSON.stringify(question && question.source)}）`);
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      for (const id of result.books) {
        assert.ok(knownBooks.has(id), `未知书目 id ${id}（source=${JSON.stringify(question && question.source)}）`);
      }
    }
  }

  assert.ok(total > 6000, `题目总量异常：${total}`);
  const other = counts.get("other") || 0;
  assert.ok(other / total < 0.01, `未识别来源过多：${other}/${total}`);
  assert.ok((counts.get("exam") || 0) / total > 0.3, "历年真题覆盖偏低，可能有规则被误伤");
});
