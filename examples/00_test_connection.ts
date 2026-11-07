import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

/**
 * 00. API 连通性快速诊断与测试脚本
 * 用途：验证 .env 中的 API Key、Base URL 与 Model 配置是否能正常通信
 */
async function testConnection() {
  console.log(chalk.bold.cyan('\n🔍 [DeepSeek Harness] 正在诊断 .env 配置与 API 连通性...\n'));

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const mode = process.env.EXECUTION_MODE || 'live';

  console.log(`- 模式 (EXECUTION_MODE): ${chalk.yellow(mode)}`);
  console.log(`- 接口地址 (DEEPSEEK_BASE_URL): ${chalk.green(baseURL)}`);
  console.log(`- 选用模型 (DEEPSEEK_MODEL): ${chalk.green(model)}`);
  console.log(`- 密钥状态 (DEEPSEEK_API_KEY): ${apiKey ? chalk.green('已配置 (以 ' + apiKey.slice(0, 6) + '... 开头)') : chalk.red('未配置')}\n`);

  if (!apiKey) {
    console.log(chalk.red('❌ 错误: 未检测到 DEEPSEEK_API_KEY，请在 .env 中填入有效的密钥。'));
    process.exit(1);
  }

  const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  console.log(`⏳ 正在向 ${endpoint} 发送测试 Ping 请求...`);

  const startTime = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a test assistant. Answer in Chinese briefly.',
          },
          {
            role: 'user',
            content: '你好，如果你能收到这条消息，请回复：“DeepSeek Harness 联调成功！”并简要说明你的模型类型。',
          },
        ],
        temperature: 0.1,
      }),
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      console.log(chalk.red(`\n❌ API 请求返回错误 HTTP ${res.status} ${res.statusText}:`));
      console.log(chalk.gray(errText));
      console.log(chalk.yellow('\n💡 常见排查建议:'));
      console.log('1. 检查 API Key 是否有效且有足够额度；');
      console.log('2. 检查第三方代理中转地址 DEEPSEEK_BASE_URL 是否正确，末尾是否有多余路径；');
      console.log('3. 检查 DEEPSEEK_MODEL 是否在当前服务商所支持的模型列表中。');
      process.exit(1);
    }

    const data = (await res.json()) as any;
    const reply = data.choices?.[0]?.message;

    console.log(chalk.bold.green(`\n🎉 连接成功！(耗时 ${elapsed}ms)`));
    if (reply?.reasoning_content) {
      console.log(chalk.italic.gray(`💭 思考链 (Reasoning):\n${reply.reasoning_content}\n`));
    }
    console.log(chalk.white(`🤖 模型回复: ${reply?.content}`));
    if (data.usage) {
      console.log(chalk.gray(`📊 统计: 输入 ${data.usage.prompt_tokens} tokens, 输出 ${data.usage.completion_tokens} tokens, 合计 ${data.usage.total_tokens} tokens`));
    }
    console.log(chalk.cyan('\n✅ 恭喜！当前环境已经可以完美驱动 DeepSeek Harness 真实任务执行！'));
  } catch (err: any) {
    console.log(chalk.red(`\n❌ 网络连接异常: ${err.message}`));
    console.log(chalk.yellow('💡 提示: 请检查本地网络或代理设置是否能正常访问该 API 域名。'));
  }
}

testConnection();

