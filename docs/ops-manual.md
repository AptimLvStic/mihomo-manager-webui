# Mihomo / New-API / CPAM / Nginx / Proxychains 协同运维手册

> 适用服务器：`39.105.62.199`  
> 域名入口：`https://api.aptim.top/`  
> 最后核验时间：`2026-07-09 Asia/Shanghai`  
> 说明：本文不记录订阅 token、SSH 私钥、数据库密码、CPAM 账号密钥等敏感信息。

## 1. 当前部署概览

本服务器承载一条面向 Codex / CPAM / OpenAI 兼容接口调用的代理链路。核心目标是：服务器位于中国大陆网络环境时，通过 Mihomo 订阅选择可用海外节点，再让 new-api、CPAM/CLIProxyAPI 或命令行工具按需走代理出口。

### 1.1 服务清单

| 模块 | 当前形态 | 服务/容器名 | 主要路径 | 作用 |
| --- | --- | --- | --- | --- |
| Nginx | systemd 服务 | `nginx` | `/etc/nginx/sites-available/api.aptim.top` | HTTPS 入口，反代 new-api |
| new-api | Docker 容器 | `new-api` | `/data/new-api` | OpenAI 兼容 API 管理与转发 |
| PostgreSQL | Docker 容器 | `postgres` | Docker volume `new-api_pg_data` | new-api 主数据库 |
| Redis | Docker 容器 | `redis` | Docker volume / container internal | new-api 缓存 |
| CPAM / CLIProxyAPI | Docker 容器 | `cli-proxy-api` | `/data/CLIProxyAPI` | Codex/CLI 账号代理服务 |
| Mihomo | systemd 服务 | `mihomo` | `/etc/mihomo/config.yaml` | 代理内核、订阅节点、策略组 |
| Mihomo Manager WebUI | Docker 容器 | `mihomo-manager-webui` | `/data/mihomo-manager-webui` | 可视化管理 Mihomo |
| Proxychains | 系统工具 | `proxychains4` | `/etc/proxychains4.conf` | 强制不支持代理的 CLI 走 SOCKS5 |

> 备注：服务器上未发现 `/data/cpam` 目录；当前 CPAM 相关服务在运行形态上对应 `/data/CLIProxyAPI` 与 `cli-proxy-api` 容器。如后续存在独立 CPAM 项目，应在本文基础上补充其路径和端口。

## 2. 访问链路与协作关系

### 2.1 对外业务入口

```text
用户 / 客户端
  -> https://api.aptim.top/
  -> Nginx 443 TLS
  -> http://127.0.0.1:3000
  -> new-api 容器
  -> CPAM / CLIProxyAPI 或上游模型服务
  -> Mihomo mixed / socks 入口
  -> 订阅节点出口
```

### 2.2 管理链路

```text
管理员浏览器
  -> http://39.105.62.199:5178
  -> mihomo-manager-webui 容器
  -> SSH 管理通道 host.docker.internal:22
  -> 宿主机 systemd / /etc/mihomo / proxychains 配置
```

### 2.3 命令行代理链路

```text
支持环境变量的程序
  -> HTTP_PROXY / HTTPS_PROXY = http://127.0.0.1:7890
  -> Mihomo mixed-port

支持 SOCKS 的程序
  -> ALL_PROXY = socks5h://127.0.0.1:7891
  -> Mihomo socks-port

不支持代理设置的程序
  -> proxychains4 <command>
  -> /etc/proxychains4.conf
  -> socks5 127.0.0.1 7891
```

## 3. 当前端口与暴露面

| 端口 | 监听 | 服务 | 说明 |
| --- | --- | --- | --- |
| `80` | `0.0.0.0` / `::` | Nginx | HTTP，自动跳转 HTTPS |
| `443` | `0.0.0.0` / `::` | Nginx | `https://api.aptim.top/` |
| `3000` | `0.0.0.0` / `::` | new-api | 当前公网暴露，同时被 Nginx 反代 |
| `5178` | `0.0.0.0` | mihomo-manager-webui | Mihomo 管理面板 |
| `7890` | `*` | Mihomo | mixed/http 入口 |
| `7891` | `*` | Mihomo | socks5 入口 |
| `9090` | `127.0.0.1` | Mihomo API | 内核控制接口，仅本机 |
| `8317/8085/1455/54545/51121/11451` | `0.0.0.0` / `::` | CLIProxyAPI | CPAM/CLIProxyAPI 业务端口 |

