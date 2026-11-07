import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveConfig } from '../../core/config.js';
import { isInside } from '../guardrails/sandbox-guard.js';
import { Context, Plugin, SessionStore, TrajectoryEvent } from '../../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebServerOptions {
  port?: number;
  workspaceDir: string;
}

/**
 * Web 可视化仪表盘与 SSE 实时推流插件 (WebServerPlugin)
 */
export const WebServerPlugin: Plugin<WebServerOptions> = (ctx: Context, options) => {
  const cfg = resolveConfig<WebServerOptions>(
    'WebServerPlugin',
    {
      port: { type: 'number', default: 3000, min: 1, max: 65535 },
      workspaceDir: { type: 'string', default: './workspace' },
    },
    options as Record<string, any>,
  );
  const port = cfg.port!;
  const workspaceRoot = path.resolve(cfg.workspaceDir!);
  const sseClients = new Set<http.ServerResponse>();

  // 1. 监听 Context 的所有核心事件，向所有已连接的 Web 客户端广播 SSE
  const broadcastEvent = (eventType: string, data: any) => {
    const payload = JSON.stringify({ eventType, timestamp: Date.now(), data });
    for (const res of sseClients) {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch (err) {
        sseClients.delete(res);
      }
    }
  };

  const d1 = ctx.on('agent:start', (data) => broadcastEvent('agent:start', data));
  const d2 = ctx.on('agent:step:before', (data) => broadcastEvent('agent:step:before', data));
  const d3 = ctx.on('agent:step:after', (data) => broadcastEvent('agent:step:after', data));
  const d4 = ctx.on('tool:before_call', (data) => broadcastEvent('tool:before_call', data));
  const d5 = ctx.on('tool:after_call', (data) => broadcastEvent('tool:after_call', data));
  const d6 = ctx.on('agent:finished', (data) => broadcastEvent('agent:finished', data));

  // 2. 创建原生 HTTP 服务
  const server = http.createServer(async (req, res) => {
    // 跨域处理
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // SSE 实时推流端点
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ eventType: 'connected', time: Date.now() })}\n\n`);
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // API: 触发运行任务
    if (url.pathname === '/api/run' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const objective =
            parsed.objective ||
            '排查并修复 workspace/src/calculator.js 中的反向计算与除零隐患，并通过自动化测试验证。';

          // 异步启动
          if (ctx.has('loop')) {
            const loop = ctx.get('loop')!;
            // 后台执行，通过 SSE 实时推流
            loop.run(objective, { verbose: true }).catch((err: any) => {
              broadcastEvent('error', { message: err.message });
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'started', objective }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No AgentLoop installed.' }));
          }
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: 获取会话轨迹 Trajectory
    if (url.pathname === '/api/trajectory') {
      const session = ctx.get('session') as SessionStore | undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events: session ? session.getEvents() : [] }));
      return;
    }

    // API: 获取当前工作区文件内容
    if (url.pathname === '/api/file') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400);
        res.end('Missing path');
        return;
      }
      const absPath = path.resolve(workspaceRoot, filePath);
      // 用 path.relative 判定，避免 '/work' 前缀放行 '/workspace-evil' 的陷阱
      if (!isInside(workspaceRoot, absPath) || !fs.existsSync(absPath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(fs.readFileSync(absPath, 'utf-8'));
      return;
    }

    // 默认提供前端 HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf-8'));
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\n🌐 [DeepSeek Harness Web Console] 服务已启动: http://localhost:${port}`);
    console.log(`📡 SSE 事件流端点就绪: http://localhost:${port}/events\n`);
  });

  return () => {
    d1();
    d2();
    d3();
    d4();
    d5();
    d6();
    for (const client of sseClients) {
      client.end();
    }
    server.close();
  };
};

