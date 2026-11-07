import chalk from 'chalk';
import { resolveConfig } from '../../core/config.js';
import {
  AgentLoop,
  Context,
  Message,
  ModelAdapter,
  Plugin,
  RunOptions,
  RunResult,
  SessionStore,
  ToolRegistry,
} from '../../core/types.js';

export interface ReActLoopOptions {
  systemPrompt?: string;
  defaultMaxSteps?: number;
  /**
   * 连续出现几次完全相同的工具调用就熔断（默认 3）。
   * 注意：真实 DSH 里对应的是 dsh-repeat-tool-reminder —— 先"提醒"模型换策略，
   * 屡教不改才中断。这里保持同样的渐进语义，避免把合法的重复读盘误杀。
   */
  repeatLimit?: number;
}

/**
 * 自愈型 ReAct (Reasoning + Acting) 执行循环插件
 *
 * 说明：ReAct 是通用 Agent 范式，**不是** DSH 专有组件；真实 DSH 中对应的是
 * `@deepseek-ai/dsh-agent-loop`（模型请求 → 流式 → 工具执行 → 会话持久化）。
 */
export const ReActLoopPlugin: Plugin<ReActLoopOptions> = (ctx: Context, options) => {
  const cfg = resolveConfig<ReActLoopOptions>(
    'ReActLoopPlugin',
    {
      systemPrompt: { type: 'string' },
      defaultMaxSteps: { type: 'number', min: 1, max: 200 },
      repeatLimit: { type: 'number', min: 1, max: 50 },
    },
    options as Record<string, any>,
  );
  const defaultPrompt =
    cfg.systemPrompt ||
    `You are an autonomous AI software engineer running inside DeepSeek Harness.
You are tasked with fixing issues, exploring codebases, and running tests.
Use the provided tools to inspect files and execute commands. Always verify your changes before finishing.`;
  const repeatLimit = cfg.repeatLimit ?? 3;

  const loop: AgentLoop = {
    async run(objective: string, runOptions: RunOptions = {}): Promise<RunResult> {
      const maxSteps = runOptions.maxSteps || cfg.defaultMaxSteps || 10;
      const verbose = runOptions.verbose ?? true;

      if (!ctx.has('model')) throw new Error('[ReActLoop] 缺少模型插件：请先 .use(DeepSeekModelPlugin)。');
      if (!ctx.has('tools')) throw new Error('[ReActLoop] 缺少工具注册表。');

      const model = ctx.get('model') as ModelAdapter;
      const tools = ctx.get('tools') as ToolRegistry;
      const session = ctx.get('session') as SessionStore;

      session.append({ type: 'USER_PROMPT', payload: { objective } });
      await ctx.emit('agent:start', { objective, sessionId: session.id });

      if (verbose) {
        console.log(chalk.bold.cyan(`\n================ DeepSeek Harness Session Started ================`));
        console.log(chalk.gray(`Session ID: ${session.id}`));
        console.log(chalk.yellow(`🎯 Objective: ${objective}`));
        console.log(chalk.gray(`Max Steps: ${maxSteps} | Engine: ${model.name}\n`));
      }

      const messages: Message[] = [
        { role: 'system', content: defaultPrompt },
        { role: 'user', content: objective },
      ];

      let stepIndex = 0;
      let finalSummary = '';
      let isSuccess = false;
      let haltedReason = '';
      let lastSignature = '';
      let repeatCount = 0;

      while (stepIndex < maxSteps) {
        stepIndex++;

        await ctx.emit('agent:step:before', {
          stepIndex,
          prompt: messages[messages.length - 1].content,
        });

        if (verbose) {
          console.log(chalk.bold.magenta(`\n--- [Step ${stepIndex}/${maxSteps}] Model Inference ---`));
        }

        const response = await model.generate(messages, tools.list());

        if (response.thought) {
          session.append({
            type: 'AGENT_THOUGHT',
            payload: { thought: response.thought },
            metadata: { stepIndex },
          });
          if (verbose) console.log(chalk.italic.gray(`💭 Thought:\n${response.thought}`));
        }

        if (response.content && verbose) {
          console.log(chalk.white(`🤖 Assistant: ${response.content}`));
        }

        // 没有工具调用 = 模型认为任务结束
        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalSummary = response.content || 'Task completed with no further actions.';
          isSuccess = true;
          session.append({
            type: 'TASK_COMPLETED',
            payload: { summary: finalSummary },
            metadata: { stepIndex },
          });
          break;
        }

        // 死循环检测：先提醒，再熔断（渐进式，避免误杀合法重复）
        const signature = JSON.stringify(response.toolCalls.map((c) => [c.name, c.args]));
        if (signature === lastSignature) {
          repeatCount++;
        } else {
          lastSignature = signature;
          repeatCount = 1;
        }

        if (repeatCount >= repeatLimit) {
          haltedReason = `检测到连续 ${repeatCount} 次完全相同的工具调用，判定为死循环并熔断。`;
          session.append({
            type: 'GUARDRAIL_INTERCEPT',
            payload: { reason: haltedReason, signature },
            metadata: { stepIndex },
          });
          if (verbose) console.log(chalk.red(`\n🛑 [Repeat Guard] ${haltedReason}`));
          break;
        }

        if (repeatCount > 1) {
          const reminder =
            `[Harness Reminder] 你已经连续 ${repeatCount} 次发出完全相同的工具调用（${response.toolCalls[0].name}）。` +
            `重复同样的请求不会得到不同结果。请先分析上一次的 Observation，换一种策略（例如换文件、换命令、或直接给出结论）。`;
          messages.push({ role: 'user', content: reminder });
          session.append({
            type: 'GUARDRAIL_INTERCEPT',
            payload: { reminder, signature },
            metadata: { stepIndex },
          });
          if (verbose) console.log(chalk.yellow(`\n🔁 [Repeat Reminder] 已提醒模型换策略（第 ${repeatCount} 次）`));
        }

        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });

        for (const call of response.toolCalls) {
          session.append({ type: 'TOOL_CALL', payload: call, metadata: { stepIndex } });

          if (verbose) {
            console.log(
              chalk.blueBright(`🛠️  Action: ${chalk.bold(call.name)}`) +
                chalk.gray(` args: ${JSON.stringify(call.args)}`),
            );
          }

          const result = await tools.execute(call, ctx);

          session.append({
            type: 'TOOL_RESULT',
            payload: result,
            metadata: { stepIndex, toolId: call.id },
          });

          // 被策略拒绝的调用单独记一条，便于回放时定位"是谁拦的"
          if (result.metadata?.denied) {
            session.append({
              type: 'GUARDRAIL_INTERCEPT',
              payload: { call, error: result.error, code: result.metadata.code },
              metadata: { stepIndex, toolId: call.id },
            });
          }

          if (verbose) {
            if (result.success) {
              console.log(chalk.green(`👁️  Observation (Success):\n${result.output}`));
            } else {
              console.log(
                chalk.red(`⚠️  Observation (Error/Denied):\n${result.error || result.output}`),
              );
            }
          }

          messages.push({
            role: 'tool',
            name: call.name,
            tool_call_id: call.id,
            content: result.success
              ? result.output
              : `Tool Execution Failed: ${result.error}\nOutput: ${result.output}`,
          });
        }

        await ctx.emit('agent:step:after', {
          stepIndex,
          thought: response.thought,
          toolCalls: response.toolCalls,
        });
      }

      if (!isSuccess) {
        finalSummary = haltedReason || `Task halted: reached maximum configured steps (${maxSteps}).`;
      }

      await ctx.emit('agent:finished', {
        success: isSuccess,
        result: finalSummary,
        trajectoryLength: session.getEvents().length,
      });

      if (verbose) {
        console.log(chalk.bold.green(`\n================ Session Finished ================\n`));
        console.log(chalk.cyan(`Result: ${finalSummary}`));
        console.log(chalk.gray(`Total Events in Trajectory: ${session.getEvents().length}\n`));
      }

      return {
        success: isSuccess,
        stepsCount: stepIndex,
        summary: finalSummary,
        trajectory: session.getEvents(),
      };
    },
  };

  ctx.provide('loop', loop);
  return () => {
    // cleanup
  };
};
