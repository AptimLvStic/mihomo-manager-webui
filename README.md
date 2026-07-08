# Mihomo Manager WebUI

简体中文 | [English](#english)

`mihomo-manager-webui` 是一个面向单台 Linux 服务器的 Mihomo 管理面板，用于订阅、节点测速、策略组切换、规则和系统代理配置。部署后会直接管理当前配置好的目标服务器。

## 核心场景

你的服务器 IP 位于中国大陆时，可以通过 Mihomo 订阅选择美国等可用节点，再配合系统代理或 proxychains 让 CPAM、Codex CLI、脚本任务等命令行程序走代理链路。

主要流程：

1. 添加或更新订阅链接。
2. 在代理页选择 `Proxies` 策略组。
3. 点击延迟数字进行节点测速，或批量测试延迟。
4. 点击节点卡片切换当前策略组节点。
5. 开启系统代理或配置 proxychains，让命令行程序通过 Mihomo 出口访问网络。

## 功能

- 订阅管理：订阅名称、描述、User-Agent、自动更新、系统代理更新、内核更新。
- 代理管理：策略组展示、节点卡片选择、延迟数字测速、批量流式并发测速。
- 选择记忆：记住上次打开的代理组和每个代理组选择过的节点。
- Mihomo 设置：Rule / Global / Direct 模式，HTTP、SOCKS5、Mixed、Redir、TProxy 端口和 TUN 设置。
- 规则管理：查看规则、添加规则类型、规则内容和代理策略。
- 服务管理：启动、停止、重启 Mihomo，查看 systemd 状态和监听端口。
- 系统代理：写入 shell / APT 代理环境，保留 proxychains 配置能力。
- Docker 部署：支持 Docker 和 Docker Compose。

## 部署方式

### Docker Compose

推荐使用 Compose 部署：

```bash
cd /data/mihomo-manager-webui
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d --build
```

查看状态：

```bash
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml ps
docker logs -f mihomo-manager-webui
```

默认 WebUI 地址：

```text
http://服务器IP:5178
```

当前生产部署使用环境变量注入目标服务器连接信息，Web 页面启动后直接进入管理面板。

### Docker

也可以使用纯 Docker 运行，按实际路径替换密钥和数据目录：

```bash
docker build -t mihomo-manager-webui .
docker run -d \
  --name mihomo-manager-webui \
  --restart unless-stopped \
  -p 0.0.0.0:5178:5178 \
  -e LISTEN_HOST=0.0.0.0 \
  -e MIHOMO_BIND=0.0.0.0 \
  -e MIHOMO_HOST=host.docker.internal \
  -e MIHOMO_SSH_PORT=22 \
  -e MIHOMO_USER=root \
  -e MIHOMO_AUTH=key \
  -e MIHOMO_KEY=/run/secrets/mihomo_ssh_key \
  -v /data/mihomo-manager-webui/data:/data \
  -v /data/mihomo-manager-webui/secrets/mihomo_manager_ed25519:/run/secrets/mihomo_ssh_key:ro \
  --add-host=host.docker.internal:host-gateway \
  mihomo-manager-webui
```

## 常用路径

WebUI 会管理目标服务器上的这些路径：

```text
/etc/mihomo/config.yaml
/etc/mihomo/subscription.env
/etc/mihomo/subscription.raw.yaml
/etc/systemd/system/mihomo.service
/etc/systemd/system/mihomo-subscription.timer
/etc/profile.d/mihomo-proxy.sh
/etc/apt/apt.conf.d/95mihomo-proxy
/etc/proxychains4.conf
```

## CPAM / Codex 代理建议

推荐优先使用 Mihomo 的 Mixed 或 SOCKS5 入口：

```bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
export ALL_PROXY=socks5h://127.0.0.1:7891
```

对于不读取代理环境变量的命令行程序，可以使用 proxychains：

```bash
proxychains4 codex --help
```

## 安全说明

- 不要把订阅 token、SSH 私钥、密码提交到 Git 仓库。
- WebUI 当前监听 `0.0.0.0:5178`，生产环境建议加安全组白名单、反向代理认证或 VPN 访问控制。
- Mihomo 控制接口建议保持 `127.0.0.1:9090`，不要直接暴露到公网。

---

## English

`mihomo-manager-webui` is a Web UI for managing Mihomo on a single Linux server. It manages subscriptions, proxy groups, node delay tests, rule editing, service control, and system proxy settings.

After deployment, the WebUI directly manages the configured target server.

## Main Workflow

1. Add or update a subscription URL.
2. Open the `Proxies` group.
3. Click delay numbers to test nodes, or run batch delay tests.
4. Click a node card to switch the selected proxy.
5. Enable system proxy or proxychains for CLI tools such as CPAM and Codex.

## Features

- Subscription settings: name, description, User-Agent, auto update, system proxy update, kernel reload.
- Proxy management: proxy groups, card-based node switching, delay-number testing, progressive concurrent batch tests.
- Remembered selections: keeps the last opened group and selected nodes per group.
- Mihomo settings: Rule / Global / Direct mode, inbound ports, bind address, TUN settings.
- Rule management: view and add rules.
- Service management: start, stop, restart, status, listening ports.
- System proxy and proxychains support.
- Docker and Docker Compose deployment.

## Docker Compose

```bash
cd /data/mihomo-manager-webui
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d --build
```

Open:

```text
http://SERVER_IP:5178
```

## Security Notes

- Never commit subscription tokens, SSH keys, or passwords.
- If the WebUI listens on `0.0.0.0:5178`, protect it with firewall rules, reverse-proxy authentication, or VPN access.
- Keep the Mihomo controller on `127.0.0.1:9090`.
