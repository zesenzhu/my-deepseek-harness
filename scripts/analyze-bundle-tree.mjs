#!/usr/bin/env node
/**
 * 分析真实组合包（bundle）的配置树
 *
 * 数据来自 fixtures/real-dsh/*.yml —— 从 npm 上原样取回的官方发行物。
 * 不依赖任何 YAML 库：这里的结构足够规整，用行级状态机就能准确解析。
 *
 * 用法:
 *   node scripts/analyze-bundle-tree.mjs            # 摘要
 *   node scripts/analyze-bundle-tree.mjs --rows     # 列出所有条目
 *   node scripts/analyze-bundle-tree.mjs --web      # 只看 web-app 层的覆盖/插入
 *   node scripts/analyze-bundle-tree.mjs --json     # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.join(root, 'fixtures', 'real-dsh');
const args = new Set(process.argv.slice(2));

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s) => `\x1b[35m${s}\x1b[0m`;

/** 行级状态机解析 cordis.patch.yml */
function parsePatchYaml(text) {
  const rows = [];
  let mode = 'top';
  let cur = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    if (/^- insert:\s*$/.test(line)) {
      mode = 'insert';
      cur = null;
      continue;
    }

    // 顶层条目：- id: xxx（col 0）
    const topRow = /^- id:\s*(\S+)\s*$/.exec(line);
    if (topRow) {
      mode = 'top';
      cur = { id: topRow[1], action: 'override', name: null };
      rows.push(cur);
      continue;
    }

    if (mode === 'insert') {
      const insRow = /^ {4}- id:\s*(\S+)\s*$/.exec(line);
      if (insRow) {
        cur = { id: insRow[1], action: 'insert', name: null };
        rows.push(cur);
        continue;
      }
      const insName = /^ {6}name:\s*'([^']+)'/.exec(line);
      if (insName && cur) {
        cur.name = insName[1];
        continue;
      }
    } else if (cur) {
      if (/^ {2}disabled:\s*true/.test(line)) {
        cur.action = 'disable';
        continue;
      }
      const topName = /^ {2}name:\s*'([^']+)'/.exec(line);
      if (topName) cur.name = topName[1];
    }
  }
  return rows;
}

/** 把包名归类到"领域"，用于看清插件树的分区 */
function domainOf(pkg) {
  const name = (pkg ?? '').replace('@deepseek-ai/', '');
  const ordered = [
    'client-ui',
    'client',
    'cordis-plugin',
    'tool',
    'session',
    'llm',
    'api',
    'command',
    'compaction',
    'skill',
    'subagent',
    'sandbox',
    'storage',
    'web',
    'host',
    'fs',
    'agent',
    'terminal',
    'bash',
    'pwsh',
    'shell',
    'job',
    'schedule',
    'spill',
    'goal',
    'plan',
    'workflow',
    'ptc',
    'typert',
    'mcp',
    'acp',
    'sdk',
    'otel',
    'telemetry',
    'credential',
    'settings',
    'home',
    'util',
    'launch',
  ];
  const stripped = name.replace(/^dsh-/, '');
  for (const d of ordered) if (stripped === d || stripped.startsWith(`${d}-`)) return d;
  return stripped.split('-')[0] || '(unknown)';
}

const layers = [
  { file: 'base.cordis.patch.yml', label: '@deepseek-ai/dsh-base' },
  { file: 'web-app.cordis.patch.yml', label: '@deepseek-ai/dsh-web-app' },
  { file: 'base.windows.cordis.patch.yml', label: '+ windows 覆盖层' },
].filter((l) => fs.existsSync(path.join(dir, l.file)));

if (layers.length === 0) {
  console.error('❌ 找不到 fixtures/real-dsh/*.yml，请先运行 node scripts/fetch-real-bundles.mjs');
  process.exit(1);
}

const parsed = layers.map((l) => ({
  ...l,
  rows: parsePatchYaml(fs.readFileSync(path.join(dir, l.file), 'utf8')),
}));

if (args.has('--json')) {
  console.log(JSON.stringify(parsed.map((p) => ({ layer: p.label, rows: p.rows })), null, 2));
  process.exit(0);
}

