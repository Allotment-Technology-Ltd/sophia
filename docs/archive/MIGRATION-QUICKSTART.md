# GCP Organization Migration - Quick Reference

**Project**: sophia-488807  
**From**: adam.boon1984@googlemail.com → **To**: admin@usesophia.app

## Pre-Flight Checklist

```bash
# 1. Export all configuration (5 min)
gcloud auth login adam.boon1984@googlemail.com
cd /Users/adamboon/projects/sophia

# Run all backups
gcloud projects get-iam-policy sophia-488807 --format=yaml > data/migration/iam-backup-$(date +%Y%m%d).yaml
gcloud iam service-accounts list --project=sophia-488807 --format=json > data/migration/service-accounts-backup-$(date +%Y%m%d).json
gcloud secrets list --project=sophia-488807 --format=json > data/migration/secrets-inventory-$(date +%Y%m%d).json
gcloud run services list --project=sophia-488807 --format=json > data/migration/cloudrun-services-$(date +%Y%m%d).json

# 2. Backup databases (10 min)
# SurrealDB backup (via SSH tunnel - see docs/GCP-ORG-MIGRATION.md Phase 1.3)
./scripts/migration-db-backup.sh

# Firestore backup
gsutil mb -p sophia-488807 -l europe-west2 gs://sophia-firestore-backups 2>/dev/null || true
gcloud firestore export gs://sophia-firestore-backups/$(date +%Y%m%d) --project=sophia-488807

# 3. Backup Pulumi state
cd infra && pulumi stack export --file ../data/migration/pulumi-state-backup-$(date +%Y%m%d).json

# 4. Verify all backups created
ls -lh data/migration/
```

**✓ All backups complete** → Proceed to transfer

---

## Transfer Execution (30 min)

```bash
# 1. Switch to organization account
gcloud auth login admin@usesophia.app

# 2. Run transfer script (interactive)
./scripts/transfer-project.sh

# This script will:
# - Get organization ID and billing account ID (user input)
# - Unlink current billing
# - Transfer project to organization
# - Relink organization billing
# - Grant admin@usesophia.app owner role
# - Verify core resources accessible
```

**⚠️ If you get organization policy errors:**

```bash
# Automated: This script handles both org authentications
./scripts/modify-org-policies.sh

# Then retry the transfer
./scripts/transfer-project.sh

# After successful transfer, optionally re-secure the orgs:
./scripts/revert-org-policies.sh
```

---

## Post-Transfer Configuration (20 min)

```bash
# 1. Set up Workload Identity Federation
# Edit scripts/setup-wif.sh and set GITHUB_REPO_OWNER
nano scripts/setup-wif.sh  # Change YOUR_GITHUB_USERNAME

./scripts/setup-wif.sh

# This outputs values for GitHub secrets - save them!

# 2. Update GitHub repository secrets
# Go to: https://github.com/YOUR_USERNAME/sophia/settings/secrets/actions
# Update:
#   - WIF_PROVIDER (from script output)
#   - WIF_SERVICE_ACCOUNT (from script output)
#   - GCP_PROJECT_ID (still sophia-488807)

# 3. Update local gcloud auth
gcloud auth login admin@usesophia.app
gcloud config set project sophia-488807
gcloud auth application-default login
gcloud auth configure-docker europe-west2-docker.pkg.dev

# 4. Test Pulumi access
cd infra
pulumi preview  # Should work without errors
```

**✓ Configuration complete** → Verify systems

---

## Verification (10 min)

```bash
# Run comprehensive verification
./scripts/verify-migration.sh

# Expected: All green ✓ (warnings OK)

# Manual tests:
# 1. Visit https://usesophia.app
# 2. Sign in with Google
# 3. Ask a question
# 4. Check conversation history
# 5. Sign out

# Test GitHub Actions (manual trigger)
# Go to: https://github.com/YOUR_USERNAME/sophia/actions
# Run workflow_dispatch on main branch
```

**✓ All tests passing** → Migration complete!

---

## Rollback (if needed)

```bash
# If critical issues after transfer:

# 1. Grant personal account owner role again
gcloud projects add-iam-policy-binding sophia-488807 \
  --member="user:adam.boon1984@googlemail.com" \
  --role="roles/owner"

# 2. Restore IAM policy
gcloud projects set-iam-policy sophia-488807 \
  data/migration/iam-backup-YYYYMMDD.yaml

# 3. Restore databases (if corrupted)
npx tsx --env-file=.env scripts/db-restore.ts --file=data/backups/BACKUP_DIR
gcloud firestore import gs://sophia-firestore-backups/YYYYMMDD --project=sophia-488807

# 4. Revert GitHub secrets to old WIF configuration
```

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/GCP-ORG-MIGRATION.md` | Complete migration runbook (detailed) |
| `scripts/transfer-project.sh` | Automated project transfer |
| `scripts/setup-wif.sh` | WIF configuration for CI/CD |
| `scripts/verify-migration.sh` | Post-migration testing |
| `scripts/migration-db-backup.sh` | SurrealDB backup via SSH tunnel |
| `data/migration/` | All backup artifacts |

---

## Timeline Estimate

| Phase | Time | Description |
|-------|------|-------------|
| Pre-flight | 15 min | Backups and exports |
| Transfer | 30 min | Project move and billing |
| Configuration | 20 min | WIF, GitHub secrets, local auth |
| Verification | 10 min | Automated + manual tests |
| **Total** | **~75 min** | Plus testing buffer |

---

## Support Contacts

- **GCP Support**: https://cloud.google.com/support
- **Migration Docs**: `docs/GCP-ORG-MIGRATION.md`
- **GitHub Issues**: Create issue for blockers

---

## Success Criteria

- [ ] Project under organization (verify with `gcloud projects describe sophia-488807`)
- [ ] admin@usesophia.app has owner role
- [ ] All service accounts intact with correct IAM roles
- [ ] Cloud Run service accessible at usesophia.app
- [ ] SSL certificate ACTIVE
- [ ] Database VM running and accessible via VPC
- [ ] GitHub Actions deployment succeeds
- [ ] Firebase Auth working
- [ ] No billing alerts or service disruptions
- [ ] `./scripts/verify-migration.sh` passes with 0 failures

---

**Last Updated**: 3 March 2026
