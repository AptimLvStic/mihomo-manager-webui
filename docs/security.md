# Security Model and Minimum-Privilege Guidance

## Threat Model

Mihomo Manager WebUI is a host administration tool. A user who can log in can perform actions that affect the Linux host, including:

- Restarting `mihomo.service`.
- Writing `/etc/mihomo/config.yaml`.
- Writing subscription settings under `/etc/mihomo`.
- Enabling or disabling system proxy files under `/etc/profile.d` and `/etc/apt/apt.conf.d`.
- Updating proxychains configuration.

Treat WebUI administrator access as host-root equivalent.

## Authentication

- The first account can register from the login page.
- After the first account exists, registration is closed by default.
- Set `AUTH_ALLOW_REGISTRATION=true` only when you intentionally allow additional self-registration.
- Passwords are stored as `scrypt` hashes in `data/auth.json`.
- Sessions are stored in memory and expire according to `SESSION_TTL_HOURS`.

## Sensitive Data

Do not commit or expose:

- `data/auth.json`
- `.env`
- `/etc/mihomo/subscription.env`
- subscription URLs or tokens
- Mihomo configs containing private nodes
- reverse proxy certificates or private keys

The repository `.gitignore` excludes local data and environment files. Verify `git status` before every commit.

## Minimum-Privilege Deployment

Full Docker-based local management requires elevated permissions because the container must enter the host namespace and control system services. Reduce risk by minimizing network exposure:

1. Bind to localhost by default:

```env
MIHOMO_MANAGER_BIND=127.0.0.1
```

2. Put the WebUI behind a TLS reverse proxy and set:

```env
COOKIE_SECURE=true
```

3. Restrict access with firewall rules, VPN, or private network policies.

4. Use strong passwords and close registration after initial setup:

```env
AUTH_ALLOW_REGISTRATION=false
```

5. Keep the project directory writable only by administrators.

## Why Docker Needs Elevated Permissions

The WebUI modifies host files and controls host systemd units. Without SSH, the container uses `nsenter --target 1` to run scripts in the host namespaces. This requires elevated container privileges. If your environment cannot accept that risk, run the Node process directly on the host under a carefully controlled service account with only the required file and systemd permissions.
