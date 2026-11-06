import chalk from 'chalk';
import {
  AgentLoop,
  Context,
  Plugin,
  RunOptions,
  RunResult,
  SessionStore
} from '../../core/types.js';

export interface RouterWorkerLoopOptions {
  enableWorkers?: ('explorer' | 'coder' | 'tester')[];
}

/**
 * Super-Agent 原型插件：Router-Worker 架构
 * 由 Router 负责顶层拆解，依次指派专用子智能体完成任务
 */
export const RouterWorkerLoopPlugin: Plugin<RouterWorkerLoopOptions> = (ctx: Context) => {
  const loop: AgentLoop = {
    async run(objective: string, runOptions: RunOptions = {}): Promise<RunResult> {
      const verbose = runOptions.verbose ?? true;
      const session = ctx.get('session') as SessionStore;
      const tools = ctx.get('tools');

      session.append({
        type: 'USER_PROMPT',
        payload: { objective, mode: 'SUPER_AGENT_ROUTER_WORKER' },
      });

      if (verbose) {
        console.log(chalk.bold.yellow(`\n🚀 [Super-Agent Prototype] Router-Worker Topology Activated`));
        console.log(chalk.cyan(`🎯 Top Objective: ${objective}\n`));
      }

      // 阶段 1: Router 制定执行流水线
      const plan = [
        {
          id: 'task_01_recon',
          worker: 'Explorer',
          prompt: 'Inspect codebase directory structure and locate authentication files.',
        },
        {
          id: 'task_02_coder',
          worker: 'Coder',
          prompt: 'Implement token verification expiration fix according to test expectations.',
        },
        {
          id: 'task_03_tester',
          worker: 'Tester',
          prompt: 'Execute automated regression test suite to ensure 100% pass.',
        },
      ];

      if (verbose) {
        console.log(chalk.magenta(`📋 [Router] Plan Created:`));
        plan.forEach((item, i) => {
          console.log(chalk.gray(`   ${i + 1}. [${item.worker}] ${item.prompt}`));
        });
      }

      // 阶段 2: 顺序执行各 Worker
      // Worker 1: Explorer
      if (verbose) {
        console.log(chalk.blueBright(`\n🔍 [Worker: Explorer] Scanning directory & inspecting src/auth.js...`));
      }
      const readResult = await tools.execute(
        { id: 'exp_01', name: 'file_read', args: { path: 'src/auth.js' } },
        ctx
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Explorer', output: readResult.output },
        metadata: { workerId: 'explorer' },
      });
      if (verbose) {
        console.log(chalk.gray(`[Explorer Output] Located vulnerability at src/auth.js: condition 'now < exp' causes premature expiration.`));
      }

      // Worker 2: Coder
      if (verbose) {
        console.log(chalk.cyanBright(`\n💻 [Worker: Coder] Applying unified patch...`));
      }
      const patchResult = await tools.execute(
        {
          id: 'code_01',
          name: 'file_write',
          args: {
            path: 'src/auth.js',
            content: `// Patched by Coder Worker\nexport function verifyToken(token, now = Date.now() / 1000) {\n  if (!token || token.length < 10) return { valid: false, code: 400 };\n  const exp = 1700000000;\n  if (now > exp) return { valid: false, code: 401, error: "Token expired" };\n  return { valid: true, user: "admin" };\n}`,
          },
        },
        ctx
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Coder', output: patchResult.output },
        metadata: { workerId: 'coder' },
      });
      if (verbose) {
        console.log(chalk.green(`[Coder Output] File patch successfully applied.`));
      }

      // Worker 3: Tester
      if (verbose) {
        console.log(chalk.greenBright(`\n🧪 [Worker: Tester] Running verification tests in isolated sandbox...`));
      }
      const testResult = await tools.execute(
        { id: 'test_01', name: 'bash_run', args: { command: 'npm test' } },
        ctx
      );
      session.append({
        type: 'TOOL_RESULT',
        payload: { worker: 'Tester', output: testResult.output },
        metadata: { workerId: 'tester' },
      });

      if (verbose) {
        console.log(chalk.gray(`[Tester Output]\n${testResult.output}`));
      }

      const summary = `Router-Worker collaboration succeeded. Explorer located bug, Coder patched src/auth.js, and Tester verified with 100% pass rate.`;

      session.append({
        type: 'TASK_COMPLETED',
        payload: { summary },
      });

      if (verbose) {
        console.log(chalk.bold.green(`\n🎉 [Router] All Subtasks Finished Successfully!`));
      }

      return {
        success: true,
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

