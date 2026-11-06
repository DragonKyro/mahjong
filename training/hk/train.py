"""Train the HK agent: imitate the heuristic AI for the first --bc-updates
updates, then improve by PPO self-play with no heuristic involvement at all
(opponents are the network itself and its own past snapshots; no imitation
loss, no KL to the teacher).

    conda activate train
    npm run train:build
    python training/hk/train.py --name hk1                 # 5,000 updates: 100 imitation + 4,900 self-play
    python training/hk/train.py --resume training/runs/hk1  # carry on after a stop

Everything runs locally: Node worker processes play the matches with the real
engine (training/hk/vec-env.ts), this process batches their decisions on the
GPU. Outputs under training/runs/<name>/: metrics.jsonl (one line per update),
evals.jsonl, policies/*.hknet (compact int8 networks the TS runtime loads),
ckpt/latest.pt (resume).

Fair play: the network's input is the seat's own view only (src/core/nn/hkEncode.ts,
scramble-tested). The value head reads the same input. The optional aux heads learn to
predict opponents' hidden hands from that input, using the hidden hands as training
labels only — they never feed a decision; --aux-coef 0 turns them off.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import threading
import time
from collections import defaultdict
from dataclasses import asdict

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
from env_client import ROOT, EnvClient, build_bundle  # noqa: E402
from model import HkNet, NetConfig, export_net, masked_logits, param_count, quantized_copy  # noqa: E402

# ------------------------------------------------------------ options


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", default=None)
    p.add_argument("--out", default=os.path.join(ROOT, "training", "runs"))
    p.add_argument("--resume", default=None, help="a run directory to continue")
    p.add_argument("--updates", type=int, default=5000)
    p.add_argument("--bc-updates", type=int, default=100, help="imitation updates at the start")
    p.add_argument("--workers", type=int, default=max(2, min(16, (os.cpu_count() or 8) - 4)))
    p.add_argument("--envs", type=int, default=48, help="matches per worker")
    p.add_argument("--groups", type=int, default=4, help="workers are served in this many groups (overlaps GPU and env time)")
    p.add_argument("--samples", type=int, default=16384, help="learner decisions per update")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--minibatch", type=int, default=4096)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--lr-final", type=float, default=3e-5)
    p.add_argument("--bc-lr", type=float, default=5e-4)
    p.add_argument("--clip", type=float, default=0.2)
    p.add_argument("--target-kl", type=float, default=0.03, help="stop an update's epochs early past 1.5x this")
    p.add_argument("--vf-coef", type=float, default=0.5)
    p.add_argument("--ent", type=float, default=0.01)
    p.add_argument("--ent-final", type=float, default=0.002)
    p.add_argument("--aux-coef", type=float, default=0.1)
    p.add_argument("--gamma", type=float, default=1.0)
    p.add_argument("--lam", type=float, default=0.95)
    p.add_argument("--max-grad", type=float, default=1.0)
    p.add_argument("--reward-scale", type=float, default=32.0, help="points per unit of reward")
    p.add_argument("--episode", choices=["hand", "match"], default="hand")
    p.add_argument("--pool-frac", type=float, default=0.25, help="share of workers playing past snapshots (2 seats each)")
    p.add_argument("--pool-every", type=int, default=20)
    p.add_argument("--pool-size", type=int, default=20)
    p.add_argument("--eval-every", type=int, default=100, help="0 = never (evaluation is measurement only)")
    p.add_argument("--progress-every", type=int, default=100, help="rewrite progress.md this often (and after each evaluation)")
    p.add_argument("--eval-matches", type=int, default=64)
    p.add_argument("--export-every", type=int, default=100)
    p.add_argument("--ckpt-every", type=int, default=50)
    p.add_argument("--precision", choices=["bf16", "fp16", "tf32"], default="bf16")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--no-build", action="store_true")
    for k in ["channels", "blocks", "neck", "globalHidden", "hidden", "valueHidden"]:
        p.add_argument(f"--{k}", type=int, default=None)
    return p.parse_args(argv)


# ------------------------------------------------------------ helpers

TEACHER, LEARNER, POOL, BC_OPP = "teacher", "learner", "pool", "bc"


def lr_at(args, update: int) -> float:
    if update <= args.bc_updates:
        return args.bc_lr
    span = max(1, args.updates - args.bc_updates)
    t = min(1.0, (update - args.bc_updates - 1) / span)
    return args.lr_final + 0.5 * (args.lr - args.lr_final) * (1 + math.cos(math.pi * t))


def ent_at(args, update: int) -> float:
    span = max(1, args.updates - args.bc_updates)
    t = min(1.0, max(0.0, (update - args.bc_updates - 1) / span))
    return args.ent + (args.ent_final - args.ent) * t


class Precision:
    def __init__(self, name: str):
        self.dtype = {"bf16": torch.bfloat16, "fp16": torch.float16}.get(name)
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
        self.store = self.dtype or torch.float32
        self.scaler = torch.amp.GradScaler(enabled=name == "fp16")

    def autocast(self):
        return torch.autocast("cuda", dtype=self.dtype or torch.float32, enabled=self.dtype is not None)


def densify(b, dim: int, device, dtype) -> torch.Tensor:
    rows = np.repeat(np.arange(b.n, dtype=np.int64), b.nnz.astype(np.int64))
    flat = torch.from_numpy(rows * dim + b.idx.astype(np.int64)).to(device, non_blocking=True)
    out = torch.zeros(b.n * dim, device=device, dtype=dtype)
    out[flat] = torch.from_numpy(np.array(b.val)).to(device, dtype, non_blocking=True)
    return out.view(b.n, dim)


class Inference:
    """A no-grad copy of the network for acting, in the storage precision (bf16:
    no per-call weight casts), replayed through CUDA graphs captured per
    batch-size bucket — one launch per decision batch instead of dozens."""

    BUCKETS = (64, 128, 256, 512, 1024, 2048, 4096)

    def __init__(self, cfg: NetConfig, device, dtype, state: dict | None = None):
        self.net = HkNet(cfg).to(device=device, dtype=dtype).eval()
        for p in self.net.parameters():
            p.requires_grad_(False)
        self.device, self.dtype = device, dtype
        self.graphs: dict[int, dict] = {}
        if state is not None:
            self.load(state)

    def load(self, state: dict) -> None:
        """Copy weights in place (the captured graphs keep pointing at the same tensors)."""
        with torch.no_grad():
            for k, v in self.net.state_dict().items():
                if k in state:
                    v.copy_(state[k])

    def _capture(self, size: int) -> dict:
        x = torch.zeros(size, self.net.cfg.planes * 34 + self.net.cfg.globals, device=self.device, dtype=self.dtype)
        side = torch.cuda.Stream()
        side.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(side), torch.no_grad():
            for _ in range(3):
                self.net(x)
        torch.cuda.current_stream().wait_stream(side)
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph), torch.no_grad():
            logits, value, _ = self.net(x)
        g = {"graph": graph, "x": x, "logits": logits, "value": value}
        self.graphs[size] = g
        return g

    def __call__(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        n = obs.shape[0]
        size = next((b for b in self.BUCKETS if b >= n), None)
        if size is None or self.device.type != "cuda":
            with torch.no_grad():
                logits, value, _ = self.net(obs.to(self.dtype))
            return logits.float(), value.float()
        g = self.graphs.get(size) or self._capture(size)
        g["x"][:n].copy_(obs)
        g["graph"].replay()
        return g["logits"][:n].float(), g["value"][:n].float()


# ------------------------------------------------------------ the rollout buffer


class Buffer:
    """Learner decisions on the GPU. A decision is complete once its reward and
    successor value are known (the seat's next request arrived, or its episode
    ended); incomplete ones (one per live seat at most) carry into the next update."""

    def __init__(self, cap: int, obs_dim: int, slots: int, aux_dim: int, device, store_dtype):
        self.cap, self.device = cap, device
        self.obs = torch.zeros(cap, obs_dim, device=device, dtype=store_dtype)
        self.mask = torch.zeros(cap, slots, device=device, dtype=torch.bool)
        self.aux = torch.zeros(cap, aux_dim, device=device, dtype=torch.float16) if aux_dim else None
        self.action = np.zeros(cap, np.int64)
        self.logp = np.zeros(cap, np.float32)
        self.value = np.zeros(cap, np.float32)
        self.reward = np.zeros(cap, np.float32)
        self.next_value = np.zeros(cap, np.float32)
        self.done = np.zeros(cap, bool)
        self.complete = np.zeros(cap, bool)
        self.succ = np.full(cap, -1, np.int64)
        self.n = 0
        self.n_complete = 0
        self.open: dict[tuple, int] = {}  # stream (worker, env, seat) -> its newest decision

    def add(self, streams, obs, mask, aux, action, logp, value) -> np.ndarray:
        k = len(streams)
        if self.n + k > self.cap:
            raise RuntimeError("rollout buffer full — raise its capacity")
        at = np.arange(self.n, self.n + k)
        self.obs[self.n : self.n + k] = obs
        self.mask[self.n : self.n + k] = mask
        if self.aux is not None and aux is not None:
            self.aux[self.n : self.n + k] = aux
        self.action[at], self.logp[at], self.value[at] = action, logp, value
        self.reward[at] = 0
        self.done[at] = False
        self.complete[at] = False
        self.succ[at] = -1
        for i, st in zip(at, streams):
            prev = self.open.get(st)
            if prev is not None:
                self.next_value[prev] = self.value[i]
                self.succ[prev] = i
                self.complete[prev] = True
                self.n_complete += 1
            self.open[st] = int(i)
        self.n += k
        return at

    def reward_to(self, stream, r: float) -> None:
        i = self.open.get(stream)
        if i is not None:
            self.reward[i] += r

    def end(self, stream, r: float) -> None:
        i = self.open.pop(stream, None)
        if i is None:
            return  # an episode that ended before the seat had a decision
        self.reward[i] += r
        self.done[i] = True
        self.next_value[i] = 0
        self.complete[i] = True
        self.n_complete += 1

    def advantages(self, gamma: float, lam: float) -> tuple[np.ndarray, np.ndarray]:
        n = self.n
        adv = np.zeros(n, np.float32)
        delta = self.reward[:n] + gamma * self.next_value[:n] * (~self.done[:n]) - self.value[:n]
        for i in range(n - 1, -1, -1):
            if not self.complete[i]:
                continue
            a = delta[i]
            j = self.succ[i]
            if not self.done[i] and j >= 0 and self.complete[j]:
                a += gamma * lam * adv[j]
            adv[i] = a
        return adv, adv + self.value[:n]

    def carry_into(self, other: "Buffer") -> None:
        """Move the incomplete decisions (each live seat's newest) into the empty `other`, which collects next."""
        keep = np.flatnonzero(~self.complete[: self.n])
        k = len(keep)
        other.clear()
        if k:
            t = torch.from_numpy(keep).to(self.device)
            other.obs[:k] = self.obs[t]
            other.mask[:k] = self.mask[t]
            if self.aux is not None and other.aux is not None:
                other.aux[:k] = self.aux[t]
            for name in ("action", "logp", "value", "reward", "next_value", "done", "complete"):
                getattr(other, name)[:k] = getattr(self, name)[keep]
        other.succ[:k] = -1
        remap = {int(o): i for i, o in enumerate(keep)}
        other.open = {st: remap[i] for st, i in self.open.items() if i in remap}
        other.n = k
        self.open = {}

    def clear(self) -> None:
        self.n = 0
        self.n_complete = 0
        self.open = {}


# ------------------------------------------------------------ workers


class Worker:
    def __init__(self, wid: int, role: str):
        self.wid = wid
        self.role = role  # 'teacher' | 'self' | 'pool' | 'eval'
        self.client = EnvClient()
        self.opponent = None  # eval: the opponent network (an Inference)
        self.net = None  # eval: the frozen network under test (an Inference)
        self.pending = False

    def reset(self, **options) -> None:
        self.client.send_reset(**options)
        self.pending = True

    def recv(self):
        b = self.client.recv()
        self.pending = False
        return b

    def step(self, actions) -> None:
        self.client.send_step(actions)
        self.pending = True

    def close(self) -> None:
        if self.pending and self.client.proc.poll() is None:
            try:
                self.client.recv()
            except Exception:
                pass
            self.pending = False
        self.client.close()


def seats_for(role: str) -> list[str]:
    return {
        "teacher": [TEACHER] * 4,
        "self": [LEARNER] * 4,
        "pool": [LEARNER, POOL, LEARNER, POOL],
    }[role]


# ------------------------------------------------------------ the trainer


class Job(threading.Thread):
    """One update's optimisation, run beside the next update's collection on its own CUDA stream."""

    def __init__(self, trainer: "Trainer", buf: Buffer, update: int, phase: str, ready, info: dict):
        super().__init__(daemon=True)
        self.trainer, self.buf, self.update, self.phase, self.ready, self.info = trainer, buf, update, phase, ready, info
        self.logs: dict = {}
        self.error: BaseException | None = None
        self.seconds = 0.0

    def run(self) -> None:
        t = self.trainer
        t0 = time.time()
        try:
            if t.train_stream is not None:
                with torch.cuda.stream(t.train_stream):
                    t.train_stream.wait_event(self.ready)
                    self.logs = t.learn(self.buf, self.update, self.phase)
                    fresh = {k: v.detach().clone() for k, v in t.model.state_dict().items() if not k.startswith("aux.")}
                    t.train_stream.synchronize()
            else:
                self.logs = t.learn(self.buf, self.update, self.phase)
                fresh = {k: v.detach().clone() for k, v in t.model.state_dict().items() if not k.startswith("aux.")}
            t.fresh = fresh
        except BaseException as e:  # re-raised by the main thread
            self.error = e
        self.seconds = time.time() - t0


class Trainer:
    def __init__(self, args):
        self.args = args
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.prec = Precision(args.precision)
        if args.resume:
            self.run_dir = os.path.abspath(args.resume)
        else:
            name = args.name or time.strftime("hk-%Y%m%d-%H%M%S")
            self.run_dir = os.path.join(args.out, name)
            if os.path.exists(os.path.join(self.run_dir, "ckpt", "latest.pt")):
                raise SystemExit(f"{self.run_dir} already has a run; use --resume or another --name")
        for d in ("policies", "ckpt"):
            os.makedirs(os.path.join(self.run_dir, d), exist_ok=True)
        if not args.no_build:
            build_bundle()

        probe = EnvClient()
        self.spec = probe.spec
        probe.close()
        over = {k: getattr(args, k) for k in ["channels", "blocks", "neck", "globalHidden", "hidden", "valueHidden"] if getattr(args, k)}
        self.cfg = NetConfig.from_spec(self.spec, **over)
        self.aux_dim = self.spec["auxDim"] if args.aux_coef > 0 else 0
        self.model = HkNet(self.cfg, aux_dim=self.aux_dim).to(self.device)
        self.opt = torch.optim.Adam(self.model.parameters(), lr=args.bc_lr, eps=1e-5, fused=self.device.type == "cuda")
        self.update = 0
        self.pool: list[tuple[int, dict]] = []  # (update, state_dict on CPU)
        self.bc_state: dict | None = None
        self.rng = random.Random(args.seed)
        if args.resume:
            self._load()
        torch.manual_seed(args.seed + self.update)

        self.D, self.S = self.spec["obsDim"], self.spec["numSlots"]
        cap = args.samples + args.workers * args.envs * 8 + 4096
        # Two rollout buffers: one fills while the other trains (in a background thread).
        self.bufs = [Buffer(cap, self.D, self.S, self.aux_dim, self.device, self.prec.store) for _ in range(2)]
        self.cur = 0
        self.job: Job | None = None
        self.fresh: dict | None = None  # weights the training thread just produced, for the acting copy
        self.trained = self.update  # the last update whose training finished
        self.train_stream = torch.cuda.Stream() if self.device.type == "cuda" else None
        self.workers: list[Worker] = []
        self.evals: list[dict] = []
        self.eval_nets: dict[str, tuple] = {}
        self.phase = None
        self.match_seed = args.seed * 7919 + self.update * 104729
        self.stats = defaultdict(float)
        self.timing = defaultdict(float)
        self.opponent: Inference | None = None
        self.opponent_update = -1
        self.infer = Inference(self.cfg, self.device, self.prec.store, self.model.state_dict())
        with open(os.path.join(self.run_dir, "config.json"), "w") as f:
            json.dump({"args": vars(args), "net": asdict(self.cfg), "spec": {k: self.spec[k] for k in ["obsDim", "numSlots", "auxDim", "encoderVersion", "actionSpaceVersion"]}}, f, indent=1)
        print(f"run {self.run_dir}\nnet {param_count(self.model):,} parameters, device {self.device}, {args.precision}")

    @property
    def buf(self) -> Buffer:
        return self.bufs[self.cur]

    # ---- checkpoints
    def _save(self) -> None:
        path = os.path.join(self.run_dir, "ckpt", "latest.pt")
        torch.save(
            {
                "update": self.trained,
                "model": self.model.state_dict(),
                "opt": self.opt.state_dict(),
                "pool": self.pool,
                "bc_state": self.bc_state,
                "net": asdict(self.cfg),
                "aux_dim": self.aux_dim,
                "rng": self.rng.getstate(),
            },
            path + ".tmp",
        )
        os.replace(path + ".tmp", path)

    def _load(self) -> None:
        ck = torch.load(os.path.join(self.run_dir, "ckpt", "latest.pt"), map_location="cpu", weights_only=False)
        self.cfg = NetConfig(**ck["net"])
        self.aux_dim = ck["aux_dim"]
        self.model = HkNet(self.cfg, aux_dim=self.aux_dim).to(self.device)
        self.model.load_state_dict(ck["model"])
        self.opt = torch.optim.Adam(self.model.parameters(), lr=self.args.lr, eps=1e-5, fused=self.device.type == "cuda")
        self.opt.load_state_dict(ck["opt"])
        self.update, self.pool, self.bc_state = ck["update"], ck["pool"], ck["bc_state"]
        self.rng.setstate(ck["rng"])
        print(f"resumed at update {self.update}")

    def export(self, name: str, sample_obs=None, sample_mask=None) -> dict:
        path = os.path.join(self.run_dir, "policies", f"{name}.hknet")
        size = export_net(self.model, self.spec, path, "i8", meta={"update": self.trained, "run": os.path.basename(self.run_dir)})
        info = {"file": os.path.basename(path), "bytes": size}
        if sample_obs is not None:
            # How closely the int8 file plays like the float network it came from.
            q = quantized_copy(self.model, "i8").eval()
            with torch.no_grad():
                a = masked_logits(self.model(sample_obs.float())[0], sample_mask)
                b = masked_logits(q(sample_obs.float())[0], sample_mask)
                info["int8_agreement"] = float((a.argmax(-1) == b.argmax(-1)).float().mean())
                pa = F.log_softmax(a, -1)
                info["int8_kl"] = float((pa.exp() * (pa - F.log_softmax(b, -1))).sum(-1).mean())
        return info

    # ---- workers
    def env_options(self, role: str, wid: int) -> dict:
        self.match_seed += 1
        return {
            "numEnvs": self.args.envs,
            "seed": (self.match_seed * 131 + wid) & 0x7FFFFFFF,
            "seats": seats_for(role),
            "rewardScale": self.args.reward_scale,
            "episode": self.args.episode,
            "aux": self.aux_dim > 0,
        }

    def start_phase(self, phase: str) -> None:
        """'bc': every worker plays heuristic-teacher matches; 'ppo': self-play, some against past snapshots."""
        for w in self.workers:
            if w.pending:
                w.recv()
        if not self.workers:
            self.workers = [Worker(i, "self") for i in range(self.args.workers)]
        n_pool = int(round(self.args.pool_frac * len(self.workers))) if phase == "ppo" else 0
        for i, w in enumerate(self.workers):
            w.role = "teacher" if phase == "bc" else ("pool" if i < n_pool else "self")
            w.reset(**self.env_options(w.role, w.wid))
        for b in self.bufs:
            b.clear()
        self.phase = phase
        if phase == "ppo" and not self.pool:
            self.pool = [(self.update, {k: v.detach().cpu().clone() for k, v in self.model.state_dict().items() if not k.startswith("aux.")})]

    def refresh_pool_opponents(self) -> None:
        """This update's past self (one snapshot for every pool worker, so they share a GPU pass)."""
        self.opponent_update, sd = self.rng.choice(self.pool)
        if self.opponent is None:
            self.opponent = Inference(self.cfg, self.device, self.prec.store)
        self.opponent.load(sd)

    # ---- acting
    @torch.no_grad()
    def act(self, net: "Inference", obs: torch.Tensor, mask: torch.Tensor, greedy: bool = False):
        logits, value = net(obs)
        logits = masked_logits(logits, mask)
        if greedy:
            a = logits.argmax(-1)
        else:
            a = torch.multinomial(F.softmax(logits, -1), 1).squeeze(-1)
        logp = F.log_softmax(logits, -1).gather(1, a[:, None]).squeeze(-1)
        return a, logp, value

    def serve(self, group: list[Worker]) -> None:
        """Collect one reply from every worker in the group, decide for all of them in one GPU pass, send the actions."""
        t0 = time.perf_counter()
        replies = [(w, w.recv()) for w in group]
        t1 = time.perf_counter()
        self.timing["wait"] += t1 - t0
        live = []
        for w, b in replies:
            if w.role == "eval":
                self._serve_eval(w, b)
                continue
            for d in b.done:
                self.buf.end((w.wid, d["env"], d["seat"]), d["reward"])
            for ep in b.episodes:
                self._episode_stats(ep)
            if b.n == 0:
                w.step([])
                continue
            live.append((w, b))
        if not live:
            return
        n = sum(b.n for _, b in live)
        nnz = np.concatenate([b.nnz for _, b in live]).astype(np.int64)
        flat = np.repeat(np.arange(n, dtype=np.int64) * self.D, nnz) + np.concatenate([b.idx for _, b in live]).astype(np.int64)
        obs = torch.zeros(n * self.D, device=self.device, dtype=self.prec.store)
        obs[torch.from_numpy(flat).to(self.device)] = torch.from_numpy(np.concatenate([b.val for _, b in live])).to(self.device, self.prec.store)
        obs = obs.view(n, self.D)
        mask = torch.from_numpy(np.concatenate([b.mask for _, b in live])).to(self.device).bool()
        who = np.concatenate([np.asarray(b.who) for _, b in live])
        wid = np.concatenate([np.full(b.n, w.wid) for w, b in live])
        env = np.concatenate([np.asarray(b.env) for _, b in live])
        seat = np.concatenate([np.asarray(b.seat) for _, b in live])
        actions = np.zeros(n, np.int64)
        learn = np.flatnonzero((who == LEARNER) | (who == TEACHER))
        if len(learn):
            li = torch.from_numpy(learn).to(self.device)
            at, lt, vt = self.act(self.infer, obs[li], mask[li])
            out = torch.stack([at.float(), lt, vt]).cpu().numpy()
            a, logp, value = out[0].astype(np.int64), out[1], out[2]
            teacher = who[learn] == TEACHER
            if teacher.any():
                hint = np.concatenate([b.hint for _, b in live])[learn]
                a = np.where(teacher, hint, a)
                logp = np.where(teacher, 0.0, logp).astype(np.float32)
            actions[learn] = a
            streams = list(zip(wid[learn].tolist(), env[learn].tolist(), seat[learn].tolist()))
            reward = np.concatenate([b.reward for _, b in live])[learn]
            for st, r in zip(streams, reward):
                if r:
                    self.buf.reward_to(st, float(r))
            aux = None
            if self.aux_dim and all(b.aux is not None for _, b in live):
                aux = torch.from_numpy(np.concatenate([b.aux for _, b in live])[learn]).to(self.device, torch.float16)
            self.buf.add(streams, obs[li], mask[li], aux, a, logp, value)
        others = np.flatnonzero(who == POOL)
        if len(others):
            oi = torch.from_numpy(others).to(self.device)
            actions[others] = self.act(self.opponent, obs[oi], mask[oi])[0].cpu().numpy()
        at = 0
        for w, b in live:
            w.step(actions[at : at + b.n])
            at += b.n
        self.timing["serve"] += time.perf_counter() - t1

    def _episode_stats(self, ep: dict) -> None:
        st = self.stats
        st["matches"] += 1
        for seat, who in enumerate(ep["who"]):
            if who not in (LEARNER, TEACHER):
                continue
            s = ep["stats"][seat]
            st["seat_hands"] += ep["hands"]
            st["wins"] += s["wins"]
            st["self_draws"] += s["selfDraws"]
            st["deal_ins"] += s["dealIns"]
            st["faan"] += s["faan"]
            st["points"] += ep["scores"][seat] - 500
            st["seat_matches"] += 1

    def collect(self) -> None:
        groups = [self.workers[i :: self.args.groups] for i in range(self.args.groups)]
        groups = [g for g in groups if g]
        while self.buf.n_complete < self.args.samples:
            self.apply_fresh()
            for g in groups:
                busy = [w for w in g if w.pending]
                if busy:
                    self.serve(busy)
            self._service_evals()

    # ---- learning
    def learn(self, buf: Buffer, update: int, phase: str) -> dict:
        """Optimise on `buf`'s complete decisions (runs in the training thread)."""
        a = self.args
        n = buf.n
        adv_np, ret_np = buf.advantages(a.gamma, 1.0 if phase == "bc" else a.lam)
        idx_np = np.flatnonzero(buf.complete[:n])
        idx = torch.from_numpy(idx_np).to(self.device)
        adv = torch.from_numpy(adv_np).to(self.device)
        ret = torch.from_numpy(ret_np).to(self.device)
        act = torch.from_numpy(buf.action[:n]).to(self.device)
        logp_old = torch.from_numpy(buf.logp[:n]).to(self.device)
        bc = phase == "bc"
        if not bc:
            sel = adv[idx]
            adv = (adv - sel.mean()) / (sel.std() + 1e-8)
        for g in self.opt.param_groups:
            g["lr"] = lr_at(a, update)
        ent_coef = ent_at(a, update)
        model = self.model.train()
        logs = defaultdict(list)
        # Imitation accuracy on data the network hasn't trained on yet.
        if bc:
            with torch.no_grad(), self.prec.autocast():
                probe = idx[: min(len(idx), 4096)]
                lg = masked_logits(model(buf.obs[probe])[0], buf.mask[probe])
                logs["bc_acc_fresh"].append(float((lg.argmax(-1) == act[probe]).float().mean()))
        stop = False
        for _ in range(a.epochs):
            perm = idx[torch.randperm(len(idx), device=self.device)]
            for s in range(0, len(perm), a.minibatch):
                mb = perm[s : s + a.minibatch]
                if len(mb) < a.minibatch // 4:
                    continue
                with self.prec.autocast():
                    logits, v, aux = model(buf.obs[mb])
                logits = masked_logits(logits, buf.mask[mb])
                logp_all = F.log_softmax(logits, -1)
                logp = logp_all.gather(1, act[mb, None]).squeeze(-1)
                v = v.float()
                ent = -(logp_all.exp() * logp_all).sum(-1).mean()
                v_loss = F.smooth_l1_loss(v, ret[mb])
                if bc:
                    pi_loss = -logp.mean()
                    loss = pi_loss + a.vf_coef * v_loss
                    logs["bc_acc"].append(float((logits.argmax(-1) == act[mb]).float().mean()))
                else:
                    ratio = torch.exp(logp - logp_old[mb])
                    A = adv[mb]
                    pi_loss = -torch.min(ratio * A, ratio.clamp(1 - a.clip, 1 + a.clip) * A).mean()
                    loss = pi_loss + a.vf_coef * v_loss - ent_coef * ent
                    with torch.no_grad():
                        kl = float(((ratio - 1) - torch.log(ratio)).mean())
                        logs["kl"].append(kl)
                        logs["clipfrac"].append(float(((ratio - 1).abs() > a.clip).float().mean()))
                    if kl > 1.5 * a.target_kl:
                        stop = True
                if aux is not None and buf.aux is not None:
                    aux_loss = F.binary_cross_entropy_with_logits(aux.float(), buf.aux[mb].float())
                    loss = loss + a.aux_coef * aux_loss
                    logs["aux_loss"].append(float(aux_loss.detach()))
                self.opt.zero_grad(set_to_none=True)
                self.prec.scaler.scale(loss).backward()
                self.prec.scaler.unscale_(self.opt)
                torch.nn.utils.clip_grad_norm_(model.parameters(), a.max_grad)
                self.prec.scaler.step(self.opt)
                self.prec.scaler.update()
                logs["pi_loss"].append(float(pi_loss.detach()))
                logs["v_loss"].append(float(v_loss.detach()))
                logs["entropy"].append(float(ent.detach()))
                if stop:
                    break
            if stop:
                break
        out = {k: float(np.mean(v)) for k, v in logs.items()}
        y, p = ret_np[idx_np], buf.value[idx_np]
        if not bc:
            out["explained_var"] = float(1 - np.var(y - p) / (np.var(y) + 1e-8))
        out["samples"] = int(len(idx_np))
        out["lr"] = lr_at(a, update)
        out["ent_coef"] = ent_coef if not bc else 0.0
        return out

    # ---- evaluation (measurement only; never a training signal)
    def start_eval(self, kind: str) -> None:
        """'heuristic': the current network vs the heuristic AI; 'bc': vs the update-100 imitation
        snapshot; 'bc_heuristic': that snapshot vs the heuristic (the starting point, run once)."""
        if kind in ("bc", "bc_heuristic") and self.bc_state is None:
            return
        if any(e["kind"] == kind for e in self.evals):
            return  # the previous one is still playing
        w = Worker(1000 + len(self.evals), "eval")
        # One pair of acting copies per kind of evaluation, reused (their CUDA graphs too).
        if kind not in self.eval_nets:
            self.eval_nets[kind] = (Inference(self.cfg, self.device, self.prec.store), Inference(self.cfg, self.device, self.prec.store) if kind == "bc" else None)
        w.net, w.opponent = self.eval_nets[kind]
        w.net.load(self.bc_state if kind == "bc_heuristic" else self.model.state_dict())
        if w.opponent is not None:
            w.opponent.load(self.bc_state)
        seats = [LEARNER, BC_OPP if kind == "bc" else "normal"] * 2
        n = self.args.eval_matches
        # maxActions: two weak players can draw hand after hand (the dealer keeps the deal on a draw).
        w.reset(numEnvs=min(n, 32), seed=777, seats=seats, schedule="paired", maxMatches=n, rewardScale=1, aux=False, maxActions=4000)
        update = self.args.bc_updates if kind == "bc_heuristic" else self.trained
        vs = "bc" if kind == "bc" else "heuristic"
        self.evals.append({"worker": w, "kind": kind, "vs": vs, "update": update, "episodes": [], "t0": time.time()})

    def _service_evals(self) -> None:
        for e in self.evals:
            if e["worker"].pending:
                self.serve([e["worker"]])
        for e in [e for e in self.evals if e.get("finished")]:
            self._finish_eval(e)
            self.evals.remove(e)

    def _serve_eval(self, w: Worker, b) -> None:
        e = next(x for x in self.evals if x["worker"] is w)
        e["episodes"] += b.episodes
        if b.finished:
            e["finished"] = True
            return
        if b.n == 0:
            w.step([])
            return
        obs = densify(b, self.D, self.device, self.prec.store)
        mask = torch.from_numpy(np.array(b.mask)).to(self.device).bool()
        who = np.asarray(b.who)
        actions = np.zeros(b.n, np.int64)
        for name, net in ((LEARNER, w.net), (BC_OPP, w.opponent)):
            rows = np.flatnonzero(who == name)
            if len(rows) and net is not None:
                ri = torch.from_numpy(rows).to(self.device)
                actions[rows] = self.act(net, obs[ri], mask[ri], greedy=True)[0].cpu().numpy()
        w.step(actions)

    def _finish_eval(self, e: dict) -> None:
        eps = e["episodes"]
        A = B = 0.0
        wins = [0, 0]
        deal_ins = [0, 0]
        hands = 0
        faan = 0.0
        for ep in eps:
            hands += ep["hands"]
            for seat, who in enumerate(ep["who"]):
                side = 0 if who == LEARNER else 1
                d = ep["scores"][seat] - 500
                if side == 0:
                    A += d
                    faan += ep["stats"][seat]["faan"]
                else:
                    B += d
                wins[side] += ep["stats"][seat]["wins"]
                deal_ins[side] += ep["stats"][seat]["dealIns"]
        n = max(1, len(eps))
        rec = {
            "update": e["update"],
            "vs": e["vs"],
            "matches": len(eps),
            "points_per_match": (A - B) / n,
            "wins": wins,
            "deal_ins": deal_ins,
            "hands": hands,
            "avg_win_faan": faan / max(1, wins[0]),
            "truncated": sum(1 for ep in eps if ep["truncated"]),
            "seconds": round(time.time() - e["t0"], 1),
        }
        with open(os.path.join(self.run_dir, "evals.jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")
        self.write_progress()
        print(f"  eval @{rec['update']} vs {rec['vs']}: {rec['points_per_match']:+.1f} points / match | wins {wins[0]}-{wins[1]} | deal-ins {deal_ins[0]}-{deal_ins[1]}")
        e["worker"].close()

    # ---- progress.md (rebuilt from metrics.jsonl and evals.jsonl, so it survives resumes)
    def write_progress(self) -> None:
        a = self.args

        def read(name):
            path = os.path.join(self.run_dir, name)
            if not os.path.exists(path):
                return []
            with open(path, encoding="utf-8") as f:
                return [json.loads(l) for l in f if l.strip()]

        metrics, evals = read("metrics.jsonl"), read("evals.jsonl")
        # A resume repeats the updates after its checkpoint: keep the latest line of each.
        metrics = sorted({m["update"]: m for m in metrics}.values(), key=lambda m: m["update"])
        evals = list({(e["update"], e["vs"]): e for e in evals}.values())
        if not metrics:
            return
        last = metrics[-1]["update"]
        walls = sorted(m["wall_s"] for m in metrics[-100:] if m.get("wall_s"))
        per = walls[len(walls) // 2] if walls else 0.0
        elapsed = sum(m.get("wall_s", 0) for m in metrics)
        phase = "imitation" if metrics[-1]["phase"] == "bc" else "self-play"
        out = [
            f"# HK training: {os.path.basename(self.run_dir)}",
            "",
            f"Updated {time.strftime('%Y-%m-%d %H:%M')} · **update {last:,} / {a.updates:,}** ({100 * last / a.updates:.0f}%) · {phase} · "
            f"{elapsed / 3600:.1f} h so far · ~{per:.1f} s / update · **ETA {per * (a.updates - last) / 3600:.1f} h**",
            "",
            f"Updates 1–{a.bc_updates} imitate the heuristic AI; after that the network trains only against itself and its own past snapshots. "
            "The evaluations below are measurement only — they never feed training.",
            "",
        ]
        heur = sorted((e for e in evals if e["vs"] == "heuristic"), key=lambda e: e["update"])
        if heur:
            e = max(heur, key=lambda e: e["update"])
            verdict = "ahead of" if e["points_per_match"] > 0 else "behind"
            out += [f"**Latest vs the heuristic AI (update {e['update']}): {e['points_per_match']:+.1f} points per match — {verdict} it.**", ""]

        def eval_table(rows, opp):
            t = [
                f"| update | points / match | net wins % | {opp} wins % | net deal-ins % | {opp} deal-ins % | net avg faan | matches |",
                "|---:|---:|---:|---:|---:|---:|---:|---:|",
            ]
            for e in rows:
                h = max(1, e["hands"])
                t.append(
                    f"| {e['update']} | {e['points_per_match']:+.1f} | {100 * e['wins'][0] / h:.1f} | {100 * e['wins'][1] / h:.1f} | "
                    f"{100 * e['deal_ins'][0] / h:.1f} | {100 * e['deal_ins'][1] / h:.1f} | {e['avg_win_faan']:.1f} | {e['matches']} |"
                )
            return t

        n_eval = a.eval_matches
        out += [
            "## Against the heuristic AI (normal)",
            "",
            f"{n_eval} paired-seed matches each (every deal played twice with the seats swapped), the network playing greedily in two seats. "
            "Points per match = network seats minus heuristic seats; win and deal-in rates are per hand, summed over both seats of a side.",
            "",
        ]
        out += eval_table(heur, "heur") if heur else ["_No evaluation finished yet._"]
        bc = sorted((e for e in evals if e["vs"] == "bc"), key=lambda e: e["update"])
        out += ["", f"## Against its own imitation snapshot (update {a.bc_updates})", "", "How far self-play has moved from where imitation left it.", ""]
        out += eval_table(bc, "snap") if bc else ["_No evaluation finished yet._"]

        out += [
            "",
            "## Training, per 100 updates",
            "",
            "| updates | phase | imitation acc | entropy | KL | clip frac | value expl. var | win % | deal-in % | avg win faan | s / update |",
            "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]

        def mean(rows, k):
            v = [r[k] for r in rows if isinstance(r.get(k), (int, float))]
            return sum(v) / len(v) if v else None

        def fmt(x, f="{:.3f}", scale=1.0):
            return "–" if x is None else f.format(x * scale)

        for start in range(1, last + 1, 100):
            rows = [m for m in metrics if start <= m["update"] < start + 100]
            if not rows:
                continue
            ph = "imitation" if rows[-1]["phase"] == "bc" else "self-play"
            out.append(
                f"| {start}–{rows[-1]['update']} | {ph} | {fmt(mean(rows, 'bc_acc_fresh'))} | {fmt(mean(rows, 'entropy'), '{:.2f}')} | "
                f"{fmt(mean(rows, 'kl'))} | {fmt(mean(rows, 'clipfrac'), '{:.2f}')} | {fmt(mean(rows, 'explained_var'), '{:.2f}')} | "
                f"{fmt(mean(rows, 'win_rate'), '{:.1f}', 100)} | {fmt(mean(rows, 'deal_in_rate'), '{:.1f}', 100)} | "
                f"{fmt(mean(rows, 'avg_win_faan'), '{:.2f}')} | {fmt(mean(rows, 'wall_s'), '{:.1f}')} |"
            )
        exports = [m["export"] for m in metrics if m.get("export")]
        if exports:
            x = exports[-1]
            agree = f", int8 file plays the same move as the float network {100 * x['int8_agreement']:.1f}% of the time" if "int8_agreement" in x else ""
            out += ["", f"Latest policy file: `policies/{x['file']}` ({x['bytes'] / 1e6:.2f} MB{agree})."]
        out += [
            "",
            "Training win / deal-in rates are the network's own seats in its training matches (mostly against itself), so they "
            "describe its style more than its strength; the evaluation tables measure strength.",
            "",
        ]
        path = os.path.join(self.run_dir, "progress.md")
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            f.write("\n".join(out))
        os.replace(path + ".tmp", path)

    # ---- the loop
    def run(self) -> None:
        a = self.args
        self.t_start = time.time()
        self.start_update = self.update
        # (Resumed right at the switch: finish the hand-over at the next update.)
        bc = self.update < a.bc_updates or (a.bc_updates > 0 and self.bc_state is None)
        self.start_phase("bc" if bc else "ppo")
        if self.phase == "ppo" and a.eval_every:
            done = os.path.join(self.run_dir, "evals.jsonl")
            seen = [json.loads(l) for l in open(done, encoding="utf-8")] if os.path.exists(done) else []
            if not any(e["vs"] == "heuristic" and e["update"] == a.bc_updates for e in seen):
                self.start_eval("bc_heuristic")
            if self.update > a.bc_updates and not any(e["update"] == self.update for e in seen):
                self.start_eval("heuristic")
                self.start_eval("bc")
        while self.update < a.updates:
            self.update += 1
            if self.update == a.bc_updates + 1 and self.phase == "bc":
                self.finish_job()  # the last imitation update
                self.bc_state = {k: v.detach().cpu().clone() for k, v in self.model.state_dict().items() if not k.startswith("aux.")}
                self.pool = [(a.bc_updates, self.bc_state)]
                self.start_phase("ppo")
            if self.phase == "ppo":
                self.refresh_pool_opponents()
            self.stats = defaultdict(float)
            self.timing = defaultdict(float)
            t0 = time.time()
            self.collect()
            info = {"collect_s": round(time.time() - t0, 2), "wait_s": round(self.timing["wait"], 2), "stats": dict(self.stats)}
            if self.phase == "ppo":
                info["pool_opponent"] = self.opponent_update
            self.finish_job()
            # Hand this rollout to a training thread; the next one fills the other buffer meanwhile.
            nxt = self.bufs[1 - self.cur]
            self.buf.carry_into(nxt)
            ready = torch.cuda.Event() if self.device.type == "cuda" else None
            if ready is not None:
                ready.record()
            self.job = Job(self, self.buf, self.update, self.phase, ready, info)
            self.job.start()
            self.cur = 1 - self.cur
        self.finish_job()
        # Let the last evaluations finish (the training workers just wait).
        while self.evals:
            self._service_evals()
        self.close()

    def apply_fresh(self) -> None:
        """Give the acting copy the weights the training thread finished."""
        if self.fresh is not None:
            self.infer.load(self.fresh)
            if self.device.type == "cuda":
                torch.cuda.current_stream().synchronize()  # before `fresh` (made on the training stream) is freed
            self.fresh = None

    def finish_job(self) -> None:
        """Wait for the training thread, then do that update's bookkeeping (the weights are still now)."""
        job = self.job
        if job is None:
            return
        job.join()
        self.job = None
        if job.error is not None:
            raise job.error
        self.apply_fresh()
        a, u, logs, st = self.args, job.update, job.logs, job.info["stats"]
        self.trained = u
        now = time.time()
        rec = {
            "update": u,
            "phase": job.phase,
            "wall_s": round(now - getattr(self, "t_last", self.t_start), 2),
            **{k: v for k, v in job.info.items() if k != "stats"},
            "train_s": round(job.seconds, 2),
            **logs,
        }
        self.t_last = now
        if st.get("seat_matches"):
            rec["win_rate"] = st["wins"] / max(1, st["seat_hands"])
            rec["deal_in_rate"] = st["deal_ins"] / max(1, st["seat_hands"])
            rec["avg_win_faan"] = st["faan"] / max(1, st["wins"])
            rec["matches"] = int(st["matches"])
        if job.phase == "ppo" and u % a.pool_every == 0:
            self.pool.append((u, {k: v.detach().cpu().clone() for k, v in self.model.state_dict().items() if not k.startswith("aux.")}))
            self.pool = self.pool[-a.pool_size :]
        if a.eval_every and (u % a.eval_every == 0 or u == a.updates):
            self.start_eval("heuristic")
            if u > a.bc_updates:
                self.start_eval("bc")
        if u % a.export_every == 0 or u == a.updates:
            probe = torch.from_numpy(np.flatnonzero(job.buf.complete[: job.buf.n])[:2048]).to(self.device)
            rec["export"] = self.export(f"update_{u:05d}", job.buf.obs[probe], job.buf.mask[probe])
            export_net(self.model, self.spec, os.path.join(self.run_dir, "policies", "latest.hknet"), "i8", meta={"update": u})
        if u % a.ckpt_every == 0 or u == a.updates:
            self._save()
        with open(os.path.join(self.run_dir, "metrics.jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")
        if u % a.progress_every == 0 or u == a.updates:
            self.write_progress()
        done = max(1, u - self.start_update)
        eta = (time.time() - self.t_start) / done * (a.updates - u)
        line = f"[{u:5d} {job.phase:3}] {logs['samples']:6d} dec | collect {rec['collect_s']:4.1f}s (env wait {rec['wait_s']:.1f}) train {job.seconds:4.1f}s"
        if job.phase == "bc":
            line += f" | acc {logs.get('bc_acc_fresh', 0):.3f}"
        else:
            line += f" | ent {logs.get('entropy', 0):.2f} kl {logs.get('kl', 0):.3f} clip {logs.get('clipfrac', 0):.2f} ev {logs.get('explained_var', 0):.2f}"
        if "win_rate" in rec:
            line += f" | win {rec['win_rate']:.3f} deal-in {rec['deal_in_rate']:.3f} faan {rec['avg_win_faan']:.1f}"
        line += f" | ETA {eta / 3600:.1f}h"
        print(line, flush=True)

    def close(self) -> None:
        for w in self.workers:
            w.close()
        for e in self.evals:
            e["worker"].close()


def main(argv=None) -> None:
    args = parse_args(argv)
    torch.set_num_threads(2)  # leave the cores to the env workers
    t = Trainer(args)
    try:
        t.run()
    except KeyboardInterrupt:
        print("stopped; saving a checkpoint")
        if t.job is not None:
            t.job.join()
            t.trained = t.job.update if t.job.error is None else t.trained
        t._save()
        t.close()


if __name__ == "__main__":
    main()
