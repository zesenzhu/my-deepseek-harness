import { DeepSeekHarness } from '../src/core/harness.js';
import { Context, Plugin, PolicyDenyCode, PolicyService, ToolRegistry } from '../src/core/types.js';
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js';
import { DeepSeekModelPlugin } from '../src/plugins/models/deepseek-adapter.js';
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js';
import { TerminalToolsPlugin } from '../src/plugins/tools/terminal-tools.js';

/**
 * 示例 2: 开发并挂载自定义插件（安全审计 + 遥测）
 *
 * ⚠️ 本示例修正了旧版一个重要错误：
 * 旧版把"拦截"写成 `ctx.on('tool:before_call', () => { throw ... })`。
 * 但 CoreContext.emit 为了不让一个监听器拖垮整条链路，会吞掉监听器异常 ——
 * 于是"守卫"只打了一行日志，工具照常执行，拦截形同虚设。
 *
 * 正确姿势（也是真实 DSH 的做法）：
 *   - 必须生效的准入控制 → 注册到 PolicyEngine，由 ToolRegistry.execute 在执行前强制裁决
 *   - 纯观察的日志/遥测   → 用 ctx.on(...) 事件
 */

interface SecurityGuardOptions {
  forbiddenFiles: string[];
}

const SecurityGuardPlugin: Plugin<SecurityGuardOptions> = (ctx: Context, options) => {
  const forbidden = options?.forbiddenFiles ?? [];
  const policies = ctx.get('policies') as PolicyService;

  console.log(`[Plugin Loaded] SecurityGuardPlugin 拦截列表: ${forbidden.join(', ')}`);

  // ---- 1. 准入控制：必须走策略裁决（deny 时工具根本不会执行）----
  const disposePolicy = policies.use({
    name: 'demo/forbidden-files',
    check(call) {
      if (call.name !== 'file_write') return { decision: 'allow' };

      const target = String(call.args?.path ?? '');
      if (forbidden.includes(target)) {
        return {
          decision: 'deny',
          reason: `禁止篡改关键文件 '${target}'`,
          code: 'PROTECTED_PATH' satisfies PolicyDenyCode,
        };
      }
      return { decision: 'allow' };
    },
  });

  // ---- 2. 遥测：纯观察，用事件即可（抛错也不会影响执行）----
  const startTimes = new Map<string, number>();
  const disposeBefore = ctx.on('tool:before_call', (call) => {
    startTimes.set(call.id, Date.now());
  });
  const disposeAfter = ctx.on('tool:after_call', ({ call, result }) => {
    const duration = Date.now() - (startTimes.get(call.id) ?? Date.now());
    console.log(
      `⚡ [Telemetry] '${call.name}' ${duration}ms (${result.success ? 'OK' : 'FAIL'})`,
    );
  });
  const disposeDenied = ctx.on('tool:denied', ({ call, reason }) => {
    console.log(`🛡️  [Audit] 已拦截 '${call.name}': ${reason}`);
  });

  return () => {
    disposePolicy();
    disposeBefore();
    disposeAfter();
    disposeDenied();
    console.log('[SecurityGuardPlugin] Disposed.');
  };
};

async function main() {
  const harness = new DeepSeekHarness();

  harness
    .use(DeepSeekModelPlugin, { mockMode: true })
    .use(FileToolsPlugin)
    .use(TerminalToolsPlugin)
    .use(ReActLoopPlugin)
    .use(SecurityGuardPlugin, { forbiddenFiles: ['package.json', '.env', '/etc/passwd'] });

  console.log('\n--- A. 正常任务：脚本模型走完读/测/改/测 ---');
  await harness.run('排查并修复认证 Bug。', { verbose: true });

  console.log('\n--- B. 越权尝试：直接请求写 package.json ---');
  const tools = harness.ctx.get('tools') as ToolRegistry;
  const denied = await tools.execute(
    { id: 'attack_01', name: 'file_write', args: { path: 'package.json', content: '{"hacked":true}' } },
    harness.ctx,
  );
  console.log('拦截结果:', { success: denied.success, error: denied.error });

  const verify = await tools.execute(
    { id: 'verify_01', name: 'file_read', args: { path: 'package.json' } },
    harness.ctx,
  );
  console.log('package.json 是否被改动:', verify.output.includes('hacked') ? '❌ 被篡改' : '✅ 未被篡改');

  if (denied.success || verify.output.includes('hacked')) {
    console.error('\n❌ 守卫失效！');
    process.exitCode = 1;
  } else {
    console.log('\n✅ 策略拦截生效：被拒绝的调用没有产生任何副作用。');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
