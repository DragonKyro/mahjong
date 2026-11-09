"""Python side of training/hk/env-server.ts.

Spawns the bundled Node env server (`npm run train:build` ->
training/dist/hk-env.mjs) and speaks its protocol: JSON lines in; a JSON
header line plus a binary payload out. `send_*` and `recv` are split so a
learner can start every worker on its step and then collect the replies
while they all run in parallel.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
from dataclasses import dataclass, field

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BUNDLE = os.path.join(ROOT, "training", "dist", "hk-env.mjs")


def build_bundle() -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "run", "train:build"], cwd=ROOT, check=True)


@dataclass
class Batch:
    n: int
    env: list[int]
    seat: list[int]
    who: list[str]
    hint: np.ndarray  # [n] heuristic slot for teacher seats, else -1
    reward: np.ndarray  # [n] reward since each seat's previous request
    seq: list[int]
    nnz: np.ndarray  # [n] uint16 non-zeros per observation row
    idx: np.ndarray  # [nnzTotal] uint16 feature index
    val: np.ndarray  # [nnzTotal] float32 value
    mask: np.ndarray  # [n, numSlots] uint8
    aux: np.ndarray | None  # [n, auxDim] float32 training labels, or None
    danger: np.ndarray | None  # [n, dangerDim] float32 training labels (who could win on each discard, its cost), or None
    done: list[dict] = field(default_factory=list)
    episodes: list[dict] = field(default_factory=list)
    finished: bool = False

    def dense(self, obs_dim: int) -> np.ndarray:
        out = np.zeros((self.n, obs_dim), dtype=np.float32)
        rows = np.repeat(np.arange(self.n), self.nnz.astype(np.int64))
        out[rows, self.idx.astype(np.int64)] = self.val
        return out


class EnvClient:
    def __init__(self, node: str = "node", build: bool = False):
        if build or not os.path.exists(BUNDLE):
            build_bundle()
        self.proc = subprocess.Popen([node, BUNDLE], stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=1 << 20)
        self.send({"cmd": "spec"})
        self.spec, _ = self._recv_raw()

    # ---- protocol
    def send(self, msg: dict) -> None:
        assert self.proc.stdin
        self.proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def _recv_raw(self) -> tuple[dict, bytes]:
        assert self.proc.stdout
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("env server exited")
        header = json.loads(line)
        payload = self.proc.stdout.read(header.get("bytes", 0)) if header.get("bytes") else b""
        if not header.get("ok"):
            raise RuntimeError(f"env server: {header.get('error')}")
        return header, payload

    def recv(self) -> Batch:
        h, p = self._recv_raw()
        n, total = h["n"], h["nnzTotal"]
        slots, aux_dim = self.spec["numSlots"], self.spec["auxDim"]
        off = 0
        val = np.frombuffer(p, "<f4", total, off)
        off += 4 * total
        aux = None
        if h["aux"]:
            aux = np.frombuffer(p, "<f4", n * aux_dim, off).reshape(n, aux_dim)
            off += 4 * n * aux_dim
        danger = None
        if h.get("danger"):
            dd = self.spec["dangerDim"]
            danger = np.frombuffer(p, "<f4", n * dd, off).reshape(n, dd)
            off += 4 * n * dd
        idx = np.frombuffer(p, "<u2", total, off)
        off += 2 * total
        nnz = np.frombuffer(p, "<u2", n, off)
        off += 2 * n
        mask = np.frombuffer(p, "u1", n * slots, off).reshape(n, slots)
        return Batch(
            n=n,
            env=h["env"],
            seat=h["seat"],
            who=h["who"],
            hint=np.asarray(h["hint"], dtype=np.int64),
            reward=np.asarray(h["reward"], dtype=np.float32),
            seq=h["seq"],
            nnz=nnz,
            idx=idx,
            val=val,
            mask=mask,
            aux=aux,
            danger=danger,
            done=h["done"],
            episodes=h["episodes"],
            finished=h["finished"],
        )

    def send_reset(self, **options) -> None:
        self.send({"cmd": "reset", "options": options})

    def send_step(self, actions) -> None:
        self.send({"cmd": "step", "actions": [int(a) for a in actions]})

    # ---- blocking conveniences
    def reset(self, **options) -> Batch:
        self.send_reset(**options)
        return self.recv()

    def step(self, actions) -> Batch:
        self.send_step(actions)
        return self.recv()

    def ts_forward(self, net_path: str, obs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """The TS runtime's forward pass on `obs` (export parity checks)."""
        data = base64.b64encode(np.ascontiguousarray(obs, dtype="<f4").tobytes()).decode("ascii")
        self.send({"cmd": "forward", "path": net_path, "obs": data})
        h, _ = self._recv_raw()
        logits = np.frombuffer(base64.b64decode(h["logits"]), dtype="<f4").reshape(-1, self.spec["numSlots"])
        return logits, np.asarray(h["value"], dtype=np.float32)

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.send({"cmd": "close"})
            except OSError:
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __enter__(self) -> "EnvClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
