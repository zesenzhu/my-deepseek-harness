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

export interface RouterWorkerLoopOptions {
  enableWorkers?: ('explorer' | 'coder' | 'tester')[];
}

/**
 * Router-Worker 多角色协同插件（**教学原型**）
 *
 * ⚠️ 诚实声明：DSH 里**没有** `dsh-superagent-prototype` 这个包，也没有官方 Router-Worker 拓扑。
 * 这四篇文档/这个插件是为讲解"角色分工 + 反馈闭环"而自建的类比模型。
 * 真实 DSH 中相近的能力由这些包提供：
 *   - `@deepseek-ai/dsh-subagent`       子 agent 委派（spawn / fork，可跨 ACP/SDK/Codex/ClaudeCode）
 *   - `@deepseek-ai/dsh-tool-subagent`  模型可调用的 subagent 工具
 *   - `@deepseek-ai/dsh-workflow`       脚本化多 agent 编排
 *   - `@deepseek-ai/dsh-experimental-agent-team` 团队式协作（实验性）
 */
export const RouterWorkerLoopPlugin: Plugin<RouterWorkerLoopOptions> = (ctx: Context) => {
  const loop: AgentLoop = {
    async run(objective: string, runOptions: RunOptions = {}): Promise<RunResult> {
      const verbose = runOptions.verbose ?? true;
      const session = ctx.get('session') as SessionStore;
      const tools = ctx.get('tools') as ToolRegistry;

      session.append({
        type: 'USER_PROMPT',
        payload: { objective, mode: 'TEACHING_ROUTER_WORKER_PROTOTYPE' },
      });
      await ctx.emit('agent:start', { objective, sessionId: session.id });

      if (verbose) {
        console.log(chalk.bold.yellow(`\n🚀 [教学原型] Router-Worker 拓扑（非 DSH 官方组件）`));
        console.log(chalk.cyan(`🎯 Top Objective: ${objective}\n`));
      }

      const plan = [
        { id: 'task_01_recon', worker: 'Explorer', prompt: 'Read src/auth.js and locate the faulty condition.' },
        { id: 'task_02_coder', worker: 'Coder', prompt: 'Rewrite verifyToken with the corrected expiration check.' },
        { id: 'task_03_tester', worker: 'Tester', prompt: 'Run the test suite and report the real result.' },
      ];

      if (verbose) {
        console.log(chalk.magenta('📋 [Router] Plan Created:'));
        plan.forEach((item, i) => console.log(chalk.gray(`   ${i + 1}. [${item.worker}] ${item.prompt}`)));
      }

      // ---- Worker 1: Explorer（只读） ----
      if (verbose) console.log(chalk.blueBright('\n🔍 [Worker: Explorer] Reading src/auth.js ...'));
      const readResult = await tools.execute(
        { id: 'exp_01', name: 'file_read', args: { path: 'src/auth.js' } },
        ctx,
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Explorer', output: readResult.output, error: readResult.error },
        metadata: { workerId: 'explorer' },
      });
      if (verbose) {
        console.log(
          readResult.success
            ? chalk.gray('[Explorer] 已读取源码，定位到过期判定条件。')
            : chalk.red(`[Explorer] 失败: ${readResult.error}`),
        );
      }

      // ---- Worker 2: Coder（写） ----
      if (verbose) console.log(chalk.cyanBright('\n💻 [Worker: Coder] Writing patch ...'));
      const patchResult = await tools.execute(
        {
          id: 'code_01',
          name: 'file_write',
          args: {
            path: 'src/auth.js',
            content:
              '// Patched by Coder Worker\n' +
              'export function verifyToken(token, now = Date.now() / 1000) {\n' +
              '  if (!token || token.length < 10) return { valid: false, code: 400 };\n' +
              '  const exp = 1700000000;\n' +
              '  if (now > exp) return { valid: false, code: 401, error: "Token expired" };\n' +
              '  return { valid: true, user: "admin" };\n' +
              '}\n',
          },
        },
        ctx,
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Coder', output: patchResult.output, error: patchResult.error },
        metadata: { workerId: 'coder' },
      });
      if (verbose) {
        console.log(
          patchResult.success
            ? chalk.green('[Coder] 补丁已写入。')
            : chalk.red(`[Coder] 写入被拒绝: ${patchResult.error}`),
        );
      }

      // ---- Worker 3: Tester（真实验收，结果不硬编码） ----
      if (verbose) console.log(chalk.greenBright('\n🧪 [Worker: Tester] Running verification ...'));
      const testResult = await tools.execute(
        { id: 'test_01', name: 'bash_run', args: { command: 'npm test' } },
        ctx,
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Tester', output: testResult.output, error: testResult.error },
        metadata: { workerId: 'tester', success: testResult.success },
      });
      if (verbose) console.log(chalk.gray(`[Tester Output]\n${testResult.output || testResult.error}`));

      // ---- Router 汇总：以真实结果为准，绝不写死成功 ----
      const success = Boolean(readResult.success && patchResult.success && testResult.success);
      const summary = success
        ? 'Router-Worker 闭环完成：Explorer 定位 → Coder 改写 → Tester 验证通过（结果来自工具返回值，未硬编码）。'
        : `Router-Worker 未完成：read=${readResult.success}, write=${patchResult.success}, test=${testResult.success}。` +
          ` 首个失败原因：${readResult.error || patchResult.error || testResult.error}`;

      session.append({ type: 'TASK_COMPLETED', payload: { summary, success } });
      await ctx.emit('agent:finished', {
        success,
        result: summary,
        trajectoryLength: session.getEvents().length,
      });

      if (verbose) {
        console.log(
          success
            ? chalk.bold.green('\n✅ [Router] 子任务全部成功')
            : chalk.bold.red(`\n❌ [Router] 存在失败子任务\n   ${summary}`),
        );
      }

      return {
        success,
        stepsCount: 3,
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
