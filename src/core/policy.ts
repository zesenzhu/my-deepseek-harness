import {
  Disposable,
  PolicyService,
  PolicyVerdict,
  ToolCallRecord,
  ToolPolicyRule,
} from './types.js';

/**
 * 人工审批器：当某条规则返回 `ask` 时，由它决定是否放行。
 * 返回 true = 批准本次调用；false = 拒绝。
 */
export type ApprovalHandler = (request: {
  call: ToolCallRecord;
  reason: string;
  rule: string;
}) => Promise<boolean>;

export interface PolicyEngineOptions {
  /**
   * 未提供审批器时的行为。
   * 默认 'deny'（失败关闭，fail-closed），与真实 DSH 一致：
   * 无法获得批准就必须拒绝，绝不能静默放行。
   */
  onAskWithoutApprover?: 'deny' | 'allow';
  approvalHandler?: ApprovalHandler;
  /** 审计钩子：每次裁决都会回调，便于记录到 Trajectory */
  onDecision?: (call: ToolCallRecord, verdict: PolicyVerdict, rule: string) => void;
}

export class PolicyEngine implements PolicyService {
  private rules: ToolPolicyRule[] = [];
  private options: PolicyEngineOptions;

  constructor(options: PolicyEngineOptions = {}) {
    this.options = options;
  }

  use(rule: ToolPolicyRule): Disposable {
    const existing = this.rules.findIndex((r) => r.name === rule.name);
    if (existing !== -1) {
      throw new Error(`[PolicyEngine] Policy rule '${rule.name}' is already registered.`);
    }
    this.rules.push(rule);
    return () => {
      this.rules = this.rules.filter((r) => r !== rule);
    };
  }

  list(): string[] {
    return this.rules.map((r) => r.name);
  }

  /**
   * 依次执行所有规则。
   * - 任一 deny：立即短路返回 deny
   * - 任一 ask：询问审批器；无审批器按配置失败关闭
   * - 规则内部抛错：视为 deny（失败关闭），绝不放行
   */
  async check(call: ToolCallRecord): Promise<PolicyVerdict> {
    for (const rule of this.rules) {
      let verdict: PolicyVerdict;
      try {
        verdict = await rule.check(call);
      } catch (err: any) {
        verdict = {
          decision: 'deny',
          reason: `[Policy '${rule.name}' failed closed] ${err?.message ?? String(err)}`,
        };
      }

      if (verdict.decision === 'allow') continue;

      if (verdict.decision === 'deny') {
        this.options.onDecision?.(call, verdict, rule.name);
        return verdict;
      }

      // ask
      const approved = await this.resolveAsk(call, rule, verdict.reason);
      if (!approved) {
        const denied: PolicyVerdict = {
          decision: 'deny',
          reason: approved === false
            ? `[Approval rejected by human] ${verdict.reason}`
            : `[Approval unavailable, failing closed] ${verdict.reason}`,
          code: approved === false ? 'APPROVAL_REJECTED' : 'APPROVAL_UNAVAILABLE',
        };
        this.options.onDecision?.(call, denied, rule.name);
        return denied;
      }
    }

    return { decision: 'allow' };
  }

  /** 返回 true=批准，false=被拒绝，undefined=没有审批器 */
  private async resolveAsk(
    call: ToolCallRecord,
    rule: ToolPolicyRule,
    reason: string,
  ): Promise<boolean | undefined> {
    if (!this.options.approvalHandler) {
      return this.options.onAskWithoutApprover === 'allow' ? true : undefined;
    }
    try {
      return await this.options.approvalHandler({ call, reason, rule: rule.name });
    } catch {
      return undefined;
    }
  }
}
