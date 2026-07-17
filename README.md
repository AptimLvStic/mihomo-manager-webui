# Mihomo Manager WebUI

Mihomo Manager WebUI is a web console for managing Mihomo on Linux. It covers the main operational flow: add a subscription, test and select nodes, configure Mihomo proxy modes and ports, then operate the service from a browser.

## Scope

Core features:

- Web login with `HttpOnly` cookie sessions.
- Local management only: no SSH key or SSH password is required.
- Subscription management and subscription updates that preserve local non-subscription config.
- Proxy group view, node cards, single-node delay tests, and current-group delay tests.
- Mihomo config for Rule / Global / Direct, Mixed / HTTP / SOCKS, bind address, LAN access, and advanced TUN/Redir/TProxy settings.
- Operations page for start/stop/restart, logs, timers, ports, and advanced rule insertion.

## Requirements

See [docs/dependencies.md](docs/dependencies.md).

Minimum host requirements:

- Linux with systemd.
- Node.js 20+ for direct host deployment, or Docker Engine + Docker Compose v2 for container deployment.
- Mihomo installed on the managed host.
- Python 3 + PyYAML on the managed host.
- `curl`, `ss` from iproute2, and standard shell utilities.

## Recommended Deployment: Host Node.js

This is the cleanest deployment because the WebUI executes management scripts directly on the same host.

```bash
git clone https://github.com/AptimLvStic/mihomo-manager-webui.git /opt/mihomo-manager-webui
cd /opt/mihomo-manager-webui
cp .env.example .env
```

Edit `.env` and set strong values:

```env
MIHOMO_MANAGER_BIND=127.0.0.1
WEBUI_USERNAME=admin
WEBUI_PASSWORD=replace-with-a-strong-password
WEBUI_SESSION_SECRET=replace-with-a-long-random-secret
WEBUI_COOKIE_SECURE=false
MIHOMO_LOCAL_RUNNER=direct
```

Start:

```bash
set -a
. ./.env
set +a
npm start
```

Smoke test:

```bash
curl http://127.0.0.1:5178/api/health
curl -i http://127.0.0.1:5178/api/config
npm run check
npm test
```

Expected unauthenticated config response:

```text
HTTP/1.1 401 Unauthorized
```

## Docker Compose Deployment

Docker is supported, but managing the Docker host from inside a container requires elevated permissions. The provided Compose file uses local mode with `MIHOMO_LOCAL_RUNNER=nsenter` for this reason.

```bash
cp .env.example .env
# edit .env first
docker compose up -d --build
docker compose ps
```

Required login variables:

```env
WEBUI_USERNAME=admin
WEBUI_PASSWORD=replace-with-a-strong-password
WEBUI_SESSION_SECRET=replace-with-a-long-random-secret
```

Healthcheck uses the public endpoint:

```bash
curl http://127.0.0.1:5178/api/health
```

## Local Management

This project manages Mihomo only on the same host. Remote hosts, SSH keys, and SSH passwords are not supported.

## Public Exposure Requirements

`0.0.0.0:5178` can be used, but do not leave this WebUI exposed on plain public HTTP for long-term production use.

Recommended controls:

- Use a strong `WEBUI_PASSWORD`.
- Keep `WEBUI_SESSION_SECRET` fixed and private.
- Restrict source IPs with firewall or cloud security groups.
- Prefer HTTPS reverse proxy and set `WEBUI_COOKIE_SECURE=true`.
- Keep Mihomo controller bound to `127.0.0.1:9090`.

## Important Paths

Managed host paths:

```text
/etc/mihomo/config.yaml
/etc/mihomo/subscription.env
/etc/mihomo/subscription.raw.yaml
/etc/systemd/system/mihomo.service
/etc/systemd/system/mihomo-subscription.timer
/etc/profile.d/mihomo-proxy.sh
/etc/apt/apt.conf.d/95mihomo-proxy
/etc/proxychains4.conf
/usr/local/sbin/update-mihomo-subscription
```

Application data:

```text
./data/auth.json
```

Do not commit `.env`, `data/`, subscription URLs, node credentials, cookies, SSH keys, or Mihomo configs containing private nodes.

## Verification Checklist

```bash
curl http://127.0.0.1:5178/api/health
curl -i http://127.0.0.1:5178/api/config
node --check server.js
node --check public/app.js
bash -n scripts/update-mihomo-subscription
docker compose config --quiet
```

After login:

```bash
npm test
```

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).
