import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DeepSeekHarness } from '../src/core/harness.js';
import { MemorySessionStore } from '../src/core/session.js';
import { PolicyEngine } from '../src/core/policy.js';
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js';
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js';
import { RealFSToolsPlugin } from '../src/plugins/tools/real-fs-tools.js';
import { SandboxGuardPlugin } from '../src/plugins/guardrails/sandbox-guard.js';
import type { ModelAdapter, Plugin, ToolDefinition } from '../src/core/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const workspace = path.join(root, 'workspace');

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${err?.message ?? err}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  console.log('🧪 DeepSeek Harness Study — 测试套件');

  // =========================================================
  section('1) 策略引擎语义');
  // =========================================================

  await test('deny 会短路，后面的规则不再执行', async () => {
    const engine = new PolicyEngine();
    let secondRan = false;
    engine.use({ name: 'a', check: () => ({ decision: 'deny', reason: 'nope' }) });
    engine.use({
      name: 'b',
      check: () => {
        secondRan = true;
        return { decision: 'allow' };
      },
    });
    const verdict = await engine.check({ id: 'x', name: 't', args: {} });
    assert.equal(verdict.decision, 'deny');
    assert.equal(secondRan, false);
  });

  await test('ask 且没有审批器时失败关闭（按 deny 处理）', async () => {
    const engine = new PolicyEngine();
    engine.use({ name: 'needs-approval', check: () => ({ decision: 'ask', reason: 'risky' }) });
    const verdict = await engine.check({ id: 'x', name: 't', args: {} });
    assert.equal(verdict.decision, 'deny');
    assert.equal((verdict as any).code, 'APPROVAL_UNAVAILABLE');
  });

  await test('ask 且审批器批准时放行', async () => {
    const engine = new PolicyEngine({ approvalHandler: async () => true });
    engine.use({ name: 'needs-approval', check: () => ({ decision: 'ask', reason: 'risky' }) });
    const verdict = await engine.check({ id: 'x', name: 't', args: {} });
    assert.equal(verdict.decision, 'allow');
  });

  await test('规则抛异常时失败关闭', async () => {
    const engine = new PolicyEngine();
    engine.use({
      name: 'boom',
      check: () => {
        throw new Error('rule crashed');
      },
    });
    const verdict = await engine.check({ id: 'x', name: 't', args: {} });
    assert.equal(verdict.decision, 'deny');
    assert.match((verdict as any).reason, /failed closed/);
  });

  // =========================================================
  section('2) 工具注册表：被拒绝的工具绝不执行');
  // =========================================================

  await test('deny 时工具副作用不会发生，并返回失败结果', async () => {
    const harness = new DeepSeekHarness();
    let executed = false;
    harness.ctx.get('tools')!.register({
      name: 'probe',
      description: 'test probe',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        executed = true;
        return { success: true, output: 'ran' };
      },
    });
    harness.ctx.get('policies')!.use({
      name: 'deny-probe',
      check: () => ({ decision: 'deny', reason: 'probe is banned', code: 'DANGEROUS_COMMAND' }),
    });

    const result = await harness.ctx.get('tools')!.execute({ id: '1', name: 'probe', args: {} }, harness.ctx);
    assert.equal(executed, false, '工具不应被执行');
    assert.equal(result.success, false);
    assert.match(result.error!, /Policy Denied/);
    assert.equal(result.metadata?.denied, true);
  });

  await test('allow 时工具正常执行并触发事件', async () => {
    const harness = new DeepSeekHarness();
    const seen: string[] = [];
    harness.ctx.on('tool:after_call', () => {
      seen.push('after');
    });
    harness.ctx.get('tools')!.register({
      name: 'ok_tool',
      description: 'ok',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ success: true, output: 'ok' }),
    });
    const result = await harness.ctx.get('tools')!.execute({ id: '1', name: 'ok_tool', args: {} }, harness.ctx);
    assert.equal(result.success, true);
    assert.deepEqual(seen, ['after']);
  });

  // =========================================================
  section('3) 沙箱守卫：真实路径与命令（回归测试）');
  // =========================================================

  const buildGuarded = () => {
    const harness = new DeepSeekHarness();
    harness
      .use(SandboxGuardPlugin, { workspaceDir: workspace })
      .use(RealFSToolsPlugin, { workspaceDir: workspace });
    return harness;
  };

  await test('路径穿越 ../escape-proof.txt 被拒绝，且文件未被写出', async () => {
    const harness = buildGuarded();
    const escapeTarget = path.join(root, 'escape-proof.txt');
    if (fs.existsSync(escapeTarget)) fs.rmSync(escapeTarget);

    const result = await harness.ctx.get('tools')!.execute(
      { id: 'e1', name: 'real_file_write', args: { path: '../escape-proof.txt', content: 'pwned' } },
      harness.ctx,
    );

    assert.equal(result.success, false, '越界写入必须失败');
    assert.match(result.error!, /PATH_ESCAPE|Policy Denied/);
    assert.equal(fs.existsSync(escapeTarget), false, '文件绝不能被写到工作区外');
  });

  await test('危险命令 rm -rf / 被拒绝，且不会启动子进程', async () => {
    const harness = buildGuarded();
    const result = await harness.ctx.get('tools')!.execute(
      { id: 'e2', name: 'real_bash_run', args: { command: 'rm -rf /' } },
      harness.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error!, /DANGEROUS_COMMAND|Policy Denied/);
  });

  await test('命令不在白名单（例如 curl）被拒绝', async () => {
    const harness = buildGuarded();
    const result = await harness.ctx.get('tools')!.execute(
      { id: 'e3', name: 'real_bash_run', args: { command: 'curl http://example.com' } },
      harness.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error!, /COMMAND_NOT_ALLOWED|Policy Denied/);
  });

  await test('工作区内的合法命令仍然能跑（node test.js）', async () => {
    const harness = buildGuarded();
    const result = await harness.ctx.get('tools')!.execute(
      { id: 'e4', name: 'real_bash_run', args: { command: 'node --version' } },
      harness.ctx,
    );
    assert.equal(result.success, true, result.error);
    assert.match(result.output, /^v\d+\./);
  });

  await test('受保护文件 .env 不可读', async () => {
    const harness = buildGuarded();
    const result = await harness.ctx.get('tools')!.execute(
      { id: 'e5', name: 'real_file_read', args: { path: '.env' } },
      harness.ctx,
    );
    assert.equal(result.success, false);
    assert.match(result.error!, /PROTECTED_PATH|Policy Denied/);
  });

  await test('符号链接指向工作区外时被拒绝', async () => {
    const harness = buildGuarded();
    const linkPath = path.join(workspace, 'escape-link');
    // 注意：符号链接必须用 unlink 删除，rmSync 会抛 ERR_FS_EISDIR
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false })) {
      fs.unlinkSync(linkPath);
    }
    fs.symlinkSync('/etc', linkPath);

    try {
      const result = await harness.ctx.get('tools')!.execute(
        { id: 'e6', name: 'real_file_read', args: { path: 'escape-link/hosts' } },
        harness.ctx,
      );
      assert.equal(result.success, false);
      assert.match(result.error!, /PATH_ESCAPE|Policy Denied/);
    } finally {
      if (fs.lstatSync(linkPath, { throwIfNoEntry: false })) fs.unlinkSync(linkPath);
    }
  });

  // =========================================================
  section('4) 会话事件溯源');
  // =========================================================

  await test('事件不可变、可回放、可分叉', () => {
    const store = new MemorySessionStore('t1');
    const e1 = store.append({ type: 'USER_PROMPT', payload: { objective: 'x' } });
    store.append({ type: 'AGENT_THOUGHT', payload: { thought: 'y' } });
    store.append({ type: 'TASK_COMPLETED', payload: { summary: 'z' } });

    assert.equal(store.getEvents().length, 3);
    assert.ok(Object.isFrozen(e1), '事件对象必须被冻结');

    const copy = store.getEvents();
    copy.push({ ...e1 });
    assert.equal(store.getEvents().length, 3, 'getEvents 必须返回副本');

    const branch = store.branch(e1.id);
    assert.equal(branch.getEvents().length, 1);
    assert.notEqual(branch.id, store.id);

    const parsed = JSON.parse(store.exportJSON());
    assert.equal(parsed.totalEvents, 3);
  });

  // =========================================================
  section('5) ReAct 循环：死循环熔断');
  // =========================================================

  await test('连续相同工具调用会被熔断，而不是烧完所有步数', async () => {
    const harness = new DeepSeekHarness();
    const loopingModel: Plugin = (ctx) => {
      const adapter: ModelAdapter = {
        name: 'looping-model',
        generate: async () => ({
          thought: 'again',
          toolCalls: [{ id: 'same', name: 'file_read', args: { path: 'src/auth.js' } }],
        }),
      };
      ctx.provide('model', adapter);
    };

    harness.use(loopingModel).use(FileToolsPlugin).use(ReActLoopPlugin, { repeatLimit: 2 });
    const result = await harness.run('loop test', { verbose: false, maxSteps: 8 });

    assert.equal(result.success, false);
    assert.match(result.summary, /死循环|熔断/);
    assert.ok(result.stepsCount < 8, `应提前熔断，实际步数 ${result.stepsCount}`);
  });

  // =========================================================
  section('6) 端到端：真实失败 → 真实修复 → 真实通过');
  // =========================================================

  await test('示例 05 真实执行闭环（含真实 node test.js）', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'examples/05_real_workspace_agent.ts')], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, `示例 05 退出码 ${run.status}\n${output.slice(-1500)}`);
    assert.match(output, /成功: true/);

    // 复位工作区，保证下次演示仍然有 Bug 可修
    fs.copyFileSync(
      path.join(workspace, 'src', 'calculator.buggy.js'),
      path.join(workspace, 'src', 'calculator.js'),
    );
  });

  // =========================================================
  console.log(`\n${failed === 0 ? '✅' : '❌'} 测试完成: ${passed} 通过, ${failed} 失败`);
  if (failures.length > 0) {
    console.log(`失败用例: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
