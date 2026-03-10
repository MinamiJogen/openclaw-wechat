import type { FuwuhaoMessage } from "../http/types.js";
import { getWecomRuntime } from "./runtime.js";

// ============================================
// 渠道来源标签
// ============================================
// 用于 ChannelSource，标识消息来自哪个微信渠道
// UI 侧可通过此字段区分不同来源，做差异化展示或交互限制
export const WECHAT_CHANNEL_LABELS = {
  /** 微信服务号 */
  serviceAccount: "serviceAccount",
  /** 微信小程序 */
  miniProgram: "miniProgram",
} as const;

// ============================================
// 消息上下文构建
// ============================================
// 将微信服务号的原始消息转换为 OpenClaw 标准的消息上下文
// 包括路由解析、会话管理、消息格式化等核心功能

/**
 * 消息上下文返回类型
 * @property ctx - OpenClaw 标准的消息上下文对象，包含所有必要的消息元数据
 * @property route - 路由信息，用于确定消息应该发送到哪个 Agent
 * @property storePath - 会话存储路径，用于持久化会话数据
 */
export interface MessageContext {
  ctx: Record<string, unknown>;
  route: {
    sessionKey: string;  // 会话唯一标识，用于关联同一用户的多轮对话
    agentId: string;     // Agent ID，标识处理此消息的 Agent
    accountId: string;   // 账号 ID，用于多账号场景
  };
  storePath: string;
}

/**
 * 构建消息上下文
 * @param message - 微信服务号的原始消息对象
 * @returns MessageContext 包含上下文、路由和存储路径的完整消息上下文
 * @description 
 * 此函数是消息处理的核心，负责：
 * 1. 提取和标准化消息字段（兼容多种格式）
 * 2. 解析路由，确定消息应该发送到哪个 Agent
 * 3. 获取会话存储路径，用于持久化对话历史
 * 4. 格式化消息为 OpenClaw 标准格式
 * 5. 构建完整的消息上下文对象
 * 
 * 内部流程：
 * - 从 runtime 获取配置
 * - 提取用户 ID、消息 ID、内容等关键信息
 * - 调用 routing.resolveAgentRoute 解析路由
 * - 调用 session.resolveStorePath 获取存储路径
 * - 调用 reply.formatInboundEnvelope 格式化消息
 * - 调用 reply.finalizeInboundContext 构建最终上下文
 */
export const buildMessageContext = (message: FuwuhaoMessage): MessageContext => {
  // 获取 OpenClaw 运行时实例
  const runtime = getWecomRuntime();
  // 加载全局配置（包含 Agent 配置、路由规则等）
  const cfg = runtime.config.loadConfig();
  
  // ============================================
  // 1. 提取和标准化消息字段
  // ============================================
  // 兼容多种字段命名（FromUserName/userid）
  const userId = message.FromUserName || message.userid || "unknown";
  const toUser = message.ToUserName || "unknown";
  // 确保消息 ID 唯一（用于去重和追踪）
  const messageId = message.MsgId || message.msgid || `${Date.now()}`;
  // TODO: 微信的 CreateTime 是秒级时间戳，需要转换为毫秒
  // const timestamp = message.CreateTime ? message.CreateTime * 1000 : Date.now();
  const timestamp = Date.now();
  // 提取消息内容（兼容 Content 和 text.content 两种格式）
  const content = message.Content || message.text?.content || "";
  
  // ============================================
  // 2. 解析路由 - 确定消息应该发送到哪个 Agent
  // ============================================
  // runtime.channel.routing.resolveAgentRoute 是 OpenClaw 的核心路由方法
  // 根据频道、账号、对话类型等信息，决定使用哪个 Agent 处理消息
  const frameworkRoute = runtime.channel.routing.resolveAgentRoute({
    cfg,                    // 全局配置
    channel: "wechat-access",     // 频道标识
    accountId: "default",   // 账号 ID（支持多账号场景）
    peer: {
      kind: "dm" as any,    // 对话类型：dm=私聊，group=群聊
      id: userId,           // 对话对象 ID（用户 ID）
    },
  });
  // 框架返回的 sessionKey 通常是 agent:main:main，与 PC 端默认 session 相同。
  // 为了让 UI 能区分外部渠道消息，使用独立的 sessionKey 格式：
  //   agent:{agentId}:wechat-access:direct:{userId}
  const channelSessionKey = `agent:${frameworkRoute.agentId}:wechat-access:direct:${userId}`;
  const route = {
    ...frameworkRoute,
    sessionKey: channelSessionKey,
  };
  
  // ============================================
  // 3. 获取消息格式化选项
  // ============================================
  // runtime.channel.reply.resolveEnvelopeFormatOptions 获取消息格式化配置
  // 包括时间格式、前缀、后缀等显示选项
  const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
  
  // ============================================
  // 4. 获取会话存储路径
  // ============================================
  // runtime.channel.session.resolveStorePath 计算会话数据的存储路径
  // 用于持久化对话历史、上下文等信息
  const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });
  // 存储路径通常类似：/data/sessions/{agentId}/{sessionKey}.json
  
  // ============================================
  // 5. 读取上次会话时间
  // ============================================
  // runtime.channel.session.readSessionUpdatedAt 读取上次会话的更新时间
  // 用于判断会话是否过期，是否需要重置上下文
  const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  // 如果距离上次会话时间过长，可能会清空历史上下文
  
  // ============================================
  // 6. 格式化入站消息
  // ============================================
  // runtime.channel.reply.formatInboundEnvelope 将原始消息格式化为标准格式
  // 添加时间戳、发送者信息、格式化选项等
  const body = runtime.channel.reply.formatInboundEnvelope({
    channel: "wechat-access",         // 频道标识
    from: userId,               // 发送者 ID
    timestamp,                  // 消息时间戳
    body: content,              // 消息内容
    chatType: "direct",         // 对话类型（direct=私聊）
    sender: {
      id: userId,               // 发送者 ID
    },
    previousTimestamp,          // 上次会话时间（用于判断是否需要添加时间分隔符）
    envelope: envelopeOptions,  // 格式化选项
  });
  // 返回格式化后的消息体，可能包含时间前缀、发送者名称等
  
  // ============================================
  // 7. 构建完整的消息上下文
  // ============================================
  // runtime.channel.reply.finalizeInboundContext 构建 OpenClaw 标准的消息上下文
  // 这是 Agent 处理消息时使用的核心数据结构
  const ctx = runtime.channel.reply.finalizeInboundContext({
    Body: body,                                 // 格式化后的消息体
    RawBody: content,                           // 原始消息内容
    CommandBody: content,                       // 命令体（用于解析命令）
    From: `wechat-access:${userId}`,                  // 发送者标识（带频道前缀）
    To: `wechat-access:${toUser}`,                    // 接收者标识
    SessionKey: route.sessionKey,               // 会话键
    AccountId: route.accountId,                 // 账号 ID
    ChatType: "direct" as const,                // 对话类型
    ChannelSource: WECHAT_CHANNEL_LABELS.serviceAccount,  // 渠道来源标识（用于 UI 侧区分消息来源）
    SenderId: userId,                           // 发送者 ID
    Provider: "wechat-access",                        // 提供商标识
    Surface: "wechat-access",                         // 界面标识
    MessageSid: messageId,                      // 消息唯一标识
    Timestamp: timestamp,                       // 时间戳
    OriginatingChannel: "wechat-access" as const,     // 原始频道
    OriginatingTo: `wechat-access:${userId}`,         // 原始接收者
  });
  // ctx 包含了 Agent 处理消息所需的所有信息
  
  return { ctx, route, storePath };
};
