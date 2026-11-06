import dotenv from 'dotenv';
import { DeepSeekHarness } from './core/harness.js';
import { ReActLoopPlugin } from './plugins/loops/react-loop.js';
import { DeepSeekModelPlugin } from './plugins/models/deepseek-adapter.js';
import { FileToolsPlugin } from './plugins/tools/file-tools.js';
import { TerminalToolsPlugin } from './plugins/tools/terminal-tools.js';

dotenv.config();

export * from './core/types.js';
export * from './core/context.js';
export * from './core/session.js';
export * from './core/harness.js';
export * from './plugins/models/deepseek-adapter.js';
export * from './plugins/tools/file-tools.js';
export * from './plugins/tools/terminal-tools.js';
export * from './plugins/loops/react-loop.js';
export * from './plugins/loops/router-worker-loop.js';

/**
 * 默认交互启动 CLI 演示
 */
async function main() {
  console.log('🚀 正在初始化 DeepSeek Harness 运行时环境...');

  // 1. 初始化 Harness 实例
  const harness = new DeepSeekHarness();

  // 2. 装配插件树 (Everything is a Plugin)
  harness
    .use(DeepSeekModelPlugin, { mockMode: true }) // 默认使用纯真模拟器，开箱即用
    .use(FileToolsPlugin)
    .use(TerminalToolsPlugin)
    .use(ReActLoopPlugin);

  // 3. 执行自主编程任务
  const task =
    '排查并修复 src/auth.js 中的 Token 过期反向判定 Bug，在沙箱中运行 npm test 确保所有测试通过。';

  const result = await harness.run(task, { maxSteps: 8, verbose: true });

  console.log(`\n任务最终状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
  console.log(`执行步骤数: ${result.stepsCount}`);
  console.log(`事件轨迹总数: ${result.trajectory.length}`);
}

// 如果作为主入口直接运行
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  main().catch(console.error);
}

