import { DeepSeekHarness } from '../src/core/harness.js';
import { RouterWorkerLoopPlugin } from '../src/plugins/loops/router-worker-loop.js';
import { DeepSeekModelPlugin } from '../src/plugins/models/deepseek-adapter.js';
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js';
import { TerminalToolsPlugin } from '../src/plugins/tools/terminal-tools.js';

/**
 * 示例 4: Super-Agent 原型 (Router-Worker 协同)
 * 演示：Router 接收顶层大目标，拆解并协同 Explorer、Coder、Tester 三大专业角色完成任务
 */
async function main() {
  const harness = new DeepSeekHarness();

  harness
    .use(DeepSeekModelPlugin, { mockMode: true })
    .use(FileToolsPlugin)
    .use(TerminalToolsPlugin)
    // 挂载 Router-Worker 循环插件，替代普通的单 Agent ReAct 循环！
    .use(RouterWorkerLoopPlugin);

  const objective = '全面审查认证系统安全性，修复任何导致测试红灯的隐患并验证';

  const result = await harness.run(objective, { verbose: true });

  console.log('\n最终交付结果:', result.summary);
}

main().catch(console.error);

