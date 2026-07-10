# Troubleshooting

## WebUI Container Is Not Healthy

```bash
docker compose ps
docker logs --tail=100 mihomo-manager-webui
docker compose config --quiet
```

Check that port `5178` is not already used:

```bash
ss -ltnp | grep ':5178'
```

## Login Does Not Work

Check that `WEBUI_USERNAME`, `WEBUI_PASSWORD`, and `WEBUI_SESSION_SECRET` are set in the service environment. Then check auth status:

```bash
curl -i http://127.0.0.1:5178/api/auth/status
```

If optional registered users are enabled, check the auth data file:

```bash
ls -l data/auth.json
```

If you need to reset optional registered users, stop the container and move the file away:

```bash
docker compose down
mv data/auth.json data/auth.json.backup.$(date +%Y%m%d%H%M%S)
docker compose up -d
```

Then restart and log in with the environment-provided administrator account.

## Local Management Permission Errors

Typical symptoms include `nsenter`, `Operation not permitted`, or systemd access errors.

Verify Compose uses local-management permissions:

```bash
docker compose config | grep -E 'pid: host|privileged: true'
```

Restart with the project Compose file:

```bash
docker compose up -d --build
```

## Mihomo Controller Unavailable

The WebUI expects the controller at `127.0.0.1:9090` from the host namespace.

```bash
systemctl status mihomo --no-pager
ss -ltnp | grep ':9090'
curl -fsS http://127.0.0.1:9090/proxies | head
```

In `/etc/mihomo/config.yaml`, verify:

```yaml
external-controller: 127.0.0.1:9090
```

## Subscription Update Fails

Run the updater manually on the host:

```bash
/usr/local/sbin/update-mihomo-subscription
```

Check dependencies:

```bash
python3 - <<'PY'
import yaml
print('PyYAML OK')
PY
curl --version
mihomo -t -d /etc/mihomo -f /etc/mihomo/config.yaml
```

Check logs:

```bash
journalctl -u mihomo-subscription.service -n 100 --no-pager
journalctl -u mihomo -n 100 --no-pager
```

## Binding Address or LAN Access Reverts

Subscription updates should preserve local non-subscription config. Verify the unified updater exists:

```bash
ls -l /usr/local/sbin/update-mihomo-subscription
```

Confirm key config values:

```bash
grep -nE '^(mode|allow-lan|bind-address|mixed-port|socks-port|external-controller):' /etc/mihomo/config.yaml
```

## Delay Tests Do Not Return Results

Check that Mihomo itself can test nodes through the controller:

```bash
curl -fsS 'http://127.0.0.1:9090/proxies'
```

If the WebUI shows every node as timeout, verify the host can reach the delay-test URL and that the selected subscription nodes are valid.
