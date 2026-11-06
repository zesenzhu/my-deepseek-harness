import { Context, Plugin, ToolDefinition, ToolRegistry } from '../../core/types.js';

export interface TerminalToolsOptions {
  allowedCommands?: string[];
}

/**
 * 终端沙箱执行器插件 (Bash Runner)
 * 能够执行沙箱测试套件，并依据当前代码状态动态反馈真实报错
 */
export const TerminalToolsPlugin: Plugin<TerminalToolsOptions> = (ctx: Context, options = {}) => {
  const allowed = options.allowedCommands || ['npm test', 'node', 'ls', 'pwd', 'echo'];

  const bashRunTool: ToolDefinition = {
    name: 'bash_run',
    description: '在受控沙箱隔离环境中执行 Shell 命令',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要在终端中执行的命令 (例如: npm test)',
        },
      },
      required: ['command'],
    },
    execute: async (args, context) => {
      const command = String(args.command).trim();

      // 安全白名单校验
      const isAllowed = allowed.some((prefix) => command.startsWith(prefix));
      if (!isAllowed) {
        return {
          success: false,
          output: '',
          error: `[Security Error] Command '${command}' is forbidden by sandbox guardrail.`,
        };
      }

      // 如果执行的是测试命令 `npm test`，根据虚拟文件系统中的代码动态判定
      if (command.startsWith('npm test')) {
        const virtualFS = context.get('virtualFS') as Map<string, string> | undefined;
        const authCode = virtualFS?.get('src/auth.js') || '';

        // 如果代码依然包含旧的错误条件 `now < exp`
        if (authCode.includes('now < exp')) {
          return {
            success: false,
            output: `> sample-auth-service@1.0.0 test
> node test.js

FAIL test/auth.test.js
  ● Token Expiration Suite > should reject expired token with 401
    AssertionError: expected 200 to equal 401
      at Object.<anonymous> (test/auth.test.js:14:12)
      at verifyToken (src/auth.js:6:7)

Tests: 1 failed, 1 passed, 2 total
Snapshots: 0 total
Time: 0.421s
Ran all test suites.`,
            error: 'Process exited with exit code 1',
          };
        } else if (authCode.includes('now > exp')) {
          // 修复成功
          return {
            success: true,
            output: `> sample-auth-service@1.0.0 test
> node test.js

PASS test/auth.test.js
  ✓ Token Expiration Suite > should accept valid token (12ms)
  ✓ Token Expiration Suite > should reject expired token with 401 (8ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        0.312s
Ran all test suites.`,
          };
        } else {
          return {
            success: false,
            output: '',
            error: 'SyntaxError: Unexpected token or corrupt auth.js file.',
          };
        }
      }

      // 默认简单命令回显
      return {
        success: true,
        output: `Executed: ${command}\nStatus: exit code 0`,
      };
    },
  };

  const registry = ctx.get('tools') as ToolRegistry;
  if (!registry) {
    throw new Error('[TerminalToolsPlugin] ToolRegistry must be initialized first!');
  }

  const dispose = registry.register(bashRunTool);
  return dispose;
};

