import { DeepSeekHarness } from '../src/core/harness.js';
import { SessionStore, TrajectoryEvent } from '../src/core/types.js';
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js';
import { DeepSeekModelPlugin } from '../src/plugins/models/deepseek-adapter.js';
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js';
import { TerminalToolsPlugin } from '../src/plugins/tools/terminal-tools.js';

/**
 * 示例 3: 会话轨迹持久化、回放 (Replay) 与分支 (Branching)
 */
async function main() {
  const harness = new DeepSeekHarness({ sessionId: 'study_session_001' });

  harness
    .use(DeepSeekModelPlugin, { mockMode: true })
    .use(FileToolsPlugin)
    .use(TerminalToolsPlugin)
    .use(ReActLoopPlugin);

  // 1. 运行任务，生成不可变事件流
  console.log('--- 1. 执行初始任务 ---');
  await harness.run('修复验证逻辑并跑通测试', { verbose: false });

  const session = harness.ctx.get('session') as SessionStore;
  const events = session.getEvents();

  console.log(`\n--- 2. 会话事件流回放 (Replay) [共 ${events.length} 个事件] ---`);
  events.forEach((evt: TrajectoryEvent, idx: number) => {
    const timeStr = new Date(evt.timestamp).toISOString().substring(11, 19);
    console.log(
      `[${timeStr}] #${evt.id} | 类型: ${evt.type.padEnd(16)} | 内容摘要: ${JSON.stringify(evt.payload).slice(0, 70)}...`
    );
  });

  // 2. 模拟从第 3 个事件 (例如第一次工具调用后) 进行时空分支 (Branching)
  console.log('\n--- 3. 会话分叉 (Forking Session from evt_0003) ---');
  const branchedSession = session.branch('evt_0003');
  console.log(`原 Session ID: ${session.id} (事件数: ${session.getEvents().length})`);
  console.log(`分叉 Session ID: ${branchedSession.id} (事件数: ${branchedSession.getEvents().length})`);

  // 3. 导出 JSON Trajectory
  console.log('\n--- 4. 导出事件轨迹 JSON 预览 (前 200 字符) ---');
  const jsonOutput = session.exportJSON();
  console.log(jsonOutput.slice(0, 200) + '\n...');
}

main().catch(console.error);

