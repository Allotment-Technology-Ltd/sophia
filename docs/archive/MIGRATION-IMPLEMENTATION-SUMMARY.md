# GCP Organization Migration - Implementation Complete

**Status**: ✅ Ready for execution  
**Date**: 3 March 2026  
**Project**: sophia-488807

## What Has Been Prepared

### 📋 Documentation Created

1. **[docs/GCP-ORG-MIGRATION.md](docs/GCP-ORG-MIGRATION.md)** - Complete detailed runbook
   - 10 phases covering entire migration process
   - Rollback procedures for each phase
   - Troubleshooting guide
   - Post-migration checklist
   - ~300 lines of detailed instructions

2. **[docs/MIGRATION-QUICKSTART.md](docs/MIGRATION-QUICKSTART.md)** - Quick reference guide
   - Condensed command sequences
   - Timeline estimates
   - Success criteria checklist
   - Emergency contacts

### 🛠️ Scripts Created

1. **[scripts/transfer-project.sh](scripts/transfer-project.sh)** - Automated project transfer
   - Interactive prompts for org ID and billing account
   - Unlinks billing, transfers project, relinks billing
   - Grants admin@usesophia.app owner role
   - Verifies core resources after transfer
   - ~150 lines with error handling

2. **[scripts/setup-wif.sh](scripts/setup-wif.sh)** - Workload Identity Federation setup
   - Creates WIF pool and GitHub OIDC provider
   - Creates/configures terraform-sa service account
   - Grants all necessary IAM roles
   - Outputs GitHub secrets configuration
   - ~120 lines

3. **[scripts/verify-migration.sh](scripts/verify-migration.sh)** - Comprehensive verification
   - Tests 9 categories of system components
   - 40+ individual checks
   - Color-coded pass/warn/fail output
   - Detailed summary with exit codes
   - ~350 lines

4. **[scripts/migration-db-backup.sh](scripts/migration-db-backup.sh)** - Database backup via SSH
   - Creates SSH tunnel through IAP to database VM
   - Bypasses VPC-only firewall restriction safely
   - Copies backup to migration directory
   - Automatic cleanup
   - ~100 lines

### 📦 Backup Artifacts Exported

All saved to `data/migration/`:

```
✓ iam-backup-20260303.yaml (3.7KB)
✓ service-accounts-backup-20260303.json (2.1KB)
✓ secrets-inventory-20260303.json (814B)
✓ secret-iam-20260303.txt (1.6KB)
✓ cloudrun-services-20260303.json (30KB)
✓ cloudrun-jobs-20260303.json (14KB)
✓ compute-instances-20260303.json (32KB)
✓ vpc-connectors-20260303.json (369B)
✓ artifact-repos-20260303.json (2.8KB)
✓ lb-addresses-20260303.json (787B)
✓ ssl-certs-20260303.json (6.3KB)
```

**Note**: Database and Firestore backups require manual execution due to network restrictions.

---

## What You Need to Do Next

### Option 1: Execute Full Migration Now

Follow this sequence:

```bash
# 1. Complete database backups (15 min)
./scripts/migration-db-backup.sh  # SurrealDB via SSH tunnel

# Firestore backup
gsutil mb -p sophia-488807 -l europe-west2 gs://sophia-firestore-backups 2>/dev/null || true
gcloud firestore export gs://sophia-firestore-backups/$(date +%Y%m%d) --project=sophia-488807

# 2. Execute project transfer (30 min)
gcloud auth login admin@usesophia.app
./scripts/transfer-project.sh  # Interactive - will prompt for org ID and billing

# 3. Configure WIF for CI/CD (10 min)
# First, edit scripts/setup-wif.sh and set your GitHub username
nano scripts/setup-wif.sh  # Line 10: GITHUB_REPO_OWNER="your_username"
./scripts/setup-wif.sh  # Outputs GitHub secrets - save them!

# 4. Update GitHub secrets (5 min)
# Go to: https://github.com/YOUR_USERNAME/sophia/settings/secrets/actions
# Update: WIF_PROVIDER, WIF_SERVICE_ACCOUNT, GCP_PROJECT_ID

# 5. Update local development (5 min)
gcloud auth login admin@usesophia.app
gcloud config set project sophia-488807
gcloud auth application-default login
gcloud auth configure-docker europe-west2-docker.pkg.dev

# 6. Verify everything works (10 min)
./scripts/verify-migration.sh  # Should show all green ✓

# 7. Test in browser
# Visit https://usesophia.app
# Sign in, ask question, verify it works

# 8. Test CI/CD
# GitHub Actions → Run workflow manually
```

**Total Time**: ~75 minutes + testing buffer

### Option 2: Review First, Execute Later

1. Read [docs/GCP-ORG-MIGRATION.md](docs/GCP-ORG-MIGRATION.md) thoroughly
2. Review [docs/MIGRATION-QUICKSTART.md](docs/MIGRATION-QUICKSTART.md) for timeline
3. Check the scripts in `scripts/` to understand what they do
4. Review backup artifacts in `data/migration/`
5. Schedule a maintenance window
6. Execute when ready using Option 1 above

