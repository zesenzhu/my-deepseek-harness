import { CoreContext } from './context.js';
import { MemorySessionStore } from './session.js';
import { Context, Plugin, RunOptions, RunResult } from './types.js';

export interface HarnessConfig {
  sessionId?: string;
}

/**
 * DeepSeek Harness (dsh) 主引导类
 * 负责装配上下文、加载插件树、发起任务
 */
export class DeepSeekHarness {
  public readonly ctx: Context;

  constructor(config: HarnessConfig = {}) {
    this.ctx = new CoreContext();
    // 注入默认的 SessionStore
    this.ctx.provide('session', new MemorySessionStore(config.sessionId));
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
        `[Harness Error] No AgentLoop plugin installed! Please install ReActLoopPlugin or RouterWorkerLoopPlugin.`
      );
    }
    const loop = this.ctx.get('loop');
    return await loop.run(objective, options);
  }
}

