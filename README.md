# mihomo-manager-webui

[简体中文](#简体中文) | [English](#english)

## 简体中文

`mihomo-manager-webui` 是一个面向 Mihomo 代理环境的本地 Web 管理界面和 Bash 管理脚本集合。浏览器控制台通过 SSH 调用服务器上的 `mihomo.sh`，可以可视化完成订阅更新、服务控制、系统代理、日志查看等操作，同时避免把管理面板暴露到公网。

仓库地址：

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### 功能特性

- 分组式交互菜单
- 简体中文 / English 界面
- 订阅链接和 User-Agent 管理
- 手动更新订阅
- 通过 Mihomo 控制接口自动选择可用节点
- Mihomo systemd 服务管理
- 系统代理配置，支持新 shell 和 apt
- proxychains4 配置辅助
- SOCKS5 和 proxychains 连通性测试
- Mihomo 和订阅更新日志查看
- 本地 Web 仪表盘，可视化操作常用功能

### 运行要求

服务器侧需要：

- Linux + systemd
- Bash
- curl
- Mihomo 安装在 `/usr/local/bin/mihomo`
- proxychains4
- 已存在以下辅助脚本：
  - `/usr/local/sbin/update-mihomo-subscription`
  - `/usr/local/sbin/select-mihomo-working-proxy`

本地 Web UI 需要：

- Node.js 20 或更高版本
- 可用的 SSH 私钥

### 安装脚本

```bash
install -m 700 mihomo.sh /usr/local/sbin/mihomo.sh
```

以 root 身份运行：

```bash
mihomo.sh menu
```

### 本地 Web UI 部署

复制示例配置，并填写服务器连接信息：

```bash
cp server.config.example.json server.config.json
```

启动本地控制台：

```bash
npm start
```

打开：

```text
http://127.0.0.1:5178
```

默认情况下，Web 服务只监听 `127.0.0.1`。后端只开放白名单 API，并通过 SSH 调用服务器上的 `/usr/local/sbin/mihomo.sh`。

也可以使用环境变量启动：

```bash
MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_KEY=/path/to/key npm start
```

### Docker 部署

构建镜像：

```bash
docker build -t mihomo-manager-webui .
```

运行容器：

```bash
docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  -p 127.0.0.1:5178:5178 \
  -e MIHOMO_HOST=1.2.3.4 \
  -e MIHOMO_SSH_PORT=22 \
  -e MIHOMO_USER=root \
  -e MIHOMO_KEY_FILE=/run/secrets/mihomo_ssh_key \
  -e MIHOMO_SCRIPT=/usr/local/sbin/mihomo.sh \
  -v /absolute/path/to/private_key:/run/secrets/mihomo_ssh_key:ro \
  mihomo-manager-webui
```

打开：

```text
http://127.0.0.1:5178
```

容器内部监听 `0.0.0.0`，但上面的示例只把服务发布到宿主机的 `127.0.0.1`。入口脚本会把挂载的私钥复制到临时文件并设置为 `600` 权限，避免 OpenSSH 因权限过宽而拒绝使用私钥。

停止并删除容器：

```bash
docker rm -f mihomo-manager-webui
```

### Docker Compose 部署

创建环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
MIHOMO_HOST=1.2.3.4
MIHOMO_SSH_PORT=22
MIHOMO_USER=root
MIHOMO_KEY_PATH=/absolute/path/to/private_key
MIHOMO_SCRIPT=/usr/local/sbin/mihomo.sh
```

启动：

```bash
docker compose up -d --build
```

打开：

```text
http://127.0.0.1:5178
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

Compose 文件同样将 Web UI 绑定到 `127.0.0.1:5178`，并通过 Docker secret 挂载 SSH 私钥。请妥善保管 `.env`，因为其中包含服务器地址和本地私钥路径。

### 常用命令

```bash
mihomo.sh status
mihomo.sh update
mihomo.sh set-url
mihomo.sh set-ua
mihomo.sh test
mihomo.sh proxy on
mihomo.sh proxy off
mihomo.sh proxy env
mihomo.sh set-lang zh
mihomo.sh set-lang en
```

让当前 shell 立即使用代理环境变量：

```bash
eval "$(mihomo.sh proxy env)"
```

### 敏感信息

不要提交订阅链接或 token。脚本会把订阅配置保存在服务器的 `/etc/mihomo/subscription.env`，显示订阅链接时会自动脱敏敏感查询参数。

本地 `server.config.json` 已被 Git 忽略，因为它可能包含个人服务器地址和 SSH 私钥路径。

## English

`mihomo-manager-webui` is a local Web UI and Bash management toolkit for a Mihomo-based proxy setup. The browser dashboard calls `mihomo.sh` on your server over SSH, so routine operations can be managed visually without exposing an admin panel to the public internet.

Repository:

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### Features

- Grouped interactive menu
- Simplified Chinese / English UI
- Subscription URL and User-Agent management
- Manual subscription refresh
- Automatic working-node selection through the Mihomo controller
- Mihomo systemd service helpers
- System proxy helpers for new shells and apt
- proxychains4 configuration helper
- SOCKS5 and proxychains connectivity tests
- Log viewers for Mihomo and subscription updates
- Local web dashboard for visual operations

### Requirements

On the server:

- Linux with systemd
- Bash
- curl
- Mihomo installed at `/usr/local/bin/mihomo`
- proxychains4
- Existing helper scripts:
  - `/usr/local/sbin/update-mihomo-subscription`
  - `/usr/local/sbin/select-mihomo-working-proxy`

For the local Web UI:

- Node.js 20 or newer
- A usable SSH private key

### Script Install

```bash
install -m 700 mihomo.sh /usr/local/sbin/mihomo.sh
```

Run as root:

```bash
mihomo.sh menu
```

### Local Web UI Deployment

Copy the example config and fill in your server details:

```bash
cp server.config.example.json server.config.json
```

Start the local dashboard:

```bash
npm start
```

Open:

```text
http://127.0.0.1:5178
```

By default, the web server only listens on `127.0.0.1`. The backend exposes only whitelisted API actions and uses SSH to run `/usr/local/sbin/mihomo.sh` on the server.

You can also configure it with environment variables:

```bash
MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_KEY=/path/to/key npm start
```

### Docker Deployment

Build the image:

```bash
docker build -t mihomo-manager-webui .
```

Run the container:

```bash
docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  -p 127.0.0.1:5178:5178 \
  -e MIHOMO_HOST=1.2.3.4 \
  -e MIHOMO_SSH_PORT=22 \
  -e MIHOMO_USER=root \
  -e MIHOMO_KEY_FILE=/run/secrets/mihomo_ssh_key \
  -e MIHOMO_SCRIPT=/usr/local/sbin/mihomo.sh \
  -v /absolute/path/to/private_key:/run/secrets/mihomo_ssh_key:ro \
  mihomo-manager-webui
```

Open:

```text
http://127.0.0.1:5178
```

The container listens on `0.0.0.0` internally, but the example publishes it only to `127.0.0.1` on the host. The entrypoint copies the mounted private key to a temporary file with `600` permissions before starting Node, which avoids common OpenSSH permission errors.

Stop and remove:

```bash
docker rm -f mihomo-manager-webui
```

### Docker Compose Deployment

Create an environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
MIHOMO_HOST=1.2.3.4
MIHOMO_SSH_PORT=22
MIHOMO_USER=root
MIHOMO_KEY_PATH=/absolute/path/to/private_key
MIHOMO_SCRIPT=/usr/local/sbin/mihomo.sh
```

Start:

```bash
docker compose up -d --build
```

Open:

```text
http://127.0.0.1:5178
```

View logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

The Compose file also binds the UI to `127.0.0.1:5178` and mounts the SSH key as a Docker secret. Keep `.env` private because it contains your server address and local key path.

### Common Commands

```bash
mihomo.sh status
mihomo.sh update
mihomo.sh set-url
mihomo.sh set-ua
mihomo.sh test
mihomo.sh proxy on
mihomo.sh proxy off
mihomo.sh proxy env
mihomo.sh set-lang zh
mihomo.sh set-lang en
```

Enable proxy variables for the current shell:

```bash
eval "$(mihomo.sh proxy env)"
```

### Sensitive Data

Do not commit subscription URLs or tokens. This script stores subscription settings in `/etc/mihomo/subscription.env` on the server and masks sensitive query parameters when displaying URLs.

The local `server.config.json` file is ignored by Git because it may contain personal server addresses and SSH key paths.
