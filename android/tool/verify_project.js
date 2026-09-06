const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(appRoot, "assets", name), "utf8"));
const questions = readJson("questions.json");
const categories = readJson("categories.json");
const progress = readJson("initial_progress.json");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(questions.total === 5952, `题目数量错误：${questions.total}`);
check(questions.items.length === questions.total, "题目 total 与 items 不一致");
check(categories.total >= 987, `分类数量错误：${categories.total}`);
check(categories.items.length === categories.total, "分类 total 与 items 不一致");
check(
  Object.keys(progress.states).length === 0,
  `初始题目状态应为空：${Object.keys(progress.states).length}`,
);
check(progress.events.length === 0, `初始学习记录应为空：${progress.events.length}`);
check(progress.lastStudy === null, "初始学习位置应为空");

const expectedRootCounts = new Map([
  ["高等数学", 3707],
  ["线性代数", 959],
  ["概率统计", 317],
  ["历年真题", 1106],
]);
for (const [name, expectedCount] of expectedRootCounts) {
  const category = categories.items.find(
    (item) => item.parentId === null && item.name === name,
  );
  check(Boolean(category), `缺少一级分类：${name}`);
  check(
    category?.totalCount === expectedCount,
    `${name} 数量错误：${category?.totalCount}`,
  );
}

const questionIds = new Set(questions.items.map((question) => question.id));
const categoryIds = new Set(categories.items.map((category) => category.id));
check(questionIds.size === questions.items.length, "存在重复题目 ID");
check(categoryIds.size === categories.items.length, "存在重复分类 ID");

for (const question of questions.items) {
  check(typeof question.stem === "string", `题目 ${question.id} 缺少题干`);
  for (const categoryId of question.categoryIds) {
    check(categoryIds.has(categoryId), `题目 ${question.id} 引用了未知分类 ${categoryId}`);
  }
}

const assetPattern = /^asset:\/\/sha256\/([a-f0-9]{64})$/;
const expectedImageHashes = new Set();
for (const question of questions.items) {
  for (const reference of question.assets || []) {
    const match = assetPattern.exec(reference);
    check(Boolean(match), `题目 ${question.id} 引用了无效题图：${reference}`);
    if (match) expectedImageHashes.add(match[1]);
  }
}
check(
  expectedImageHashes.size === 1297,
  `题图引用数量错误：${expectedImageHashes.size}`,
);

const imageDirectory = path.join(appRoot, "assets", "question_images");
let imageBytes = 0;
let verifiedImages = 0;
const missingImages = [];
for (const hash of expectedImageHashes) {
  const imagePath = path.join(imageDirectory, `${hash}.png`);
  if (!fs.existsSync(imagePath)) {
    missingImages.push(hash);
    continue;
  }
  const content = fs.readFileSync(imagePath);
  const actualHash = crypto.createHash("sha256").update(content).digest("hex");
  check(actualHash === hash, `题图校验失败：${hash}.png`);
  check(
    content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `题图不是 PNG：${hash}.png`,
  );
  imageBytes += content.length;
  verifiedImages += 1;
}
check(
  missingImages.length === 0,
  `缺少 ${missingImages.length}/${expectedImageHashes.size} 张题图`
    + (missingImages.length ? `，第一张：${missingImages[0]}.png` : ""),
);
for (const questionId of Object.keys(progress.states)) {
  check(questionIds.has(Number(questionId)), `状态引用了未知题目 ${questionId}`);
}
const archivedEvents = progress.events.filter(
  (event) => !questionIds.has(event.questionId),
).length;

const manifest = fs.readFileSync(
  path.join(appRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
  "utf8",
);
check(!manifest.includes("android.permission.INTERNET"), "应用不应申请联网权限");
check(!manifest.toLowerCase().includes("webview"), "应用不应使用 WebView");
check(
  manifest.includes('android:allowBackup="false"'),
  "应用必须关闭系统自动备份和恢复",
);
check(
  manifest.includes('android:fullBackupContent="@xml/backup_rules"'),
  "Android 11 及以下必须配置备份排除规则",
);
check(
  manifest.includes('android:dataExtractionRules="@xml/data_extraction_rules"'),
  "Android 12 及以上必须配置数据迁移排除规则",
);
const backupRules = fs.readFileSync(
  path.join(appRoot, "android", "app", "src", "main", "res", "xml", "backup_rules.xml"),
  "utf8",
);
const extractionRules = fs.readFileSync(
  path.join(
    appRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    "xml",
    "data_extraction_rules.xml",
  ),
  "utf8",
);
check(
  backupRules.includes('<exclude domain="file" path="."'),
  "旧版 Android 备份规则必须排除应用文件",
);
check(
  extractionRules.includes("<cloud-backup>")
    && extractionRules.includes("<device-transfer>")
    && (extractionRules.match(/<exclude domain="file" path="."\s*\/>/g) || [])
      .length === 2,
  "Android 12+ 必须同时排除云备份与设备迁移中的应用文件",
);

const dartFiles = fs
  .readdirSync(path.join(appRoot, "lib"))
  .filter((name) => name.endsWith(".dart"))
  .map((name) => fs.readFileSync(path.join(appRoot, "lib", name), "utf8"))
  .join("\n");
check(!dartFiles.includes("http://"), "Dart 代码中不应出现 HTTP 地址");
check(!dartFiles.includes("https://"), "Dart 代码中不应出现 HTTPS 地址");
check(dartFiles.includes("GestureDetector"), "缺少双指缩放手势");
check(dartFiles.includes("InteractiveViewer"), "缺少题图双指缩放支持");
check(dartFiles.includes("Image.asset"), "缺少离线题图显示");
check(dartFiles.includes("SelectionArea"), "缺少文字选择支持");
check(dartFiles.includes("exportJson"), "缺少导出调用");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}

const stateValues = Object.values(progress.states);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      questions: questions.items.length,
      categories: categories.items.length,
      meaningfulStates: stateValues.length,
      mastered: stateValues.filter((state) => state.mastery === "mastered").length,
      needsPractice: stateValues.filter(
        (state) => state.mastery === "needs_practice",
      ).length,
      notKnown: stateValues.filter((state) => state.mastery === "not_known").length,
      favorites: stateValues.filter((state) => state.favorite).length,
      events: progress.events.length,
      archivedEvents,
      questionImages: verifiedImages,
      questionImageBytes: imageBytes,
      networkPermission: false,
      webView: false,
    },
    null,
    2,
  ),
);
