# QClaw WeChat Access

[中文](./README.md)
⚠️ This repository may stop working at any time if WeChat or the QClaw backend changes.
Reuse the QClaw WeChat channel in OpenClaw and bring WeChat into OpenClaw.

## Features

This plugin lets a stock OpenClaw instance:

- pair a WeChat account through QClaw's customer-service QR flow
- sync the QClaw channel token and QClaw model API key into OpenClaw config

## Invite Code and Permission Notice

This project does **not** provide invite-code registration or account opening.

You must use a WeChat account that has already been activated through QClaw's invite flow. If the account has not been opened on QClaw's backend, pairing may appear to succeed, but the gateway can still mark the device as offline.

## Requirements

- a WeChat account that has already been invited for QClaw WeChat gateway access

## Install

### Option 1: install from npm

```bash
openclaw plugins install @minamijogen/openclaw-wechat
```

### Option 2: install from a local checkout

```bash
openclaw plugins install /path/to/qclaw-wechat-plugin --link
```

### Option 3: clone from GitHub first

```bash
git clone https://github.com/MinamiJogen/openclaw-wechat.git
cd openclaw-wechat
openclaw plugins install "$(pwd)" --link
```

### Option 4: install from the package subpath

```bash
git clone https://github.com/MinamiJogen/openclaw-wechat.git
cd openclaw-wechat
npm install
npm run build
openclaw plugins install -l ./packages/channels
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
- `models.providers.qclaw.apiKey`

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
- the account has already been invited

### The QR page does not open automatically

Run:

```bash
openclaw qclaw-wechat pair --no-open
```

Then open the printed URL manually.
