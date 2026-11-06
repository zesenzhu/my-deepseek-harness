"""
Mini DeepSeek Harness (Python 原生轻量对照版)
零依赖、纯原生 Python 3.8+ 即可直接运行！
演示 DeepSeek Harness 的核心三支柱：
1. 插件化上下文与服务总线 (Context & Plugin Bus)
2. 事件溯源轨迹记录器 (Append-only Event Trajectory)
3. 自主思考与自愈循环 (Thought -> Tool -> Self-Correction Loop)
"""

import json
import time
from typing import Any, Callable, Dict, List, Optional


# ==========================================
# 1. 核心上下文与插件系统
# ==========================================
class Context:
    def __init__(self):
        self.services: Dict[str, Any] = {}
        self.listeners: Dict[str, List[Callable]] = {}

    def provide(self, name: str, service: Any):
        self.services[name] = service

    def get(self, name: str) -> Any:
        if name not in self.services:
            raise KeyError(f"Service '{name}' not found in Context")
        return self.services[name]

    def on(self, event: str, callback: Callable):
        self.listeners.setdefault(event, []).append(callback)

    def emit(self, event: str, data: Any):
        for cb in self.listeners.get(event, []):
            cb(data)

    def plugin(self, plugin_fn: Callable, *args, **kwargs):
        plugin_fn(self, *args, **kwargs)


# ==========================================
# 2. 会话与事件溯源存储 (Event Sourcing)
# ==========================================
class SessionStore:
    def __init__(self, session_id: Optional[str] = None):
        self.id = session_id or f"sess_{int(time.time())}"
        self.events: List[Dict[str, Any]] = []

    def append(self, event_type: str, payload: Any, metadata: Optional[Dict] = None):
        event = {
            "id": f"evt_{len(self.events) + 1:04d}",
            "timestamp": time.time(),
            "type": event_type,
            "payload": payload,
            "metadata": metadata or {},
        }
        self.events.append(event)
        return event

    def replay(self):
        print(f"\n--- [Replay] 会话事件流回放 (共 {len(self.events)} 个事件) ---")
        for e in self.events:
            print(f"[{e['id']}] {e['type']:<18} | {str(e['payload'])[:65]}...")


# ==========================================
# 3. 插件实现 (模型、工具、执行循环)
# ==========================================
def file_tools_plugin(ctx: Context):
    # 沙箱虚拟文件
    virtual_fs = {
        "src/auth.py": "def verify_token(token, now=100):\n    # 错误的反向过期判断\n    if now < 50:\n        return {'valid': False, 'code': 401}\n    return {'valid': True}"
    }

    tools = {
        "file_read": lambda path: virtual_fs.get(path, "Error: File not found"),
        "file_write": lambda path, content: virtual_fs.update({path: content}) or "Success written",
        "run_test": lambda: "FAIL: test_auth_expired failed (now=100 did not reject)" if "now < 50" in virtual_fs.get("src/auth.py", "") else "PASS: 2/2 tests passed"
    }
    ctx.provide("tools", tools)
    ctx.provide("fs", virtual_fs)


def mock_deepseek_model_plugin(ctx: Context):
    # 模拟 DeepSeek-R1 / V3 的推理与决策演变
    class MockModel:
        def __init__(self):
            self.turn = 0

        def infer(self, history: List[Dict[str, str]]):
            self.turn += 1
            if self.turn == 1:
                return {
                    "thought": "收到修复 Token 鉴权的任务。首先读取 src/auth.py 检查代码实现。",
                    "action": {"name": "file_read", "args": {"path": "src/auth.py"}},
                }
            elif self.turn == 2:
                return {
                    "thought": "检查到反向判定条件 `now < 50`。先运行一次测试验证失败现象。",
                    "action": {"name": "run_test", "args": {}},
                }
            elif self.turn == 3:
                return {
                    "thought": "测试确实报错。现在写入修复：修正为 `if now > 50: return {'valid': False, 'code': 401}`。",
                    "action": {
                        "name": "file_write",
                        "args": {
                            "path": "src/auth.py",
                            "content": "def verify_token(token, now=100):\n    # 修正逻辑\n    if now > 50:\n        return {'valid': False, 'code': 401}\n    return {'valid': True}"
                        }
                    },
                }
            elif self.turn == 4:
                return {
                    "thought": "修复已写入，再次运行测试套件验证。",
                    "action": {"name": "run_test", "args": {}},
                }
            else:
                return {
                    "thought": "测试全绿通过，任务顺利完成。",
                    "action": None,
                    "summary": "已成功定位并修复 src/auth.py 中的 Token 过期条件，回归测试全部 PASS！"
                }

    ctx.provide("model", MockModel())


def react_loop_plugin(ctx: Context):
    def run_loop(objective: str, max_steps: int = 6):
        session: SessionStore = ctx.get("session")
        model = ctx.get("model")
        tools = ctx.get("tools")

        session.append("USER_PROMPT", {"objective": objective})
        print(f"\n🎯 [DeepSeek Harness] 启动目标: {objective}")

        for step in range(1, max_steps + 1):
            print(f"\n--- [Step {step}] 推理周期 ---")
            res = model.infer([])
            
            # 记录思考
            if "thought" in res:
                print(f"💭 思考 (Thought): {res['thought']}")
                session.append("AGENT_THOUGHT", {"thought": res["thought"]}, {"step": step})

            action = res.get("action")
            if not action:
                print(f"\n🎉 目标达成 (Finish): {res.get('summary')}")
                session.append("TASK_COMPLETED", {"summary": res.get("summary")})
                break

            # 执行工具调用
            tool_name = action["name"]
            tool_args = action["args"]
            print(f"🛠️  行动 (Action): {tool_name}({tool_args})")
            session.append("TOOL_CALL", action, {"step": step})

            # 沙箱执行观测
            obs = tools[tool_name](**tool_args) if tool_args else tools[tool_name]()
            print(f"👁️  观测 (Observation): {obs}")
            session.append("TOOL_RESULT", {"output": obs}, {"step": step})

    ctx.provide("run_loop", run_loop)


# ==========================================
# 4. 入口运行
# ==========================================
if __name__ == "__main__":
    print("=" * 60)
    print("🚀 DeepSeek Harness (dsh) - Python 原生架构演示")
    print("=" * 60)

    # 1. 创建服务上下文容器
    ctx = Context()
    session = SessionStore("session_py_001")
    ctx.provide("session", session)

    # 2. 挂载插件 (Everything is a Plugin)
    ctx.plugin(file_tools_plugin)
    ctx.plugin(mock_deepseek_model_plugin)
    ctx.plugin(react_loop_plugin)

    # 3. 运行 ReAct 任务
    run_fn = ctx.get("run_loop")
    run_fn("修复 auth 模块中的时间判定并跑通测试")

    # 4. 回放事件轨迹
    session.replay()
    print("\n✅ 演示完成！")

