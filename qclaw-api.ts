import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  CHANNEL_ID,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_X_TOKEN,
  QCLAW_CONTACT_OPEN_ID,
  QCLAW_CONTACT_TYPE,
  QCLAW_ENV,
} from "./constants.js";
import type { QClawWechatState } from "./state-store.js";
import { clearState, readState, writeState } from "./state-store.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type ApiResult = {
  success: boolean;
  code?: number;
  message?: string;
  raw: any;
  nextJwtToken?: string;
};

type LoginPayload = {
  jwtToken?: string;
  openclawChannelToken?: string;
  userInfo?: Record<string, unknown>;
};

export type BoundWechatDevice = {
  nickname: string;
  avatar?: string;
  externalUserId?: string;
};

function firstDefined(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = path
      .split(".")
      .reduce<unknown>((current, segment) => {
        if (!current || typeof current !== "object") {
          return undefined;
        }
        return (current as Record<string, unknown>)[segment];
      }, source);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function extractBusinessCode(raw: any): number | undefined {
  const value = firstDefined(raw, [
    "data.resp.common.code",
    "data.common.code",
    "resp.common.code",
    "common.code",
  ]);
  return typeof value === "number" ? value : undefined;
}

function extractMessage(raw: any): string | undefined {
  const value = firstDefined(raw, [
    "data.resp.common.message",
    "data.common.message",
    "resp.common.message",
    "common.message",
    "message",
  ]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractLoginPayload(raw: any): LoginPayload {
  const source =
    firstDefined(raw, ["data.resp.data"]) ??
    firstDefined(raw, ["data.data"]) ??
    raw?.data ??
    raw;
  if (!source || typeof source !== "object") {
    return {};
  }
  const payload = source as Record<string, unknown>;
  const userInfo =
    payload.user_info && typeof payload.user_info === "object"
      ? (payload.user_info as Record<string, unknown>)
      : undefined;
  return {
    jwtToken:
      typeof payload.token === "string" ? payload.token : undefined,
    openclawChannelToken:
      typeof payload.openclaw_channel_token === "string"
        ? payload.openclaw_channel_token
        : undefined,
    userInfo,
  };
}

function extractStateValue(raw: any): string | undefined {
  const value = firstDefined(raw, [
    "data.state",
    "data.resp.data.state",
    "data.resp.state",
    "resp.data.state",
  ]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractApiKey(raw: any): string | undefined {
  const value = firstDefined(raw, ["data.key", "data.resp.data.key", "resp.data.key"]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractChannelToken(raw: any): string | undefined {
  const value = firstDefined(raw, [
    "data.resp.data.openclaw_channel_token",
    "data.data.openclaw_channel_token",
    "data.openclaw_channel_token",
  ]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractContactLink(raw: any): string | undefined {
  const value = firstDefined(raw, [
    "data.resp.url",
    "data.resp.data.url",
    "data.url",
    "resp.url",
  ]);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractBoundWechatDevice(raw: any): BoundWechatDevice | null {
  const source =
    firstDefined(raw, ["data.resp.data"]) ??
    firstDefined(raw, ["data.resp"]) ??
    firstDefined(raw, ["data.data"]) ??
    raw?.data ??
    raw;
  if (!source || typeof source !== "object") {
    return null;
  }
  const payload = source as Record<string, unknown>;
  const nickname =
    typeof payload.nickname === "string" ? payload.nickname.trim() : "";
  if (!nickname) {
    return null;
  }
  return {
    nickname,
    avatar:
      typeof payload.avatar === "string" && payload.avatar.trim()
        ? payload.avatar
        : undefined,
    externalUserId:
      typeof payload.external_user_id === "string" &&
      payload.external_user_id.trim()
        ? payload.external_user_id
        : undefined,
  };
}

function resolveHeaderGuid(state: QClawWechatState | null): string {
  return state?.guid?.trim() || "1";
}

function resolveHeaderAccount(state: QClawWechatState | null): string {
  const userId = state?.userInfo?.user_id ?? state?.userInfo?.userId;
  if (typeof userId === "string" && userId.trim()) {
    return userId;
  }
  if (typeof userId === "number" && Number.isFinite(userId)) {
    return String(userId);
  }
  return "1";
}

function resolveHeaderToken(state: QClawWechatState | null): string {
  const loginKey = state?.userInfo?.loginKey;
  if (typeof loginKey === "string" && loginKey.trim()) {
    return loginKey;
  }
  return DEFAULT_X_TOKEN;
}

async function qclawRequest(
  endpoint: string,
  body: Record<string, unknown>,
  state: QClawWechatState | null,
): Promise<ApiResult> {
  const url = new URL(endpoint, QCLAW_ENV.jprxGateway).toString();
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Version": "1",
    "X-Token": resolveHeaderToken(state),
    "X-Guid": resolveHeaderGuid(state),
    "X-Account": resolveHeaderAccount(state),
    "X-Session": "",
  });
  if (state?.jwtToken?.trim()) {
    headers.set("X-OpenClaw-Token", state.jwtToken.trim());
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...body,
      web_version: QCLAW_ENV.webVersion,
      web_env: QCLAW_ENV.webEnv,
    }),
  });
  const nextJwtToken = response.headers.get("X-New-Token") ?? undefined;
  let raw: any = null;
  try {
    const text = await response.text();
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const businessCode = extractBusinessCode(raw);
  if (businessCode === 21004) {
    return {
      success: false,
      code: businessCode,
      message: "登录已过期，请重新扫码配对",
      raw,
      nextJwtToken,
    };
  }
  if (!response.ok) {
    return {
      success: false,
      code: response.status,
      message:
        extractMessage(raw) ||
        response.statusText ||
        `HTTP ${response.status}`,
      raw,
      nextJwtToken,
    };
  }
  const ret = typeof raw?.ret === "number" ? raw.ret : undefined;
  if (
    (ret !== undefined && ret !== 0) ||
    (businessCode !== undefined && businessCode !== 0)
  ) {
    return {
      success: false,
      code: businessCode ?? ret,
      message: extractMessage(raw) || "业务请求失败",
      raw,
      nextJwtToken,
    };
  }
  return {
    success: true,
    code: businessCode ?? ret ?? 0,
    raw,
    nextJwtToken,
  };
}

function mergeState(
  state: QClawWechatState,
  patch: Partial<QClawWechatState>,
): QClawWechatState {
  return {
    ...state,
    ...patch,
    updatedAtMs: Date.now(),
  };
}

function patchChannelConfig(
  cfg: Record<string, unknown>,
  state: QClawWechatState | null,
): Record<string, unknown> {
  const channels = ((cfg.channels as Record<string, unknown> | undefined) ?? {});
  const current = ((channels[CHANNEL_ID] as Record<string, unknown> | undefined) ?? {});
  const next = {
    ...current,
    accountId: DEFAULT_ACCOUNT_ID,
    wsUrl: QCLAW_ENV.wechatWsUrl,
    enabled: Boolean(state?.openclawChannelToken),
  } as Record<string, unknown>;
  if (state?.openclawChannelToken) {
    next.token = state.openclawChannelToken;
  } else {
    delete next.token;
  }
  return {
    ...cfg,
    channels: {
      ...channels,
      [CHANNEL_ID]: next,
    },
  };
}

function patchQClawProvider(
  cfg: Record<string, unknown>,
  state: QClawWechatState | null,
): Record<string, unknown> {
  const models = ((cfg.models as Record<string, unknown> | undefined) ?? {});
  const providers = ((models.providers as Record<string, unknown> | undefined) ?? {});
  const current = ((providers.qclaw as Record<string, unknown> | undefined) ?? {});
  const currentModels = Array.isArray(current.models) ? current.models : [];
  const next = {
    ...current,
    baseUrl: QCLAW_ENV.qclawBaseUrl,
    api:
      typeof current.api === "string" && current.api.trim()
        ? current.api
        : QCLAW_ENV.qclawProviderApi,
    models:
      currentModels.length > 0
        ? currentModels
        : [
            {
              id: QCLAW_ENV.qclawDefaultModelId,
              name: QCLAW_ENV.qclawDefaultModelId,
            },
          ],
  } as Record<string, unknown>;
  if (state?.qclawApiKey) {
    next.apiKey = state.qclawApiKey;
  } else {
    delete next.apiKey;
  }
  return {
    ...cfg,
    models: {
      ...models,
      providers: {
        ...providers,
        qclaw: next,
      },
    },
  };
}

export async function syncStateToConfig(
  api: OpenClawPluginApi,
  state: QClawWechatState | null,
): Promise<void> {
  const cfg = api.runtime.config.loadConfig() as Record<string, unknown>;
  const withChannel = patchChannelConfig(cfg, state);
  const withProvider = patchQClawProvider(withChannel, state);
  await api.runtime.config.writeConfigFile(withProvider);
}

export async function getLoginState(
  state: QClawWechatState,
): Promise<{ loginState?: string; nextState: QClawWechatState }> {
  const result = await qclawRequest("data/4050/forward", { guid: state.guid }, state);
  const nextState = result.nextJwtToken
    ? mergeState(state, { jwtToken: result.nextJwtToken })
    : state;
  if (!result.success) {
    return { loginState: undefined, nextState };
  }
  return {
    loginState: extractStateValue(result.raw),
    nextState,
  };
}

export async function finishWxLogin(params: {
  state: QClawWechatState;
  code: string;
  loginState: string;
}): Promise<QClawWechatState> {
  const result = await qclawRequest(
    "data/4026/forward",
    {
      guid: params.state.guid,
      code: params.code,
      state: params.loginState,
    },
    params.state,
  );
  if (!result.success) {
    throw new Error(result.message || "微信登录失败");
  }
  const payload = extractLoginPayload(result.raw);
  if (!payload.jwtToken || !payload.openclawChannelToken) {
    throw new Error("微信登录成功，但响应中缺少 token");
  }
  return mergeState(params.state, {
    jwtToken: result.nextJwtToken ?? payload.jwtToken,
    openclawChannelToken: payload.openclawChannelToken,
    userInfo: payload.userInfo,
  });
}

export function hasAuthenticatedSession(state: QClawWechatState | null): boolean {
  if (!state?.jwtToken?.trim() || !state?.openclawChannelToken?.trim()) {
    return false;
  }
  const userId = state.userInfo?.user_id ?? state.userInfo?.userId;
  return (
    (typeof userId === "string" && userId.trim().length > 0) ||
    (typeof userId === "number" && Number.isFinite(userId))
  );
}

export async function generateContactLink(
  state: QClawWechatState,
): Promise<{ url: string; nextState: QClawWechatState }> {
  const userId = state.userInfo?.user_id ?? state.userInfo?.userId;
  if (
    !(
      (typeof userId === "string" && userId.trim()) ||
      (typeof userId === "number" && Number.isFinite(userId))
    )
  ) {
    throw new Error("当前未登录 QClaw，无法生成微信绑定二维码");
  }
  const result = await qclawRequest(
    "data/4018/forward",
    {
      guid: state.guid,
      user_id: userId,
      open_id: QCLAW_CONTACT_OPEN_ID,
      contact_type: QCLAW_CONTACT_TYPE,
    },
    state,
  );
  const nextState = result.nextJwtToken
    ? mergeState(state, { jwtToken: result.nextJwtToken })
    : state;
  if (!result.success) {
    throw new Error(result.message || "生成微信绑定链接失败");
  }
  const url = extractContactLink(result.raw);
  if (!url) {
    throw new Error("绑定链接生成成功，但响应中缺少 url");
  }
  return { url, nextState };
}

export async function queryBoundDevice(
  state: QClawWechatState,
): Promise<{ device: BoundWechatDevice | null; nextState: QClawWechatState }> {
  const result = await qclawRequest(
    "data/4019/forward",
    { guid: state.guid },
    state,
  );
  const nextState = result.nextJwtToken
    ? mergeState(state, { jwtToken: result.nextJwtToken })
    : state;
  if (!result.success) {
    throw new Error(result.message || "查询微信绑定状态失败");
  }
  return {
    device: extractBoundWechatDevice(result.raw),
    nextState,
  };
}

export async function createApiKey(
  state: QClawWechatState,
): Promise<{ apiKey?: string; nextState: QClawWechatState }> {
  const result = await qclawRequest("data/4055/forward", {}, state);
  const nextState = result.nextJwtToken
    ? mergeState(state, { jwtToken: result.nextJwtToken })
    : state;
  if (!result.success) {
    return { apiKey: undefined, nextState };
  }
  return {
    apiKey: extractApiKey(result.raw),
    nextState,
  };
}

export async function refreshChannelToken(
  state: QClawWechatState,
): Promise<QClawWechatState | null> {
  const result = await qclawRequest("data/4058/forward", {}, state);
  if (!result.success) {
    return null;
  }
  const token = extractChannelToken(result.raw);
  const nextState = mergeState(state, {
    jwtToken: result.nextJwtToken ?? state.jwtToken,
    openclawChannelToken: token ?? state.openclawChannelToken,
  });
  return nextState;
}

export async function unpairQClawWechat(
  state: QClawWechatState,
  logger: Logger,
): Promise<void> {
  const requests = [
    qclawRequest("data/4028/forward", { guid: state.guid }, state),
    qclawRequest("data/4020/forward", { guid: state.guid }, state),
  ];
  const results = await Promise.allSettled(requests);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn(
        `[qclaw-wechat] 解除配对接口异常: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`,
      );
    }
  }
}

export async function persistAuthenticatedState(params: {
  api: OpenClawPluginApi;
  state: QClawWechatState;
  logger: Logger;
}): Promise<QClawWechatState> {
  let nextState = params.state;
  try {
    const apiKeyResult = await createApiKey(nextState);
    nextState = apiKeyResult.nextState;
    if (apiKeyResult.apiKey) {
      nextState = mergeState(nextState, { qclawApiKey: apiKeyResult.apiKey });
    }
  } catch (error) {
    params.logger.warn(
      `[qclaw-wechat] createApiKey 失败，但不影响微信通路: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await writeState(params.api, nextState);
  await syncStateToConfig(params.api, nextState);
  return nextState;
}

export async function refreshAndPersist(
  api: OpenClawPluginApi,
  logger: Logger,
): Promise<boolean> {
  const state = await readState(api);
  if (!state?.jwtToken) {
    return false;
  }
  const refreshed = await refreshChannelToken(state);
  if (!refreshed) {
    return false;
  }
  let nextState = refreshed;
  try {
    const apiKeyResult = await createApiKey(refreshed);
    nextState = apiKeyResult.nextState;
    if (apiKeyResult.apiKey) {
      nextState = mergeState(nextState, { qclawApiKey: apiKeyResult.apiKey });
    }
  } catch (error) {
    logger.warn(
      `[qclaw-wechat] 定时同步 API Key 失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await writeState(api, nextState);
  await syncStateToConfig(api, nextState);
  return true;
}

export async function clearPairing(
  api: OpenClawPluginApi,
  logger: Logger,
): Promise<void> {
  const state = await readState(api);
  if (state) {
    await unpairQClawWechat(state, logger);
  }
  await clearState(api);
  await syncStateToConfig(api, null);
}
