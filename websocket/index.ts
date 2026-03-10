// ============================================
// WebSocket 模块导出
// ============================================

// 类型定义
export type {
  AGPEnvelope,
  AGPMethod,
  ContentBlock,
  ToolCall,
  ToolCallKind,
  ToolCallStatus,
  ToolLocation,
  PromptPayload,
  CancelPayload,
  UpdatePayload,
  UpdateType,
  PromptResponsePayload,
  StopReason,
  PromptMessage,
  CancelMessage,
  UpdateMessage,
  PromptResponseMessage,
  WebSocketClientConfig,
  ConnectionState,
  WebSocketClientCallbacks,
} from "./types.js";

// WebSocket 客户端
export { WechatAccessWebSocketClient } from "./websocket-client.js";

// 消息处理器
export { handlePrompt, handleCancel } from "./message-handler.js";

// 消息适配器
export {
  extractTextFromContent,
  promptPayloadToFuwuhaoMessage,
  buildWebSocketMessageContext,
} from "./message-adapter.js";
