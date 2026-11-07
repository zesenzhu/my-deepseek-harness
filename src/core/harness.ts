import { CoreContext } from './context.js';
import { PolicyEngine, PolicyEngineOptions } from './policy.js';
import { InMemoryToolRegistry } from './registry.js';
import { MemorySessionStore } from './session.js';
import { Context, Plugin, RunOptions, RunResult } from './types.js';

export interface HarnessConfig {
  sessionId?: string;
  /** 策略引擎配置：审批器、失败关闭行为、审计回调 */
  policy?: PolicyEngineOptions;
}

/**
 * DeepSeek Harness (dsh) 学习版主引导类
 *
 * 构造时注入三项基础设施（相当于真实 DSH 里 dsh-base bundle 的第一层）：
 *   - session  事件溯源会话
 *   - policies 工具准入策略引擎（allow / deny / ask）
 *   - tools    工具注册表（执行时强制走策略裁决）
 */
export class DeepSeekHarness {
  public readonly ctx: Context;

  constructor(config: HarnessConfig = {}) {
    this.ctx = new CoreContext();
    this.ctx.provide('session', new MemorySessionStore(config.sessionId));
    this.ctx.provide('policies', new PolicyEngine(config.policy));
    this.ctx.provide('tools', new InMemoryToolRegistry());
  }

  /**
   * 链式挂载插件
   */
  use<T>(plugin: Plugin<T>, options?: T): this {
    this.ctx.plugin(plugin, options);
    return this;
  }

  /**
   * 启动任务执行
   */
  async run(objective: string, options?: RunOptions): Promise<RunResult> {
    if (!this.ctx.has('loop')) {
      throw new Error(
        `[Harness Error] No AgentLoop plugin installed! Please install ReActLoopPlugin or RouterWorkerLoopPlugin.`,
      );
    }
    const loop = this.ctx.get('loop')!;
    return await loop.run(objective, options);
  }
}
