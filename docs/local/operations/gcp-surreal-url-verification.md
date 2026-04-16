# Verify production `surreal-db-url` (Secret Manager)

Use this **before** merging any change that removes the Cloud Run VPC connector. If `surreal-db-url` still points at a **private RFC1918** address, removing VPC **breaks** graph access until you update the secret to a public Surreal endpoint.

## 1. Read the secret value (operator only)

```bash
gcloud secrets versions access latest --secret=surreal-db-url --project=sophia-488807
```

Do **not** paste the full URL into tickets or commits.

## 2. Expected shapes

| Shape | Meaning | VPC connector |
|-------|---------|----------------|
| `wss://…` or `https://…` pointing at SurrealDB Cloud / public endpoint | **Surreal Cloud** (or other internet RPC) | **Not required** for Cloud Run; repo deploy removes `--vpc-connector`. |
| `http://10.x.x.x:8000/rpc` or other **RFC1918** host | Private VPC Surreal (e.g. old GCE VM) | **Required** until you migrate the secret to a public URL and validate the app. |

## 3. Optional runtime check

After deploy, hit `/api/health` (or any route that touches Surreal) and confirm no connection errors in Cloud Run logs.

## Related

- [SurrealDB Cloud — credentials](./surrealdb-cloud-access.md)
- [GCP infrastructure](./gcp-infrastructure.md) — connector removal order