生产安全建议：

1. `3000` 建议改为只监听 `127.0.0.1:3000`，让外部只通过 Nginx HTTPS 访问。
2. `5178` 建议加安全组白名单、VPN、Nginx Basic Auth 或其他访问控制。
3. CLIProxyAPI 暴露的多个端口应按实际业务最小化开放。
4. Mihomo 的 `7890/7891` 当前监听所有地址，若不需要外部访问，建议改成仅本机或通过防火墙限制。

## 4. 关键配置位置

### 4.1 Nginx

- 主站点：`/etc/nginx/sites-available/api.aptim.top`
- 启用链接：`/etc/nginx/sites-enabled/api.aptim.top`
- WebSocket 连接升级：`/etc/nginx/conf.d/connection_upgrade.conf`
- 证书路径：`/etc/letsencrypt/live/api.aptim.top/fullchain.pem`
- 私钥路径：`/etc/letsencrypt/live/api.aptim.top/privkey.pem`

当前 Nginx 逻辑：

```text
api.aptim.top:80  -> 301 到 https://api.aptim.top/
api.aptim.top:443 -> proxy_pass http://127.0.0.1:3000
```

### 4.2 new-api

- 项目目录：`/data/new-api`
- Compose 文件：`/data/new-api/docker-compose.yml`
- 数据目录：`/data/new-api/data`
- 日志目录：`/data/new-api/logs`
- 数据库卷：`new-api_pg_data`
- 容器：`new-api`、`postgres`、`redis`

### 4.3 CLIProxyAPI / CPAM

- 项目目录：`/data/CLIProxyAPI`
- Compose 文件：`/data/CLIProxyAPI/docker-compose.yml`
- 配置文件：`/data/CLIProxyAPI/config.yaml`
- 账号/认证目录：`/data/CLIProxyAPI/auths`
- 日志目录：`/data/CLIProxyAPI/logs`
- 容器：`cli-proxy-api`

### 4.4 Mihomo

- systemd 服务：`/etc/systemd/system/mihomo.service`
- 主配置：`/etc/mihomo/config.yaml`
- 订阅环境：`/etc/mihomo/subscription.env`
- 原始订阅配置：`/etc/mihomo/subscription.raw.yaml`
- 自动选择脚本：`/usr/local/sbin/select-mihomo-working-proxy`
- 当前关键设置：

```yaml
mode: Rule
mixed-port: 7890
socks-port: 7891
allow-lan: true
bind-address: "0.0.0.0"
external-controller: 127.0.0.1:9090
```

### 4.5 Mihomo Manager WebUI

- 项目目录：`/data/mihomo-manager-webui`
- Compose 文件：`docker-compose.yml` + `docker-compose.ssh-key.yml`
- 环境变量：`/data/mihomo-manager-webui/.env`
- 容器名：`mihomo-manager-webui`
- Web 地址：`http://39.105.62.199:5178`

### 4.6 Proxychains

- 配置文件：`/etc/proxychains4.conf`
- 当前出口：

```text
[ProxyList]
socks5 127.0.0.1 7891
```

## 5. 标准启动与重启顺序

推荐顺序是先代理内核，再业务容器，最后入口网关。

### 5.1 启动或重启 Mihomo

```bash
systemctl restart mihomo
systemctl status mihomo --no-pager
journalctl -u mihomo -n 80 --no-pager
```

配置变更前建议先测试：

```bash
/usr/local/bin/mihomo -t -d /etc/mihomo -f /etc/mihomo/config.yaml
```

### 5.2 启动或重启 CLIProxyAPI / CPAM

```bash
cd /data/CLIProxyAPI
docker compose up -d
docker logs --tail 200 -f cli-proxy-api
```

### 5.3 启动或重启 new-api

```bash
cd /data/new-api
docker compose up -d
docker compose ps
docker logs --tail 200 -f new-api
```

### 5.4 启动或重启 Mihomo Manager WebUI

```bash
cd /data/mihomo-manager-webui
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d --build
docker logs --tail 100 mihomo-manager-webui
```

