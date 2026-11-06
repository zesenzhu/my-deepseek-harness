import {
  Context,
  ContextServices,
  Disposable,
  EventHandler,
  EventMap,
  Plugin
} from './types.js';

/**
 * Cordis 风格的服务上下文容器
 * 实现微内核依赖注入 (DI)、事件总线 (EventBus) 与插件生命周期管理
 */
export class CoreContext implements Context {
  private services = new Map<string, any>();
  private listeners = new Map<string, Set<EventHandler>>();
  private disposers: Disposable[] = [];

  /**
   * 注册向上下文暴露的核心服务
   */
  provide<K extends keyof ContextServices>(name: K, service: ContextServices[K]): void {
    this.services.set(name as string, service);
  }

  /**
   * 获取上下文中注册的服务
   */
  get<K extends keyof ContextServices>(name: K): ContextServices[K] {
    const service = this.services.get(name as string);
    if (!service) {
      throw new Error(`[Context Error] Service '${String(name)}' is not provided in this context.`);
    }
    return service;
  }

  /**
   * 判断某个服务是否存在
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * 注册事件监听器，返回对应的注销函数
   */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): Disposable {
    const eventName = event as string;
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    const handlers = this.listeners.get(eventName)!;
    handlers.add(handler);

    const dispose = () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(eventName);
      }
    };

    this.disposers.push(dispose);
    return dispose;
  }

  /**
   * 异步派发事件
   */
  async emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void> {
    const handlers = this.listeners.get(event as string);
    if (!handlers || handlers.size === 0) return;

    for (const handler of Array.from(handlers)) {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[Event Error] Error in handler for event '${String(event)}':`, err);
      }
    }
  }

  /**
   * 挂载插件，支持返回清理函数并在上下文销毁时卸载
   */
  plugin<T = any>(plugin: Plugin<T>, options?: T): Disposable {
    let cleanUp: Disposable | void;
    try {
      cleanUp = plugin(this, options);
    } catch (err) {
      console.error(`[Plugin Error] Failed to load plugin:`, err);
      throw err;
    }

    const dispose = () => {
      if (typeof cleanUp === 'function') {
        cleanUp();
      }
    };

    this.disposers.push(dispose);
    return dispose;
  }

  /**
   * 销毁当前上下文
   */
  dispose(): void {
    for (const dispose of this.disposers.reverse()) {
      try {
        dispose();
      } catch (e) {
        // ignore
      }
    }
    this.services.clear();
    this.listeners.clear();
    this.disposers = [];
  }
}

