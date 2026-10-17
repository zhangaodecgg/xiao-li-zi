#!/usr/bin/env node
/**
 * 卡片墙数据校验
 *
 *   node tools/check.js
 *
 * 检查 CARDS / DEEP / DEEP_BODY / EXTRA 四张表是否对齐，
 * 以及「同族指向不存在的卡」这类会被页面静默吞掉的问题。
 * 有问题时退出码为 1，方便接到 CI 里。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '工程名词卡片墙.html');
const src = fs.readFileSync(FILE, 'utf8');

/** 从 HTML 里取出一个 const 的值（括号配对扫描，避开字符串里的括号） */
function pick(name) {
  const key = 'const ' + name + ' = ';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('在 HTML 里找不到常量 ' + name);
  i += key.length;
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

  if (!(c.r in RINGS) && !RINGS[c.r]) problems.push(tag + '：环号 r=' + c.r + ' 不在 RINGS 里');
  if (c.lv !== 'core' && c.lv !== 'adv') problems.push(tag + '：lv 只能是 core 或 adv，当前是 ' + c.lv);
  if (!c.d) problems.push(tag + '：缺少 d（一句话解释）');
  if (!c.m) problems.push(tag + '：缺少 m（口诀）');
  if (!Array.isArray(c.k)) problems.push(tag + '：k 应该是数组');
  (c.k || []).forEach(k => {
    if (!names.has(k) && !CARDS.some(x => x.n === k)) {
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
      const star = (p.match(/\*\*/g) || []).length;
      if (star % 2) problems.push(n + '：body[' + i + '] 的 ** 没有成对');
      const bt = (p.match(/`/g) || []).length;
      if (bt % 2) problems.push(n + '：body[' + i + '] 的反引号没有成对');
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

/* ---------- 输出 ---------- */
const ok = problems.length === 0;
console.log('卡片墙体检\n');
console.log('  卡片     ' + CARDS.length + ' 张');
console.log('  环       ' + Object.keys(RINGS).length + ' 档');
console.log('  方向     ' + SCENES.length + ' 个');
console.log('  链接     ' + Object.values(DEEP).reduce((s, d) => s + (d.s || []).length, 0) + ' 条');
console.log('  正文     ' + Object.values(BODY).reduce((s, b) => s + (b.body || []).join('').length, 0) + ' 字\n');

if (warn.length) {
  console.log('提醒（不阻塞）：');
  warn.forEach(w => console.log('  · ' + w));
  console.log('');
}
if (ok) {
  console.log('✅ 全部通过，可以提 PR 了。');
  process.exit(0);
} else {
  console.log('❌ 发现 ' + problems.length + ' 个问题：');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
