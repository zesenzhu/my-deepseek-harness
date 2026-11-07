import dotenv from 'dotenv'
import {
  Context,
  Message,
  ModelAdapter,
  ModelResponse,
  Plugin,
  ToolDefinition,
} from '../../core/types.js'

dotenv.config()

export interface DeepSeekAdapterOptions {
  apiKey?: string
  baseURL?: string
  model?: string
  mockMode?: boolean
}

/**
 * 【剧本回放引擎】（Scripted Fixture）—— 务必看清它是什么
 *
 * 它不是模型，也不做任何推理：只是按 turn 依次吐出写死的 5 个回合。
 * 之所以保留它，是为了在没有 API Key 时也能把"循环 + 工具 + 事件"这条工程链路跑通。
 *
 * 但它会让人误以为"看到的是模型能力"。因此：
 *   1. 所有输出都会带 [SCRIPTED] 前缀；
 *   2. 想观察真实的行为差异，请用 examples/05（真实文件系统 + 真实 shell）。
 */
class MockDeepSeekEngine {
  private turn = 0

  async generate(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ModelResponse> {
    this.turn++
    const lastMsg = messages[messages.length - 1]

    // 第一回合：分析任务，决定查看代码
    if (this.turn === 1) {
      return {
        thought:
          '[SCRIPTED] 用户要求排查并修复认证模块的 Token 过期 Bug。首先我需要查看当前的源码结构，使用 file_read 读取 src/auth.js 文件。',
        content: '我正在读取 src/auth.js 以了解当前的 JWT 鉴权逻辑。',
        toolCalls: [
          {
            id: 'call_read_auth_01',
            name: 'file_read',
            args: { path: 'src/auth.js' },
          },
        ],
        usage: { promptTokens: 350, completionTokens: 85, totalTokens: 435 },
      }
    }

    // 第二回合：观察到代码中的错误（使用了错误的比较操作符），准备执行测试复现
    if (this.turn === 2) {
      return {
        thought:
          '[SCRIPTED] 通过阅读代码，我发现 verifyToken 方法中，过期时间计算存在反向逻辑：`if (now < exp)` 判定为过期，这显然是写反了。但在修改前，我应该先运行一次单元测试复现该失败。',
        content:
          '我已发现潜在的问题代码。在进行修复前，我先在沙箱中运行测试套件以复现错误。',
        toolCalls: [
          {
            id: 'call_test_01',
            name: 'bash_run',
            args: { command: 'npm test' },
          },
        ],
        usage: { promptTokens: 620, completionTokens: 110, totalTokens: 730 },
      }
    }

    // 第三回合：从沙箱测试失败的 observation 中提取信息，修复代码
    if (this.turn === 3) {
      return {
        thought:
          '[SCRIPTED] 测试结果验证了我的推断：Test failed with "Expected 401 Unauthorized but received 200 OK". 现在我使用 file_write 将其修正为 `if (now > exp) return { valid: false, code: 401 };`。',
        content: '测试复现了 Bug。现在我应用精确代码修复。',
        toolCalls: [
          {
            id: 'call_fix_auth_01',
            name: 'file_write',
            args: {
              path: 'src/auth.js',
              content: `// 修复后的认证模块
export function verifyToken(token, now = Date.now() / 1000) {
  if (!token || token.length < 10) return { valid: false, code: 400 };
  const exp = 1700000000;
  // 修正：当前时间大于过期时间才判定为过期！
  if (now > exp) {
    return { valid: false, code: 401, error: "Token expired" };
  }
  return { valid: true, user: "admin" };
}
`,
            },
          },
        ],
        usage: { promptTokens: 890, completionTokens: 140, totalTokens: 1030 },
      }
    }

    // 第四回合：再次运行测试验证
    if (this.turn === 4) {
      return {
        thought:
          '[SCRIPTED] 代码已完成写入。现在再次运行测试套件，确保修改生效且全部用例通过。',
        content: '代码修改已应用，正在回归测试。',
        toolCalls: [
          {
            id: 'call_verify_test_02',
            name: 'bash_run',
            args: { command: 'npm test' },
          },
        ],
        usage: { promptTokens: 1100, completionTokens: 70, totalTokens: 1170 },
      }
    }

    // 第五回合：测试全绿，提交总结
    return {
      thought:
        '[SCRIPTED] 模拟测试报告显示全部用例通过。剧本到此结束，无需进一步调用工具。',
      content:
        '[SCRIPTED FIXTURE] 剧本演完了：模拟报告显示全部通过。注意——这不是模型真的修好了代码。',
      usage: { promptTokens: 1250, completionTokens: 90, totalTokens: 1340 },
    }
  }
}

/**
 * 真实 DeepSeek API 适配器（兼容 DeepSeek-V3 / DeepSeek-R1）
 */
class RealDeepSeekAdapter implements ModelAdapter {
  public readonly name = 'DeepSeekAdapter (Live)'
  private apiKey: string
  private baseURL: string
  private model: string

  constructor(
    apiKey: string,
    baseURL = 'https://api.deepseek.com/v1',
    model = 'deepseek-chat',
  ) {
    this.apiKey = apiKey
    this.baseURL = baseURL.replace(/\/+$/, '')
    this.model = model
  }

  async generate(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<ModelResponse> {
    const formattedTools = tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
        ...(formattedTools && formattedTools.length > 0
          ? { tools: formattedTools }
          : {}),
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(
        `[DeepSeek API Error] ${response.status} ${response.statusText}: ${errText}`,
      )
    }

    const data = (await response.json()) as any
    const choice = data.choices?.[0]
    const message = choice?.message || {}

    const toolCalls = message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}'),
    }))

    return {
      thought: message.reasoning_content || undefined,
      content: message.content || '',
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    }
  }
}

/**
 * 包装为标准的 DeepSeek Harness Plugin
 */
export const DeepSeekModelPlugin: Plugin<DeepSeekAdapterOptions> = (
  ctx: Context,
  options = {},
) => {
  const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY
  const mockMode =
    options.mockMode ?? (!apiKey || process.env.EXECUTION_MODE === 'mock')

  let adapter: ModelAdapter

  if (mockMode) {
    const mockEngine = new MockDeepSeekEngine()
    adapter = {
      name: 'ScriptedFixture (非模型, 剧本回放)',
      generate: (msgs, tools) => mockEngine.generate(msgs, tools),
    }
    console.log('[ModelPlugin] 模式: 🧪 剧本回放 (Scripted Fixture) —— 不是模型推理，不产生真实决策')
  } else {
    const baseURL =
      options.baseURL ||
      process.env.DEEPSEEK_BASE_URL ||
      'https://api.deepseek.com/v1'
    const model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    adapter = new RealDeepSeekAdapter(apiKey!, baseURL, model)
    console.log(`[ModelPlugin] 模式: 🚀 真实模型调用 (Live Mode)`)
    console.log(`[ModelPlugin] 目标模型: ${model}`)
    console.log(`[ModelPlugin] 接口地址: ${baseURL}`)
  }

  // 注册到上下文
  ctx.provide('model', adapter)

  return () => {
    // cleanup
  }
}
