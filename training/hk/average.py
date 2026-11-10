"""Average the weights of several HK networks into one (Polyak / "model soup"
averaging of checkpoints from one run). Works when the checkpoints sit in one
basin — late snapshots of a single run with a small learning rate do.

    conda activate train
    # the full-precision snapshot pool saved in a run's checkpoint (every 20 updates, the last 20):
    python training/hk/average.py --ckpt training/runs/hk1/ckpt/latest.pt --last 20 -o avg.hknet
    # or exported files (int8, dequantised before averaging):
    python training/hk/average.py training/runs/hk1/policies/update_04{0..9}00.hknet -o avg.hknet

Then measure it: python training/hk/evaluate.py avg.hknet training/runs/hk1/policies/update_05000.hknet
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(__file__))
from env_client import EnvClient  # noqa: E402
from model import HkNet, NetConfig, export_net, read_net  # noqa: E402


def average(states: list[dict]) -> dict:
    keys = states[0].keys()
    return {k: sum(s[k].float() for s in states) / len(states) for k in keys}


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("files", nargs="*", help=".hknet files to average")
    p.add_argument("--ckpt", help="a run's ckpt/latest.pt: average its snapshot pool instead")
    p.add_argument("--last", type=int, default=0, help="with --ckpt: only the last N snapshots")
    p.add_argument("-o", "--out", required=True)
    args = p.parse_args(argv)

    if args.ckpt:
        ck = torch.load(args.ckpt, map_location="cpu", weights_only=False)
        pool = ck["pool"][-args.last :] if args.last else ck["pool"]
        states = [sd for _, sd in pool]
        updates = [u for u, _ in pool]
        cfg = NetConfig(**ck["net"])
    else:
        if not args.files:
            p.error("give .hknet files or --ckpt")
        loaded = [read_net(f) for f in args.files]
        states = [t for _, t in loaded]
        updates = [h.get("meta", {}).get("update") for h, _ in loaded]
        cfg = NetConfig(**loaded[0][0]["config"])

    model = HkNet(cfg)
    model.load_state_dict(average(states), strict=False)
    with EnvClient() as env:
        size = export_net(model, env.spec, args.out, "i8", meta={"averaged": updates})
    print(json.dumps({"out": args.out, "averaged": updates, "bytes": size}))


if __name__ == "__main__":
    main()
