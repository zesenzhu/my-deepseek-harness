import { Context, Disposable, Plugin, ToolDefinition, ToolRegistry } from '../../core/types.js';

export interface FileToolsOptions {
  initialFiles?: Record<string, string>;
}

/**
 * 文件沙箱环境与文件操作工具集插件
 */
export const FileToolsPlugin: Plugin<FileToolsOptions> = (ctx: Context, options = {}) => {
  // 维护沙箱内虚拟文件系统状态
  const virtualFS = new Map<string, string>();

  // 预装初始文件（例如包含一个带有 Bug 的认证文件）
  const defaultFiles: Record<string, string> = {
    'src/auth.js': `// 认证模块 (存在逻辑 Bug)
export function verifyToken(token, now = Date.now() / 1000) {
  if (!token || token.length < 10) return { valid: false, code: 400 };
  const exp = 1700000000;
  // 错误：反向判断了过期时间
  if (now < exp) {
    return { valid: false, code: 401, error: "Token expired" };
  }
  return { valid: true, user: "admin" };
}
`,
    'package.json': `{
  "name": "sample-auth-service",
  "version": "1.0.0",
  "scripts": {
    "test": "node test.js"
  }
}`,
  };

  const initial = { ...defaultFiles, ...(options.initialFiles || {}) };
  for (const [path, content] of Object.entries(initial)) {
    virtualFS.set(path, content);
  }

  // 1. 读取文件工具
  const readFileTool: ToolDefinition = {
    name: 'file_read',
    description: '读取沙箱文件系统中的指定文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要读取的相对路径 (例如: src/auth.js)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const filePath = String(args.path);
      if (!virtualFS.has(filePath)) {
        return {
          success: false,
          output: '',
          error: `FileNotFoundError: File '${filePath}' does not exist in workspace.`,
        };
      }
      return {
        success: true,
        output: virtualFS.get(filePath)!,
      };
    },
  };

  // 2. 写入/修改文件工具
  const writeFileTool: ToolDefinition = {
    name: 'file_write',
    description: '向沙箱文件系统中写入或替换指定文件的全部内容',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目标文件相对路径',
        },
        content: {
          type: 'string',
          description: '写入的完整代码内容',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const filePath = String(args.path);
      const content = String(args.content);
      virtualFS.set(filePath, content);
      return {
        success: true,
        output: `Successfully wrote ${content.length} bytes to ${filePath}`,
      };
    },
  };

  // 3. 列出目录工具
  const listDirTool: ToolDefinition = {
    name: 'list_directory',
    description: '列出沙箱文件系统中的所有文件列表',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: '可选的文件名前缀或通配过滤',
        },
      },
    },
    execute: async () => {
      const files = Array.from(virtualFS.keys());
      return {
        success: true,
        output: files.join('\n'),
      };
    },
  };

  // 注册到 Harness 提供的 ToolRegistry（registry 内部的 execute 会强制走策略裁决）
  const registry = ctx.get('tools') as ToolRegistry;
  if (!registry) {
    throw new Error('[FileToolsPlugin] ToolRegistry must be provided by the harness first!');
  }

  const d1 = registry.register(readFileTool);
  const d2 = registry.register(writeFileTool);
  const d3 = registry.register(listDirTool);

  // 暴露沙箱存储引用，供其他沙箱工具（如终端测试）查看
  ctx.provide('virtualFS', virtualFS);

  return () => {
    d1();
    d2();
    d3();
  };
};

