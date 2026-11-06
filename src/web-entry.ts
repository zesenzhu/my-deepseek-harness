import path from 'path';
import { DeepSeekHarness } from './core/harness.js';
import { SandboxGuardPlugin } from './plugins/guardrails/sandbox-guard.js';
import { SuperAgentLoopPlugin } from './plugins/loops/superagent-loop.js';
import { DeepSeekModelPlugin } from './plugins/models/deepseek-adapter.js';
import { RealFSToolsPlugin } from './plugins/tools/real-fs-tools.js';
import { WebServerPlugin } from './plugins/web/server.js';

/**
 * Web 可视化控制台启动入口
 * 一键装配：真实沙箱 + 安全守卫 + Router-Worker 协同 + 原生 SSE Web 看板
 */
async function bootstrap() {
  const workspaceDir = path.resolve(process.cwd(), 'workspace');

  console.log('⚡ 正在启动 DeepSeek Harness (dsh) 全栈控制台...');
  console.log(`🔒 工作区沙箱绑定路径: ${workspaceDir}`);

  const harness = new DeepSeekHarness();

  harness
    // 1. 注册核心模型适配插件
    .use(DeepSeekModelPlugin, { mockMode: true })
    // 2. 注册安全守卫中间件（圈禁在 ./workspace）
    .use(SandboxGuardPlugin, { workspaceDir })
    // 3. 注册真实文件与 Shell 子进程执行工具
    .use(RealFSToolsPlugin, { workspaceDir })
    // 4. 注册 Super-Agent Router-Worker 循环插件
    .use(SuperAgentLoopPlugin, { workspaceDir })
    // 5. 注册 Web 可视化推流服务器
    .use(WebServerPlugin, { port: 3000, workspaceDir });

  console.log('✅ Harness 上下文与插件树已装配就绪！');
  console.log('👉 请在浏览器打开: http://localhost:3000 进行可视化操作与实时推流查看。');
}

bootstrap().catch(console.error);

