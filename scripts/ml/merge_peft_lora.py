#!/usr/bin/env python3
"""
Merge a PEFT LoRA adapter into a bf16 causal LM for local export / AWQ / HF upload.

  pip install torch transformers peft accelerate

Usage:
  python scripts/ml/merge_peft_lora.py --base mistralai/Mistral-7B-Instruct-v0.2 \\
    --adapter ./lora-adapter-dir --out ./merged-bf16

  Optional reproducible Hub pin:
  python scripts/ml/merge_peft_lora.py --base mistralai/Mistral-7B-Instruct-v0.2 \\
    --revision <git-rev> --adapter ./lora-adapter-dir --out ./merged-bf16
"""

from __future__ import annotations

import argparse
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="HF hub id or local path for base model")
    parser.add_argument(
        "--revision",
        default=None,
        help="Optional Hub git revision (branch / tag / commit) for reproducible base+tokenizer load",
    )
    parser.add_argument("--adapter", required=True, help="Path to LoRA adapter (PEFT)")
    parser.add_argument("--out", required=True, help="Output directory for merged weights")
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base_kw: dict[str, Any] = dict(torch_dtype=torch.bfloat16, device_map="auto")
    tok_kw: dict[str, Any] = {}
    if args.revision:
        base_kw["revision"] = args.revision
        tok_kw["revision"] = args.revision

    base = AutoModelForCausalLM.from_pretrained(
        args.base,
        **base_kw,
    )
    model = PeftModel.from_pretrained(base, args.adapter)
    merged = model.merge_and_unload()
    merged.save_pretrained(args.out)
    tok = AutoTokenizer.from_pretrained(args.base, **tok_kw)
    tok.save_pretrained(args.out)
    print(f"Wrote merged model + tokenizer to {args.out}")


if __name__ == "__main__":
    main()