### 5.5 检查并重载 Nginx

```bash
nginx -t
systemctl reload nginx
systemctl status nginx --no-pager
```

## 6. 日常健康检查

### 6.1 一键总览

```bash
docker ps
systemctl is-active nginx mihomo
ss -tulpn | grep -E ':(80|443|3000|5178|7890|7891|9090)'
```

### 6.2 检查 HTTPS 入口

```bash
curl -I https://api.aptim.top/
curl -I http://api.aptim.top/
```

预期：

- `https://api.aptim.top/` 返回 `200 OK`
- `http://api.aptim.top/` 返回 `301 Moved Permanently`

### 6.3 检查 new-api

```bash
curl -fsS http://127.0.0.1:3000/api/status | head -c 500; echo
docker logs --tail 100 new-api
```

### 6.4 检查 Mihomo Manager

```bash
curl -fsS http://127.0.0.1:5178/api/config | python3 -m json.tool
curl -fsS http://127.0.0.1:5178/api/proxies | head -c 500; echo
```

### 6.5 检查 Mihomo 出口

```bash
curl -x http://127.0.0.1:7890 -I https://chatgpt.com
curl --socks5-hostname 127.0.0.1:7891 -I https://chatgpt.com
proxychains4 curl -I https://chatgpt.com
```

### 6.6 检查证书与续期

```bash
certbot certificates
systemctl list-timers certbot.timer --no-pager
```

续期演练建议在低峰执行：

```bash
certbot renew --dry-run
```

## 7. 常用运维动作

### 7.1 更新 Mihomo 订阅

优先使用 WebUI：

1. 打开 `http://39.105.62.199:5178`
2. 进入“订阅”页面
3. 更新订阅链接或 User-Agent
4. 点击保存并更新
5. 进入“代理”页面测试节点延迟
6. 选择合适节点

命令行检查定时器：

```bash
systemctl status mihomo-subscription.timer --no-pager
systemctl list-timers mihomo-subscription.timer --no-pager
journalctl -u mihomo-subscription.service -n 100 --no-pager
```

### 7.2 切换 Mihomo 节点

优先使用 WebUI 的“代理”页面：

- 点击策略组卡片切换策略组。
- 点击节点延迟数字进行单节点测速。
- 点击节点卡片切换当前节点。
- 批量测速时，节点应逐个返回延迟，不需要等待全部完成。

API 级排查：

```bash
curl -fsS http://127.0.0.1:9090/proxies | head -c 1000; echo
```

### 7.3 更新 new-api

```bash
cd /data/new-api
docker compose pull new-api
docker compose up -d new-api
docker logs --tail 200 -f new-api
curl -I https://api.aptim.top/
```

### 7.4 更新 CLIProxyAPI / CPAM

```bash
cd /data/CLIProxyAPI
docker compose pull
docker compose up -d
docker logs --tail 200 -f cli-proxy-api
```

### 7.5 更新 Mihomo Manager WebUI

```bash
cd /data/mihomo-manager-webui
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d --build
curl -fsS http://127.0.0.1:5178/api/config | python3 -m json.tool
```

### 7.6 修改 Nginx 反代配置

```bash
cp /etc/nginx/sites-available/api.aptim.top /etc/nginx/sites-available/api.aptim.top.backup.$(date +%Y%m%d%H%M%S)
vim /etc/nginx/sites-available/api.aptim.top
nginx -t
systemctl reload nginx
curl -I https://api.aptim.top/
```

## 8. 备份与恢复

### 8.1 建议备份内容

| 内容 | 路径/对象 | 重要性 |
| --- | --- | --- |
| new-api 数据 | `/data/new-api/data` | 高 |
| new-api 日志 | `/data/new-api/logs` | 中 |
| PostgreSQL 数据卷 | `new-api_pg_data` | 高 |
| CLIProxyAPI 配置 | `/data/CLIProxyAPI/config.yaml` | 高 |
| CLIProxyAPI 认证 | `/data/CLIProxyAPI/auths` | 高，敏感 |
| Mihomo 配置 | `/etc/mihomo` | 高，含订阅信息 |
| Proxychains 配置 | `/etc/proxychains4.conf` | 中 |
| Nginx 站点配置 | `/etc/nginx/sites-available/api.aptim.top` | 中 |
| 证书 | `/etc/letsencrypt` | 中，可重新签发 |
| Mihomo Manager 配置 | `/data/mihomo-manager-webui/.env`、`secrets/` | 高，敏感 |

