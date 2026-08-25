#!/usr/bin/env node
// HTML 标签平衡检查器：跳过 script/style/comment/string，识别 void 元素和维护 tag 栈
import { readFileSync, existsSync } from 'fs';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

// 简单 HTML 解析：跳过 <script>...</script>、<style>...</style>、<!-- ... -->、字符串字面量
// 维护标签栈，报告未闭合 / 多闭合 / 标签不匹配
function checkHtml(filePath) {
  if (!existsSync(filePath)) {
    return [{ line: 0, col: 0, msg: 'File not found: ' + filePath }];
  }
  const html = readFileSync(filePath, 'utf8');
  const errors = [];
  const stack = []; // [{ tag, line }]
  let i = 0;
  let line = 1;
  let col = 0;
  let inScript = false;
  let inStyle = false;

  const advance = (n) => {
    for (let k = 0; k < n; k++) {
      if (html[i + k] === '\n') { line++; col = 0; } else { col++; }
    }
    i += n;
  };

  while (i < html.length) {
    // 处理 script/style 块
    if (!inScript && !inStyle) {
      // 跳过 <script
      if (html.substring(i, i + 7).toLowerCase() === '<script') {
        const closeIdx = html.toLowerCase().indexOf('</script>', i + 7);
        if (closeIdx === -1) {
          errors.push({ line, col, msg: 'Unclosed <script> tag' });
          break;
        }
        // 累计行号
        const before = html.substring(i, closeIdx);
        line += (before.match(/\n/g) || []).length;
        col = 0;
        i = closeIdx + 9;
        continue;
      }
      if (html.substring(i, i + 6).toLowerCase() === '<style') {
        const closeIdx = html.toLowerCase().indexOf('</style>', i + 6);
        if (closeIdx === -1) {
          errors.push({ line, col, msg: 'Unclosed <style> tag' });
          break;
        }
        const before = html.substring(i, closeIdx);
        line += (before.match(/\n/g) || []).length;
        col = 0;
        i = closeIdx + 8;
        continue;
      }
    }

    // 跳过 HTML 注释
    if (html.substring(i, i + 4) === '<!--') {
      const closeIdx = html.indexOf('-->', i + 4);
      if (closeIdx === -1) {
        errors.push({ line, col, msg: 'Unclosed <!-- comment' });
        break;
      }
      const before = html.substring(i, closeIdx);
      line += (before.match(/\n/g) || []).length;
      col = 0;
      i = closeIdx + 3;
      continue;
    }

    // 找下一个 < 或 >
    if (html[i] !== '<') {
      if (html[i] === '\n') { line++; col = 0; } else { col++; }
      i++;
      continue;
    }

    // 找到 > 结束
    const closeAngle = html.indexOf('>', i + 1);
    if (closeAngle === -1) {
      errors.push({ line, col, msg: 'Unclosed < at line ' + line });
      break;
    }

    const tagText = html.substring(i, closeAngle + 1);
    // 解析标签名
    const tagMatch = tagText.match(/^<\/?\s*(\w+)/);
    if (!tagMatch) {
      // 不像标签，跳过
      col += tagText.length;
      i = closeAngle + 1;
      continue;
    }
    const tagName = tagMatch[1].toLowerCase();
    const isClosing = tagText.startsWith('</');
    const isSelfClosing = tagText.endsWith('/>') || VOID_ELEMENTS.has(tagName);

    if (inScript || inStyle) {
      // script/style 块内的标签忽略
      col += tagText.length;
      i = closeAngle + 1;
      continue;
    }

    if (isSelfClosing && !isClosing) {
      // void 或自闭合，不入栈
    } else if (isClosing) {
      // 闭标签
      if (stack.length === 0) {
        errors.push({ line, col, msg: 'Closing </' + tagName + '> but stack is empty' });
      } else if (stack[stack.length - 1].tag !== tagName) {
        const top = stack[stack.length - 1];
        errors.push({
          line, col,
          msg: 'Closing </' + tagName + '> but top of stack is <' + top.tag + '> (opened at line ' + top.line + ')'
        });
        // 尝试从栈中找到匹配的标签
        const idx = stack.findIndex(s => s.tag === tagName);
        if (idx >= 0) {
          // 把中间的标签都报告为未闭合
          for (let k = stack.length - 1; k > idx; k--) {
            errors.push({
              line, col,
              msg: 'Unclosed <' + stack[k].tag + '> opened at line ' + stack[k].line
            });
          }
          stack.length = idx;
        }
        stack.pop();
      } else {
        stack.pop();
      }
    } else {
      // 开标签
      stack.push({ tag: tagName, line });
    }

    col += tagText.length;
    i = closeAngle + 1;
  }

  // 结束时栈内未闭合的
  for (const item of stack) {
    errors.push({ line: item.line, col: 0, msg: 'Unclosed <' + item.tag + '> at end of file' });
  }

  return errors;
}

// 检测控制字符和非法字符（HTML 不允许的 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F）
function findInvalidChars(filePath) {
  if (!existsSync(filePath)) return [];
  const html = readFileSync(filePath, 'utf8');
  const buf = Buffer.from(html, 'utf8');
  const errors = [];
  let line = 1;
  let col = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0A) { line++; col = 0; continue; }
    if (b < 0x09 || (b > 0x0D && b < 0x20) || b === 0x7F) {
      errors.push({ line, col, code: b, char: '\\x' + b.toString(16).padStart(2, '0') });
    }
    col++;
  }
  return errors;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: checker.mjs <html_file> [html_file ...]');
  process.exit(1);
}

let totalErrors = 0;
for (const filePath of args) {
  const tagErrors = checkHtml(filePath);
  const charErrors = findInvalidChars(filePath);
  const allErrors = tagErrors.length + charErrors.length;
  if (allErrors === 0) {
    console.log('✓ ' + filePath + ': OK');
  } else {
    console.log('✗ ' + filePath + ': ' + allErrors + ' issue(s)');
    for (const e of tagErrors) {
      console.log('  [tag] line ' + e.line + ':' + e.col + ' ' + e.msg);
    }
    for (const e of charErrors) {
      console.log('  [char] line ' + e.line + ':' + e.col + ' invalid control byte 0x' + e.code.toString(16));
    }
    totalErrors += allErrors;
  }
}
process.exit(totalErrors > 0 ? 1 : 0);