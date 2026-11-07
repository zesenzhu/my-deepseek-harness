import dotenv from 'dotenv'
import { DeepSeekHarness } from '../src/core/harness.js'
import { ReActLoopPlugin } from '../src/plugins/loops/react-loop.js'
import { DeepSeekModelPlugin } from '../src/plugins/models/deepseek-adapter.js'
import { FileToolsPlugin } from '../src/plugins/tools/file-tools.js'
import { TerminalToolsPlugin } from '../src/plugins/tools/terminal-tools.js'

dotenv.config()

/**
 * 示例 1: 基础自主 Agent 任务
 * 演示：LLM 自主阅读代码、跑测试、发现反向逻辑 Bug、写入修复并验证通过
 */
async function runBasicAgent() {
  const harness = new DeepSeekHarness()

  harness
    .use(DeepSeekModelPlugin) // 自动根据 .env 判定 live 或 mock 模式
    .use(FileToolsPlugin)
    .use(TerminalToolsPlugin)
    .use(ReActLoopPlugin, { defaultMaxSteps: 6 })

  const objective = '修复认证代码中的逻辑漏洞并执行自动化回归验证。'
  const result = await harness.run(objective, { verbose: true })

  console.log('Result:', result.summary)
}

runBasicAgent().catch(console.error)
