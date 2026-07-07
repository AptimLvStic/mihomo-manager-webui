# mihomo.sh

`mihomo.sh` is a small Bash management script for a Mihomo-based proxy setup.
It provides grouped menus and command-line shortcuts for subscription updates,
Mihomo service control, proxychains configuration, system proxy environment
settings, logs, connectivity tests, and Chinese/English language switching.

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
