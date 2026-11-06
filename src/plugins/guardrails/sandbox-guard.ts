import path from 'path';
import { Context, Plugin, ToolCallRecord } from '../../core/types.js';

export interface SandboxGuardOptions {
  workspaceDir: string;
  allowedCommands?: string[];
  maxCommandTimeoutMs?: number;
}

/**
 * 核心安全护栏插件 (Sandbox Guard Plugin)
 * 职责：
 * 1. 严格将所有文件操作圈禁在指定工作区目录 (Workspace Jail) 内，阻止路径穿越 (Directory Traversal)
 * 2. 对所有 Shell 命令进行白名单与危险指令校验
 */
export const SandboxGuardPlugin: Plugin<SandboxGuardOptions> = (ctx: Context, options) => {
  if (!options?.workspaceDir) {
    throw new Error('[SandboxGuardPlugin] workspaceDir is required!');
  }

  const safeWorkspaceRoot = path.resolve(options.workspaceDir);
  const allowedCommands = options.allowedCommands || [
    'npm',
    'node',
    'git',
    'ls',
    'cat',
    'echo',
    'grep',
    'find',
    'pytest',
    'python',
    'python3',
  ];

  // 1. 拦截所有工具调用前的安全风险
  const disposeBefore = ctx.on('tool:before_call', (call: ToolCallRecord) => {
    // 检查文件路径相关工具
    if (['real_file_read', 'real_file_write', 'real_file_patch'].includes(call.name)) {
      const targetPath = call.args.path as string;
      if (!targetPath) {
        throw new Error(`[Sandbox Guard] Missing required 'path' argument in tool '${call.name}'.`);
      }

      const absoluteTarget = path.resolve(safeWorkspaceRoot, targetPath);
      // 必须确保解析后的绝对路径以工作区目录开头，严防 ../../ 逃逸
      if (!absoluteTarget.startsWith(safeWorkspaceRoot)) {
        throw new Error(
          `[Sandbox Guard Security Violation] Access denied! Path '${targetPath}' resolves outside the allowed workspace: '${safeWorkspaceRoot}'.`
        );
      }
    }

    // 检查 Shell 终端执行工具
    if (call.name === 'real_bash_run') {
      const rawCommand = (call.args.command as string || '').trim();
      if (!rawCommand) {
        throw new Error(`[Sandbox Guard] Empty command received.`);
      }

      // 提取命令主程序（如 "npm test" -> "npm"）
      const mainBinary = rawCommand.split(/\s+/)[0];
      const isAllowed = allowedCommands.some((allowed) => mainBinary === allowed || rawCommand.startsWith(allowed));

      // 危险命令黑名单双重拦截
      const dangerousPatterns = [
        /rm\s+-rf\s+\//,
        /mkfs/,
        />\s*\/dev\//,
        /:(){ :\|:& };:/, // Fork bomb
        /chmod\s+-R\s+777\s+\//,
        /curl.*\|\s*bash/,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(rawCommand)) {
          throw new Error(
            `[Sandbox Guard Alert] Extremely dangerous command pattern detected: '${rawCommand}'. Blocked immediately.`
          );
        }
      }

      if (!isAllowed) {
        throw new Error(
          `[Sandbox Guard] Command '${rawCommand}' is not in the allowed whitelist (${allowedCommands.join(', ')}).`
        );
      }
    }
  });

  return () => {
    disposeBefore();
  };
};

