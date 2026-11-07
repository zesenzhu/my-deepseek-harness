import chalk from 'chalk';
import {
  AgentLoop,
  Context,
  Plugin,
  RunOptions,
  RunResult,
  SessionStore,
  ToolRegistry,
} from '../../core/types.js';

export interface SuperAgentLoopOptions {
  workspaceDir: string;
}

/**
 * Router-Worker 协同的"真实工作区"版本（**教学原型**）
 *
 * 与 router-worker-loop 的区别：这里操作的是**真实磁盘**与**真实子进程**，
 * 所以"测试通过/失败"不是写死的字符串，而是 `node test.js` 的真实退出码。
 *
 * ⚠️ 同样需要说明：DSH 官方没有 Router-Worker 拓扑；真实对应物见 dsh-subagent /
 * dsh-tool-subagent / dsh-workflow / dsh-experimental-agent-team。
 */
export const SuperAgentLoopPlugin: Plugin<SuperAgentLoopOptions> = (ctx: Context) => {
  const loop: AgentLoop = {
    async run(objective: string, runOptions: RunOptions = {}): Promise<RunResult> {
      const verbose = runOptions.verbose ?? true;
      const session = ctx.get('session') as SessionStore;
      const tools = ctx.get('tools') as ToolRegistry;

      session.append({
        type: 'USER_PROMPT',
        payload: { objective, topology: 'TEACHING_ROUTER_WORKER_REAL_FS' },
      });
      await ctx.emit('agent:start', { objective, sessionId: session.id });

      if (verbose) {
        console.log(chalk.bold.yellow('\n🚀 [教学原型] Router-Worker（真实文件系统 + 真实子进程）'));
        console.log(chalk.cyan(`🎯 全局目标: ${objective}`));
        console.log(chalk.gray(`会话 ID: ${session.id}\n`));
      }

      const tool = async (id: string, name: string, args: Record<string, unknown>) => {
        const result = await tools.execute({ id, name, args }, ctx);
        session.append({
          type: 'TOOL_RESULT',
          payload: { tool: name, args, output: result.output, error: result.error },
          metadata: { toolId: id, success: result.success },
        });
        if (result.metadata?.denied) {
          session.append({
            type: 'GUARDRAIL_INTERCEPT',
            payload: { tool: name, args, error: result.error },
            metadata: { toolId: id },
          });
        }
        return result;
      };

      // ---- 1. Explorer：勘测 ----
      if (verbose) console.log(chalk.blueBright('\n🔍 [Worker: Explorer] 扫描工作区...'));
      const scan = await tool('call_exp_01', 'real_list_directory', {});
      if (verbose) console.log(chalk.gray(scan.output || scan.error));

      const readTarget = 'src/calculator.js';
      const read = await tool('call_exp_02', 'real_file_read', { path: readTarget });
      if (!read.success) {
        session.append({
          type: 'TASK_COMPLETED',
          payload: { summary: `无法读取 ${readTarget}: ${read.error}`, success: false },
        });
        await ctx.emit('agent:finished', {
          success: false,
          result: read.error ?? '',
          trajectoryLength: session.getEvents().length,
        });
        return {
          success: false,
          stepsCount: 2,
          summary: `Explorer 失败：${read.error}`,
          trajectory: session.getEvents(),
        };
      }

      // ---- 2. Tester：首测复现（真实执行） ----
      if (verbose) console.log(chalk.greenBright('\n🧪 [Worker: Tester] 运行初始测试以复现 Bug ...'));
      const firstTest = await tool('call_test_01', 'real_bash_run', { command: 'node test.js' });

      if (firstTest.success) {
        const hint =
          '测试一开始就是绿的：工作区处于"已修复"状态，没有可复现的 Bug。\n' +
          '请先执行 `npm run reset` 把 workspace/src/calculator.js 复位到含 Bug 的基线。';
        session.append({ type: 'TASK_COMPLETED', payload: { summary: hint, success: false } });
        await ctx.emit('agent:finished', {
          success: false,
          result: hint,
          trajectoryLength: session.getEvents().length,
        });
        if (verbose) console.log(chalk.yellow(`\n⚠️  ${hint}`));
        return { success: false, stepsCount: 3, summary: hint, trajectory: session.getEvents() };
      }

      if (verbose) {
        console.log(chalk.red('[Tester] 红灯（预期）：'));
        console.log(chalk.gray((firstTest.output || firstTest.error || '').trim()));
      }

      // ---- 3. Coder：靶向修复（真实写入，可能被策略拒绝） ----
      if (verbose) console.log(chalk.cyanBright('\n💻 [Worker: Coder] 写入修复补丁...'));
      const fixedCode = `/**
 * 修复后的计算与折扣模块
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
`;
      const write = await tool('call_code_01', 'real_file_write', {
        path: readTarget,
        content: fixedCode,
      });

      if (!write.success) {
        const summary = `Coder 写入被拒绝或失败：${write.error}`;
        session.append({ type: 'TASK_COMPLETED', payload: { summary, success: false } });
        await ctx.emit('agent:finished', {
          success: false,
          result: summary,
          trajectoryLength: session.getEvents().length,
        });
        if (verbose) console.log(chalk.red(`\n❌ ${summary}`));
        return { success: false, stepsCount: 4, summary, trajectory: session.getEvents() };
      }
      if (verbose) console.log(chalk.green('[Coder] 补丁已写入真实工作区。'));

      // ---- 4. Tester：回归验收（真实执行） ----
      if (verbose) console.log(chalk.greenBright('\n🧪 [Worker: Tester] 二次运行测试，回归验收 ...'));
      const verify = await tool('call_test_02', 'real_bash_run', { command: 'node test.js' });

      const success = Boolean(verify.success);
      const summary = success
        ? '闭环完成：Explorer 定位 → Tester 复现红灯 → Coder 写入补丁 → Tester 回归全绿（全部为真实执行结果）。'
        : `回归失败，测试仍未通过。输出：\n${(verify.output || verify.error || '').trim()}`;

      session.append({ type: 'TASK_COMPLETED', payload: { summary, success } });
      await ctx.emit('agent:finished', {
        success,
        result: summary,
        trajectoryLength: session.getEvents().length,
      });

      if (verbose) {
        console.log(success ? chalk.bold.green('\n🎉 验收通过') : chalk.bold.red('\n❌ 验收失败'));
        console.log(chalk.gray(`累计不可变事件数: ${session.getEvents().length}\n`));
      }

      return {
        success,
        stepsCount: 5,
        summary,
        trajectory: session.getEvents(),
      };
    },
  };

  ctx.provide('loop', loop);
  return () => {
    // cleanup
  };
};