---

## Key Decision Points

### Before Transfer

- **Organization ID**: You'll need the numeric organization ID for usesophia.app
  - Get with: `gcloud organizations list` (as admin@usesophia.app)

- **Billing Account ID**: You'll need the org's billing account ID
  - Get with: `gcloud billing accounts list` (as admin@usesophia.app)

- **GitHub Repository**: Update `GITHUB_REPO_OWNER` in [scripts/setup-wif.sh](scripts/setup-wif.sh)
  - Line 10: `GITHUB_REPO_OWNER="your_github_username"`

### During Transfer

The [scripts/transfer-project.sh](scripts/transfer-project.sh) will:
1. Prompt you for org ID
2. Prompt you for billing account ID
3. Confirm before unlinking billing
4. Confirm before actual transfer
5. Automatically relink billing
6. Verify resources still work

**It's interactive and safe** - you can cancel at any point before the actual transfer.

---

## Rollback Plan

If anything goes wrong:

### Before IAM Changes (Phase 1-3)

Just restore from backups in `data/migration/`

### After Project Transfer (Phase 4+)

1. Grant personal account back:
   ```bash
   gcloud projects add-iam-policy-binding sophia-488807 \
     --member="user:adam.boon1984@googlemail.com" \
     --role="roles/owner"
   ```

2. Restore IAM:
   ```bash
   gcloud projects set-iam-policy sophia-488807 \
     data/migration/iam-backup-20260303.yaml
   ```

3. See [docs/GCP-ORG-MIGRATION.md](docs/GCP-ORG-MIGRATION.md) "Rollback Plan" section for full details

---

## What Won't Change

✅ **Project ID**: Still `sophia-488807`  
✅ **Domain**: Still `usesophia.app`  
✅ **Region**: Still `europe-west2`  
✅ **Service accounts**: Transfer with project automatically  
✅ **All resources**: Stay intact (Cloud Run, VM, VPC, etc.)  
✅ **SSL certificates**: Continue to work  
✅ **Database data**: Stays on VM  
✅ **Firestore data**: Stays in Firestore  
✅ **Secrets**: Stay in Secret Manager  

## What Will Change

🔄 **Project parent**: Personal account → Organization  
🔄 **Billing account**: Personal → Organization billing  
🔄 **IAM members**: admin@usesophia.app gets owner role  
🔄 **GitHub Actions auth**: Old WIF → New WIF  
🔄 **Local gcloud auth**: adam.boon1984@googlemail.com → admin@usesophia.app  

---

## Risk Assessment

### Low Risk ✅

- Project ID unchanged → No code/config updates needed
- Domain unchanged → No DNS changes needed  
- All resources transfer atomically with project
- Backups created before any changes

### Medium Risk ⚠️

- Billing interruption (mitigated: relinked immediately)
- GitHub Actions broken (mitigated: WIF setup script ready)
- Access issues (mitigated: admin@usesophia.app granted owner role immediately)

### High Risk ❌

- None identified. Extended downtime window allows thorough testing.

---

## Support Resources

- **Detailed Runbook**: [docs/GCP-ORG-MIGRATION.md](docs/GCP-ORG-MIGRATION.md)
- **Quick Reference**: [docs/MIGRATION-QUICKSTART.md](docs/MIGRATION-QUICKSTART.md)
- **Verification Script**: Run `./scripts/verify-migration.sh` anytime
- **GCP Support**: https://cloud.google.com/support
- **Rollback Procedures**: In runbook Phase 10

---

## Success Indicators

After migration, verify these:

```bash
# Quick checks
gcloud projects describe sophia-488807 | grep parent  # Should say "organization"
curl -I https://usesophia.app | grep "HTTP"  # Should return 200
./scripts/verify-migration.sh  # Should show all green ✓

# Full verification (10 min)
# 1. Browser test: Sign in, ask question, check history
# 2. GitHub Actions: Trigger manual deployment
# 3. Check logs: No errors in Cloud Run logs
# 4. Database: VM running, Cloud Run can connect
```

---

## Questions Before Starting?

Review these docs:
1. [docs/GCP-ORG-MIGRATION.md](docs/GCP-ORG-MIGRATION.md) - Full details
2. [docs/MIGRATION-QUICKSTART.md](docs/MIGRATION-QUICKSTART.md) - Command sequences
3. [scripts/transfer-project.sh](scripts/transfer-project.sh) - See what transfer does
4. [scripts/verify-migration.sh](scripts/verify-migration.sh) - See what gets tested

All scripts have detailed comments explaining each step.

---

## Ready to Execute?

When you're ready to begin:

```bash
# Step 1: Read the quickstart
cat docs/MIGRATION-QUICKSTART.md

# Step 2: Start the migration
./scripts/migration-db-backup.sh  # First backup databases

# Step 3: Follow the quickstart guide
# (All commands are in docs/MIGRATION-QUICKSTART.md)
```

Good luck! 🚀

---

**Prepared by**: GitHub Copilot  
**Date**: 3 March 2026  
**Implementation Status**: ✅ Complete & Ready for Execution
