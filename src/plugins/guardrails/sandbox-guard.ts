import fs from 'fs';
import path from 'path';
import { resolveConfig } from '../../core/config.js';
import {
  Context,
  Plugin,
  PolicyDenyCode,
  PolicyService,
  PolicyVerdict,
  ToolCallRecord,
} from '../../core/types.js';

export interface SandboxGuardOptions {
  /** 工作区根目录；所有真实文件操作与命令都必须落在这里 */
  workspaceDir: string;
  /** Shell 允许执行的二进制白名单（按 basename 比对） */
  allowedCommands?: string[];
  /** 额外需要拒绝的命令正则（字符串形式，便于通过配置传入） */
  denyPatterns?: string[];
  /** 不允许写入的相对路径（默认包含 .env/.git 等敏感目标） */
  protectedPaths?: string[];
}

/** 文件类工具：这些工具的参数里带 path */
const FILE_TOOLS = new Set([
  'file_read',
  'file_write',
  'real_file_read',
  'real_file_write',
  'real_file_patch',
]);
/** 真实磁盘文件工具：需要做工作区越界检查 */
const REAL_FILE_TOOLS = new Set(['real_file_read', 'real_file_write', 'real_file_patch']);
/** Shell 类工具 */
const SHELL_TOOLS = new Set(['bash_run', 'real_bash_run']);

const DEFAULT_DENY_PATTERNS = [
  String.raw`rm\s+(-[a-zA-Z]*\s+)*\/(\s|$)`, // rm -rf /
  String.raw`rm\s+-rf\s+~`,
  String.raw`mkfs`,
  String.raw`dd\s+if=`,
  String.raw`>\s*\/dev\/(sd|disk|rdisk)`,
  String.raw`:\(\)\s*\{.*\};\s*:`, // fork bomb
  String.raw`chmod\s+-R\s+777\s+\/`,
  String.raw`(curl|wget)[^|]*\|\s*(ba)?sh`,
  String.raw`shutdown|reboot|halt`,
  String.raw`git\s+push\s+--force`,
];

const SYSTEM_PATH_PREFIXES = ['/usr', '/bin', '/sbin', '/opt', '/tmp', '/dev/null', '/etc/hosts'];

/**
 * 判断 target 是否严格位于 root 之内。
 * 用 path.relative 而不是 startsWith：`/work` 与 `/workspace-evil` 的前缀陷阱由此消除。
 */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 找到最近的已存在祖先目录，用于 realpath 校验（防符号链接逃逸） */
