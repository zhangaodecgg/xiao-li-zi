#!/usr/bin/env node
/**
 * 工程名词卡片墙 · 数据校验器（跨项目版）
 *
 *   node check.js                      # 自动找当前目录下的卡片墙
 *   node check.js <卡片墙.html>        # 指定文件
 *
 * 检查 CARDS / EXTRA / DEEP / DEEP_BODY 四张表是否对齐，
 * 以及「同族指向不存在的卡」「别名切成单字」这类会被页面静默吞掉的问题。
 * 有问题时退出码为 1。
 *
 * 用法见 SKILL.md「修改流程」一节：每次改完必须跑到 0 问题。
 */
const fs = require('fs');
const path = require('path');

/* ---------- 定位文件 ---------- */
function resolveFile() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const cands = [
    path.join(__dirname, '..', '工程名词卡片墙.html'),          // 放在 <仓库>/tools/ 时的标准布局
    path.join(process.cwd(), '工程名词卡片墙.html'),
    path.join(process.cwd(), 'xiao-li-zi', '工程名词卡片墙.html'),
    path.join(__dirname, '..', '..', '..', 'Desktop', '工作台输入内容库',
      '2026-10-16-19-19-01', '工程名词卡片墙.html'),            // 他这台的默认工作区
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  console.error('找不到卡片墙文件，请把路径作为第一个参数传进来。试过：\n  ' + cands.join('\n  '));
  process.exit(2);
}

const FILE = resolveFile();
const src = fs.readFileSync(FILE, 'utf8');

/** 从 HTML 里取出一个 const 的值（括号配对扫描，避开字符串里的括号） */
function pick(name) {
  const key = 'const ' + name + ' = ';
  const at = src.indexOf(key);
  if (at < 0) throw new Error('在 HTML 里找不到常量 ' + name + '（是不是被误删了？）');
  let i = at + key.length;
  while (/\s/.test(src[i])) i++;
  const open = src[i];
  if (open !== '{' && open !== '[') throw new Error(name + ' 的值不是对象或数组');
  const close = open === '{' ? '}' : ']';
  const start = i;
  let depth = 0, quote = null, escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return eval('(' + src.slice(start, i + 1) + ')');
    }
  }
  throw new Error(name + ' 没有找到配对的结束符');
}

