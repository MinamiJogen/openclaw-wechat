import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { CLI_ROOT, DEFAULT_LOGIN_STATE } from "./constants.js";
import { captureWxCode, serveBindingQrPage } from "./qr-page.js";
import {
  clearPairing,
  generateContactLink,
  finishWxLogin,
  getLoginState,
  hasAuthenticatedSession,
  persistAuthenticatedState,
  queryBoundDevice,
  refreshAndPersist,
  syncStateToConfig,
} from "./qclaw-api.js";
import { ensureGuid, readState, writeState } from "./state-store.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

async function loginWithWechat(params: {
  api: OpenClawPluginApi;
  logger: Logger;
  state: Awaited<ReturnType<typeof ensureGuid>>;
  options: {
    open?: boolean;
    timeout?: string;
    bind?: string;
    port?: string;
    publicUrl?: string;
  };
}) {
  const timeoutMs = Math.max(30_000, Number(params.options.timeout ?? 300_000));
  const port = Math.max(0, Number(params.options.port ?? 0));
  const loginStateResult = await getLoginState(params.state);
  let state = loginStateResult.nextState;
  await writeState(params.api, state);
  const loginState = loginStateResult.loginState ?? DEFAULT_LOGIN_STATE;
  const { code, url } = await captureWxCode({
    loginState,
    logger: params.logger,
    openBrowser: params.options.open !== false,
    timeoutMs,
    bindHost: params.options.bind,
    port,
    publicUrl: params.options.publicUrl,
  });
  if (params.options.open === false) {
    params.logger.info(`[qclaw-wechat] 请在浏览器中打开二维码页面: ${url}`);
  }
  const authenticated = await finishWxLogin({
    state,
    code,
    loginState,
  });
  state = await persistAuthenticatedState({
    api: params.api,
    state: authenticated,
    logger: params.logger,
  });
  return state;
}

async function waitForWechatBinding(params: {
  api: OpenClawPluginApi;
  logger: Logger;
  state: Awaited<ReturnType<typeof ensureGuid>>;
  options: {
    open?: boolean;
    timeout?: string;
    bind?: string;
    port?: string;
    publicUrl?: string;
  };
}) {
  const timeoutMs = Math.max(30_000, Number(params.options.timeout ?? 300_000));
  const port = Math.max(0, Number(params.options.port ?? 0));
  let state = params.state;
  const { url: bindUrl, nextState } = await generateContactLink(state);
  state = nextState;
  await writeState(params.api, state);
  const page = await serveBindingQrPage({
    bindUrl,
    logger: params.logger,
    openBrowser: params.options.open !== false,
    bindHost: params.options.bind,
    port,
    publicUrl: params.options.publicUrl,
  });
  if (params.options.open === false) {
    params.logger.info(`[qclaw-wechat] 请在浏览器中打开绑定二维码页面: ${page.url}`);
  }
  page.updateStatus({
    phase: "waiting",
    message: "请使用微信扫码，随后在手机侧确认绑定",
    detail: "扫码后会直接跳转到客服会话。",
  });
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const result = await queryBoundDevice(state);
      state = result.nextState;
      if (result.device) {
        page.updateStatus({
          phase: "bound",
          message: `已绑定微信：${result.device.nickname}`,
          detail: "终端配置已完成，这个页面可以关闭。",
        });
        await writeState(params.api, state);
        await syncStateToConfig(params.api, state);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return {
          state,
          device: result.device,
          bindingPageUrl: page.url,
        };
      }
      await writeState(params.api, state);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    page.updateStatus({
      phase: "error",
      message: "等待绑定超时",
      detail: "请重新执行 pair 并在手机侧完成客服会话确认。",
    });
    throw new Error("等待微信绑定超时，请重新执行 pair");
  } finally {
    await page.close();
  }
}

export function registerQClawWechatCli(params: {
  api: OpenClawPluginApi;
  program: any;
  logger: Logger;
}) {
  const { api, program, logger } = params;
  const root = program
    .command(CLI_ROOT)
    .description("Pair OpenClaw with QClaw's private WeChat gateway");

  root
    .command("pair")
    .description("Bind this gateway to WeChat using QClaw's pairing flow")
    .option("--no-open", "Do not auto-open the browser")
    .option("--timeout <ms>", "Timeout waiting for the QR callback", "300000")
    .option("--bind <host>", "Bind the local QR HTTP server", "127.0.0.1")
    .option("--port <port>", "Listen on a fixed QR HTTP port", "0")
    .option(
      "--public-url <url>",
      "Public URL for a reverse proxy / remote server QR page",
    )
    .action(
      async (options: {
        open?: boolean;
        timeout?: string;
        bind?: string;
        port?: string;
        publicUrl?: string;
      }) => {
        let state = await ensureGuid(api);
        let didLogin = false;
        if (!hasAuthenticatedSession(state)) {
          logger.info("[qclaw-wechat] 当前没有有效登录态，先执行一次微信登录");
          state = await loginWithWechat({
            api,
            logger,
            state,
            options,
          });
          didLogin = true;
        }
        let binding;
        try {
          binding = await waitForWechatBinding({
            api,
            logger,
            state,
            options,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            !didLogin &&
            (message.includes("登录已过期") || message.includes("未登录"))
          ) {
            logger.info("[qclaw-wechat] 登录态已过期，重新登录后继续绑定");
            state = await loginWithWechat({
              api,
              logger,
              state: await ensureGuid(api),
              options,
            });
            didLogin = true;
            binding = await waitForWechatBinding({
              api,
              logger,
              state,
              options,
            });
          } else {
            throw error;
          }
        }
        const persisted = binding.state;
        const userId =
          persisted.userInfo?.user_id ?? persisted.userInfo?.userId ?? "(unknown)";
        const nickname =
          persisted.userInfo?.nickname ??
          persisted.userInfo?.nick_name ??
          "(unknown)";
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              ok: true,
              guid: persisted.guid,
              userId,
              nickname,
              didLogin,
              boundWechatNickname: binding.device.nickname,
              boundWechatExternalUserId:
                binding.device.externalUserId ?? null,
              channelTokenConfigured: Boolean(persisted.openclawChannelToken),
              qclawApiKeyConfigured: Boolean(persisted.qclawApiKey),
            },
            null,
            2,
          ),
        );
      },
    );

  root
    .command("unpair")
    .description("Remove the current WeChat pairing and clear local config")
    .action(async () => {
      await clearPairing(api, logger);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, unpaired: true }, null, 2));
    });

  root
    .command("sync")
    .description("Refresh Channel Token/API key and sync them back into config")
    .action(async () => {
      const changed = await refreshAndPersist(api, logger);
      if (!changed) {
        const state = await readState(api);
        if (state) {
          await syncStateToConfig(api, state);
        }
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, synced: changed }, null, 2));
    });
}
