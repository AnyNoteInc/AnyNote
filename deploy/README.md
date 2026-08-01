# Deployment

Production runs on a single host behind Traefik (file provider, TLS via Let's
Encrypt). The stack is defined in [`compose.yml`](compose.yml); Traefik routing
lives in [`traefik/`](traefik/). Deploys are driven by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which renders
`.env.template` with `envsubst`, syncs `deploy/traefik/`, and runs the versioned
`/opt/anynote/deploy-stack.sh` helper over SSH. That helper reads the registry
token from standard input, logs out as cleanup, propagates login, pull, up, and
logout failures, and treats only image pruning after a successful bring-up as
best-effort. It delegates Compose operations to `/opt/anynote/compose.sh`, which
always changes to the managed project directory and removes an ambient
`TELEGRAM_PROXY_URL` before interpolation, so `/opt/anynote/.env` is the only
source for that value. The registry token is never placed in an argument or
printed by either helper.

## TLS certificates

Traefik issues certificates automatically via Let's Encrypt using the `le`
resolver defined in [`traefik/traefik.yml`](traefik/traefik.yml):

```yaml
certificatesResolvers:
  le:
    acme:
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web # HTTP-01 on :80
```

Every router that sets `tls.certResolver: le` (in
[`traefik/dynamic/routers.yml`](traefik/dynamic/routers.yml)) gets a certificate
on first request for its host. The `:80` (`web`) entrypoint redirects to HTTPS,
but Traefik answers the ACME HTTP-01 challenge on `:80` itself before applying
the redirect, so the challenge succeeds. Certificates persist in the
`traefik_acme` volume (`/letsencrypt/acme.json`) and renew automatically ~30
days before expiry.

The ACME account email is supplied via the
`TRAEFIK_CERTIFICATESRESOLVERS_LE_ACME_EMAIL` env var on the Traefik service
(from the `ACME_EMAIL` GitHub secret) — Traefik's static YAML does not expand
`${VAR}` placeholders, which is why it is passed as an env var.

### Issuing the certificate for `api.anynote.ru`

The router for `api.anynote.ru` already exists in
[`traefik/dynamic/routers.yml`](traefik/dynamic/routers.yml) and is configured
exactly like the working `anynote.ru` router — `entryPoints: [websecure]`,
`tls.certResolver: le`, routing to the `engines` service (NestJS REST + MCP on
`:8082`):

```yaml
api:
  rule: 'Host(`api.anynote.ru`)'
  entryPoints:
    - websecure
  tls:
    certResolver: le
  service: engines
  middlewares:
    - ratelimit@file
    - inflight@file
    - headers@file
    - compress@file
```

**No Traefik/application config change is required to enable HTTPS.** The
certificate is not yet issued only because issuance needs the name to resolve to
the host and a running deploy. To issue it:

1. **DNS** — add an `A` record:

   ```
   api.anynote.ru  →  <same IP as anynote.ru / the Traefik host>
   ```

   Let's Encrypt's HTTP-01 challenge requires `api.anynote.ru` to resolve to the
   Traefik host so the challenge on `:80` reaches Traefik.

2. **Deploy** — trigger the deploy workflow so Traefik (re)loads the dynamic
   config and runs the ACME challenge:

   ```bash
   gh workflow run deploy.yml --ref main
   ```

   (Or push a release tag.) The workflow syncs `deploy/traefik/` and runs
   `/opt/anynote/compose.sh up -d`; Traefik then performs HTTP-01 for
   `api.anynote.ru` and
   writes the cert into `/letsencrypt/acme.json`. If the router config is already
   live on the host, simply having DNS resolve and hitting
   `https://api.anynote.ru` once is enough to trigger issuance — but running a
   deploy guarantees the current `routers.yml` is in place.

