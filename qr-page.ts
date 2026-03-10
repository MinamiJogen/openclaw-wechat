import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { LOGIN_TIMEOUT_MS, QCLAW_ENV } from "./constants.js";
import qrcodeFactory from "./vendor/qrcode-generator.cjs";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBindHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : "127.0.0.1";
}

function normalizeListenPort(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0 || value > 65535) {
    return 0;
  }
  return Math.floor(value);
}

function buildAccessibleUrl(params: {
  bindHost: string;
  port: number;
  publicUrl?: string;
}): string {
  if (params.publicUrl?.trim()) {
    return `${trimTrailingSlash(params.publicUrl.trim())}/`;
  }
  const host =
    params.bindHost === "0.0.0.0" || params.bindHost === "::"
      ? "127.0.0.1"
      : params.bindHost;
  return `http://${host}:${params.port}/`;
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

type BindingPageStatus =
  | { phase: "waiting"; message: string; detail?: string }
  | { phase: "bound"; message: string; detail?: string }
  | { phase: "error"; message: string; detail?: string };

function renderLoginPage(params: { loginState: string }): string {
  const serializedState = JSON.stringify(params.loginState);
  const serializedRedirect = JSON.stringify(QCLAW_ENV.redirectUri);
  const serializedAppId = JSON.stringify(QCLAW_ENV.appId);
  const serializedStyle = JSON.stringify(QCLAW_ENV.wxLoginStyleBase64);
  const serializedScript = JSON.stringify(QCLAW_ENV.wxLoginScriptUrl);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>QClaw 微信配对</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
        background: #f6f6f6;
        color: #111;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 360px;
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
        padding: 28px 24px;
        text-align: center;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
      }
      p {
        margin: 0;
        color: #666;
        line-height: 1.5;
      }
      #wx_login {
        margin: 20px auto 0;
        min-height: 240px;
      }
      #status {
        margin-top: 16px;
        font-size: 14px;
      }
      .hint {
        margin-top: 8px;
        font-size: 13px;
        color: #8f8f8f;
      }
      .done {
        display: none;
        margin-top: 20px;
        padding: 18px 16px;
        border-radius: 16px;
        background: #f3f8f4;
        color: #1f4d2a;
        line-height: 1.6;
        text-align: left;
      }
      .done strong {
        display: block;
        margin-bottom: 6px;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>微信扫码登录</h1>
        <p>本步骤使用微信官方登录渠道，请放心扫码。</p>
        <div id="wx_login"></div>
        <div id="status">等待扫码…</div>
        <div class="hint">扫码成功后，您可以关闭当前浏览器页面，并返回终端继续操作。</div>
        <div id="done" class="done">
          <strong>登录成功</strong>
          登录信息正在同步至本地终端。您可以关闭当前浏览器页面，并返回终端继续操作。
        </div>
      </div>
    </div>
    <script src=${serializedScript}></script>
    <script>
      const loginState = ${serializedState};
      const statusNode = document.getElementById("status");
      const doneNode = document.getElementById("done");
      const qrNode = document.getElementById("wx_login");
      let submitted = false;
      function updateStatus(text) {
        statusNode.textContent = text;
      }
      function showDone(message) {
        qrNode.style.display = "none";
        doneNode.style.display = "block";
        updateStatus(message);
      }
      window.addEventListener("message", async (event) => {
        const payload = event.data;
        if (
          submitted ||
          !payload ||
          payload.type !== "sendCode" ||
          typeof payload.data !== "string"
        ) {
          return;
        }
        submitted = true;
        showDone("登录成功，正在同步登录信息…");
        try {
          const response = await fetch("/callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: payload.data }),
          });
          if (!response.ok) {
            throw new Error("callback failed");
          }
          updateStatus("登录信息已回传，您可以关闭当前页面并返回终端继续操作");
          setTimeout(() => {
            try {
              window.close();
            } catch (_) {}
          }, 1200);
        } catch (_) {
          submitted = false;
          qrNode.style.display = "";
          doneNode.style.display = "none";
          updateStatus("登录信息回传失败，请返回终端查看错误信息后重试");
        }
      });
      function renderQr() {
        if (!window.WxLogin) {
          updateStatus("微信登录组件加载失败，请稍后重试");
          return;
        }
        new window.WxLogin({
          self_redirect: true,
          id: "wx_login",
          appid: ${serializedAppId},
          scope: "snsapi_login",
          redirect_uri: encodeURIComponent(${serializedRedirect}),
          state: loginState,
          style: "white",
          href: "data:text/css;base64," + ${serializedStyle},
          onReady: function () {
            updateStatus("二维码已就绪，请使用微信扫码登录");
          },
          onQRcodeReady: function () {},
        });
      }
      renderQr();
    </script>
  </body>