function nearestExistingAncestor(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * 安全护栏插件（裁决式 / verdict-based）
 *
 * ⚠️ 这里**不再用 throw**。旧实现把拒绝写成 `ctx.on('tool:before_call', () => { throw ... })`，
 * 而 CoreContext.emit 会吞掉监听器异常，导致守卫"喊了一声"就被忽略，
 * `../escape.txt` 能写到工作区外、`rm -rf /` 能真的进 shell。
 *
 * 现在改为向 PolicyEngine 注册规则，由 ToolRegistry.execute 在执行前强制裁决：
 *   deny -> 工具根本不会被调用，返回失败 ToolResult
 *   ask  -> 交给审批器；没有审批器则失败关闭
 */
export const SandboxGuardPlugin: Plugin<SandboxGuardOptions> = (ctx: Context, options) => {
  const cfg = resolveConfig<Required<Pick<SandboxGuardOptions, 'workspaceDir'>> & SandboxGuardOptions>(
    'SandboxGuardPlugin',
    {
      workspaceDir: { type: 'string', required: true },
      allowedCommands: { type: 'string[]' },
      denyPatterns: { type: 'string[]' },
      protectedPaths: { type: 'string[]' },
    },
    options as Record<string, any>,
  );

  const workspaceRoot = path.resolve(cfg.workspaceDir);
  const realWorkspaceRoot = fs.existsSync(workspaceRoot)
    ? fs.realpathSync(workspaceRoot)
    : workspaceRoot;

  const allowedCommands = (
    cfg.allowedCommands ?? [
      'npm',
      'pnpm',
      'npx',
      'node',
      'tsx',
      'git',
      'ls',
      'cat',
      'echo',
      'grep',
      'find',
      'pytest',
      'python',
      'python3',
    ]
  ).map((c) => path.basename(c));

  let denyPatterns: RegExp[];
  try {
    denyPatterns = [...DEFAULT_DENY_PATTERNS, ...(cfg.denyPatterns ?? [])].map((p) => new RegExp(p));
  } catch (err: any) {
    throw new Error(`[SandboxGuardPlugin] Config Error: denyPatterns 中有非法正则 —— ${err.message}`);
  }

  const protectedPaths = cfg.protectedPaths ?? [
    '.env',
    '.env.local',
    '.git/config',
    '.ssh/id_rsa',
    'credentials.json',
  ];

  if (!ctx.has('policies')) {
    throw new Error(
      '[SandboxGuardPlugin] PolicyService is missing. 请用 DeepSeekHarness 引导，它会注入 policies 服务。',
    );
  }
  const policies = ctx.get('policies') as PolicyService;

  const deny = (
    reason: string,
    code: PolicyDenyCode,
  ): PolicyVerdict => ({ decision: 'deny', reason, code });

  // ---------- 规则 1：真实文件路径必须落在工作区内 ----------
  const disposePath = policies.use({
    name: 'sandbox/path-jail',
    check(call: ToolCallRecord): PolicyVerdict {
      if (!REAL_FILE_TOOLS.has(call.name)) return { decision: 'allow' };

      const rawPath = call.args?.path;
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return deny(`工具 '${call.name}' 缺少必需参数 'path'。`, 'PATH_ESCAPE');
      }

      const abs = path.resolve(workspaceRoot, rawPath);

      if (!isInside(workspaceRoot, abs)) {
        return deny(
          `路径 '${rawPath}' 解析为 '${abs}'，越出允许的工作区 '${workspaceRoot}'。`,
          'PATH_ESCAPE',
        );
      }

      // 符号链接逃逸：把最近的已存在祖先 realpath 之后再比一次
      const ancestorReal = fs.realpathSync(nearestExistingAncestor(abs));
      if (!isInside(realWorkspaceRoot, ancestorReal)) {
        return deny(
          `路径 '${rawPath}' 通过符号链接指向工作区之外（真实路径 '${ancestorReal}'）。`,
          'PATH_ESCAPE',
        );
      }

      // 敏感文件保护
      const rel = path.relative(workspaceRoot, abs).split(path.sep).join('/');
      if (protectedPaths.some((p) => rel === p || rel.startsWith(`${p}/`))) {
        return deny(`'${rel}' 属于受保护的敏感文件，禁止 Agent 读写。`, 'PROTECTED_PATH');
      }

      return { decision: 'allow' };
    },
  });

  // ---------- 规则 2：Shell 二进制白名单 ----------
  const disposeBinary = policies.use({
    name: 'sandbox/command-allowlist',
    check(call: ToolCallRecord): PolicyVerdict {
      if (!SHELL_TOOLS.has(call.name)) return { decision: 'allow' };

      const command = String(call.args?.command ?? '').trim();
      if (!command) return deny('空命令被拒绝。', 'COMMAND_NOT_ALLOWED');

      const binary = path.basename(command.split(/\s+/)[0]);
      if (!allowedCommands.includes(binary)) {
        return deny(
          `命令 '${binary}' 不在白名单内（允许：${allowedCommands.join(', ')}）。`,
          'COMMAND_NOT_ALLOWED',
        );
      }
      return { decision: 'allow' };
    },
  });

  // ---------- 规则 3：危险命令模式 ----------
  const disposeDangerous = policies.use({
    name: 'sandbox/dangerous-command',
    check(call: ToolCallRecord): PolicyVerdict {
      if (!SHELL_TOOLS.has(call.name)) return { decision: 'allow' };

      const command = String(call.args?.command ?? '').trim();

      for (const pattern of denyPatterns) {
        if (pattern.test(command)) {
          return deny(
            `命令命中危险模式 ${pattern}，已拦截：'${command}'。`,
            'DANGEROUS_COMMAND',
          );
        }
      }

      // 命令里出现的绝对路径，不得指向工作区之外（系统目录除外）
      const tokens = command.split(/\s+/).filter((t) => t.startsWith('/'));
      for (const token of tokens) {
        const isSystemPath = SYSTEM_PATH_PREFIXES.some(
          (p) => token === p || token.startsWith(`${p}/`),
        );
        if (isSystemPath) continue;
        if (!isInside(workspaceRoot, token)) {
          return deny(
            `命令包含工作区之外的绝对路径 '${token}'。`,
            'PATH_ESCAPE',
          );
        }
      }

      return { decision: 'allow' };
    },
  });

  if (process.env.DSH_STUDY_VERBOSE_POLICY === '1') {
    console.log(`[SandboxGuard] 已注册策略：${policies.list().join(', ')}`);
    console.log(`[SandboxGuard] 工作区：${workspaceRoot}`);
  }

  return () => {
    disposePath();
    disposeBinary();
    disposeDangerous();
  };
};

export { FILE_TOOLS, isInside };