3. **Verify** — once DNS has propagated and the deploy is done:

   ```bash
   # A valid TLS handshake (200 / 404 / 502 — anything but an SSL error)
   curl -I https://api.anynote.ru

   # Inspect the served certificate's CN/issuer
   echo | openssl s_client -servername api.anynote.ru -connect api.anynote.ru:443 2>/dev/null \
     | openssl x509 -noout -issuer -subject -dates

   # On the host: confirm Traefik obtained the cert
   /opt/anynote/compose.sh logs traefik | grep -i acme
   ```

   A trusted (Let's Encrypt) chain with `subject=CN=api.anynote.ru` means the
   secure certificate is issued. Renewal is automatic.

### Prerequisites already wired

- `ACME_EMAIL` GitHub secret →
  `TRAEFIK_CERTIFICATESRESOLVERS_LE_ACME_EMAIL` (see `deploy.yml`).
- `engines` service is part of the production compose stack.
- `NEXT_PUBLIC_API_BASE_URL=https://api.anynote.ru` is set in
  `.env.template`.

## Telegram WARP egress

The deploy workflow materializes two different files locally: `.env` is the
Compose interpolation source and contains exactly one `TELEGRAM_PROXY_URL=`
line; `.app.env` is derived from it with that line removed and is the common
application `env_file`. It streams both to unique mode-`0600` temporary files
under `/opt/anynote`, then `/opt/anynote/activate-env.sh` validates ownership,
content, filesystem, mode, and live destination type before replacing the live
pair. Existing regular files are preserved as same-filesystem hard-link
snapshots. Each rename is atomic individually, but the pair is not an OS-atomic
operation; the helper rolls the complete prior pair back if the second rename
or a post-activation check fails. Do not copy either file directly onto a live
path.

Shell rollback cannot run after `SIGKILL`, power loss, or a host crash. Inspect
any retained `/opt/anynote/.env.backup.*` recovery snapshot before rerunning an
interrupted activation. A failure that occurs only while deleting a recovery
snapshot leaves the already verified new pair committed and reports a nonzero
result without rolling it back.

For every manual Compose operation, use the synced wrapper:

```bash
sudo /opt/anynote/compose.sh pull
sudo /opt/anynote/compose.sh up -d --remove-orphans
sudo /opt/anynote/compose.sh ps
sudo /opt/anynote/compose.sh logs --tail=80 web engines
```

### Install and verify infrastructure

The WARP bootstrap is an explicit operator action; deployment only syncs the
versioned assets to `/opt/anynote/warp`.

```bash
sudo /opt/anynote/warp/install.sh check
sudo /opt/anynote/warp/install.sh install
sudo /opt/anynote/warp/install.sh status
```

`install` must report WARP as `Connected` in local proxy mode. The installer
accepts the proxy port only from the single `Mode: WarpProxy on port N` field
in `warp-cli settings`, then correlates it with exactly one
`127.0.0.1:N` listener owned by `warp-svc`. Compare `ip route show default`
before and after installation; the default route must remain unchanged.

The Docker host-gateway must be an RFC1918 address assigned exactly once across
all host interfaces, and that sole assignment must belong to a local `dockerN`
or `br-*` interface. Port `40001` must have exactly one listener, bound only to
that current Docker host-gateway address—never a wildcard, public/LAN
interface, wrong address, duplicate socket, or IPv6 wildcard.

`status` is a fail-closed invariant check, not just a diagnostic printout. It
cross-checks active services, `Connected` state, WARP settings, the safely
parsed bridge environment, the current Docker host-gateway, and both exact
listeners. A nonzero result means application routing must not be enabled.
Gateway discovery uses the local default bridge inspection and never starts or
pulls a diagnostic container image. The verified application endpoint is
exactly `http://host.docker.internal:40001`.

Before package or mode changes, installation queries systemd `LoadState`
fail-closed: only `not-found` means absent; every known existing state requires
the old bridge to stop and an inactive `ActiveState` confirmation. On every
post-connect installation failure, the installer attempts both bridge shutdown
and WARP disconnect. A rerun then explicitly restarts the bridge after
installing the new environment and unit. `disable` is the infrastructure
rollback: it always attempts both operations and does not uninstall packages or
remove configuration.

The systemd relay uses `DynamicUser=yes`. It binds only the unprivileged high
port, writes no persistent state, and retains the unit's filesystem and
privilege hardening.

### Enable application routing

Only after `install.sh status` succeeds, set the production GitHub environment
variable to the exact scoped endpoint and run the deploy workflow:

```bash
gh variable set TELEGRAM_PROXY_URL --env production \
  --body 'http://host.docker.internal:40001'
gh workflow run deploy.yml --ref main
```

The workflow rematerializes and transactionally activates both environment
files, then recreates the stack through `deploy-stack.sh` and `compose.sh`.
Never export the proxy variable in the host shell and never set `HTTP_PROXY`,
`HTTPS_PROXY`, or `ALL_PROXY`.

### Health checks

First rerun the infrastructure invariant and inspect container state:

```bash
sudo /opt/anynote/warp/install.sh status
sudo /opt/anynote/compose.sh ps
```

Run a redacted, non-mutating `getMe` probe from `engines`; print only `ok` and a
neutral error description, never the bot identity, token, chat ID, request URL,
or response body. Then send one clearly marked synthetic submission to the
public contact endpoint `https://anynote.ru/api/trpc/contact.submit` and confirm
HTTP 200 plus delivery in the configured Telegram chat. Inspect only
secret-safe summaries; do not log the submission payload or Telegram URLs.

Also verify port `40001` is unreachable on the host's public address. A healthy
result requires the exact listener invariant from `install.sh status`, healthy
`web` and `engines` containers, a redacted successful `getMe`, and the marked
public contact smoke.

### Rollback

Rollback is application-first. Do not disable the bridge while containers can
still depend on it.

1. Delete `TELEGRAM_PROXY_URL` from the production GitHub environment and run a
   successful deployment so `.env` contains one empty proxy line and
   `.app.env` still contains none.
2. Recreate the two Telegram-capable services on the direct path:

   ```bash
   sudo /opt/anynote/compose.sh up -d --force-recreate web engines
   ```

3. Verify both containers no longer have a configured proxy without printing
   any other environment values:

   ```bash
   docker exec anynote-web-1 node -e \
     "process.exit(process.env.TELEGRAM_PROXY_URL ? 1 : 0)"
   docker exec anynote-engines-1 node -e \
     "process.exit(process.env.TELEGRAM_PROXY_URL ? 1 : 0)"
   sudo /opt/anynote/compose.sh ps web engines
   ```

4. Only after the direct-path redeploy and both checks succeed, disable the
   infrastructure:

   ```bash
   sudo /opt/anynote/warp/install.sh disable
   ```
