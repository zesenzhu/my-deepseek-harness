#!/usr/bin/env node
/**
 * 重置演示工作区：把 src/calculator.buggy.js 复制回 src/calculator.js
 *
 * Agent 演示会真的修改 workspace/src/calculator.js，跑完必须复位，
 * 否则第二次运行时"Bug 已经被修好了"，演示就失去意义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', 'workspace');
const baseline = path.join(workspace, 'src', 'calculator.buggy.js');
const target = path.join(workspace, 'src', 'calculator.js');
const logFile = path.join(workspace, 'run.log');

if (!fs.existsSync(baseline)) {
  console.error(`[reset-workspace] 基线文件不存在: ${baseline}`);
  process.exit(1);
}

fs.copyFileSync(baseline, target);
if (fs.existsSync(logFile)) fs.rmSync(logFile);

console.log(`[reset-workspace] ✅ 已复位 ${path.relative(process.cwd(), target)}（含 2 个故意埋设的 Bug）`);
