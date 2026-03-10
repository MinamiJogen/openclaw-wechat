# QClaw WeChat Access

[English](./README.en.md)
⚠️本仓库随时可能因为微信或 QClaw 后端调整而失效

在 OpenClaw 中复用 QClaw 微信通路，将微信接入 OpenClaw！

## 功能说明

这个插件可以让原版 OpenClaw：

- 通过 QClaw 的客服二维码流程配对微信
- 将 QClaw 的 channel token 和模型 API key 同步到 OpenClaw 配置

## 邀请码与权限说明

这个项目**不提供**邀请码注册或账号开通能力。

因此你必须使用已经填写过邀请码的微信账号。如果账号尚未被 QClaw 后端开通，配对流程可能看起来成功，但网关仍然会把设备判定为离线。

## 要求

- 已受到邀请可以正常使用 QClaw 的微信账号

## 安装

### 方式一：通过 npm 安装

```bash
openclaw plugins install @minamijogen/openclaw-wechat
```

### 方式二：从本地目录安装

```bash
openclaw plugins install /path/to/qclaw-wechat-plugin --link
```

### 方式三：先从 GitHub 克隆

```bash
git clone https://github.com/MinamiJogen/openclaw-wechat.git
cd openclaw-wechat
openclaw plugins install "$(pwd)" --link
```

### 方式四：按子包路径安装

```bash
git clone https://github.com/MinamiJogen/openclaw-wechat.git
cd openclaw-wechat
npm install
npm run build
openclaw plugins install -l ./packages/channels
```

安装完成后重启 OpenClaw。

## 命令

### 配对

```bash
openclaw qclaw-wechat pair
```

流程如下：

- 如果当前没有可用的 QClaw 登录态，会先完成一次微信登录
- 然后打开客服绑定二维码页面
- 手机跳转到 QClaw 客服会话并确认绑定后，插件会轮询直到设备绑定完成

成功后会写入：

- `channels.wechat-access.token`
- `channels.wechat-access.wsUrl`
- `models.providers.qclaw.baseUrl`
- `models.providers.qclaw.api`
- `models.providers.qclaw.models`
- `models.providers.qclaw.apiKey`

### 解除配对

```bash
openclaw qclaw-wechat unpair
```

这会清除本地保存的登录状态，并从配置里移除当前 channel token。

### 同步

```bash
openclaw qclaw-wechat sync
```

这会从腾讯后端刷新 `openclaw_channel_token` 和 QClaw API key，并同步回配置文件。

## 无头服务器使用

如果不想自动打开浏览器，可以只打印本地二维码地址：

```bash
openclaw qclaw-wechat pair --no-open
```

如果是通过 SSH 连接到无头服务器，可以在服务端本地监听，再做端口转发：

```bash
ssh -L 64716:127.0.0.1:64716 user@server
openclaw qclaw-wechat pair --no-open --bind 127.0.0.1 --port 64716
```

然后在本地浏览器打开 `http://127.0.0.1:64716/`。

如果服务器有反向代理或公网入口，可以这样：

```bash
openclaw qclaw-wechat pair \
  --no-open \
  --bind 0.0.0.0 \
  --port 64716 \
  --public-url https://your-host.example.com/qclaw-wechat
```

## 常见问题

### 配对成功了，但微信里仍然提示设备离线

这通常说明账号虽然完成了设备绑定，但并没有真正开通 QClaw 微信网关权限。设备绑定和账号授权不是一回事。

优先检查：

- 账号是否能正常登录 QClaw
- 账号是否已经被邀请

### 二维码页面没有自动打开

执行：

```bash
openclaw qclaw-wechat pair --no-open
```

然后手动打开终端打印出来的地址即可。