console.log(bold('\n🧬 真实 DSH 组合包配置树分析'));
console.log(dim(`   数据源: fixtures/real-dsh/  (npm @deepseek-ai/dsh-base + dsh-web-app, 0.0.1-rc.1)\n`));

// ---- 每层统计 ----
console.log(bold('1) 每一层做了什么'));
let totalRows = 0;
for (const layer of parsed) {
  const counts = { insert: 0, override: 0, disable: 0 };
  for (const r of layer.rows) counts[r.action]++;
  totalRows += layer.rows.length;
  console.log(
    `   ${cyan(layer.label.padEnd(30))} ` +
      `插入 ${String(counts.insert).padStart(2)}  ` +
      `覆盖 ${String(counts.override).padStart(2)}  ` +
      `禁用 ${String(counts.disable).padStart(2)}  ` +
      dim(`共 ${layer.rows.length} 行`),
  );
}
console.log(dim(`   合计 ${totalRows} 行配置（注意：npm 上这个发行版的依赖有 329 个包，但一棵树只挂载其中一部分）`));

// ---- 领域分布 ----
const baseRows = parsed[0].rows.filter((r) => r.name);
const webRows = parsed[1]?.rows ?? [];
const allInserted = [...parsed.flatMap((p) => p.rows.filter((r) => r.action === 'insert' && r.name))];

const byDomain = new Map();
for (const r of allInserted) {
  const d = domainOf(r.name);
  byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
}
const sorted = [...byDomain].sort((a, b) => b[1] - a[1]);

console.log(bold('\n2) 插件树的领域分布（按挂载条目数）'));
const max = sorted[0]?.[1] ?? 1;
for (const [d, n] of sorted) {
  const bar = '█'.repeat(Math.max(1, Math.round((n / max) * 28)));
  console.log(`   ${d.padEnd(16)} ${String(n).padStart(3)}  ${magenta(bar)}`);
}

// ---- web 层对 base 的改动 ----
if (webRows.length > 0) {
  const overrides = webRows.filter((r) => r.action === 'override');
  const disables = webRows.filter((r) => r.action === 'disable');
  const inserts = webRows.filter((r) => r.action === 'insert');

  console.log(bold('\n3) web-app 层如何改造 base 层'));
  console.log(dim('   这正是"层"的价值：同一个包，不同 profile 通过 patch 得到不同行为。'));
  if (disables.length) {
    console.log(`   禁用: ${disables.map((r) => yellow(r.id)).join(', ')}`);
  }
  if (inserts.length) {
    console.log(`   新增 ${inserts.length} 个条目，例如: ${inserts.slice(0, 6).map((r) => cyan(r.name.replace('@deepseek-ai/', ''))).join(', ')}…`);
  }
  if (overrides.length) {
    console.log(`   覆盖 ${overrides.length} 个已有条目:`);
    for (const r of overrides) console.log(`     • ${yellow(r.id)}`);
  }
}

// ---- 全部条目 ----
if (args.has('--rows') || args.has('--web')) {
  console.log(bold('\n4) 条目明细'));
  for (const layer of parsed) {
    if (args.has('--web') && !layer.label.includes('web-app')) continue;
    console.log(`\n   ${cyan(layer.label)}`);
    for (const r of layer.rows) {
      const tag =
        r.action === 'insert' ? dim('insert ') : r.action === 'disable' ? '\x1b[31mdisable\x1b[0m' : yellow('override');
      console.log(`   ${tag} ${r.id.padEnd(30)} ${dim((r.name ?? '(继承 base 的包)').replace('@deepseek-ai/', ''))}`);
    }
  }
}

console.log(bold('\n5) 读这份数据时该注意什么'));
console.log('   • 行序不代表加载顺序：base 的注释明确写了「Row order carries no load semantics」，');
console.log('     激活与否由"服务是否可用（service-availability）"决定。');
console.log('   • 一个 patch 替换目标行的**整个 config**，不是深合并，所以每行都要把自己的键写全。');
console.log('   • 同一行可以被多层依次覆盖：bundle → 用户 cordis.patch.yml → --patch overlay，后者赢。');
console.log(dim('   完整语义见 docs/08_real_bundle_tree.md。\n'));
