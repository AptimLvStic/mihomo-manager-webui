# mihomo-manager-webui

[简体中文](#简体中文) | [English](#english)

## 简体中文

`mihomo-manager-webui` 是一个独立的 Mihomo Web 管理面板。它不依赖额外的管理脚本文件，支持本地管理和远端管理两种模式，并使用内置的白名单动作管理 Mihomo、订阅配置、proxychains、系统代理、systemd 服务和日志。

仓库地址：

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### 功能特性

- 借鉴 Clash Verge 的侧边导航和分栏布局，本地 Web 仪表盘可视化管理 Mihomo
- 后端白名单 API，不开放任意命令执行
- 本地管理模式：部署在目标服务器上，直接使用本机环境执行管理动作
- 远端管理模式：通过 SSH 密钥或 SSH 密码连接服务器进行管理
- 首次启动初始化界面，可在浏览器中选择本地/远端模式、测试连接并保存配置
- 订阅名称、描述、链接、User-Agent 和更新策略管理
- 订阅拉取、配置生成和 Mihomo 配置校验
- 自动选择可用代理节点
- 代理组视图，支持查看当前策略、手动切换节点和逐条显示延迟测试结果
- 规则视图，支持查看当前加载规则、规则类型统计、前 500 条规则明细和新增规则
- Mihomo systemd 服务启动、停止、重启和状态查看
- 系统代理配置，支持新 shell 和 apt
- proxychains4 配置辅助
- SOCKS5 和 proxychains 连通性测试
- Mihomo 和订阅更新日志查看
- 简体中文 / English 输出设置
- Docker 和 Docker Compose 部署支持

### 运行要求

被管理的服务器需要：

- Linux + systemd
- Bash
- curl
- python3
- Mihomo 安装在 `/usr/local/bin/mihomo` 或位于 `PATH`
- Mihomo external controller 可在服务器本机 `127.0.0.1:9090` 访问
- proxychains4，用于 proxychains 相关功能
- 远端管理模式需要服务器允许 SSH 登录

WebUI 运行侧需要：

- Node.js 20 或更高版本，或 Docker
- 本地管理模式需要能在本机执行 `bash`，通常建议以 root 或具备 sudo/systemd 管理权限的用户运行
- 远端密钥模式需要可用的 SSH 私钥
- 远端密码模式需要 `sshpass`，Docker 镜像已内置

### 管理的文件

WebUI 会直接管理以下路径。本地管理模式下这些是本机路径；远端管理模式下这些是远程服务器路径：

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

### 使用模式

首次部署后可以直接打开 WebUI 进入初始化界面，无需先手写配置文件。初始化界面支持选择本地/远端管理、选择 SSH 密钥或密码、测试连接，并将配置保存到本地 `server.config.json`。

也可以继续使用配置文件或环境变量：

本地管理：

```json
{
  "mode": "local"
}
```

远端管理，SSH 密钥：

```json
{
  "mode": "remote",
  "auth": "key",
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "identityFile": "/absolute/path/to/private_key"
}
```

远端管理，SSH 密码：

```json
{
  "mode": "remote",
  "auth": "password",
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "password": "<ssh-password>"
}
```

也可以使用环境变量：

```bash
# 本地管理
MIHOMO_MODE=local npm start

# 远端密钥管理
MIHOMO_MODE=remote MIHOMO_AUTH=key MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_KEY=/path/to/key npm start

# 远端密码管理
MIHOMO_MODE=remote MIHOMO_AUTH=password MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_PASSWORD='<ssh-password>' npm start
```

### 本地 Web UI 部署

复制示例配置，并按上面的使用模式填写：

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

默认情况下，Web 服务只监听 `127.0.0.1`。后端只开放白名单 API，并根据 `mode` 在本机执行动作或通过 SSH 在远程服务器执行动作。

### Docker 部署

#### 方式一：docker run

当前 Docker 示例默认绑定 `0.0.0.0:5178`，会对外开放 WebUI；生产环境请至少配合防火墙白名单，推荐再通过 Nginx/Caddy 等反向代理提供 HTTPS 访问。若容器需要管理宿主机上的 Mihomo，不要把 `MIHOMO_HOST` 写成 `127.0.0.1`，容器内的 `127.0.0.1` 指向容器自身，应使用 `host.docker.internal` 并添加 host-gateway 映射。

首次初始化模式可以只挂载持久化目录后启动，随后在浏览器初始化界面选择“本地管理”或“远端管理”：

```bash
mkdir -p data

docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  --init \
  -p 0.0.0.0:5178:5178 \
  --add-host=host.docker.internal:host-gateway \
  -e LISTEN_HOST=0.0.0.0 \
  -e SERVER_CONFIG_FILE=/app/data/server.config.json \
  -v "$(pwd)/data:/app/data" \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  mihomo-manager-webui
```

如果明确采用“远端密钥模式”管理宿主机或另一台服务器，可以预先注入环境变量和密钥：

```bash
mkdir -p data secrets
# 示例：为宿主机管理生成项目专用密钥，并把公钥加入被管理服务器的 authorized_keys
ssh-keygen -t ed25519 -N "" -f secrets/mihomo_manager_ed25519 -C mihomo-manager-webui
cat secrets/mihomo_manager_ed25519.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys secrets/mihomo_manager_ed25519

docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  --init \
  -p 0.0.0.0:5178:5178 \
  --add-host=host.docker.internal:host-gateway \
  -e LISTEN_HOST=0.0.0.0 \
  -e SERVER_CONFIG_FILE=/app/data/server.config.json \
  -e MIHOMO_MODE=remote \
  -e MIHOMO_AUTH=key \
  -e MIHOMO_HOST=host.docker.internal \
  -e MIHOMO_SSH_PORT=22 \
  -e MIHOMO_USER=root \
  -e MIHOMO_KEY_FILE=/run/secrets/mihomo_ssh_key \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/secrets/mihomo_manager_ed25519:/run/secrets/mihomo_ssh_key:ro" \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  mihomo-manager-webui
```

打开：

```text
http://SERVER_IP:5178
```

停止并删除容器：

```bash
docker rm -f mihomo-manager-webui
```

#### 方式二：Docker Compose

创建环境变量文件：

```bash
cp .env.example .env
mkdir -p data secrets
```

若使用初始化界面完成配置，可以保持 `.env` 中 `MIHOMO_MODE`、`MIHOMO_AUTH`、`MIHOMO_HOST` 等为空，然后启动：

```bash
docker compose up -d --build
```

若使用远端密钥模式管理宿主机，建议创建项目专用密钥并填写 `.env`：

```bash
ssh-keygen -t ed25519 -N "" -f secrets/mihomo_manager_ed25519 -C mihomo-manager-webui
cat secrets/mihomo_manager_ed25519.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys secrets/mihomo_manager_ed25519
```

```env
MIHOMO_BIND=0.0.0.0
MIHOMO_MODE=remote
MIHOMO_AUTH=key
MIHOMO_HOST=host.docker.internal
MIHOMO_SSH_PORT=22
MIHOMO_USER=root
MIHOMO_KEY_PATH=/absolute/path/to/mihomo-manager-webui/secrets/mihomo_manager_ed25519
MIHOMO_PASSWORD=
```

启动远端密钥模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml up -d --build
```

远端密码模式不需要密钥 override，设置 `MIHOMO_AUTH=password` 和 `MIHOMO_PASSWORD` 后使用基础 Compose 文件启动即可。本地管理模式设置 `MIHOMO_MODE=local`，但在 Docker 内的本地模式只管理容器自身环境；如果要管理宿主机服务，推荐使用上面的远端 SSH 方式。

上线检查：

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml ps
curl -fsS http://127.0.0.1:5178/api/config
curl -fsS "http://127.0.0.1:5178/api/run?command=status"
ss -ltnp | grep 5178
```

查看日志和停止服务：

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml down
```

Compose 默认将 WebUI 绑定到 `0.0.0.0:5178`，配置文件持久化到 `./data`，密钥建议放在 `./secrets`。`.env`、`data/`、`secrets/` 都不应提交到 Git。

### 可视化操作

WebUI 当前包含以下页面：

- 仪表盘：查看服务、订阅、系统代理和 proxychains 状态
- 代理：按 Mihomo 代理组查看节点、当前策略、节点延迟，支持手动切换和逐条测速显示
- 订阅：更换订阅链接，设置订阅名称、描述、User-Agent、自动更新、系统代理更新和内核更新
- 规则：查看当前加载规则、规则类型统计、规则明细，按规则类型、规则内容和代理策略新增规则
- 服务：启动、停止、重启 Mihomo，查看监听端口和 systemd 状态
- 系统：开启/关闭系统代理，查看和重建 proxychains 配置
- 日志：查看 Mihomo 日志和订阅更新日志
- 设置：切换输出语言，查看连接信息

### 优化整改文档

P0-P3 整改设计、UI 原型、技术方案、路线图和测试清单见：

```text
docs/optimization-plan.md
```

### 敏感信息

不要提交订阅链接或 token。WebUI 会把订阅配置保存在服务器的 `/etc/mihomo/subscription.env`，显示订阅链接时会自动脱敏敏感查询参数。

本地 `server.config.json` 已被 Git 忽略，因为它可能包含个人服务器地址和 SSH 私钥路径。

## English

`mihomo-manager-webui` is a standalone Web UI for managing a Mihomo proxy setup. It does not depend on an external management script file. It supports both local management and remote management, and uses built-in whitelisted actions to manage Mihomo, subscriptions, proxychains, system proxy settings, systemd services, and logs.

Repository:

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

### Features

- Clash Verge inspired sidebar navigation and split-pane local dashboard for visual Mihomo management
- Whitelisted backend API, with no arbitrary command execution endpoint
- Local management mode: deploy on the target server and use the local runtime directly
- Remote management mode: connect to the target server with an SSH key or SSH password
- First-run setup screen for choosing local/remote mode, testing the connection, and saving the config in the browser
- Subscription name, description, URL, User-Agent, and update policy management
- Subscription download, config generation, and Mihomo config validation
- Automatic working-node selection
- Proxy group view for current policy, manual node switching, and per-node progressive delay results
- Rules view for loaded-rule inspection, rule type statistics, the first 500 rule entries, and adding rules
- Mihomo systemd start, stop, restart, and status helpers
- System proxy helpers for new shells and apt
- proxychains4 configuration helper
- SOCKS5 and proxychains connectivity tests
- Log viewers for Mihomo and subscription updates
- Simplified Chinese / English output setting
- Docker and Docker Compose deployment support

### Requirements

On the managed server:

- Linux with systemd
- Bash
- curl
- python3
- Mihomo installed at `/usr/local/bin/mihomo` or available in `PATH`
- Mihomo external controller reachable on the server at `127.0.0.1:9090`
- proxychains4 for proxychains-related features
- SSH login access for remote management mode

On the WebUI runtime side:

- Node.js 20 or newer, or Docker
- Local management mode needs `bash` on the same machine, usually running as root or as a user with enough sudo/systemd permissions
- Remote key mode needs a usable SSH private key
- Remote password mode needs `sshpass`; the Docker image includes it

### Managed Files

The WebUI directly manages these paths. In local management mode they are local paths; in remote management mode they are paths on the remote server:

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

### Usage Modes

After the first deployment, you can open the WebUI and finish setup in the browser without manually writing a config file. The setup screen supports local/remote mode selection, SSH key/password authentication, connection testing, and saving to local `server.config.json`.

Manual config files and environment variables are still supported:

Local management:

```json
{
  "mode": "local"
}
```

Remote management with an SSH key:

```json
{
  "mode": "remote",
  "auth": "key",
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "identityFile": "/absolute/path/to/private_key"
}
```

Remote management with an SSH password:

```json
{
  "mode": "remote",
  "auth": "password",
  "host": "1.2.3.4",
  "port": 22,
  "user": "root",
  "password": "<ssh-password>"
}
```

You can also use environment variables:

```bash
# Local management
MIHOMO_MODE=local npm start

# Remote key management
MIHOMO_MODE=remote MIHOMO_AUTH=key MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_KEY=/path/to/key npm start

# Remote password management
MIHOMO_MODE=remote MIHOMO_AUTH=password MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_PASSWORD='<ssh-password>' npm start
```

### Local Web UI Deployment

Copy the example config and fill it according to one of the usage modes above:

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

By default, the web server only listens on `127.0.0.1`. The backend exposes only whitelisted API actions and runs them locally or over SSH depending on `mode`.

### Docker Deployment

#### Option 1: docker run

The Docker examples bind to `0.0.0.0:5178` by default and expose the WebUI on all interfaces; for production, protect it with a firewall allowlist and preferably a reverse proxy such as Nginx or Caddy with HTTPS. If the container manages Mihomo on the Docker host, do not set `MIHOMO_HOST` to `127.0.0.1`; inside a container that points to the container itself. Use `host.docker.internal` with the host-gateway mapping instead.

For first-run setup, you can start with only the persistent data directory mounted, then choose local or remote mode in the browser setup screen:

```bash
mkdir -p data

docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  --init \
  -p 0.0.0.0:5178:5178 \
  --add-host=host.docker.internal:host-gateway \
  -e LISTEN_HOST=0.0.0.0 \
  -e SERVER_CONFIG_FILE=/app/data/server.config.json \
  -v "$(pwd)/data:/app/data" \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  mihomo-manager-webui
```

If you already know you want remote key mode for the Docker host or another server, inject the environment and key explicitly:

```bash
mkdir -p data secrets
# Example: create a project-specific key for host management and authorize it on the managed server.
ssh-keygen -t ed25519 -N "" -f secrets/mihomo_manager_ed25519 -C mihomo-manager-webui
cat secrets/mihomo_manager_ed25519.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys secrets/mihomo_manager_ed25519

docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  --init \
  -p 0.0.0.0:5178:5178 \
  --add-host=host.docker.internal:host-gateway \
  -e LISTEN_HOST=0.0.0.0 \
  -e SERVER_CONFIG_FILE=/app/data/server.config.json \
  -e MIHOMO_MODE=remote \
  -e MIHOMO_AUTH=key \
  -e MIHOMO_HOST=host.docker.internal \
  -e MIHOMO_SSH_PORT=22 \
  -e MIHOMO_USER=root \
  -e MIHOMO_KEY_FILE=/run/secrets/mihomo_ssh_key \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/secrets/mihomo_manager_ed25519:/run/secrets/mihomo_ssh_key:ro" \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  mihomo-manager-webui
```

Open:

```text
http://SERVER_IP:5178
```

Stop and remove:

```bash
docker rm -f mihomo-manager-webui
```

#### Option 2: Docker Compose

Create the environment file:

```bash
cp .env.example .env
mkdir -p data secrets
```

To use the browser setup wizard, keep `MIHOMO_MODE`, `MIHOMO_AUTH`, `MIHOMO_HOST`, and related fields empty in `.env`, then start:

```bash
docker compose up -d --build
```

For remote key mode managing the Docker host, create a project-specific key and fill `.env`:

```bash
ssh-keygen -t ed25519 -N "" -f secrets/mihomo_manager_ed25519 -C mihomo-manager-webui
cat secrets/mihomo_manager_ed25519.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys secrets/mihomo_manager_ed25519
```

```env
MIHOMO_BIND=0.0.0.0
MIHOMO_MODE=remote
MIHOMO_AUTH=key
MIHOMO_HOST=host.docker.internal
MIHOMO_SSH_PORT=22
MIHOMO_USER=root
MIHOMO_KEY_PATH=/absolute/path/to/mihomo-manager-webui/secrets/mihomo_manager_ed25519
MIHOMO_PASSWORD=
```

Start remote key mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml up -d --build
```

Remote password mode does not need the key override; set `MIHOMO_AUTH=password` and `MIHOMO_PASSWORD`, then use the base Compose file. Local mode uses `MIHOMO_MODE=local`, but local mode inside Docker only manages the container runtime. To manage host services, prefer the remote SSH mode above.

Production checks:

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml ps
curl -fsS http://127.0.0.1:5178/api/config
curl -fsS "http://127.0.0.1:5178/api/run?command=status"
ss -ltnp | grep 5178
```

View logs and stop:

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.remote-key.yml down
```

Compose binds the WebUI to `0.0.0.0:5178` by default, persists config under `./data`, and expects private keys under `./secrets`. Do not commit `.env`, `data/`, or `secrets/` to Git.

### Visual Operations

The WebUI currently includes these pages:

- Dashboard: service, subscription, system proxy, and proxychains status
- Proxies: inspect Mihomo proxy groups, current policies, node latency, manual switching, and progressive delay tests
- Subscription: replace subscription URL and manage subscription name, description, User-Agent, auto update, system-proxy update, and core reload settings
- Rules: inspect currently loaded rules, rule type statistics, rule entries, and add rules by type, payload, and policy
- Service: start, stop, restart Mihomo, view listening ports and systemd status
- System: enable/disable system proxy, view and recreate proxychains config
- Logs: view Mihomo logs and subscription update logs
- Settings: switch output language and view connection details

### Optimization Plan

The P0-P3 optimization design, UI prototypes, technical plan, roadmap, and test checklist are available at:

```text
docs/optimization-plan.md
```

### Sensitive Data

Do not commit subscription URLs or tokens. The WebUI stores subscription settings in `/etc/mihomo/subscription.env` on the server and masks sensitive query parameters when displaying URLs.

The local `server.config.json` file is ignored by Git because it may contain personal server addresses and SSH key paths.
