import {
  Context,
  Disposable,
  ToolCallRecord,
  ToolDefinition,
  ToolPolicyRule,
  ToolRegistry,
  ToolResult,
} from './types.js';

/**
 * 进程内工具注册表。
 *
 * 执行顺序是本文件的核心教学点，也是修复"守卫形同虚设"的关键：
 *   1. 查表
 *   2. **策略裁决**（allow / deny / ask）—— 必须在这里拦，不能靠事件监听器抛异常
 *   3. tool:before_call 通知（监听器抛错只记日志，不影响执行）
 *   4. 执行工具
 *   5. tool:after_call 通知
 */
export class InMemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private rules: ToolPolicyRule[] = [];

  register(tool: ToolDefinition): Disposable {
    if (this.tools.has(tool.name)) {
      throw new Error(`[ToolRegistry] Tool '${tool.name}' is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return () => {
      this.tools.delete(tool.name);
    };
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  use(rule: ToolPolicyRule): Disposable {
    this.rules.push(rule);
    return () => {
      this.rules = this.rules.filter((r) => r !== rule);
    };
  }

  async execute(call: ToolCallRecord, ctx: Context): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `Tool '${call.name}' not found.`,
      };
      await ctx.emit('tool:after_call', { call, result });
      return result;
    }

    // ---- 1. 准入裁决（拦截在这里真正生效） ----
    const verdict = await this.evaluate(call, ctx);
    if (verdict.decision === 'deny') {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `[Policy Denied${verdict.code ? ` / ${verdict.code}` : ''}] ${verdict.reason}`,
        metadata: { denied: true, code: verdict.code },
      };
      await ctx.emit('tool:denied', { call, reason: verdict.reason, code: verdict.code });
      await ctx.emit('tool:after_call', { call, result });
      return result;
    }

    // ---- 2. 执行前通知（纯观察，抛错不阻断） ----
    await ctx.emit('tool:before_call', call);

    // ---- 3. 执行 ----
    let result: ToolResult;
    try {
      result = await tool.execute(call.args, ctx);
    } catch (err: any) {
      result = {
        success: false,
        output: '',
        error: `Tool '${call.name}' threw: ${err?.message ?? String(err)}`,
      };
    }

    await ctx.emit('tool:after_call', { call, result });
    return result;
  }

  /**
   * 合并两处策略来源：Context 上的全局 PolicyEngine（插件用 ctx.get('policies').use 注册），
   * 以及注册表自身的 use() 便捷入口。
   */
  private async evaluate(call: ToolCallRecord, ctx: Context) {
    if (ctx.has('policies')) {
      const verdict = await ctx.get('policies')!.check(call);
      if (verdict.decision === 'deny') return verdict;
    }
    for (const rule of this.rules) {
      let verdict;
      try {
        verdict = await rule.check(call);
      } catch (err: any) {
        return {
          decision: 'deny' as const,
          reason: `[Policy '${rule.name}' failed closed] ${err?.message ?? String(err)}`,
        };
      }
      if (verdict.decision === 'deny') return verdict;
    }
    return { decision: 'allow' as const };
  }
}
