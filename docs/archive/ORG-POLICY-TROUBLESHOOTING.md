# GCP Organization Policy Constraints - Troubleshooting

## The Issue

Your transfer is blocked by **Organization Policies** — a Google Cloud security feature that restricts which organizations can receive projects and from where projects can be imported.

```
ERROR: Constraint `constraints/resourcemanager.allowedExportDestinations` violated
ERROR: Constraint `constraints/resourcemanager.allowedImportSources` violated
```

This is actually **good security** — it means your organizations have strong controls. But it requires additional steps to move the project.

## Which Policies Are Blocking?

There are **2 policies** that matter:

### 1. Source Organization Policy (adam-boon1984-org)

**Policy**: `constraints/resourcemanager.allowedExportDestinations`  
**What it does**: Controls where projects from this organization can be exported to  
**Your status**: It doesn't allow exports to usesophia.app organization (438631660639)

### 2. Destination Organization Policy (usesophia.app)

**Policy**: `constraints/resourcemanager.allowedImportSources`  
**What it does**: Controls which organizations' projects can be imported  
**Your status**: It doesn't allow imports from adam-boon1984-org (654846649492)

### Both Must Allow the Transfer

For the transfer to succeed:
- Source org must allow exports to destination org ✗ (blocked)
- Destination org must allow imports from source org ✗ (blocked)

**You need to fix BOTH before transfer can succeed.**

---

## Solution 1: Check Current Policies (Diagnostic)

```bash
# See what organizations are in the allowed list for each policy
./scripts/check-org-policies.sh
```

This will:
- Check if policies exist
- Show you what's currently allowed
- Suggest next steps

---

## Solution 2: Modify Policies (If You Have Permission)

**Prerequisites**: You need Organization Admin role on **BOTH** organizations

### Automated Method (Recommended)

```bash
# Run this script - it handles authentication for both orgs
./scripts/modify-org-policies.sh

# It will:
# 1. Authenticate as source org admin
# 2. Add destination org to allowed exports
# 3. Authenticate as destination org admin
# 4. Add source org to allowed imports
# 5. Prompt you to retry the transfer
```

Then retry:
```bash
./scripts/transfer-project.sh
```

### Manual Method

If you prefer to run commands directly:

#### Step 1: Modify Source Organization Policy

```bash
# Authenticate as admin of SOURCE organization (adam-boon1984-org)
gcloud auth login adam.boon1984@googlemail.com

# Get current policy (to see what's already allowed)
gcloud resource-manager org-policies describe \
  constraints/resourcemanager.allowedExportDestinations \
  --organization=654846649492

# Allow exports to destination org
gcloud resource-manager org-policies allow \
  constraints/resourcemanager.allowedExportDestinations \
  --organization=654846649492 \
  organizations/438631660639
```

### Step 2: Modify Destination Organization Policy

```bash
# Authenticate as admin of DESTINATION organization (usesophia.app)
gcloud auth login admin@usesophia.app

# Get current policy (to see what's already allowed)
gcloud resource-manager org-policies describe \
  constraints/resourcemanager.allowedImportSources \
  --organization=438631660639

# Allow imports from source org
gcloud resource-manager org-policies allow \
  constraints/resourcemanager.allowedImportSources \
  --organization=438631660639 \
  organizations/654846649492
```

### Step 3: Retry Transfer

```bash
# You should already be logged in as admin@usesophia.app
./scripts/transfer-project.sh
```

---

## Solution 3: Manual Transfer via GCP Console

This may work even if policies are restrictive (depending on configuration):

1. **Authenticate** as admin@usesophia.app in browser
2. **Go to** https://console.cloud.google.com/cloud-resource-manager
3. **Find** project `sophia-488807`
4. **Click** the project
5. **Click** "Move" button at top
6. **Select** destination organization (usesophia.app)
7. **Confirm** move

### Advantages of Console Method

✓ May bypass some policy restrictions  
✓ No command-line complexity  
✓ Visual confirmation at each step  
✓ Easier to rollback if needed

### Disadvantages

✗ More clicks  
✗ Can't be automated  
✗ Less clear on exactly what's happening

---

## Solution 4: Contact Organization Admin

If you don't have permission to modify policies:

**Ask the admin of usesophia.app organization to:**

1. Modify `constraints/resourcemanager.allowedImportSources`
2. Add source organization `654846649492` to the allowed list

**Ask the admin of adam-boon1984-org organization to:**

1. Modify `constraints/resourcemanager.allowedExportDestinations`
2. Add destination organization `438631660639` to the allowed list

Send them:
- Source org ID: `654846649492`
- Destination org ID: `438631660639`
- Project ID: `sophia-488807`

---

## After Transfer Succeeds

### Step 1: Re-secure the Organizations (Optional but Recommended)

If you modified the policies to allow the transfer, you may want to restrict them again after:

```bash
# Use 'deny' to remove the organization from the allowed list

# Remove exports allowance on source org
gcloud auth login adam.boon1984@googlemail.com
gcloud resource-manager org-policies deny \
  constraints/resourcemanager.allowedExportDestinations \
  --organization=654846649492 \
  organizations/438631660639

# Remove imports allowance on destination org
gcloud auth login admin@usesophia.app
gcloud resource-manager org-policies deny \
  constraints/resourcemanager.allowedImportSources \
  --organization=438631660639 \
  organizations/654846649492
```

This removes the temporary allowlist. You can add it back if needed in the future.

### Step 2: Continue with Migration

```bash
./scripts/setup-wif.sh
# ... rest of migration steps
```

---

## Reference Information

| Item | Value |
|------|-------|
| Source Organization ID | `654846649492` |
| Source Org Name | adam-boon1984-org |
| Destination Organization ID | `438631660639` |
| Destination Org Name | usesophia.app |
| Project ID | `sophia-488807` |
| Source Policy to Modify | `constraints/resourcemanager.allowedExportDestinations` |
| Destination Policy to Modify | `constraints/resourcemanager.allowedImportSources` |

---

## Troubleshooting

### "Permission denied" when modifying policies

✗ You don't have Organization Admin role  
✓ Contact your organization admin  
✓ Ask them to make the policy changes instead

### "Policy does not exist" when checking

✗ The policy constraint might not be set yet  
✓ Try running the transfer anyway  
✓ Or check using GCP Console

### "Resource already has a parent" error

✗ The project isn't ready to move  
✓ Wait a few minutes  
✓ Try again  
✓ Or restart the transfer script

### Still stuck?

- Check full migration docs: `docs/GCP-ORG-MIGRATION.md`
- Review GCP org policy docs: https://cloud.google.com/resource-manager/docs/organization-policy/overview
- Try GCP Console manual method
- Contact GCP Support

---

**Last Updated**: 3 March 2026
