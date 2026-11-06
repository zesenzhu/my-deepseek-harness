import chalk from 'chalk';
import {
  AgentLoop,
  Context,
  Message,
  Plugin,
  RunOptions,
  RunResult,
  SessionStore
} from '../../core/types.js';

export interface ReActLoopOptions {
  systemPrompt?: string;
  defaultMaxSteps?: number;
}

/**
 * 自愈型 ReAct (Reasoning + Acting) 执行循环插件
 */
export const ReActLoopPlugin: Plugin<ReActLoopOptions> = (ctx: Context, options = {}) => {
  const defaultPrompt =
    options.systemPrompt ||
    `You are an autonomous AI software engineer running inside DeepSeek Harness.
You are tasked with fixing issues, exploring codebases, and running tests.
Use the provided tools to inspect files and execute commands. Always verify your changes before finishing.`;

  const loop: AgentLoop = {
    async run(objective: string, runOptions: RunOptions = {}): Promise<RunResult> {
      const maxSteps = runOptions.maxSteps || options.defaultMaxSteps || 10;
      const verbose = runOptions.verbose ?? true;

      const model = ctx.get('model');
      const tools = ctx.get('tools');
      const session = ctx.get('session') as SessionStore;

      // 1. 初始化会话与事件
      session.append({
        type: 'USER_PROMPT',
        payload: { objective },
      });

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

      while (stepIndex < maxSteps) {
        stepIndex++;

        await ctx.emit('agent:step:before', {
          stepIndex,
          prompt: messages[messages.length - 1].content,
        });

        if (verbose) {
          console.log(chalk.bold.magenta(`\n--- [Step ${stepIndex}/${maxSteps}] Model Inference ---`));
        }

        // 调用模型获取响应
        const response = await model.generate(messages, tools.list());

        // 记录模型思考
        if (response.thought) {
          session.append({
            type: 'AGENT_THOUGHT',
            payload: { thought: response.thought },
            metadata: { stepIndex },
          });
          if (verbose) {
            console.log(chalk.italic.gray(`💭 Thought:\n${response.thought}`));
          }
        }

        if (response.content && verbose) {
          console.log(chalk.white(`🤖 Assistant: ${response.content}`));
        }

        // 判定是否完成任务（没有发起 Tool Call 且给出了总结）
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

        // 处理 Tool Calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        });

        for (const call of response.toolCalls) {
          session.append({
            type: 'TOOL_CALL',
            payload: call,
            metadata: { stepIndex },
          });

          if (verbose) {
            console.log(
              chalk.blueBright(`🛠️  Action: ${chalk.bold(call.name)}`) +
                chalk.gray(` args: ${JSON.stringify(call.args)}`)
            );
          }

          // 沙箱安全调用
          const result = await tools.execute(call, ctx);

          session.append({
            type: 'TOOL_RESULT',
            payload: result,
            metadata: { stepIndex, toolId: call.id },
          });

          if (verbose) {
            if (result.success) {
              console.log(chalk.green(`👁️  Observation (Success):\n${result.output}`));
            } else {
              console.log(
                chalk.red(`⚠️  Observation (Error/Exit Failure):\n${result.error || result.output}`)
              );
            }
          }

          // 将工具执行结果作为 Observation 反馈给模型（支持自愈重试）
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

      if (!isSuccess && stepIndex >= maxSteps) {
        finalSummary = `Task halted: reached maximum configured steps (${maxSteps}).`;
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

