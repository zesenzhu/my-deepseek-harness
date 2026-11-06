import { SessionStore, TrajectoryEvent } from './types.js';

/**
 * 基于事件溯源 (Event Sourcing) 的会话轨迹存储器
 * 核心保证：事件日志追加且不可变 (Append-Only & Immutable)
 */
export class MemorySessionStore implements SessionStore {
  public readonly id: string;
  private events: TrajectoryEvent[] = [];
  private eventCounter = 0;

  constructor(id?: string, initialEvents: TrajectoryEvent[] = []) {
    this.id = id || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.events = [...initialEvents];
    this.eventCounter = this.events.length;
  }

  /**
   * 追加新事件到轨迹日志
   */
  append(eventData: Omit<TrajectoryEvent, 'id' | 'timestamp'>): TrajectoryEvent {
    this.eventCounter++;
    const event: TrajectoryEvent = {
      id: `evt_${this.eventCounter.toString().padStart(4, '0')}`,
      timestamp: Date.now(),
      ...eventData,
    };

    // 冻结对象，确保外部无法篡改历史事件
    Object.freeze(event);
    this.events.push(event);
    return event;
  }

  /**
   * 获取所有事件副本
   */
  getEvents(): TrajectoryEvent[] {
    return [...this.events];
  }

  /**
   * 基于某个历史事件节点创建新分支 (Branching)
   */
  branch(fromEventId?: string): SessionStore {
    let slicedEvents = this.events;
    if (fromEventId) {
      const index = this.events.findIndex((e) => e.id === fromEventId);
      if (index !== -1) {
        slicedEvents = this.events.slice(0, index + 1);
      }
    }
    const branchedId = `${this.id}_branch_${Date.now().toString().slice(-4)}`;
    return new MemorySessionStore(branchedId, slicedEvents);
  }

  /**
   * 导出为 JSON 字符串
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        sessionId: this.id,
        totalEvents: this.events.length,
        events: this.events,
      },
      null,
      2
    );
  }
}

