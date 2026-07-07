# mihomo-manager-webui

[简体中文](#简体中文) | [English](#english)

## 简体中文

`mihomo-manager-webui` 是一个独立的 Mihomo 本地 Web 管理面板。它不依赖额外的管理脚本文件，后端通过 SSH 连接服务器，并使用内置的白名单动作直接管理 Mihomo、订阅配置、proxychains、系统代理、systemd 服务和日志。

仓库地址：

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### 功能特性

- 借鉴 Clash Verge 的侧边导航和分栏布局，本地 Web 仪表盘可视化管理 Mihomo
- 后端白名单 API，不开放任意命令执行
- 通过 SSH 直接管理远程服务器
- 订阅链接和 User-Agent 管理
- 订阅拉取、配置生成和 Mihomo 配置校验
- 自动选择可用代理节点
- 代理组视图，支持查看当前策略、手动切换节点和批量延迟测试
- 规则视图，支持查看当前加载规则、规则类型统计和前 500 条规则明细
- Mihomo systemd 服务启动、停止、重启和状态查看
- 系统代理配置，支持新 shell 和 apt
- proxychains4 配置辅助
- SOCKS5 和 proxychains 连通性测试
- Mihomo 和订阅更新日志查看
- 简体中文 / English 输出设置
- Docker 和 Docker Compose 部署支持

### 运行要求

远程服务器需要：

- Linux + systemd
- Bash
- curl
- python3
- Mihomo 安装在 `/usr/local/bin/mihomo` 或位于 `PATH`
- Mihomo external controller 可在服务器本机 `127.0.0.1:9090` 访问
- proxychains4，用于 proxychains 相关功能
- 服务器允许 SSH 登录

本地或容器侧需要：

- Node.js 20 或更高版本，或 Docker
- 可用的 SSH 私钥

### 管理的远程文件

WebUI 会直接管理以下远程路径：

```text
/etc/mihomo/subscription.env
/etc/mihomo/config.yaml
/etc/mihomo/subscription.raw.yaml
/etc/mihomo/webui.env
/etc/proxychains4.conf
/etc/proxychains.conf
/etc/profile.d/mihomo-proxy.sh
/etc/apt/apt.conf.d/95mihomo-proxy
```

### 本地 Web UI 部署

复制示例配置，并填写服务器连接信息：

```bash
cp server.config.example.json server.config.json
```

示例：

```json
{
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "identityFile": "/absolute/path/to/private_key"
}
```

启动本地控制台：

```bash
npm start
```

打开：

```text
http://127.0.0.1:5178
```

默认情况下，Web 服务只监听 `127.0.0.1`。后端只开放白名单 API，并通过 SSH 在服务器上执行内置管理动作。

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

### 可视化操作

WebUI 当前包含以下页面：

- 仪表盘：查看服务、订阅、系统代理和 proxychains 状态
- 代理：按 Mihomo 代理组查看节点、当前策略、节点延迟，支持手动切换和批量测速
- 订阅：更换订阅链接、设置 User-Agent、更新订阅、选择可用节点
- 规则：查看当前加载规则、规则类型统计和规则明细
- 服务：启动、停止、重启 Mihomo，查看监听端口和 systemd 状态
- 系统：开启/关闭系统代理，查看和重建 proxychains 配置
- 日志：查看 Mihomo 日志和订阅更新日志
- 设置：切换输出语言，查看连接信息

### 敏感信息

不要提交订阅链接或 token。WebUI 会把订阅配置保存在服务器的 `/etc/mihomo/subscription.env`，显示订阅链接时会自动脱敏敏感查询参数。

本地 `server.config.json` 已被 Git 忽略，因为它可能包含个人服务器地址和 SSH 私钥路径。

## English

`mihomo-manager-webui` is a standalone local Web UI for managing a Mihomo proxy setup. It does not depend on an external management script file. The backend connects to your server over SSH and uses built-in whitelisted actions to manage Mihomo, subscriptions, proxychains, system proxy settings, systemd services, and logs directly.

Repository:

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### Features

- Clash Verge inspired sidebar navigation and split-pane local dashboard for visual Mihomo management
- Whitelisted backend API, with no arbitrary command execution endpoint
- Direct remote server management over SSH
- Subscription URL and User-Agent management
- Subscription download, config generation, and Mihomo config validation
- Automatic working-node selection
- Proxy group view for current policy, manual node switching, and grouped delay tests
- Rules view for loaded-rule inspection, rule type statistics, and the first 500 rule entries
- Mihomo systemd start, stop, restart, and status helpers
- System proxy helpers for new shells and apt
- proxychains4 configuration helper
- SOCKS5 and proxychains connectivity tests
- Log viewers for Mihomo and subscription updates
- Simplified Chinese / English output setting
- Docker and Docker Compose deployment support

### Requirements

On the remote server:

- Linux with systemd
- Bash
- curl
- python3
- Mihomo installed at `/usr/local/bin/mihomo` or available in `PATH`
- Mihomo external controller reachable on the server at `127.0.0.1:9090`
- proxychains4 for proxychains-related features
- SSH login access

On the local or container side:

- Node.js 20 or newer, or Docker
- A usable SSH private key

### Remote Files Managed

The WebUI directly manages these remote paths:

```text
/etc/mihomo/subscription.env
/etc/mihomo/config.yaml
/etc/mihomo/subscription.raw.yaml
/etc/mihomo/webui.env
/etc/proxychains4.conf
/etc/proxychains.conf
/etc/profile.d/mihomo-proxy.sh
/etc/apt/apt.conf.d/95mihomo-proxy
```

### Local Web UI Deployment

Copy the example config and fill in your server details:

```bash
cp server.config.example.json server.config.json
```

Example:

```json
{
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "identityFile": "/absolute/path/to/private_key"
}
```

Start the local dashboard:

```bash
npm start
```

Open:

```text
http://127.0.0.1:5178
```

By default, the web server only listens on `127.0.0.1`. The backend exposes only whitelisted API actions and runs built-in management actions on the server over SSH.

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

### Visual Operations

The WebUI currently includes these pages:

- Dashboard: service, subscription, system proxy, and proxychains status
- Proxies: inspect Mihomo proxy groups, current policies, node latency, manual switching, and grouped delay tests
- Subscription: replace subscription URL, set User-Agent, update subscription, select a working node
- Rules: inspect currently loaded rules, rule type statistics, and rule entries
- Service: start, stop, restart Mihomo, view listening ports and systemd status
- System: enable/disable system proxy, view and recreate proxychains config
- Logs: view Mihomo logs and subscription update logs
- Settings: switch output language and view connection details

### Sensitive Data

Do not commit subscription URLs or tokens. The WebUI stores subscription settings in `/etc/mihomo/subscription.env` on the server and masks sensitive query parameters when displaying URLs.

The local `server.config.json` file is ignored by Git because it may contain personal server addresses and SSH key paths.
