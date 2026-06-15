# Deployment

Production runs on a single host behind Traefik (file provider, TLS via Let's
Encrypt). The stack is defined in [`compose.yml`](compose.yml); Traefik routing
lives in [`traefik/`](traefik/). Deploys are driven by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which renders
`.env.template` with `envsubst`, syncs `deploy/traefik/`, and runs
`docker compose pull && docker compose up -d` over SSH.

## TLS certificates

Traefik issues certificates automatically via Let's Encrypt using the `le`
resolver defined in [`traefik/traefik.yml`](traefik/traefik.yml):

```yaml
certificatesResolvers:
  le:
    acme:
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web        # HTTP-01 on :80
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
  rule: "Host(`api.anynote.ru`)"
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
   `docker compose up -d`; Traefik then performs HTTP-01 for `api.anynote.ru` and
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
   docker compose logs traefik | grep -i acme
   ```

   A trusted (Let's Encrypt) chain with `subject=CN=api.anynote.ru` means the
   secure certificate is issued. Renewal is automatic.

### Prerequisites already wired

- `ACME_EMAIL` GitHub secret →
  `TRAEFIK_CERTIFICATESRESOLVERS_LE_ACME_EMAIL` (see `deploy.yml`).
- `engines` service is part of the production compose stack.
- `NEXT_PUBLIC_API_BASE_URL=https://api.anynote.ru` is set in
  `.env.template`.
