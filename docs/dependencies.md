# Dependencies

## Host Runtime

The WebUI manages the local Linux host. The host should provide:

| Dependency | Purpose | Typical package |
| --- | --- | --- |
| Linux + systemd | Control `mihomo.service` and timer units | built-in on most server distributions |
| Docker Engine | Run the WebUI container | `docker-ce` or distribution package |
| Docker Compose v2 | Deploy the service | `docker compose` plugin |
| Mihomo core | Proxy runtime | `/usr/local/bin/mihomo` or `mihomo` in `PATH` |
| Python 3 | YAML merge and helper scripts | `python3` |
| PyYAML | Safe YAML parsing for subscription merge | `python3-yaml` |
| curl | Subscription download and connectivity checks | `curl` |
| iproute2 | Read listening ports through `ss` | `iproute2` |
| proxychains4 | Optional CLI proxy wrapper | `proxychains4` |

## Container Runtime

The image is based on `node:22-bookworm-slim` and installs:

- `ca-certificates`
- `util-linux`, for `nsenter`

`nsenter` is used only when `MIHOMO_LOCAL_RUNNER=nsenter`, typically for Docker managing the host namespace. Direct host Node.js deployment should use `MIHOMO_LOCAL_RUNNER=direct`.

## Mihomo Assumptions

Default host paths:

```text
/etc/mihomo/config.yaml
/etc/mihomo/subscription.env
/etc/mihomo/subscription.raw.yaml
/usr/local/bin/mihomo
/usr/local/sbin/update-mihomo-subscription
```

Mihomo controller is expected at:

```text
127.0.0.1:9090
```

The WebUI reads and writes the Mihomo YAML config, validates with `mihomo -t`, then restarts or reloads Mihomo depending on the selected update mode.
