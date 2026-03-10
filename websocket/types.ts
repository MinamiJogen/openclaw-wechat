/**
 * @file types.ts
 * @description AGP (Agent Gateway Protocol) 协议类型定义
 *
 * AGP 是 OpenClaw 与外部服务（如微信服务号后端）之间的 WebSocket 通信协议。
 * 所有消息都使用统一的「信封（Envelope）」格式，通过 method 字段区分消息类型。
 *
 * 消息方向：
 *   下行（服务端 → 客户端）：session.prompt、session.cancel
 *   上行（客户端 → 服务端）：session.update、session.promptResponse
 *
 * 基于 websocket.md 协议文档定义
 */

// ============================================
// AGP 消息信封
// ============================================
/**
 * AGP 统一消息信封
 * 所有 WebSocket 消息（上行和下行）均使用此格式
 */
export interface AGPEnvelope<T = unknown> {
  /** 全局唯一消息 ID（UUID），用于幂等去重 */
  msg_id: string;
  /** 设备唯一标识（下行消息携带，上行消息需原样回传） */
  guid?: string;
  /** 用户 ID（下行消息携带，上行消息需原样回传） */
  user_id?: string;
  /** 消息类型 */
  method: AGPMethod;
  /** 消息载荷 */
  payload: T;
}

// ============================================
// Method 枚举
// ============================================
/**
 * AGP 消息方法枚举
 * - session.prompt: 下发用户指令（服务端 → 客户端）
 * - session.cancel: 取消 Prompt Turn（服务端 → 客户端）
 * - session.update: 流式中间更新（客户端 → 服务端）
 * - session.promptResponse: 最终结果（客户端 → 服务端）
 */
export type AGPMethod =
  | "session.prompt"
  | "session.cancel"
  | "session.update"
  | "session.promptResponse"
  | "ping";

// ============================================
// 通用数据结构
// ============================================

/**
 * 内容块
 * 当前仅支持 text 类型
 */
export interface ContentBlock {
  type: "text";
  text: string;
}

/**
 * 工具调用状态枚举
 */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * 工具调用类型枚举
 */
export type ToolCallKind = "read" | "edit" | "delete" | "execute" | "search" | "fetch" | "think" | "other";

/**
 * 工具操作路径
 * @description 记录工具调用涉及的文件或目录路径，用于在 UI 中展示操作位置
 */
export interface ToolLocation {
  /** 文件或目录的绝对路径 */
  path: string;
}

/**
 * 工具调用
 * @description
 * 描述一次工具调用的完整信息，用于在 session.update 消息中实时推送工具执行状态。
 * 一次工具调用会产生多个 session.update 消息：
 *   1. update_type=tool_call：工具开始执行（status=in_progress）
 *   2. update_type=tool_call_update：执行中间状态（status=in_progress，可选）
 *   3. update_type=tool_call_update：执行完成（status=completed/failed）
 */
export interface ToolCall {
  /** 工具调用唯一 ID，用于关联同一次工具调用的多个 update 消息 */
  tool_call_id: string;
  /** 工具调用标题（展示用，通常是工具名称，如 "read_file"） */
  title?: string;
  /** 工具类型，用于 UI 展示不同的图标 */
  kind?: ToolCallKind;
  /** 工具调用当前状态 */
  status: ToolCallStatus;
  /** 工具调用结果内容（phase=result 时附带，用于展示工具输出） */
  content?: ContentBlock[];
  /** 工具操作涉及的文件路径（可选，用于 UI 展示操作位置） */
  locations?: ToolLocation[];
}

// ============================================
// 下行消息（服务端 → 客户端）
// ============================================

/**
 * session.prompt 载荷 — 下发用户指令
 * @description
 * 服务端收到用户消息后，通过此消息将用户指令下发给客户端（OpenClaw Agent）处理。
 * 客户端处理完毕后，需要发送 session.promptResponse 作为响应。
 */
export interface PromptPayload {
  /** 所属 Session ID（标识一个完整的对话会话） */
  session_id: string;
  /** 本次 Turn 唯一 ID（标识一次「用户提问 + AI 回答」的完整交互） */
  prompt_id: string;
  /** 目标 AI 应用标识（指定由哪个 Agent 处理此消息） */
  agent_app: string;
  /** 用户指令内容（结构化内容块数组，目前只支持 text 类型） */
  content: ContentBlock[];
}

/**
 * session.cancel 载荷 — 取消 Prompt Turn
 * @description
 * 用户主动取消正在处理的请求时，服务端发送此消息。
 * 客户端收到后应停止 Agent 处理，并发送 stop_reason=cancelled 的 promptResponse。
 */
export interface CancelPayload {
  /** 所属 Session ID */
  session_id: string;
  /** 要取消的 Turn ID（与对应 session.prompt 的 prompt_id 一致） */
  prompt_id: string;
  /** 目标 AI 应用标识 */
  agent_app: string;
}

// ============================================
// 上行消息（客户端 → 服务端）
// ============================================

/**
 * session.update 的更新类型
 * @description
 * 定义 session.update 消息中 update_type 字段的可选值：
 * - message_chunk: Agent 生成的增量文本片段（流式输出，每次只包含新增的部分）
 * - tool_call: Agent 开始调用一个工具（通知服务端展示工具调用状态）
 * - tool_call_update: 工具调用状态变更（执行中的中间结果，或执行完成/失败）
 */
