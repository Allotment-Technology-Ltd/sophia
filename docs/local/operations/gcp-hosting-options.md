# Hosting options when leaving GCP Cloud Run

Sophia today: **SvelteKit** on **Cloud Run**, **Neon Postgres**, **SurrealDB** (production should use **SurrealDB Cloud** or another internet-reachable RPC URL — see [gcp-surreal-url-verification.md](./gcp-surreal-url-verification.md)), optional **Vertex / Google AI** for ingestion, **Paddle** for billing.

## Decision matrix

| Option | Monthly ops | Fits Surreal Cloud + Neon | Notes |
|--------|-------------|---------------------------|--------|
| **Vercel** (or Netlify / similar) | Low | Yes | Replace Cloud Run + global HTTPS LB with platform edge; run `db:migrate:ci` in CI (see [ci-migrate-off-cloud-run.md](./ci-migrate-off-cloud-run.md)); serverless function timeouts may affect long ingest — keep heavy batch off edge or use background jobs. |
| **Single VPS** (Hetzner, OVH, DO, etc.) | Medium | Yes | Docker Compose: one container for app + TLS reverse proxy; smallest fixed cost; you patch OS and rotate certs. |
| **Fly.io / Railway** | Medium | Yes | Container + private networking; good if you want fewer raw-Linux chores than VPS. |
| **Stay on GCP** | Low (familiar) | Yes | Right-size Run, pause schedulers ([pause script](../../../scripts/gcp/pause-cost-saving-schedulers.sh)), delete unused connector — still pay for HTTPS LB until DNS moves. |

## DNS cutover (all options)

Production hostname **`usesophia.app`** sits on a **GCP external HTTPS load balancer** today ([gcp-infrastructure.md](./gcp-infrastructure.md)). Moving host:

1. Stand up new origin (TLS + health check).
2. Lower DNS TTL ahead of time.
3. Point `A`/`AAAA` or `CNAME` to the new provider; validate certs.
4. After traffic is stable, delete GCP forwarding rules, URL maps, backend services, NEGs, static IP — then Cloud Run services.

## Recommendation under tight budget

- **Minimize GCP now** (this repo’s deploy + scheduler scripts).
- **Target Vercel + Neon + Surreal Cloud** if you want the least server patching; **single VPS** if you want the lowest vendor bill and accept ops.
