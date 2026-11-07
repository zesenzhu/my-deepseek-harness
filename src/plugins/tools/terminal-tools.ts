import vm from 'node:vm';
import { Context, Plugin, ToolDefinition, ToolRegistry } from '../../core/types.js';

/**
 * 在受限的 vm 沙箱里**真正执行**虚拟文件系统中的 verifyToken，
 * 而不是用字符串匹配去猜"这份代码看起来对不对"。
 *
 * 旧版用 `authCode.includes('now > exp')` 判定通过，导致模型把边界条件写成
 * `now >= exp`（RFC 7519 的正确语义）时反而被判为"文件损坏"，
 * 逼着模型去迁就假测试 —— 这是最伤学习体验的一类坑。
 */
function loadVerifyToken(source: string): (token: string, now?: number) => any {
  const code = source.replace(/^\s*export\s+/gm, '');
  const sandbox: Record<string, any> = { Math, Date };
  const context = vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__verify = typeof verifyToken === 'function' ? verifyToken : undefined;`, context, {
    timeout: 1000,
  });
  const fn = sandbox.__verify;
  if (typeof fn !== 'function') throw new Error('模块中没有导出 verifyToken 函数');
  return fn;
}

export interface TerminalToolsOptions {
  allowedCommands?: string[];
}

/**
 * 内存沙箱的"伪终端"插件（教学用）
 *
 * ⚠️ 诚实声明（这一点在原版里是误导的）：
 * 本工具**不会启动任何子进程**。它只在 FileToolsPlugin 维护的内存虚拟文件系统上，
 * 对 `src/auth.js` 的内容做一次字符串判定，然后返回一份*模拟*测试报告。
 *
 * 想看到"真的跑测试、真的失败、真的修复、真的通过"，请使用
 * `real_bash_run`（RealFSToolsPlugin）并参考 examples/05_real_workspace_agent.ts。
 */
export const TerminalToolsPlugin: Plugin<TerminalToolsOptions> = (ctx: Context, options = {}) => {
  const allowed = options.allowedCommands || ['npm test', 'node', 'ls', 'pwd', 'echo'];

  const bashRunTool: ToolDefinition = {
    name: 'bash_run',
    description:
      '【模拟】在内存沙箱中"运行"命令。不会启动真实子进程；对 npm test 返回基于虚拟文件内容的模拟报告。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令 (例如: npm test)',
        },
      },
      required: ['command'],
    },
    execute: async (args, context) => {
      const command = String(args.command).trim();

      const isAllowed = allowed.some((prefix) => command.startsWith(prefix));
      if (!isAllowed) {
        return {
          success: false,
          output: '',
          error: `[Sandbox Error] Command '${command}' is not allowed. Allowed: ${allowed.join(', ')}`,
        };
      }

      if (command.startsWith('npm test')) {
        const virtualFS = context.get('virtualFS') as Map<string, string> | undefined;
        const source = virtualFS?.get('src/auth.js') || '';
        const header = '[SIMULATED RUNTIME] 未启动子进程，但在 vm 沙箱中真实执行了 src/auth.js 的逻辑。\n';

        try {
          const verifyToken = loadVerifyToken(source);
          const cases = [
            {
              name: 'should accept valid token',
              run: () => {
                const r = verifyToken('validtoken12345', 1699999999);
                if (!r?.valid) throw new Error(`期望 valid=true，实际 ${JSON.stringify(r)}`);
              },
            },
            {
              name: 'should reject token with correct 401 code',
              run: () => {
                const r = verifyToken('validtoken12345', 1700000001);
                if (r?.valid !== false || r?.code !== 401) {
                  throw new Error(`期望 {valid:false, code:401}，实际 ${JSON.stringify(r)}`);
                }
              },
            },
            {
              name: 'should reject malformed token with 400',
              run: () => {
                const r = verifyToken('short', 1699999999);
                if (r?.valid !== false || r?.code !== 400) {
                  throw new Error(`期望 {valid:false, code:400}，实际 ${JSON.stringify(r)}`);
                }
              },
            },
          ];

          const lines: string[] = [];
          let failedCount = 0;
          for (const c of cases) {
            try {
              c.run();
              lines.push(`  ✓ ${c.name}`);
            } catch (err: any) {
              failedCount++;
              lines.push(`  ✗ ${c.name}\n      ${err.message}`);
            }
          }

          const passedCount = cases.length - failedCount;
          const report =
            header +
            lines.join('\n') +
            `\n\n测试统计: ${passedCount} 通过, ${failedCount} 失败`;

          return failedCount === 0
            ? { success: true, output: report, metadata: { simulated: true } }
            : {
                success: false,
                output: report,
                error: 'Process exited with exit code 1',
                metadata: { simulated: true },
              };
        } catch (err: any) {
          return {
            success: false,
            output: '',
            error: `${header}无法执行 src/auth.js：${err.message}`,
            metadata: { simulated: true },
          };
        }
      }

      // 其他命令：诚实回显，明确没有执行
      return {
        success: false,
        output: '',
        error: `[SIMULATED] 未实际执行 '${command}'：内存沙箱没有真实 shell。请改用 real_bash_run。`,
        metadata: { simulated: true },
      };
    },
  };

  const registry = ctx.get('tools') as ToolRegistry;
  if (!registry) {
    throw new Error('[TerminalToolsPlugin] ToolRegistry must be provided by the harness first!');
  }

  return registry.register(bashRunTool);
};
