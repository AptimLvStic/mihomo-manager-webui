# mihomo.sh

`mihomo.sh` is a small Bash management script for a Mihomo-based proxy setup.
It also includes a local browser UI that calls the script over SSH, so routine
operations can be done visually without exposing a management panel to the
public internet.

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

## Install

```bash
install -m 700 mihomo.sh /usr/local/sbin/mihomo.sh
```

Run as root:

```bash
mihomo.sh menu
```

## Local Web UI

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