</html>`;
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function captureWxCode(params: {
  loginState: string;
  logger: Logger;
  openBrowser?: boolean;
  timeoutMs?: number;
  bindHost?: string;
  port?: number;
  publicUrl?: string;
}): Promise<{ code: string; url: string }> {
  const timeoutMs = params.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const bindHost = normalizeBindHost(params.bindHost);
  const listenPort = normalizeListenPort(params.port);
  let resolveCode: ((value: string) => void) | null = null;
  let rejectCode: ((reason?: unknown) => void) | null = null;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && requestUrl.pathname === "/") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderLoginPage({ loginState: params.loginState }));
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/callback") {
        const body = await readJsonBody(req);
        const code =
          body && typeof body.code === "string" ? body.code.trim() : "";
        if (!code) {
          res.statusCode = 400;
          res.end("missing code");
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
        resolveCode?.(code);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    } catch (error) {
      res.statusCode = 500;
      res.end("internal error");
      rejectCode?.(error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法分配本地二维码服务端口");
  }
  const url = buildAccessibleUrl({
    bindHost,
    port: address.port,
    publicUrl: params.publicUrl,
  });
  params.logger.info(`[qclaw-wechat] 二维码页面已就绪: ${url}`);
  if (!params.publicUrl && (bindHost === "0.0.0.0" || bindHost === "::")) {
    params.logger.warn(
      `[qclaw-wechat] 当前监听在 ${bindHost}:${address.port}，请通过服务器实际 IP / 域名访问，或传入 --public-url 打印可直接访问的地址`,
    );
  }
  if (params.openBrowser !== false) {
    try {
      openUrl(url);
    } catch (error) {
      params.logger.warn(
      `[qclaw-wechat] 自动打开浏览器失败，请手动访问以下地址完成登录：${url}。${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  try {
    const code = await Promise.race([
      codePromise,
      new Promise<string>((_, reject) => {
        setTimeout(
          () => reject(new Error("等待扫码超时，请重新执行 pair 命令")),
          timeoutMs,
        );
      }),
    ]);
    return { code, url };
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function buildBindingQrSvg(bindUrl: string): string {
  const qr = qrcodeFactory(0, "M");
  qr.addData(bindUrl);
  qr.make();
  return qr.createSvgTag({
    cellSize: 4,
    margin: 0,
    scalable: true,
    title: "QClaw WeChat Bind QR Code",
  });
}

function renderBindingPage(params: { bindUrl: string }): string {
  const serializedBindUrl = JSON.stringify(params.bindUrl);
  const qrSvg = buildBindingQrSvg(params.bindUrl);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>QClaw 微信绑定</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
        background: #f6f6f6;
        color: #111;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 380px;
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
        padding: 28px 24px;
        text-align: center;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
      }
      p {
        margin: 0;
        color: #666;
        line-height: 1.6;
      }
      #qrcode {
        width: 220px;
        height: 220px;
        margin: 24px auto 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #qrcode img,
      #qrcode canvas {
        max-width: 220px;
        max-height: 220px;
      }
      #status {
        margin-top: 20px;
        font-size: 15px;
        color: #111;
      }
      #detail {
        margin-top: 10px;
        font-size: 13px;
        color: #8f8f8f;
        min-height: 20px;
      }
      .success {
        color: #1f4d2a;
      }
      .error {
        color: #a1322a;
      }
      .hint {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        background: #f7f7f7;
        text-align: left;
        font-size: 13px;
        color: #666;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>微信扫码绑定</h1>
        <p>请使用微信扫描二维码，并在移动端按照页面提示完成绑定确认。</p>
        <div id="qrcode">${qrSvg}</div>
        <div id="status">等待扫码…</div>
        <div id="detail"></div>
        <div class="hint">
          扫码成功后，您可以关闭当前浏览器页面，并返回终端继续操作。
        </div>
      </div>
    </div>
    <script>
      const bindUrl = ${serializedBindUrl};
      const statusNode = document.getElementById("status");
      const detailNode = document.getElementById("detail");
      async function pollStatus() {
        try {
          const response = await fetch("/status", { cache: "no-store" });
          const payload = await response.json();
          statusNode.textContent = payload.message || "等待扫码…";
          detailNode.textContent = payload.detail || "";
          statusNode.className =
            payload.phase === "bound"
              ? "success"
              : payload.phase === "error"
                ? "error"
                : "";
          if (payload.phase === "bound" || payload.phase === "error") {
            return;
          }
        } catch (_) {
          statusNode.textContent = "正在获取绑定状态，请稍候…";
        }
        setTimeout(pollStatus, 1500);
      }
      pollStatus();
    </script>
  </body>
</html>`;
}

export async function serveBindingQrPage(params: {
  bindUrl: string;
  logger: Logger;
  openBrowser?: boolean;
  bindHost?: string;
  port?: number;
  publicUrl?: string;
}): Promise<{
  url: string;
  updateStatus: (status: BindingPageStatus) => void;
  close: () => Promise<void>;
}> {
  const bindHost = normalizeBindHost(params.bindHost);
  const listenPort = normalizeListenPort(params.port);
  let status: BindingPageStatus = {
    phase: "waiting",
    message: "请使用微信扫码，并在移动端完成绑定确认",
    detail: "扫码成功后，您可以关闭当前浏览器页面，并返回终端继续操作。",
  };
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && requestUrl.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderBindingPage({ bindUrl: params.bindUrl }));
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/status") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(status));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法分配本地二维码服务端口");
  }
  const url = buildAccessibleUrl({
    bindHost,
    port: address.port,
    publicUrl: params.publicUrl,
  });
  params.logger.info(`[qclaw-wechat] 绑定二维码页面已就绪: ${url}`);
  if (!params.publicUrl && (bindHost === "0.0.0.0" || bindHost === "::")) {
    params.logger.warn(
      `[qclaw-wechat] 当前监听在 ${bindHost}:${address.port}，请通过服务器实际 IP / 域名访问，或传入 --public-url 打印可直接访问的地址`,
    );
  }
  if (params.openBrowser !== false) {
    try {
      openUrl(url);
    } catch (error) {
      params.logger.warn(
      `[qclaw-wechat] 自动打开浏览器失败，请手动访问以下地址完成绑定：${url}。${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    url,
    updateStatus(nextStatus) {
      status = nextStatus;
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
