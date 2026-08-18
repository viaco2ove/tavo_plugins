/**
 * 从 worldbook/ 目录下的 Markdown 文件生成 worldbook.json
 * 用法: node generate-worldbook-json.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename } from "path";

const WB_DIR = "D:/Users/viaco/tools/Toonflow-game/Toonflow-game-story/ai_story/171/谁让这个山大王修仙的/worldbook";

// 解析 Markdown 中的字段行，如: - **Keys**: `["a", "b"]`
function parseField(line, fieldName) {
  const m = line.match(new RegExp(`\\*\\*${fieldName}[^*]*\\*\\*\\s*:?\\s*(.+)`));
  if (!m) return undefined;
  let raw = m[1].trim();
  // 去掉 Markdown 反引号包裹：`true` -> true, `["a","b"]` -> ["a","b"], `100` -> 100
  raw = raw.replace(/^`+|`+$/g, "").trim();
  // 去掉行尾中文括号注释，如 `0`（前期禁用）-> 0
  raw = raw.replace(/[（(][^)）]*[)）]\s*$/g, "").trim();
  // 再次去反引号（去掉注释后可能暴露出来的）
  raw = raw.replace(/^`+|`+$/g, "").trim();
  // 解析 JSON 数组/对象
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  // 解析布尔
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  // 解析数字
  const num = Number(raw);
  if (!isNaN(num) && raw !== "") return num;
  return raw;
}

// 从 Markdown 文件中提取所有条目
function parseMarkdownFile(filePath, category) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const entries = [];
  let currentEntry = null;
  let inContent = false;
  let contentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 二级标题 = 新条目开始
    if (line.startsWith("## ") && !line.startsWith("## 目录") && !line.startsWith("## 条目")) {
      // 保存上一个条目
      if (currentEntry) {
        currentEntry.content = contentLines.join("\n").replace(/^>\s?/gm, "").trim();
        entries.push(currentEntry);
      }
      const title = line.replace(/^##\s+/, "").trim();
      currentEntry = { title, category, keys: [], constant: false, probability: 100, order: 100, group: null, selectiveLogic: null, selectiveKeys: null, content: "" };
      inContent = false;
      contentLines = [];
      continue;
    }

    if (!currentEntry) continue;

    // 字段行
    if (line.startsWith("- **Keys**")) { currentEntry.keys = parseField(line, "Keys") || []; inContent = false; continue; }
    if (line.startsWith("- **Constant**")) { currentEntry.constant = parseField(line, "Constant"); inContent = false; continue; }
    if (line.startsWith("- **Probability**")) { currentEntry.probability = parseField(line, "Probability"); inContent = false; continue; }
    if (line.startsWith("- **Order**")) { currentEntry.order = parseField(line, "Order"); inContent = false; continue; }
    if (line.startsWith("- **Group**")) { currentEntry.group = parseField(line, "Group"); inContent = false; continue; }
    if (line.startsWith("- **Selective Logic**")) { currentEntry.selectiveLogic = parseField(line, "Selective Logic"); inContent = false; continue; }
    if (line.startsWith("- **Selective Keys**")) { currentEntry.selectiveKeys = parseField(line, "Selective Keys"); inContent = false; continue; }

    // Content 标记行
    if (line.startsWith("- **Content**")) { inContent = true; continue; }

    // 收集 Content 正文（以 > 开头的行）
    if (inContent && line.startsWith(">")) {
      contentLines.push(line);
    } else if (inContent && line.trim() === "" && contentLines.length > 0) {
      // 空行可能属于 content 内部
      contentLines.push("");
    } else if (inContent && line.startsWith("---")) {
      // 分隔符结束当前 content
      // 保存
    }
  }

  // 保存最后一个条目
  if (currentEntry) {
    currentEntry.content = contentLines.join("\n").replace(/^>\s?/gm, "").trim();
    entries.push(currentEntry);
  }

  return entries.filter(e => e.title && e.content);
}

// 文件名 -> category 映射
const fileCategoryMap = {
  "_constants.md": "constants",
  "_system.md": "system",
  "world.md": "world",
  "locations.md": "locations",
  "characters.md": "characters",
  "factions.md": "factions",
  "items.md": "items",
  "events.md": "events",
  "random.md": "random",
};

const allEntries = [];
let entryIdCounter = 0;

for (const [filename, category] of Object.entries(fileCategoryMap)) {
  const filePath = join(WB_DIR, filename);
  try {
    const entries = parseMarkdownFile(filePath, category);
    for (const entry of entries) {
      entry.id = `entry_${String(entryIdCounter++).padStart(3, "0")}_${category}`;
      allEntries.push(entry);
    }
    console.log(`${filename}: ${entries.length} entries`);
  } catch (e) {
    console.error(`Error reading ${filename}: ${e.message}`);
  }
}

const worldbook = {
  name: "谁让这个山大王修仙的！",
  version: "1.0.0",
  description: "基于 SillyTavern 世界书（Lorebook / World Info）规范的 JSON 版。核心思想：关键词触发 -> 动态注入上下文。",
  lastUpdated: "2026-07-22",
  source: "从 worldbook/ 目录下的 Markdown 文件同步生成，MD 文件为人类可读规范，本 JSON 为运行时数据源。",
  scanDepth: 5,
  tokenBudget: 2000,
  recursiveScanning: true,
  caseSensitive: false,
  matchWholeWords: false,
  totalEntries: allEntries.length,
  entries: allEntries,
};

const outputPath = join(WB_DIR, "worldbook.json");
writeFileSync(outputPath, JSON.stringify(worldbook, null, 2), "utf-8");
console.log(`\nDone! ${allEntries.length} entries written to ${outputPath}`);