### 8.2 文件备份示例

```bash
BACKUP_DIR=/root/backups/mihomo-stack-$(date +%F-%H%M%S)
mkdir -p "$BACKUP_DIR"

tar -czf "$BACKUP_DIR/new-api-files.tgz" -C /data new-api/data new-api/logs

tar -czf "$BACKUP_DIR/cliproxyapi-files.tgz" -C /data CLIProxyAPI/config.yaml CLIProxyAPI/auths CLIProxyAPI/logs

tar -czf "$BACKUP_DIR/system-proxy-config.tgz" \
  /etc/mihomo \
  /etc/proxychains4.conf \
  /etc/profile.d/mihomo-proxy.sh \
  /etc/apt/apt.conf.d/95mihomo-proxy \
  /etc/nginx/sites-available/api.aptim.top \
  /etc/nginx/conf.d/connection_upgrade.conf

tar -czf "$BACKUP_DIR/mihomo-manager.tgz" -C /data mihomo-manager-webui/.env mihomo-manager-webui/secrets mihomo-manager-webui/data
```

### 8.3 PostgreSQL Docker 卷备份

```bash
BACKUP_DIR=/root/backups/mihomo-stack-$(date +%F-%H%M%S)
mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v new-api_pg_data:/volume:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c 'cd /volume && tar -czf /backup/new-api-pg-volume.tgz .'
```

### 8.4 恢复原则

1. 先恢复数据库和配置文件。
2. 再启动 Mihomo，确认代理出口可用。
3. 再启动 CLIProxyAPI / CPAM。
4. 再启动 new-api。
5. 最后检查 Nginx HTTPS 入口。

恢复后执行：

```bash
systemctl restart mihomo nginx
cd /data/CLIProxyAPI && docker compose up -d
cd /data/new-api && docker compose up -d
cd /data/mihomo-manager-webui && docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d
curl -I https://api.aptim.top/
```

## 9. 故障排查手册

### 9.1 `https://api.aptim.top/` 打不开

检查顺序：

```bash
getent ahosts api.aptim.top
ss -tulpn | grep -E ':(80|443)'
systemctl status nginx --no-pager
nginx -t
tail -100 /var/log/nginx/error.log
curl -I http://127.0.0.1:3000/
```

常见原因：

- DNS 未解析到 `39.105.62.199`。
- 服务器安全组未放行 `80/443`。
- Nginx 配置错误或未 reload。
- new-api 容器异常。

### 9.2 HTTPS 正常但 API 调用失败

```bash
docker logs --tail 200 new-api
curl -fsS http://127.0.0.1:3000/api/status | head -c 1000; echo
cd /data/new-api && docker compose ps
```

继续检查数据库和 Redis：

```bash
docker logs --tail 100 postgres
docker logs --tail 100 redis
```

### 9.3 CPAM / Codex 账号代理异常

```bash
cd /data/CLIProxyAPI
docker compose ps
docker logs --tail 200 -f cli-proxy-api
ls -la auths
```

同时检查 Mihomo 是否确实代理到可用节点：

```bash
journalctl -u mihomo -n 100 --no-pager
curl -x http://127.0.0.1:7890 -I https://chatgpt.com
proxychains4 curl -I https://chatgpt.com
```

### 9.4 Mihomo 节点不可用或延迟很高

优先在 WebUI 中进行：

1. 打开代理页。
2. 点击延迟数字测试单个节点。
3. 批量测试时观察逐条返回结果。
4. 切换到低延迟节点。
5. 如果所有节点失败，更新订阅。

命令行排查：

```bash
systemctl status mihomo --no-pager
journalctl -u mihomo -n 200 --no-pager
curl -fsS http://127.0.0.1:9090/proxies | head -c 2000; echo
```

### 9.5 Proxychains 不生效

```bash
command -v proxychains4
tail -30 /etc/proxychains4.conf
proxychains4 curl -I https://chatgpt.com
```

预期配置：

```text
strict_chain
proxy_dns
[ProxyList]
socks5 127.0.0.1 7891
```

