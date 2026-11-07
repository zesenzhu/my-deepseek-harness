/**
 * DeepSeek Harness Core Types
 */

// ==========================================
// 1. Cordis 微内核架构类型
// ==========================================

export type Disposable = () => void;

export interface EventMap {
  'agent:start': { objective: string; sessionId: string };
  'agent:step:before': { stepIndex: number; prompt: string };
  'agent:step:after': { stepIndex: number; thought?: string; toolCalls?: ToolCallRecord[] };
  'agent:finished': { success: boolean; result: string; trajectoryLength: number };
  'tool:before_call': ToolCallRecord;
  'tool:after_call': { call: ToolCallRecord; result: ToolResult };
  'tool:denied': { call: ToolCallRecord; reason: string; code?: string };
  'session:event_appended': TrajectoryEvent;
  [key: string]: any;
}

export type EventHandler<T = any> = (payload: T) => Promise<void> | void;

export interface ContextServices {
  model?: ModelAdapter;
  tools?: ToolRegistry;
  session?: SessionStore;
  loop?: AgentLoop;
  policies?: PolicyService;
  [key: string]: any;
}

export interface Context {
  // 服务依赖注入
  provide<K extends keyof ContextServices>(name: K, service: ContextServices[K]): void;
  get<K extends keyof ContextServices>(name: K): ContextServices[K];
  has(name: string): boolean;

  // 事件总线
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): Disposable;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void>;

  // 插件系统
  plugin<T = any>(plugin: Plugin<T>, options?: T): Disposable;
}

export type Plugin<Options = any> = (ctx: Context, options?: Options) => Disposable | void;

// ==========================================
// 2. 工具与环境模型 (Tool & Environment)
// ==========================================

export interface ToolParameterSchema {
  type: string;
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute: (args: Record<string, any>, ctx: Context) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): Disposable;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  execute(call: ToolCallRecord, ctx: Context): Promise<ToolResult>;
  /** 注册一条工具准入策略；返回的函数用于注销该策略 */
  use(rule: ToolPolicyRule): Disposable;
}

// ==========================================
// 2.5 工具准入策略 (Tool Policy)
// ==========================================
//
// 重要：拦截能力**不能**依赖事件处理器抛异常。
// CoreContext.emit 只是"通知"，为了不让一个监听器拖垮整条链路，它会吞掉异常。
// 因此凡是"必须生效"的安全检查，都必须走这里的裁决管线（verdict pipeline）：
//   allow  -> 放行
//   ask    -> 请求人类批准；没有审批器时**失败关闭**（按 deny 处理）
//   deny   -> 直接拒绝，工具不会被调用
// 这也正是真实 DSH 中 dsh-tools（allow/deny/ask）与 dsh-sandbox 的做法。

export type PolicyDenyCode =
  | 'PATH_ESCAPE'
  | 'COMMAND_NOT_ALLOWED'
  | 'DANGEROUS_COMMAND'
  | 'PROTECTED_PATH'
  | 'APPROVAL_UNAVAILABLE'
  | 'APPROVAL_REJECTED';

export type PolicyVerdict =
  | { decision: 'allow' }
  | { decision: 'ask'; reason: string }
  | { decision: 'deny'; reason: string; code?: PolicyDenyCode };

export interface ToolPolicyRule {
  /** 规则名，会出现在审计日志里 */
  name: string;
  /** 返回裁决；抛异常会被视为 deny（失败关闭） */
  check(call: ToolCallRecord): PolicyVerdict | Promise<PolicyVerdict>;
}

export interface PolicyService {
  use(rule: ToolPolicyRule): Disposable;
  check(call: ToolCallRecord): Promise<PolicyVerdict>;
  list(): string[];
}

// ==========================================
// 3. 模型适配器类型 (Model Adapter)
// ==========================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

export interface ModelResponse {
  thought?: string; // 思考推理过程（如 DeepSeek-R1 / CoT）
  content?: string; // 最终回答或总结
  toolCalls?: ToolCallRecord[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelAdapter {
  name: string;
  generate(messages: Message[], tools?: ToolDefinition[]): Promise<ModelResponse>;
}

// ==========================================
// 4. 会话与事件溯源类型 (Session & Event Sourcing)
// ==========================================

export type EventType =
  | 'USER_PROMPT'
  | 'AGENT_THOUGHT'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'GUARDRAIL_INTERCEPT'
  | 'TASK_COMPLETED';

export interface TrajectoryEvent {
  id: string;
  timestamp: number;
  type: EventType;
  payload: any;
  metadata?: {
    stepIndex?: number;
    agentId?: string;
    [key: string]: any;
  };
}

export interface SessionStore {
  id: string;
  append(event: Omit<TrajectoryEvent, 'id' | 'timestamp'>): TrajectoryEvent;
  getEvents(): TrajectoryEvent[];
  branch(fromEventId?: string): SessionStore;
  exportJSON(): string;
}

// ==========================================
// 5. 循环策略类型 (Agent Loop)
// ==========================================

export interface RunOptions {
  maxSteps?: number;
  verbose?: boolean;
}

export interface RunResult {
  success: boolean;
  stepsCount: number;
  summary: string;
  trajectory: TrajectoryEvent[];
}

export interface AgentLoop {
  run(objective: string, options?: RunOptions): Promise<RunResult>;
}

