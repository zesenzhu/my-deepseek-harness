#!/usr/bin/env node
/**
 * 探查本机真实安装的 DeepSeek Harness（只读，不启动服务、不改任何配置）
 *
 * 用法:
 *   node scripts/inspect-real-dsh.mjs            # 概览
 *   node scripts/inspect-real-dsh.mjs --patch    # 打印 profile patch 的条目表
 *   node scripts/inspect-real-dsh.mjs --sessions # 统计会话日志的事件类型（不打印内容）
 *
 * 这个脚本存在的意义：让你用"自己机器上的真实数据"验证 docs/07 里讲的
 * profile / bundle / patch 分层，而不是只读二手文档。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const HOME = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
const args = new Set(process.argv.slice(2));

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exitCode = 1;
}

if (!fs.existsSync(HOME)) {
  fail(`找不到 DSH home: ${HOME}\n   如果你没装 DeepSeek Harness，这个脚本没有可探查的对象。`);
  process.exit();
}

console.log(bold('\n🔎 DeepSeek Harness 本机运行时探查'));
console.log(dim(`   DSH home: ${HOME}\n`));

// ---------------------------------------------------------------- profiles
const profilesDir = path.join(HOME, 'profiles');
const profiles = fs.existsSync(profilesDir)
  ? fs.readdirSync(profilesDir).filter((d) => fs.statSync(path.join(profilesDir, d)).isDirectory())
  : [];

console.log(bold('1) 已安装的 profile'));
if (profiles.length === 0) console.log(dim('   (无)'));
for (const name of profiles) {
  const pkgPath = path.join(profilesDir, name, 'package.json');
  let bundles = [];
  let deps = 0;
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    bundles = pkg?.dsh?.profile?.bundles ?? [];
    deps = Object.keys(pkg.dependencies ?? {}).length;
  }
  console.log(`   ${cyan(name)}  组合包: ${bundles.join(' → ') || '(无)'}   ${dim(`树外依赖: ${deps}`)}`);
}

// ---------------------------------------------------------------- patch layers
if (args.has('--patch') || args.size === 0) {
  const name = profiles[0];
  if (name) {
    const patchFile = path.join(profilesDir, name, 'cordis.patch.yml');
    console.log(bold(`\n2) profile '${name}' 的 patch 层（用户自选的覆盖配置）`));
    if (!fs.existsSync(patchFile)) {
      console.log(dim('   (没有 cordis.patch.yml)'));
    } else {
      const text = fs.readFileSync(patchFile, 'utf8');
      // 只做语义级提取（不解析完整 YAML，避免引入依赖）
      const entries = [...text.matchAll(/- id:\s*(\S+)\s*\n\s*name:\s*"([^"]+)"/g)].map((m) => ({
        id: m[1],
        name: m[2],
      }));
      console.log(dim(`   ${patchFile}`));
      console.log(dim(`   共 ${entries.length} 条 patch 条目（按 id 定位，替换该条目的整个 config）`));
      if (args.has('--patch')) {
        for (const e of entries) console.log(`   • ${yellow(e.id.padEnd(28))} ${e.name}`);
      } else {
        for (const e of entries.slice(0, 8)) console.log(`   • ${yellow(e.id.padEnd(28))} ${e.name}`);
        if (entries.length > 8) console.log(dim(`   … 其余 ${entries.length - 8} 条用 --patch 查看`));
      }
      const modelLine = text.match(/- id:\s*agent-default-model\s*\n\s*name:\s*\S+\s*\n\s*config:\s*\n\s*provider:\s*(\S+)\s*\n\s*model:\s*(\S+)/);
      if (modelLine) {
        console.log(green(`\n   ↳ 当前默认模型来自 patch: provider=${modelLine[1]} model=${modelLine[2]}`));
      }
    }
  }
}

// ---------------------------------------------------------------- sessions
if (args.has('--sessions') || args.size === 0) {
  console.log(bold('\n3) 会话日志（真实格式）'));
  const sessionsRoot = path.join(HOME, 'sessions');
  if (!fs.existsSync(sessionsRoot)) {
    console.log(dim('   (还没有会话)'));
  } else {
    const files = [];
    for (const ws of fs.readdirSync(sessionsRoot)) {
      const wsPath = path.join(sessionsRoot, ws);
      if (!fs.statSync(wsPath).isDirectory()) continue;
      for (const s of fs.readdirSync(wsPath)) {
        const dir = path.join(wsPath, s);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith('session.') && f.endsWith('.jsonl.zstd')) files.push(path.join(dir, f));
        }
      }
    }

    console.log(`   共 ${files.length} 个会话日志文件`);
    if (files.length > 0) {
      const sample = files[files.length - 1];
      console.log(dim(`   样本: ${path.relative(HOME, sample)}`));
      try {
        const raw = zlib.zstdDecompressSync(fs.readFileSync(sample)).toString('utf8');
        const lines = raw.split('\n').filter(Boolean);
        const types = new Map();
        let header = null;
        for (const line of lines) {
          const obj = JSON.parse(line);
          if (!header) header = obj;
          const t = obj.type ?? '(无 type)';
          types.set(t, (types.get(t) ?? 0) + 1);
        }
        if (header) {
          console.log(`   文件头字段: ${Object.keys(header).join(', ')}`);
          console.log(dim(`   version=${header.version} agentPreset=${header.agentPreset} delegationDepth=${header.delegationDepth}`));
        }
        console.log(`   事件行数: ${lines.length}`);
        for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) {
          console.log(`     ${t.padEnd(24)} ${n}`);
        }
        console.log(dim('   （只读统计，不打印任何会话内容）'));
      } catch (err) {
        console.log(dim(`   无法解析样本: ${err.message}`));
      }
    }
  }
}

console.log(bold('\n4) 想看到完整的插件树？'));
console.log('   真实 CLI 支持 `dsh --profile web --dump-config`（会把叠加 patch 后生效的完整配置树打印出来）。');
console.log(dim('   本机桌面版把运行时打包在 app.asar 内，没有暴露 dsh 可执行文件；'));
console.log(dim('   但上面的 profile/patch/会话日志已经是同一套机制的落盘结果。'));
console.log();
