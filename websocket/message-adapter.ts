/**
 * @file message-adapter.ts
 * @description AGP 协议消息与 OpenClaw 内部格式之间的适配器
 *
 * 设计思路：
 * WebSocket 通道（AGP 协议）和 HTTP 通道（微信服务号 Webhook）使用不同的消息格式，
 * 但底层的 Agent 路由、会话管理、消息处理逻辑是完全相同的。
 * 此适配器将 AGP 消息转换为 OpenClaw 内部的 FuwuhaoMessage 格式，
 * 从而复用 HTTP 通道已有的 buildMessageContext 逻辑，避免重复实现。
 *
 * 转换链路：
 *   AGP PromptPayload → FuwuhaoMessage → MsgContext（OpenClaw 内部格式）
 */

import type { PromptPayload, ContentBlock } from "./types.js";
import type { FuwuhaoMessage } from "../http/types.js";
import { getWecomRuntime } from "../common/runtime.js";
import { buildMessageContext } from "../common/message-context.js";

// ============================================
// 消息适配器
// ============================================
// 负责 AGP 协议消息与 OpenClaw 内部格式之间的转换

/**
 * 从 ContentBlock 数组中提取纯文本
 * @param content - AGP 协议的内容块数组（每个块有 type 和 text 字段）
 * @returns 合并后的纯文本字符串（多个文本块用换行符连接）
 * @description
 * AGP 协议的消息内容是结构化的 ContentBlock 数组，支持多种类型（目前只有 text）。
 * 此函数将所有 text 类型的块提取出来，合并为一个纯文本字符串。
 *
 * 处理步骤：
 * 1. filter: 过滤出 type === "text" 的块（忽略未来可能新增的其他类型）
 * 2. map: 提取每个块的 text 字段
 * 3. join: 用换行符连接多个文本块
 *
 * 示例：
 * ```
 * extractTextFromContent([
 *   { type: "text", text: "你好" },
 *   { type: "text", text: "请帮我写代码" }
 * ])
 * // 返回："你好\n请帮我写代码"
 * ```
 */
export const extractTextFromContent = (content: ContentBlock[]): string => {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
};

/**
 * 将 AGP session.prompt 载荷转换为 FuwuhaoMessage 格式
 * @param payload - AGP 协议的 prompt 载荷（包含 session_id、prompt_id、content 等）
 * @param userId - 用户 ID（来自 AGP 信封的 user_id 字段）
 * @returns OpenClaw 内部的 FuwuhaoMessage 格式
 * @description
 * FuwuhaoMessage 是 OpenClaw 为微信服务号定义的内部消息格式，
 * 与微信服务号 Webhook 推送的消息格式保持一致。
 * 通过将 AGP 消息转换为此格式，可以复用 HTTP 通道的所有处理逻辑。
 *
 * 字段映射：
 *   - msgtype: 固定为 "text"（当前只支持文本消息）
 *   - MsgId: 使用 prompt_id 作为消息 ID（保证唯一性）
 *   - Content: 从 ContentBlock 数组提取的纯文本
 *   - FromUserName: 发送者 ID（来自 AGP 信封的 user_id）
 *   - ToUserName: 固定为 "fuwuhao_bot"（接收方标识）
 *   - CreateTime: 当前时间戳（秒级，Math.floor(Date.now() / 1000)）
 *
 * `Date.now()` 返回毫秒级时间戳，除以 1000 并取整得到秒级时间戳，
 * 与微信服务号 Webhook 的 CreateTime 字段格式一致。
 */
export const promptPayloadToFuwuhaoMessage = (
  payload: PromptPayload,
  userId: string
): FuwuhaoMessage => {
  const textContent = extractTextFromContent(payload.content);

  return {
    msgtype: "text",
    MsgId: payload.prompt_id,   // 使用 prompt_id 作为消息唯一 ID
    Content: textContent,
    FromUserName: userId,
    ToUserName: "fuwuhao_bot",
    CreateTime: Math.floor(Date.now() / 1000), // 秒级时间戳
  };
};

/**
 * 构建 WebSocket 消息的完整上下文
 * @param payload - AGP 协议的 prompt 载荷
 * @param userId - 用户 ID
 * @returns 消息上下文对象，包含：
 *   - ctx: MsgContext — OpenClaw 内部消息上下文（含路由、会话等信息）
 *   - route: 路由信息（agentId、accountId、sessionKey 等）
 *   - storePath: 会话存储文件路径
 * @description
 * 这是适配器的核心函数，完成两步转换：
 *   1. AGP PromptPayload → FuwuhaoMessage（通过 promptPayloadToFuwuhaoMessage）
 *   2. FuwuhaoMessage → MsgContext（通过 buildMessageContext，复用 HTTP 通道逻辑）
 *
 * buildMessageContext 内部会：
 *   - 根据消息的 FromUserName 和 ToUserName 确定路由（选择哪个 Agent）
 *   - 计算 sessionKey（用于关联历史对话）
 *   - 确定 storePath（会话历史存储位置）
 *   - 构建完整的 MsgContext（包含所有 Agent 处理所需的上下文信息）
 *
 * 通过这种适配方式，WebSocket 通道和 HTTP 通道共享同一套路由和会话管理逻辑，
 * 确保两个通道的行为完全一致。
 */
export const buildWebSocketMessageContext = (payload: PromptPayload, userId: string) => {
  const message = promptPayloadToFuwuhaoMessage(payload, userId);
  return buildMessageContext(message);
};
