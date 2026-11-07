#!/usr/bin/env node
/**
 * 重新拉取真实组合包配置到 fixtures/real-dsh/
 *
 * 只下载三个小包（各 10~20KB），不会安装 329 个依赖，也不会改动你的 ~/.dsh。
 * 缓存写在工作区内的 .tmp/npm-cache，避免污染全局 npm 缓存。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tmp = path.join(root, '.tmp');
const packs = path.join(tmp, 'packs');
const out = path.join(root, 'fixtures', 'real-dsh');

const PACKAGES = [
  { name: '@deepseek-ai/dsh-base', dir: 'base', files: ['cordis.patch.yml', 'windows.cordis.patch.yml'] },
  { name: '@deepseek-ai/dsh-web-app', dir: 'web', files: ['cordis.patch.yml'] },
];

fs.mkdirSync(packs, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const env = { ...process.env, npm_config_cache: path.join(tmp, 'npm-cache') };

console.log('📦 正在下载真实组合包（仅配置文件，不安装依赖）...');
const packOut = execFileSync('npm', ['pack', ...PACKAGES.map((p) => p.name), '--pack-destination', packs], {
  cwd: root,
  env,
  encoding: 'utf8',
});
const tarballs = packOut
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.endsWith('.tgz'));

for (const pkg of PACKAGES) {
  const tgz = tarballs.find((t) => t.includes(pkg.name.split('/')[1]));
  if (!tgz) {
    console.warn(`⚠️  没找到 ${pkg.name} 的 tarball，跳过`);
    continue;
  }
  const dir = path.join(packs, pkg.dir);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['xzf', path.join(packs, tgz), '-C', dir, '--strip-components=1'], { cwd: root });

  for (const file of pkg.files) {
    const src = path.join(dir, file);
    if (!fs.existsSync(src)) continue;
    const prefix = file.startsWith('windows') ? '' : `${pkg.dir === 'base' ? 'base' : 'web-app'}.`;
    const destName =
      pkg.dir === 'base'
        ? file.startsWith('windows')
          ? 'base.windows.cordis.patch.yml'
          : 'base.cordis.patch.yml'
        : 'web-app.cordis.patch.yml';
    fs.copyFileSync(src, path.join(out, destName));
    console.log(`  ✓ ${pkg.name} → fixtures/real-dsh/${destName}`);
    void prefix;
  }
}

// 记录校验和
const files = fs.readdirSync(out).filter((f) => f.endsWith('.yml')).sort();
console.log('\nSHA-256:');
for (const f of files) {
  const hash = execFileSync('shasum', ['-a', '256', path.join(out, f)], { encoding: 'utf8' }).split(' ')[0];
  console.log(`  ${hash}  ${f}`);
}
console.log('\n完成。下一步: node scripts/analyze-bundle-tree.mjs');
