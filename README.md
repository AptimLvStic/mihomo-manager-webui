# Mihomo Manager WebUI

Mihomo Manager WebUI is a local-first web console for managing a Linux host running the Mihomo core. It focuses on subscription management, proxy group selection, node delay testing, rule insertion, service control, proxy entry configuration, and common system proxy/proxychains operations.

The project no longer uses an SSH management bridge. The Docker deployment manages the local Docker host through `nsenter`, so it is intended to be deployed on the same Linux host that runs Mihomo.

## Features

- Web login with first-user registration.
- Local host management only; no SSH key or SSH password mode.
- Subscription settings and update workflow.
- Subscription updates preserve local Mihomo configuration changes.
- Proxy group and node view with streaming delay test results.
- Mihomo inbound configuration: HTTP, SOCKS5, Mixed, Redir, TProxy and TUN.
- Rule insertion with policy selection.
- systemd service control for `mihomo.service` and subscription timer inspection.
- System proxy and optional proxychains configuration helpers.

## Requirements

See [docs/dependencies.md](docs/dependencies.md) for the full dependency list.

Minimum host requirements:

- Linux with systemd.
- Docker Engine and Docker Compose v2.
- Mihomo installed on the host, usually `/usr/local/bin/mihomo`.
- Mihomo config at `/etc/mihomo/config.yaml`.
- Python 3 and PyYAML on the host, usually package `python3-yaml`.
- `curl`, `iproute2`/`ss`, and standard GNU utilities.
- Optional: `proxychains4` if you want WebUI-managed proxychains configuration.

## Docker Compose Deployment

Clone the repository on the same host that runs Mihomo:

```bash
git clone https://github.com/AptimLvStic/mihomo-manager-webui.git /opt/mihomo-manager-webui
cd /opt/mihomo-manager-webui
cp .env.example .env
```

Edit `.env`:

```env
MIHOMO_MANAGER_BIND=127.0.0.1
MIHOMO_MANAGER_HOST_PROJECT_DIR=/opt/mihomo-manager-webui
AUTH_ALLOW_REGISTRATION=false
SESSION_TTL_HOURS=24
COOKIE_SECURE=false
```

Start the service:

```bash
docker compose up -d --build
docker compose ps
```

Open the WebUI:

```text
http://127.0.0.1:5178
```

The first user can register from the login page. After one user exists, public registration is disabled unless `AUTH_ALLOW_REGISTRATION=true` is set.

## Binding and Reverse Proxy

For production, prefer binding the WebUI to localhost and exposing it through a TLS reverse proxy:

```env
MIHOMO_MANAGER_BIND=127.0.0.1
COOKIE_SECURE=true
```

Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:5178;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

If you bind to `0.0.0.0`, restrict access with firewall rules or a private network. This application has host-management privileges and should not be exposed as an unauthenticated public service.

## Important Paths

Host paths managed by the WebUI:

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

Application data path:

```text
./data/auth.json
```

`auth.json` stores usernames and password hashes. Do not commit `data/`.

## Security Notes

Read [docs/security.md](docs/security.md) before exposing the WebUI beyond localhost. The short version:

- The container needs elevated host-management privileges when deployed with Docker.
- Treat WebUI admin access as equivalent to root on the host.
- Use TLS, firewall restrictions, and strong passwords.
- Keep subscription URLs, cookies, generated data, and Mihomo configs out of Git.

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

Common checks:

```bash
docker compose ps
docker logs --tail=100 mihomo-manager-webui
curl -fsS http://127.0.0.1:5178/api/auth/status | jq
systemctl status mihomo --no-pager
journalctl -u mihomo -n 100 --no-pager
```

## Development Checks

```bash
node --check server.js
node --check public/app.js
bash -n scripts/update-mihomo-subscription
docker compose config --quiet
```

---

## English Quick Start

This project is a local Mihomo management WebUI for Linux hosts. It does not use SSH. Deploy it on the same host that runs Mihomo, start with `docker compose up -d --build`, register the first admin user in the browser, then manage subscriptions, proxy groups, node delay tests, rules, service state, and Mihomo inbound ports from the UI.

Read `docs/dependencies.md`, `docs/security.md`, and `docs/troubleshooting.md` before production use.
