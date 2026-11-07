"""Head-to-head evaluation of exported HK networks (or a network against the
heuristic AI): paired seeds — every deal played twice with the seats swapped —
greedy play, the result with its standard error and a points breakdown.

    conda activate train
    python training/hk/evaluate.py training/runs/hk1/policies/update_02300.hknet heuristic
    python training/hk/evaluate.py training/runs/hk1/policies/update_02300.hknet training/runs/hk1/policies/update_01100.hknet --matches 512

A and B each play two seats (across from each other). Points per match = A's
two seats minus B's two seats. The standard error comes from the spread over
seed pairs, so ±2 SE is a rough 95% interval.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from env_client import EnvClient  # noqa: E402
from model import NetConfig, masked_logits, read_net  # noqa: E402
from train import Inference, Precision, densify  # noqa: E402

HEURISTIC = {"easy", "normal", "hard", "heuristic"}
KEYS = ["wins", "selfDraws", "dealIns", "faan", "bigWins", "wonPoints", "dealInPoints", "paidPoints"]


def load(spec: str, device, dtype):
    if spec in HEURISTIC:
        return None
    header, tensors = read_net(spec)
    return Inference(NetConfig(**header["config"]), device, dtype, tensors)


def label(spec: str) -> str:
    return spec if spec in HEURISTIC else os.path.splitext(os.path.basename(spec))[0]


def evaluate(a: str, b: str, matches: int = 256, workers: int = 4, envs: int = 32, seed: int = 4242, precision: str = "bf16") -> dict:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    prec = Precision(precision)
    nets = {"A": load(a, device, prec.store), "B": load(b, device, prec.store)}
    seat_b = "normal" if b == "heuristic" else (b if b in HEURISTIC else "B")
    seat_a = "normal" if a == "heuristic" else (a if a in HEURISTIC else "A")
    per = -(-matches // workers)
    per += per % 2
    clients = [EnvClient() for _ in range(workers)]
    dim = clients[0].spec["obsDim"]
    for i, c in enumerate(clients):
        c.send_reset(numEnvs=min(envs, per), seed=seed + 100_003 * i, seats=[seat_a, seat_b, seat_a, seat_b],
                     schedule="paired", maxMatches=per, rewardScale=1, aux=False, maxActions=6000)
    live = set(range(workers))
    episodes = []
    t0 = time.time()
    while live:
        for i in sorted(live):
            batch = clients[i].recv()
            episodes += [dict(ep, worker=i) for ep in batch.episodes]
            if batch.finished:
                live.discard(i)
                continue
            actions = np.zeros(batch.n, np.int64)
            if batch.n:
                obs = densify(batch, dim, device, prec.store)
                mask = torch.from_numpy(np.array(batch.mask)).to(device).bool()
                who = np.asarray(batch.who)
                for name, net in nets.items():
                    rows = np.flatnonzero(who == name)
                    if len(rows) and net is not None:
                        r = torch.from_numpy(rows).to(device)
                        logits, _ = net(obs[r])
                        actions[rows] = masked_logits(logits, mask[r]).argmax(-1).cpu().numpy()
            clients[i].send_step(actions)
    for c in clients:
        c.close()

    side = {s: dict.fromkeys(["points", *KEYS], 0.0) for s in "AB"}
    pairs: dict[tuple, float] = {}
    hands = 0
    for ep in episodes:
        hands += ep["hands"]
        diff = 0.0
        for seat, who in enumerate(ep["who"]):
            s = "A" if who == seat_a else "B"
            d = ep["scores"][seat] - 500
            side[s]["points"] += d
            diff += d if s == "A" else -d
            for k in KEYS:
                side[s][k] += ep["stats"][seat].get(k, 0)
        pairs[(ep["worker"], ep["seed"])] = pairs.get((ep["worker"], ep["seed"]), 0.0) + diff
    n = len(episodes)
    per_pair = np.array(list(pairs.values())) / 2  # per match, averaged over the two seatings
    mean = float(per_pair.mean()) if len(per_pair) else 0.0
    se = float(per_pair.std(ddof=1) / math.sqrt(len(per_pair))) if len(per_pair) > 1 else float("nan")
    h = max(1, hands)

    def stats(x):
        return {
            "points_per_hand": x["points"] / h,
            "win_pct": 100 * x["wins"] / h,
            "points_per_win": x["wonPoints"] / max(1, x["wins"]),
            "avg_win_faan": x["faan"] / max(1, x["wins"]),
            "big_win_pct": 100 * x["bigWins"] / max(1, x["wins"]),
            "deal_in_pct": 100 * x["dealIns"] / h,
            "points_per_deal_in": x["dealInPoints"] / max(1, x["dealIns"]),
            "paid_per_hand": x["paidPoints"] / h,
        }

    return {
        "a": label(a),
        "b": label(b),
        "matches": n,
        "hands": hands,
        "points_per_match": mean,
        "se": se,
        "A": stats(side["A"]),
        "B": stats(side["B"]),
        "truncated": sum(1 for ep in episodes if ep["truncated"]),
        "seconds": round(time.time() - t0, 1),
    }


def report(r: dict) -> str:
    lines = [
        f"{r['a']} vs {r['b']}: {r['points_per_match']:+.1f} ± {r['se']:.1f} points per match (A − B, {r['matches']} matches, {r['hands']} hands, {r['seconds']} s)",
        f"  {'':22}{'A':>10}{'B':>10}",
    ]
    for k, name in [
        ("points_per_hand", "points / hand"),
        ("win_pct", "win %"),
        ("points_per_win", "points per win"),
        ("avg_win_faan", "avg win faan"),
        ("big_win_pct", "6+ faan wins %"),
        ("deal_in_pct", "deal-in %"),
        ("points_per_deal_in", "points per deal-in"),
        ("paid_per_hand", "paid on others' / hand"),
    ]:
        lines.append(f"  {name:22}{r['A'][k]:10.1f}{r['B'][k]:10.1f}")
    return "\n".join(lines)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("a", help="a .hknet file, or 'heuristic'")
    p.add_argument("b", help="a .hknet file, or 'heuristic'")
    p.add_argument("--matches", type=int, default=256)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--envs", type=int, default=32)
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--json", default=None, help="append the result to this .jsonl file")
    args = p.parse_args(argv)
    torch.set_num_threads(2)
    r = evaluate(args.a, args.b, args.matches, args.workers, args.envs, args.seed)
    print(report(r), flush=True)
    if args.json:
        with open(args.json, "a", encoding="utf-8") as f:
            f.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    main()
