import { DeepSeekHarness } from '../src/core/harness.js';
import { Context, Plugin } from '../src/core/types.js';
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js';
import { DeepSeekModelPlugin } from '../src/plugins/models/deepseek-adapter.js';
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js';
import { TerminalToolsPlugin } from '../src/plugins/tools/terminal-tools.js';

/**
 * 示例 2: 开发与挂载自定义插件
 * 演示：在不修改 DSH 源码的情况下，注入自定义的“敏感文件防篡改与耗时监控插件”
 */

interface SecurityGuardOptions {
  forbiddenFiles: string[];
}

// 编写自定义插件
const SecurityGuardPlugin: Plugin<SecurityGuardOptions> = (ctx: Context, options) => {
  const forbidden = options?.forbiddenFiles || [];

  console.log(`[Plugin Loaded] SecurityGuardPlugin initialized with rules:`, forbidden);

  // 1. 监听工具调用前事件，进行安全拦截
  const disposeBefore = ctx.on('tool:before_call', (call) => {
    if (call.name === 'file_write') {
      const targetPath = call.args.path;
      if (forbidden.includes(targetPath)) {
        throw new Error(
          `[Security Breach] Tampering with critical system file '${targetPath}' is strictly forbidden!`
        );
      }
    }
  });

  // 2. 统计每个工具调用的执行时间
  const startTimes = new Map<string, number>();
  ctx.on('tool:before_call', (call) => {
    startTimes.set(call.id, Date.now());
  });

  const disposeAfter = ctx.on('tool:after_call', ({ call, result }) => {
    const start = startTimes.get(call.id) || Date.now();
    const duration = Date.now() - start;
    console.log(`⚡ [Telemetry] Tool '${call.name}' executed in ${duration}ms (status: ${result.success ? 'OK' : 'FAIL'})`);
  });

  return () => {
    disposeBefore();
    disposeAfter();
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
    // 挂载我们刚刚编写的自定义安全守卫插件！
    .use(SecurityGuardPlugin, {
      forbiddenFiles: ['package.json', '/etc/passwd', '.env'],
    });

  const objective = '排查并修复认证 Bug。';
  await harness.run(objective, { verbose: true });
}

main().catch(console.error);

