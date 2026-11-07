import { Context, ModelAdapter, ModelResponse, Plugin } from '../../core/types.js';

export interface ScriptedWorkspaceModelOptions {
  /** 目标文件（相对工作区） */
  targetPath?: string;
  /** 该工作区使用的测试命令 */
  testCommand?: string;
}

/**
 * 工作区演示用的"剧本模型"
 *
 * 定位非常明确：**决策是脚本化的，效果是真实的。**
 *   - 脚本化：每一步调用哪个工具、写什么内容，都是写死的；
 *   - 真实：文件读写真的落到 disk，`node test.js` 真的起子进程，
 *           "修复前红 / 修复后绿"是真实退出码，不是字符串。
 *
 * 这样演示不会假装"这就是模型能力"，但工程链路（循环 / 工具 / 策略 / 事件）都是真跑。
 * 想换成真实模型，把本插件替换成 DeepSeekModelPlugin 即可，循环一行都不用改。
 */
export const ScriptedWorkspaceModelPlugin: Plugin<ScriptedWorkspaceModelOptions> = (
  ctx: Context,
  options = {},
) => {
  const targetPath = options.targetPath ?? 'src/calculator.js';
  const testCommand = options.testCommand ?? 'node test.js';
  let turn = 0;

  const adapter: ModelAdapter = {
    name: 'ScriptedWorkspaceFixture (决策脚本化 / 效果真实)',
    async generate(): Promise<ModelResponse> {
      turn++;

      if (turn === 1) {
        return {
          thought: '[SCRIPTED] 先看工作区里有什么。',
          toolCalls: [{ id: 's1', name: 'real_list_directory', args: {} }],
        };
      }

      if (turn === 2) {
        return {
          thought: `[SCRIPTED] 定位到核心文件 ${targetPath}，读一下。`,
          toolCalls: [{ id: 's2', name: 'real_file_read', args: { path: targetPath } }],
        };
      }

      if (turn === 3) {
        return {
          thought: '[SCRIPTED] 先跑一次测试，确认失败现象。',
          toolCalls: [{ id: 's3', name: 'real_bash_run', args: { command: testCommand } }],
        };
      }

      if (turn === 4) {
        return {
          thought: '[SCRIPTED] 修复：把 1 + pct/100 改成 1 - pct/100，并补上除零保护。',
          toolCalls: [
            {
              id: 's4',
              name: 'real_file_write',
              args: {
                path: targetPath,
                content: `/**
 * 修复后的计算与折扣模块（由演示脚本写入，真实落盘）
 */
export function calculateDiscount(price, discountPercent) {
  if (price < 0 || discountPercent < 0) {
    throw new Error('Negative values not allowed');
  }

  const finalPrice = price * (1 - discountPercent / 100);

  return Math.round(finalPrice * 100) / 100;
}

export function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero is not permitted');
  }
  return a / b;
}
`,
              },
            },
          ],
        };
      }

      if (turn === 5) {
        return {
          thought: '[SCRIPTED] 回归验证。',
          toolCalls: [{ id: 's5', name: 'real_bash_run', args: { command: testCommand } }],
        };
      }

      return {
        thought: '[SCRIPTED] 结束。',
        content:
          '[SCRIPTED DECISIONS / REAL EFFECTS] 演示结束：失败与通过都来自真实子进程退出码。',
      };
    },
  };

  ctx.provide('model', adapter);
  return () => {
    // cleanup
  };
};
