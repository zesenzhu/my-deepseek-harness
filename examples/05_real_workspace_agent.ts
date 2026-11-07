import fs from 'fs';
import path from 'path';
import { DeepSeekHarness } from '../src/core/harness.js';
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js';
import { ScriptedWorkspaceModelPlugin } from '../src/plugins/models/scripted-workspace-model.js';
import { RealFSToolsPlugin } from '../src/plugins/tools/real-fs-tools.js';
import { SandboxGuardPlugin } from '../src/plugins/guardrails/sandbox-guard.js';

/**
 * 示例 5: 真实文件系统 + 真实子进程的完整闭环
 *
 * 这个示例存在的意义，是修正示例 1~4 的"剧场感"：
 *   - 真实读盘、真实写盘、真实 `node test.js`
 *   - "修复前失败 / 修复后通过"来自子进程退出码，不是写死的字符串
 *
 * 唯一脚本化的是"决策"（调用哪个工具、写什么内容）。
 * 想换成真模型：把 ScriptedWorkspaceModelPlugin 换成 DeepSeekModelPlugin，
 * 循环、工具、策略、事件一行都不用改 —— 这正是"模型是插件"的价值。
 */
async function main() {
  const workspaceDir = path.resolve(process.cwd(), 'workspace');
  const target = path.join(workspaceDir, 'src', 'calculator.js');
  const baseline = path.join(workspaceDir, 'src', 'calculator.buggy.js');

  // 每次运行前复位到含 Bug 的基线，保证演示可重复
  if (!process.argv.includes('--no-reset')) {
    fs.copyFileSync(baseline, target);
    console.log(`🧹 已复位基线: ${path.relative(process.cwd(), target)}（含 2 个故意埋设的 Bug）`);
  }

  const harness = new DeepSeekHarness({
    sessionId: 'real_workspace_demo',
    policy: {
      // 本例没有交互式审批器，因此 ask 一律失败关闭
      onAskWithoutApprover: 'deny',
    },
  });

  harness
    .use(ScriptedWorkspaceModelPlugin, { targetPath: 'src/calculator.js', testCommand: 'node test.js' })
    .use(SandboxGuardPlugin, { workspaceDir })
    .use(RealFSToolsPlugin, { workspaceDir })
    .use(ReActLoopPlugin, { defaultMaxSteps: 8 });

  const result = await harness.run(
    '让 workspace 的自动化测试变绿（真实执行）',
    { verbose: true },
  );

  console.log('\n================ 真实执行结果 ================');
  console.log(`成功: ${result.success}`);
  console.log(`步数: ${result.stepsCount}`);
  console.log(`事件数: ${result.trajectory.length}`);
  console.log(`结论: ${result.summary}`);

  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
