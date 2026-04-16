#!/usr/bin/env python3
"""
Refresh Step D artifact sidecar: SHA256s for known weight archives + HF index,
manifest fingerprints from manifest.json, optional upload of the sidecar JSON to GCS.

  pip install  # stdlib only

Usage (repo root):

  python scripts/ml/write_phase2_artifact_manifest.py \\
    --export-dir data/phase1-training-export \\
    --out data/phase1-training-export/artifact-ft-d95bacfb-6f78.json

Optional upload (sidecar JSON only; large tarballs are operator-managed):

  PHASE2_ARTIFACT_GCS_URI=gs://your-bucket/path/artifact-ft-d95bacfb-6f78.json \\
    pnpm ops:phase2-write-artifact-manifest --export-dir data/phase1-training-export

Requires `gsutil` on PATH when PHASE2_ARTIFACT_GCS_URI is set.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Paths for job ft-d95bacfb-6f78 (see docs/sophia/extraction-fireworks-deploy.md).
DEFAULT_PATHS = {
    "merged_weights_tarball": "merged-bfl6-adapter/ft-d95bacfb-6f78-2026-04-15-21-03-23.tar.zst",
    "lora_adapter_tarball": "ft-d95bacfb-6f78-adapter/ft-d95bacfb-6f78_adapter-2026-04-15-21-03-23.tar.zst",
    "model_safetensors_index": "merged-bfl6-hf/model.safetensors.index.json",
}


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--export-dir",
        default="data/phase1-training-export",
        help="Directory containing manifest.json and weight tarballs",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output JSON path (default: <export-dir>/artifact-ft-d95bacfb-6f78.json)",
    )
    parser.add_argument(
        "--job-id",
        default="ft-d95bacfb-6f78",
        help="Together fine-tune job id (used in default output filename)",
    )
    args = parser.parse_args()

    export_dir = Path(args.export_dir)
    out_path = Path(args.out) if args.out else export_dir / f"artifact-{args.job_id}.json"

    manifest_path = export_dir / "manifest.json"
    together_path = export_dir / "together-finetune-job-submitted.json"
    step_a_path = export_dir / "step-a-together-packaging-report.json"

    if not manifest_path.is_file():
        print(f"error: missing {manifest_path}", file=sys.stderr)
        sys.exit(1)
    if not together_path.is_file():
        print(f"error: missing {together_path}", file=sys.stderr)
        sys.exit(1)

    manifest = load_json(manifest_path)
    together = load_json(together_path)

    cohort_fp = manifest.get("cohort", {}).get("cohortFingerprintSha256_16")
    golden_fp = manifest.get("goldenSet", {}).get("fingerprintSha256_16")
    manifest_generated_at = manifest.get("generatedAt")

    merged_rel = DEFAULT_PATHS["merged_weights_tarball"]
    adapter_rel = DEFAULT_PATHS["lora_adapter_tarball"]
    index_rel = DEFAULT_PATHS["model_safetensors_index"]

    merged_path = export_dir / merged_rel
    adapter_path = export_dir / adapter_rel
    index_path = export_dir / index_rel

    merged_sha = sha256_file(merged_path)
    adapter_sha = sha256_file(adapter_path)
    index_sha = sha256_file(index_path)

    ed = export_dir.as_posix()

    fireworks_block: dict[str, Any] | None = None
    if out_path.is_file():
        try:
            prev = load_json(out_path)
            if isinstance(prev.get("fireworks"), dict):
                fireworks_block = prev["fireworks"]
        except (json.JSONDecodeError, OSError):
            pass

    if fireworks_block is None:
        fireworks_block = {
            "note": "Deployment ids below are historical (2026-04-16 vendor FT eval). Teardown may have removed them; see docs/sophia/extraction-fireworks-deploy.md (Retention and teardown).",
            "historical_eval_deployments": [
                {
                    "eval_label": "golden_holdout_200",
                    "deployment_id": "accounts/adam-boon1984-17nryg/deployments/ytv2kq38",
                    "eval_output_relative_path": f"{ed}/eval-fireworks-extraction.json",
                },
                {
                    "eval_label": "remit_multidomain_200",
                    "deployment_id": "accounts/adam-boon1984-17nryg/deployments/keo1sj4o",
                    "eval_output_relative_path": f"{ed}/eval-fireworks-remit-multidomain.json",
                },
            ],
        }

    doc: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "note": "Step D lineage sidecar: links Together job, on-disk weight archives, export manifest fingerprints, and historical Fireworks eval deployments. Re-run `pnpm ops:phase2-write-artifact-manifest --export-dir <export-dir>` from repo root to refresh hashes after re-download or extract (pass flags directly; avoid `pnpm … -- --export-dir` which forwards a bare `--` to Python).",
        "job_id": together.get("job_id", args.job_id),
        "base_model": together.get("model", "mistralai/Mistral-7B-Instruct-v0.2"),
        "together_output_model_name": together.get("output_model_name"),
        "merge_method": "together_merged_tarball",
        "merge_method_detail": "Full merged weights from Together checkpoint tarball (no local Peft merge). For adapter-only re-merge use scripts/ml/merge_peft_lora.py with the same base id.",
        "training_data_lineage": {
            "manifest_relative_path": f"{ed}/manifest.json",
            "manifest_generatedAt": manifest_generated_at,
            "cohortFingerprintSha256_16": cohort_fp,
            "goldenFingerprintSha256_16": golden_fp,
            "step_a_packaging_relative_path": f"{ed}/step-a-together-packaging-report.json",
            "together_job_record_relative_path": f"{ed}/together-finetune-job-submitted.json",
        },
        "artifacts": {
            "merged_weights_tarball": {
                "relative_path": f"{ed}/{merged_rel}",
                "sha256": merged_sha,
            },
            "lora_adapter_tarball": {
                "relative_path": f"{ed}/{adapter_rel}",
                "sha256": adapter_sha,
            },
            "extracted_hf_directory": {
                "relative_path": f"{ed}/merged-bfl6-hf",
                "model_safetensors_index_sha256": index_sha,
                "model_safetensors_index_relative_path": f"{ed}/{index_rel}",
            },
        },
        "quantization": {
            "serving_path": "fireworks_managed_bf16_import",
            "notes": "No separate AWQ/GPTQ artifact for Fireworks pilot; avoid ad-hoc bitsandbytes 8-bit checkpoint dumps. See docs/sophia/extraction-vllm-awq.md for optional self-host quant.",
        },
        "fireworks": fireworks_block,
    }

    if step_a_path.is_file():
        doc["training_data_lineage"]["step_a_packaging_present"] = True

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")

    gcs_uri = os.environ.get("PHASE2_ARTIFACT_GCS_URI", "").strip()
    if gcs_uri:
        try:
            subprocess.run(
                ["gsutil", "cp", str(out_path), gcs_uri],
                check=True,
            )
            print(f"Uploaded sidecar to {gcs_uri}")
        except FileNotFoundError:
            print("error: gsutil not found; install gcloud SDK or unset PHASE2_ARTIFACT_GCS_URI", file=sys.stderr)
            sys.exit(1)
        except subprocess.CalledProcessError as e:
            print(f"error: gsutil failed: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
