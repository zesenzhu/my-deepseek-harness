import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Context, Disposable, Plugin, ToolDefinition, ToolRegistry } from '../../core/types.js';

const execAsync = promisify(exec);

export interface RealFSToolsOptions {
  workspaceDir: string;
  defaultTimeoutMs?: number;
}

/**
 * 真实宿主机沙箱文件系统与 Shell 执行工具插件
 */
export const RealFSToolsPlugin: Plugin<RealFSToolsOptions> = (ctx: Context, options) => {
  if (!options?.workspaceDir) {
    throw new Error('[RealFSToolsPlugin] workspaceDir is required');
  }

  const workspaceRoot = path.resolve(options.workspaceDir);
  const timeoutMs = options.defaultTimeoutMs || 20000;

  // 保证 workspace 目录存在
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  // 1. 真实文件读取
  const realFileReadTool: ToolDefinition = {
    name: 'real_file_read',
    description: '读取工作区目录内的真实文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的相对路径 (例如: src/app.js)',
        },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const target = path.resolve(workspaceRoot, String(args.path));
      if (!fs.existsSync(target)) {
        return {
          success: false,
          output: '',
          error: `FileNotFound: File does not exist at '${args.path}'`,
        };
      }
      const content = fs.readFileSync(target, 'utf-8');
      return {
        success: true,
        output: content,
      };
    },
  };

  // 2. 真实文件写入/覆盖
  const realFileWriteTool: ToolDefinition = {
    name: 'real_file_write',
    description: '在工作区目录中创建或覆盖指定文件',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的相对路径',
        },
        content: {
          type: 'string',
          description: '写入的完整文件内容',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const target = path.resolve(workspaceRoot, String(args.path));
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(target, String(args.content), 'utf-8');
      return {
        success: true,
        output: `Successfully written ${Buffer.byteLength(String(args.content))} bytes to '${args.path}'`,
      };
    },
  };

  // 3. 真实目录树扫描
  const realListDirTool: ToolDefinition = {
    name: 'real_list_directory',
    description: '列出工作区目录或子目录下的所有文件结构',
    parameters: {
      type: 'object',
      properties: {
        subPath: {
          type: 'string',
          description: '可选的子目录相对路径，默认为工作区根目录',
        },
      },
    },
    execute: async (args) => {
      const target = path.resolve(workspaceRoot, String(args.subPath || '.'));
      if (!fs.existsSync(target)) {
        return {
          success: false,
          output: '',
          error: `Directory not found: '${args.subPath}'`,
        };
      }

      function scan(dir: string, prefix = ''): string[] {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let files: string[] = [];
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const relPath = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            files.push(`${relPath}/`);
            files = files.concat(scan(path.join(dir, entry.name), relPath));
          } else {
            files.push(relPath);
          }
        }
        return files;
      }

      const allFiles = scan(target);
      return {
        success: true,
        output: allFiles.join('\n') || '(Empty directory)',
      };
    },
  };

  // 4. 真实受控子进程 Shell 执行
  const realBashRunTool: ToolDefinition = {
    name: 'real_bash_run',
    description: '在工作区沙箱目录下安全执行 Shell 命令或自动化测试',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '在工作区中执行的命令 (例如: npm test 或 node test.js)',
        },
      },
      required: ['command'],
    },
    execute: async (args) => {
      const command = String(args.command);
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceRoot,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 2, // 2MB
        });

        return {
          success: true,
          output: (stdout + '\n' + (stderr ? `[stderr]: ${stderr}` : '')).trim(),
        };
      } catch (err: any) {
        return {
          success: false,
          output: (err.stdout || '') + '\n' + (err.stderr || ''),
          error: `Command failed with code ${err.code || 'TIMEOUT'}: ${err.message}`,
        };
      }
    },
  };

  // 获取或初始化工具注册表
  let registry: ToolRegistry;
  if (!ctx.has('tools')) {
    const toolMap = new Map<string, ToolDefinition>();
    registry = {
      register(t: ToolDefinition): Disposable {
        toolMap.set(t.name, t);
        return () => toolMap.delete(t.name);
      },
      get(name: string) {
        return toolMap.get(name);
      },
      list() {
        return Array.from(toolMap.values());
      },
      async execute(call, context) {
        const tool = toolMap.get(call.name);
        if (!tool) {
          return { success: false, output: '', error: `Tool '${call.name}' not found.` };
        }
        await context.emit('tool:before_call', call);
        const result = await tool.execute(call.args, context);
        await context.emit('tool:after_call', { call, result });
        return result;
      },
    };
    ctx.provide('tools', registry);
  } else {
    registry = ctx.get('tools');
  }

  const d1 = registry.register(realFileReadTool);
  const d2 = registry.register(realFileWriteTool);
  const d3 = registry.register(realListDirTool);
  const d4 = registry.register(realBashRunTool);

  return () => {
    d1();
    d2();
    d3();
    d4();
  };
};

