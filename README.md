# mihomo-manager-webui

`mihomo-manager-webui` is a local Web UI and Bash management toolkit for a
Mihomo-based proxy setup. The browser dashboard calls `mihomo.sh` over SSH, so
routine operations can be done visually without exposing a management panel to
the public internet.

Repository:

```text
https://github.com/AptimLvStic/mihomo-manager-webui
```

## Features

- Grouped interactive menu
- Chinese and English UI
- Subscription URL and User-Agent management
- Manual subscription refresh
- Automatic working-node selection through Mihomo controller
- Mihomo systemd service helpers
- System proxy helpers for new shells and apt
- proxychains4 configuration helper
- SOCKS5 and proxychains connectivity tests
- Log viewers for Mihomo and subscription updates
- Local web dashboard for visual operations

## Requirements

- Linux server with systemd
- Bash
- curl
- Mihomo installed at `/usr/local/bin/mihomo`
- proxychains4
- Existing helper scripts:
  - `/usr/local/sbin/update-mihomo-subscription`
  - `/usr/local/sbin/select-mihomo-working-proxy`

## Script Install

```bash
install -m 700 mihomo.sh /usr/local/sbin/mihomo.sh
```

Run as root:

```bash
mihomo.sh menu
```

## Local Web UI Deployment

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

The web server only listens on `127.0.0.1` by default. It exposes whitelisted
API actions and uses SSH to run `/usr/local/sbin/mihomo.sh` on the server.

You can also configure it with environment variables:

```bash
MIHOMO_HOST=1.2.3.4 MIHOMO_USER=root MIHOMO_KEY=/path/to/key npm start
```

## Docker Deployment

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

The container listens on `0.0.0.0` internally, but the example publishes it only
to `127.0.0.1` on the host. The entrypoint copies the mounted private key to a
temporary file with `600` permissions before starting Node, which avoids common
OpenSSH permission errors.

Stop and remove:

```bash
docker rm -f mihomo-manager-webui
```

## Docker Compose Deployment

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

The Compose file also binds the UI to `127.0.0.1:5178` and mounts the SSH key as
a Docker secret. Keep `.env` private because it contains your server address and
local key path.

## Common Commands

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

## Sensitive Data

Do not commit subscription URLs or tokens. This script stores subscription
settings in `/etc/mihomo/subscription.env` on the server and masks sensitive
query parameters when displaying URLs.

The local `server.config.json` file is ignored by Git because it may contain
personal server addresses and key paths.