const RINGS = pick('RINGS');
const SCENES = pick('SCENES');
const CARDS = pick('CARDS');
const DEEP = pick('DEEP');
const BODY = pick('DEEP_BODY');
const EXTRA = pick('EXTRA');
// ZH 是可选的（早期版本没有）。它里面的链接是运行时 push 进 DEEP 的，
// 静态扫 DEEP 一条都扫不到 —— 必须单独解析这个数组。
const ZH = /const ZH = \[/.test(src) ? pick('ZH') : null;

// NAME2IDX 是翻面逻辑的索引表 —— 曾经被误删导致"卡片点了没反应"，这里直接查它在不在
if (!/NAME2IDX/.test(src)) {
  console.error('❌ 致命：页面里找不到 NAME2IDX —— 翻面会抛 ReferenceError，卡片点了不会动。');
  process.exit(1);
}

const problems = [];
const warn = [];
const names = new Set();
const dup = [];

/* ---------- 1. CARDS 自身 ---------- */
CARDS.forEach((c, i) => {
  const tag = 'CARDS[' + i + '] ' + (c.n || '(无名)');
  if (!c.n) problems.push(tag + '：缺少 n（名字）');
  if (names.has(c.n)) dup.push(c.n);
  names.add(c.n);

  if (!(c.r in RINGS)) problems.push(tag + '：环号 r=' + c.r + ' 不在 RINGS 里');
  if (c.lv !== 'core' && c.lv !== 'adv') problems.push(tag + '：lv 只能是 core 或 adv，当前是 ' + c.lv);
  if (!c.d) problems.push(tag + '：缺少 d（一句话解释）');
  else if (c.d.length > 50) warn.push(tag + '：d 有 ' + c.d.length + ' 字，目标 ≤40 字（超过 50 就该砍）');
  if (!c.m) problems.push(tag + '：缺少 m（口诀）');
  else if (c.m.length > 18) warn.push(tag + '：口诀 ' + c.m.length + ' 字，目标 ≤12 字（超过 18 就该砍）');
  if (!Array.isArray(c.k)) problems.push(tag + '：k 应该是数组');
  (c.k || []).forEach(k => {
    if (!CARDS.some(x => x.n === k)) {
      problems.push(tag + '：同族「' + k + '」在 CARDS 里不存在，这个链接会点不动');
    }
  });
});
if (dup.length) problems.push('卡片名重复：' + [...new Set(dup)].join(', '));

/* ---------- 2. 四张表的键是否对齐 ---------- */
const cardNames = CARDS.map(c => c.n);
cardNames.forEach(n => {
  if (!DEEP[n]) problems.push(n + '：DEEP 里没有它（没有"去哪学"那一层）');
  if (!BODY[n]) problems.push(n + '：DEEP_BODY 里没有它（没有详细解读）');
  if (!EXTRA[n]) problems.push(n + '：EXTRA 里没有它（没有别名和六方向）');
});
[['DEEP', DEEP], ['DEEP_BODY', BODY], ['EXTRA', EXTRA]].forEach(([label, obj]) => {
  Object.keys(obj).forEach(k => {
    if (!cardNames.includes(k)) problems.push(label + ' 里多出一条「' + k + '」，但 CARDS 里没有这张卡');
  });
});

/* ---------- 3. DEEP 的内容 ---------- */
const TYPES = ['doc', 'cn', 'vid', 'paper', 'zh'];
Object.entries(DEEP).forEach(([n, d]) => {
  if (!d.why) warn.push(n + '：DEEP.why 为空（"为什么值得花时间"会空着）');
  if (!d.t1) problems.push(n + '：DEEP.t1 为空（"第一次上手"是必填）');
  if (!Array.isArray(d.s) || !d.s.length) problems.push(n + '：DEEP.s 至少要有一个链接');
  (d.s || []).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 4) problems.push(n + '：DEEP.s[' + i + '] 应该是 [类型, 标题, 链接, 说明] 四项');
    else {
      if (!TYPES.includes(x[0])) problems.push(n + '：DEEP.s[' + i + '] 类型「' + x[0] + '」不合法，只能是 ' + TYPES.join('/'));
      if (!/^https?:\/\//.test(x[2])) problems.push(n + '：DEEP.s[' + i + '] 链接不是 http(s) 开头');
    }
  });
  if (!Array.isArray(d.q) || !d.q.length) problems.push(n + '：DEEP.q 至少要有一个搜索词');
});

