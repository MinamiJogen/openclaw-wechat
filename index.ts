import type {
  OpenClawPluginApi,
  OpenClawPluginService,
} from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { CLI_ROOT, DEFAULT_ACCOUNT_ID, PLUGIN_ID, REFRESH_INTERVAL_MS } from "./constants.js";
import { setWecomRuntime } from "./common/runtime.js";
import {
  WechatAccessWebSocketClient,
  handleCancel,
  handlePrompt,
} from "./websocket/index.js";
import { registerQClawWechatCli } from "./cli.js";
import { refreshAndPersist } from "./qclaw-api.js";

type NormalizedChatType = "direct" | "group" | "channel";

const wsClients = new Map<string, WechatAccessWebSocketClient>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<void> | null = null;

const meta = {
  id: "wechat-access",
  label: "QClaw 微信通路",
  selectionLabel: "QClaw 微信通路",
  detailLabel: "QClaw 微信通路",
  docsPath: "/channels/wechat-access",
  docsLabel: "wechat-access",
  blurb: "Reuse QClaw's private WeChat gateway from original OpenClaw.",
  systemImage: "message.fill",
  order: 85,
};

const qclawWechatChannelPlugin = {
  id: "wechat-access",
  meta,
  capabilities: {
    chatTypes: ["direct"] as NormalizedChatType[],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: {
    configPrefixes: ["channels.wechat-access.token", "channels.wechat-access.wsUrl"],
  },
  config: {
    listAccountIds: (cfg: any) => {
      const accounts = cfg.channels?.["wechat-access"]?.accounts;
      if (accounts && typeof accounts === "object") {
        return Object.keys(accounts);
      }
      return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg: any, accountId: string) => {
      const accounts = cfg.channels?.["wechat-access"]?.accounts;
      const account = accounts?.[accountId ?? DEFAULT_ACCOUNT_ID];
      return account ?? { accountId: accountId ?? DEFAULT_ACCOUNT_ID };
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async () => ({ ok: true }),
  },
  status: {
    buildAccountSnapshot: ({ accountId }: { accountId?: string }) => {
      const client = wsClients.get(accountId ?? DEFAULT_ACCOUNT_ID);
      return { running: client?.getState() === "connected" };
    },
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { cfg, accountId, abortSignal, log } = ctx;
      const accountKey = accountId ?? DEFAULT_ACCOUNT_ID;
      const channelConfig = cfg?.channels?.["wechat-access"];
      const token = channelConfig?.token ? String(channelConfig.token) : "";
      const wsUrl = channelConfig?.wsUrl ? String(channelConfig.wsUrl) : "";
      const gatewayPort = cfg?.gateway?.port ? String(cfg.gateway.port) : "unknown";

      if (!token) {
        log?.warn("[qclaw-wechat] token 为空，跳过 WebSocket 连接");
        return;
      }

      const client = new WechatAccessWebSocketClient(
        {
          url: wsUrl,
          token,
          guid: "",
          userId: "",
          gatewayPort,
          reconnectInterval: 3000,
          maxReconnectAttempts: 10,
          heartbeatInterval: 20_000,
        },
        {
          onConnected: () => {
            log?.info("[qclaw-wechat] WebSocket 连接成功");
            ctx.setStatus({ running: true });
          },
          onDisconnected: (reason?: string) => {
            log?.warn(`[qclaw-wechat] WebSocket 连接断开: ${reason ?? "unknown"}`);
            ctx.setStatus({ running: false });
          },
          onPrompt: (message: any) => {
            void handlePrompt(message, client).catch((error: Error) => {
              log?.error(`[qclaw-wechat] 处理 prompt 失败: ${error.message}`);
            });
          },
          onCancel: (message: any) => {
            handleCancel(message, client);
          },
          onError: (error: Error) => {
            log?.error(`[qclaw-wechat] WebSocket 错误: ${error.message}`);
          },
        },
      );

      wsClients.set(accountKey, client);
      client.start();

      await new Promise<void>((resolve) => {
        abortSignal.addEventListener("abort", () => {
          client.stop();
          if (wsClients.get(accountKey) === client) {
            wsClients.delete(accountKey);
          }
          ctx.setStatus({ running: false });
          resolve();
        });
      });
    },
    stopAccount: async (ctx: any) => {
      const accountKey = ctx.accountId ?? DEFAULT_ACCOUNT_ID;
      const client = wsClients.get(accountKey);
      if (!client) {
        return;
      }
      client.stop();
      wsClients.delete(accountKey);
      ctx.setStatus({ running: false });
    },
  },
};

function buildRefreshService(api: OpenClawPluginApi): OpenClawPluginService {
  return {
    id: `${PLUGIN_ID}-auth`,
    start: async () => {
      const run = async () => {
        if (refreshInFlight) {
          return refreshInFlight;
        }
        refreshInFlight = refreshAndPersist(api, api.logger)
          .then(() => undefined)
          .catch((error) => {
            api.logger.warn(
              `[qclaw-wechat] 自动刷新失败: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          })
          .finally(() => {
            refreshInFlight = null;
          });
        return refreshInFlight;
      };
      await run();
      if (!refreshTimer) {
        refreshTimer = setInterval(() => {
          void run();
        }, REFRESH_INTERVAL_MS);
      }
    },
    stop: async () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    },
  };
}

const plugin = {
  id: PLUGIN_ID,
  name: "QClaw WeChat Access",
  description: "Use QClaw's private WeChat gateway from original OpenClaw.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWecomRuntime(api.runtime);
    api.registerChannel({ plugin: qclawWechatChannelPlugin as any });
    api.registerCli(
      ({ program }) => {
        registerQClawWechatCli({
          api,
          program,
          logger: api.logger,
        });
      },
      { commands: [CLI_ROOT] },
    );
    api.registerService(buildRefreshService(api));
  },
};

export default plugin;