export type UpdateType = "message_chunk" | "tool_call" | "tool_call_update";

/**
 * session.update 载荷 — 流式中间更新
 * @description
 * 在 Agent 处理 session.prompt 的过程中，通过此消息实时推送中间状态。
 * 服务端收到后转发给用户端，实现流式输出效果。
 *
 * 根据 update_type 的不同，使用不同的字段：
 *   - message_chunk: 使用 content 字段（单个 ContentBlock，非数组）
 *   - tool_call / tool_call_update: 使用 tool_call 字段
 */
export interface UpdatePayload {
  /** 所属 Session ID */
  session_id: string;
  /** 所属 Turn ID（与对应 session.prompt 的 prompt_id 一致） */
  prompt_id: string;
  /** 更新类型，决定使用 content 还是 tool_call 字段 */
  update_type: UpdateType;
  /**
   * 文本内容块（update_type=message_chunk 时使用）
   * 注意：这里是单个 ContentBlock 对象，而非数组
   */
  content?: ContentBlock;
  /** 工具调用信息（update_type=tool_call 或 tool_call_update 时使用） */
  tool_call?: ToolCall;
}

/**
 * 停止原因枚举
 * - end_turn: 正常完成
 * - cancelled: 被取消
 * - refusal: AI 应用拒绝执行
 * - error: 技术错误
 */
export type StopReason = "end_turn" | "cancelled" | "refusal" | "error";

/**
 * session.promptResponse 载荷 — 最终结果
 * @description
 * Agent 处理完 session.prompt 后，必须发送此消息告知服务端本次 Turn 已结束。
 * 无论正常完成、被取消还是出错，都需要发送此消息。
 * 服务端收到后才会认为本次 Turn 已关闭，可以接受下一个 prompt。
 */
export interface PromptResponsePayload {
  /** 所属 Session ID */
  session_id: string;
  /** 所属 Turn ID（与对应 session.prompt 的 prompt_id 一致） */
  prompt_id: string;
  /** 停止原因，告知服务端 Turn 是如何结束的 */
  stop_reason: StopReason;
  /**
   * 最终结果内容（ContentBlock 数组）
   * stop_reason=end_turn 时附带，包含 Agent 的完整回复文本
   * stop_reason=cancelled/error 时通常为空
   */
  content?: ContentBlock[];
  /** 错误描述（stop_reason 为 error 或 refusal 时附带，说明失败原因） */
  error?: string;
}

// ============================================
// 类型别名（方便使用）
// ============================================

/** 下行：session.prompt 消息 */
export type PromptMessage = AGPEnvelope<PromptPayload>;
/** 下行：session.cancel 消息 */
export type CancelMessage = AGPEnvelope<CancelPayload>;
/** 上行：session.update 消息 */
export type UpdateMessage = AGPEnvelope<UpdatePayload>;
/** 上行：session.promptResponse 消息 */
export type PromptResponseMessage = AGPEnvelope<PromptResponsePayload>;

// ============================================
// WebSocket 客户端配置
// ============================================

/**
 * WebSocket 客户端配置
 * @description
 * 在插件入口（index.ts）的 WS_CONFIG 常量中配置，传入 WechatAccessWebSocketClient 构造函数。
 */
export interface WebSocketClientConfig {
  /** WebSocket 服务端地址（如 ws://21.0.62.97:8080/） */
  url: string;
  /** 设备唯一标识，用于服务端识别连接来源（作为 URL 查询参数传递） */
  guid: string;
  /** 用户账户 ID（作为 URL 查询参数传递，也用于上行消息的 user_id 字段） */
  userId: string;
  /** 鉴权 token（可选，作为 URL 查询参数传递，当前服务端未校验） */
  token?: string;
  /**
   * 重连间隔基准值（毫秒），默认 3000（3秒）
   * 实际重连间隔使用指数退避策略，此值是第一次重连的等待时间
   */
  reconnectInterval?: number;
  /**
   * 最大重连次数，默认 0（无限重连）
   * 设为正整数时，超过此次数后停止重连并将状态设为 disconnected
   */
  maxReconnectAttempts?: number;
  /**
   * 心跳间隔（毫秒），默认 240000（4分钟）
   * 应小于服务端的空闲超时时间（通常为 5 分钟），确保连接不会因空闲被断开
   * 心跳使用 WebSocket 原生 ping 控制帧（ws 库的 ws.ping() 方法）
   */
  heartbeatInterval?: number;
  /**
   * 当前 openclaw gateway 监听的端口号（来自 cfg.gateway.port）
   * 用于日志前缀，方便区分多实例
   */
  gatewayPort?: string;
}

/**
 * WebSocket 连接状态
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/**
 * WebSocket 客户端事件回调
 */
export interface WebSocketClientCallbacks {
  /** 连接成功 */
  onConnected?: () => void;
  /** 连接断开 */
  onDisconnected?: (reason?: string) => void;
  /** 收到 session.prompt 消息 */
  onPrompt?: (message: PromptMessage) => void;
  /** 收到 session.cancel 消息 */
  onCancel?: (message: CancelMessage) => void;
  /** 发生错误 */
  onError?: (error: Error) => void;
}
