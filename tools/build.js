/**
 * 生成发布用的 ASCII 文件副本。
 *
 * 为什么需要：线上链接里带中文文件名会变成一长串 %E5%B7%A5%E7%A8%8B...，
 * 分享出去难看，个别环境还会编码出错。所以主文件保留中文名（仓库里可读性好），
 * 发布时复制一份 ASCII 名的。
 *
 * 用法：node tools/build.js
 * 每次改完 工程名词卡片墙.html / 工程广度地图.html 之后跑一次。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pairs = [
  ['工程名词卡片墙.html', 'cardwall.html'],
  ['工程广度地图.html', 'map.html'],
];

let ok = 0;
for (const [src, dst] of pairs) {
  const s = path.join(root, src);
  const d = path.join(root, dst);
  if (!fs.existsSync(s)) {
    console.log(`!! 找不到源文件 ${src}`);
    continue;
  }
  const before = fs.existsSync(d) ? fs.readFileSync(d) : null;
  const buf = fs.readFileSync(s);
  if (before && before.equals(buf)) {
    console.log(`=  ${dst} 无变化`);
    ok++;
    continue;
  }
  fs.writeFileSync(d, buf);
  console.log(`✓  ${src} → ${dst}  (${(buf.length / 1024).toFixed(0)} KB)`);
  ok++;
}

// 索引页里引用的两个文件名必须真的存在，否则评委点进去是 404
const idx = path.join(root, 'index.html');
if (fs.existsSync(idx)) {
  const html = fs.readFileSync(idx, 'utf8');
  const refs = [...html.matchAll(/href="([^"#]+\.html)"/g)].map(m => m[1]);
  const miss = [...new Set(refs)].filter(r => !fs.existsSync(path.join(root, r)));
  if (miss.length) {
    console.log('!! index.html 引用了不存在的文件: ' + miss.join(', '));
    process.exit(1);
  }
  console.log('✓  index.html 的 ' + new Set(refs).size + ' 个站内链接全部存在');
}

if (ok === 0) process.exit(1);
console.log('\n构建完成，可以发布。');
