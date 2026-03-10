# QClaw WeChat Access

Reuse QClaw's private WeChat gateway in OpenClaw with QR pairing. 在 OpenClaw 中复用 QClaw 私有微信通路，并支持扫码配对。

- Repository: `https://github.com/MinamiJogen/openclaw-wechat`
- Issues: `https://github.com/MinamiJogen/openclaw-wechat/issues`

## What it does

This plugin lets a stock OpenClaw instance:

- pair a WeChat account through QClaw's customer-service QR flow
- reuse QClaw's private `wechat-access` gateway
- sync the QClaw channel token and QClaw model API key into OpenClaw config

## Important note about invite access

This project does **not** provide invite-code registration or account opening.

You must use a WeChat/QClaw account that already has permission to use the QClaw WeChat gateway. If the account is not opened by QClaw's backend, pairing may appear to succeed, but the gateway can still reject the device as offline.

In practice:

- this plugin only reuses QClaw's existing backend
- it does not create invite codes
- it does not bypass backend account authorization
- if your account is still under invite control, you need a WeChat account that already has that permission

## Requirements

- OpenClaw `>= 2026.1.26`
- a working QClaw-backed WeChat login
- a WeChat account that already has QClaw gateway permission

## Install

### Option 1: install from a local checkout

```bash
openclaw plugins install /path/to/qclaw-wechat-plugin --link
```

### Option 2: clone from GitHub first

```bash
git clone https://github.com/MinamiJogen/openclaw-wechat.git
cd openclaw-wechat
openclaw plugins install "$(pwd)" --link
```

Restart OpenClaw after install.

## Commands

### Pair

```bash
openclaw qclaw-wechat pair
```

Flow:

- if there is no valid QClaw login session yet, it first completes one WeChat login
- then it opens the customer-service binding QR page
- after the phone jumps into the QClaw customer-service chat and confirms binding, the plugin polls until the device is bound

After success it writes:

- `channels.wechat-access.token`
- `channels.wechat-access.wsUrl`
- `models.providers.qclaw.baseUrl`
- `models.providers.qclaw.api`
- `models.providers.qclaw.models`
- `models.providers.qclaw.apiKey` when available

If you paired with an older build of this plugin and the browser page logged in but still showed "device not bound", run `unpair` once and then `pair` again so the plugin can rebuild its guid from the host machine ID and switch over to the binding flow.

### Unpair

```bash
openclaw qclaw-wechat unpair
```

This clears the stored login state and removes the live channel token from config.

### Sync

```bash
openclaw qclaw-wechat sync
```

This refreshes `openclaw_channel_token` and the QClaw API key from Tencent's backend and syncs them back into config.

## Headless server usage

You can keep the browser closed and print the local QR URL instead:

```bash
openclaw qclaw-wechat pair --no-open
```

For a headless server behind SSH, bind locally on the server and forward the port:

```bash
ssh -L 64716:127.0.0.1:64716 user@server
openclaw qclaw-wechat pair --no-open --bind 127.0.0.1 --port 64716
```

Then open `http://127.0.0.1:64716/` in your local browser.

For a remote host with reverse proxy or public ingress:

```bash
openclaw qclaw-wechat pair \
  --no-open \
  --bind 0.0.0.0 \
  --port 64716 \
  --public-url https://your-host.example.com/qclaw-wechat
```

## Troubleshooting

### Pairing succeeds, but WeChat still says the device is offline

This usually means the account is not fully opened for the QClaw WeChat gateway on the backend side. Device binding and account authorization are not the same thing.

Check these first:

- the account can log in to QClaw normally
- the account has already been granted QClaw WeChat gateway access
- you are not relying on frontend-only invite-code bypass

### The QR page does not open automatically

Run:

```bash
openclaw qclaw-wechat pair --no-open
```

Then open the printed URL manually.