### 9.6 Mihomo Manager 无法管理宿主机

```bash
cd /data/mihomo-manager-webui
docker logs --tail 200 mihomo-manager-webui
cat .env | sed -E 's/(PASSWORD|KEY|TOKEN)=.*/\1=***REDACTED***/g'
ls -l secrets/
curl -fsS http://127.0.0.1:5178/api/config | python3 -m json.tool
```

重点检查：

- `.env` 中 `MIHOMO_HOST=host.docker.internal`
- `MIHOMO_AUTH=key`
- `MIHOMO_KEY_PATH` 指向存在的项目专用私钥
- 宿主机 `authorized_keys` 是否包含对应公钥

## 10. 安全整改建议

### 10.1 收敛 new-api 直连端口

当前 `new-api` 的 `3000` 端口公网暴露。建议在维护窗口内把 `/data/new-api/docker-compose.yml` 中端口改为：

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

然后执行：

```bash
cd /data/new-api
docker compose up -d
curl -I https://api.aptim.top/
```

### 10.2 收敛 Mihomo Manager 访问面

当前 `5178` 暴露公网。建议三选一：

1. 云安全组只允许你的办公 IP 访问。
2. 通过 Nginx 加 Basic Auth 后再暴露。
3. 仅通过 SSH 隧道访问。

SSH 隧道示例：

```bash
ssh -i ~/.ssh/your_private_key -L 5178:127.0.0.1:5178 root@39.105.62.199
```

然后浏览器访问：`http://127.0.0.1:5178`

### 10.3 保护敏感文件

建议权限：

```bash
chmod 600 /data/mihomo-manager-webui/secrets/*
chmod 600 /data/mihomo-manager-webui/.env
chmod 600 /data/CLIProxyAPI/config.yaml
chmod -R go-rwx /data/CLIProxyAPI/auths
```

不要把以下内容提交到 GitHub：

- 订阅链接 token
- SSH 私钥
- new-api 数据库密码
- Redis 密码
- CPAM / CLIProxyAPI 账号认证文件
- `.env` 中的真实密钥

## 11. 变更发布 SOP

### 11.1 变更前

```bash
docker ps
systemctl is-active nginx mihomo
curl -I https://api.aptim.top/
certbot certificates
```

创建备份：

```bash
BACKUP_DIR=/root/backups/pre-change-$(date +%F-%H%M%S)
mkdir -p "$BACKUP_DIR"
cp -a /etc/nginx/sites-available/api.aptim.top "$BACKUP_DIR/"
cp -a /etc/mihomo "$BACKUP_DIR/"
cp -a /data/CLIProxyAPI/config.yaml "$BACKUP_DIR/cliproxy-config.yaml"
cp -a /data/new-api/docker-compose.yml "$BACKUP_DIR/new-api-compose.yml"
```

### 11.2 变更中

- 每次只改一个模块。
- 改 Nginx 必跑 `nginx -t`。
- 改 Mihomo 必先测试配置。
- 改容器前先确认 Compose 文件和当前容器状态。

### 11.3 变更后

```bash
curl -I https://api.aptim.top/
curl -fsS http://127.0.0.1:3000/api/status | head -c 300; echo
curl -x http://127.0.0.1:7890 -I https://chatgpt.com
proxychains4 curl -I https://chatgpt.com
docker ps
```

## 12. 快速命令清单

```bash
# 服务状态
docker ps
systemctl status nginx --no-pager
systemctl status mihomo --no-pager

# 入口检查
curl -I https://api.aptim.top/
curl -I http://api.aptim.top/

# 日志
tail -f /var/log/nginx/access.log /var/log/nginx/error.log
docker logs --tail 200 -f new-api
docker logs --tail 200 -f cli-proxy-api
journalctl -u mihomo -f

# 代理测试
curl -x http://127.0.0.1:7890 -I https://chatgpt.com
curl --socks5-hostname 127.0.0.1:7891 -I https://chatgpt.com
proxychains4 curl -I https://chatgpt.com

# 证书
certbot certificates
certbot renew --dry-run

# Nginx
nginx -t
systemctl reload nginx

# Mihomo Manager
cd /data/mihomo-manager-webui
docker compose -f docker-compose.yml -f docker-compose.ssh-key.yml up -d --build
```
