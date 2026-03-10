export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

type OnAgentEventType = (
  listener: (payload: AgentEventPayload) => void,
) => (() => boolean);

// 动态导入，兼容 openclaw 未导出该函数的情况
let _onAgentEvent: OnAgentEventType | undefined;

// SDK 加载完成的 Promise，确保只加载一次
const sdkReady: Promise<OnAgentEventType | undefined> = (async () => {
  try {
    const sdk = await import("openclaw/plugin-sdk");
    const candidate = (sdk as Record<string, unknown>).onAgentEvent;
    if (typeof candidate === "function") {
      _onAgentEvent = candidate as OnAgentEventType;
    }
  } catch {
    // ignore
  }
  return _onAgentEvent;
})();

/**
 * 注册 Agent 事件监听器。
 *
 * 修复了原版的时序问题：原版使用 loadOnAgentEvent().then() 异步注册，
 * 导致在 dispatchReplyWithBufferedBlockDispatcher 调用之前注册的监听器
 * 实际上在 Agent 开始产生事件时还未真正挂载，造成事件全部丢失。
 *
 * 新版通过 await sdkReady 确保 SDK 加载完成后再注册监听器，
 * 调用方需要 await 此函数返回的 Promise，再调用 dispatchReply。
 */
export const onAgentEvent = async (
  listener: Parameters<OnAgentEventType>[0]
): Promise<() => boolean> => {
  const fn = await sdkReady;
  if (fn) {
    const unsubscribe = fn(listener);
    return unsubscribe;
  }
  return () => false;
};