/* ---------- 4. DEEP_BODY 的内容 ---------- */
Object.entries(BODY).forEach(([n, b]) => {
  if (!Array.isArray(b.body) || b.body.length < 2) {
    problems.push(n + '：DEEP_BODY.body 至少要 2 段（一段讲不清"是什么"）');
  } else {
    b.body.forEach((p, i) => {
      if (typeof p !== 'string' || p.trim().length < 40) problems.push(n + '：body[' + i + '] 太短（少于 40 字）');
      if ((p.match(/\*\*/g) || []).length % 2) problems.push(n + '：body[' + i + '] 的 ** 没有成对');
      if ((p.match(/`/g) || []).length % 2) problems.push(n + '：body[' + i + '] 的反引号没有成对');
      if (/<\/?[a-z][a-z0-9]*>/i.test(p)) warn.push(n + '：body[' + i + '] 里疑似混入了 HTML 标签');
    });
  }
  if (!Array.isArray(b.trap) || !b.trap.length) problems.push(n + '：DEEP_BODY.trap 至少要有一条"最容易搞错的地方"');
  (b.trap || []).forEach((t, i) => {
    if (typeof t !== 'string' || !t.trim()) problems.push(n + '：trap[' + i + '] 是空的');
    else if ((t.match(/\*\*/g) || []).length % 2) problems.push(n + '：trap[' + i + '] 的 ** 没有成对');
  });
});

/* ---------- 5. EXTRA 的内容 ---------- */
Object.entries(EXTRA).forEach(([n, e]) => {
  if (!e.a) problems.push(n + '：EXTRA.a 为空（口语别名是"我听一句话"能否命中的关键）');
  else {
    // 页面只按逗号/分号切分别名，所以别名内部可以有空格（如 "Windows 里装 Linux"）。
    // 真正危险的是「切出来是单个字」——那会让任何含这个字的句子都误命中。
    const parts = e.a.split(/[,，;；]+/).map(x => x.trim()).filter(Boolean);
    if (!parts.length) problems.push(n + '：EXTRA.a 切完是空的');
    const tooShort = parts.filter(p => p.length < 2);
    if (tooShort.length) problems.push(n + '：别名太短（会误匹配，页面会自动忽略它）：' + tooShort.join(' / '));
    if (parts.length !== new Set(parts).size) problems.push(n + '：EXTRA.a 里有重复别名');
  }

  if (!Array.isArray(e.s) || e.s.length !== SCENES.length) {
    problems.push(n + '：EXTRA.s 应该是 ' + SCENES.length + ' 个分数，当前 ' + (e.s ? e.s.length : 0) + ' 个');
    return;
  }
  if (!Array.isArray(e.w) || e.w.length !== SCENES.length) {
    problems.push(n + '：EXTRA.w 应该和 s 等长（' + SCENES.length + ' 个），当前 ' + (e.w ? e.w.length : 0) + ' 个');
    return;
  }
  e.s.forEach((v, i) => {
    if (typeof v !== 'number' || v < 0 || v > 3) problems.push(n + '：EXTRA.s[' + i + '] 应该是 0~3 的整数');
    if (v >= 2 && !e.w[i]) problems.push(n + '：EXTRA.s[' + i + '] 给了分（' + v + '），但 w[' + i + '] 没写理由——卡片上会空一格');
  });
  if (e.s.filter(v => v >= 2).length === 0) problems.push(n + '：六个方向一个都没到 2 分，按方向筛选时它会彻底消失');
});

/* ---------- 6. 文案里的卡数是否跟实际一致 ---------- */
// 卡数改过 66 → 67 → 102 三次，title / sub / foot / 倒查兜底文案里都残留过旧数字。
{
  const re = /(\d+)\s*(?:张卡|张可翻转|个名词|张卡里)/g;
  let m;
  const wrong = new Set();
  while ((m = re.exec(src))) {
    const v = Number(m[1]);
    if (v !== CARDS.length && v > 10 && v < 1000) wrong.add(v);
  }
  if (wrong.size) {
    warn.push('页面文案里出现了非当前卡数的数字：' + [...wrong].join(' / ') +
      '（当前 ' + CARDS.length + ' 张）——改过卡数就要全文 grep 一遍');
  }
}

/* ---------- 7. ZH（知乎 / 外部观点来源）---------- */
let zhHooks = 0;
if (Array.isArray(ZH)) {
  ZH.forEach((z, i) => {
    const tag = 'ZH[' + i + '] ' + (z.t || '(无题目)');
    if (!z.u || !/^https?:\/\//.test(z.u)) problems.push(tag + '：u 不是 http(s) 链接');
    if (!z.a) warn.push(tag + '：a（作者）为空');
    if (!z.w) warn.push(tag + '：w 为空（弹层里"为什么对你有用"会空着）');
    if (!Array.isArray(z.k) || !z.k.length) problems.push(tag + '：k 为空，这条来源挂不到任何卡');
    (z.k || []).forEach(k => {
      if (!CARDS.some(c => c.n === k)) {
        // 页面里是 if (DEEP[k]) push —— 名字写错就被静默跳过，页面上完全看不出来
        problems.push(tag + '：要挂到「' + k + '」，但 CARDS 里没有这张卡（页面会静默跳过）');
      } else zhHooks++;
    });
  });
}

/* ---------- 输出 ---------- */
const ok = problems.length === 0;
console.log('卡片墙体检 · ' + path.basename(FILE) + '\n');
console.log('  卡片     ' + CARDS.length + ' 张');
console.log('  环       ' + Object.keys(RINGS).length + ' 档');
console.log('  方向     ' + SCENES.length + ' 个');
console.log('  链接     ' + Object.values(DEEP).reduce((s, d) => s + (d.s || []).length, 0) + ' 条');
console.log('  正文     ' + Object.values(BODY).reduce((s, b) => s + (b.body || []).join('').length, 0) + ' 字');
console.log('  方向理由 ' + Object.values(EXTRA).reduce((s, e) => s + (e.w || []).filter(Boolean).length, 0) + ' 条');
if (Array.isArray(ZH)) {
  console.log('  外部观点 ' + ZH.length + ' 篇 / 挂载 ' + zhHooks + ' 处（运行时注入，不在上面 302 条里）');
}
console.log('');

if (warn.length) {
  console.log('提醒（不阻塞）：');
  warn.forEach(w => console.log('  · ' + w));
  console.log('');
}
if (ok) {
  console.log('✅ 全部通过，数据对齐、可以提交了。');
  process.exit(0);
} else {
  console.log('❌ 发现 ' + problems.length + ' 个问题：');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
