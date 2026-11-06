"""Python side of training/hk/env-server.ts: spawns the bundled Node env
server (`npm run train:build` -> training/dist/hk-env.mjs) and speaks its
line-delimited JSON protocol. Observations and masks arrive as numpy arrays.
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
    env: list[int]
    seat: list[int]
    who: list[str]
    obs: np.ndarray  # [n, obsDim] float32
    mask: np.ndarray  # [n, numSlots] uint8
    reward: np.ndarray  # [n] reward since each seat's previous request
    aux: np.ndarray | None  # [n, auxDim] float32 (training targets) or None
    done: list[dict] = field(default_factory=list)
    episodes: list[dict] = field(default_factory=list)


class EnvClient:
    def __init__(self, node: str = "node", build: bool = False):
        if build or not os.path.exists(BUNDLE):
            build_bundle()
        self.proc = subprocess.Popen(
            [node, BUNDLE],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.spec = self._call({"cmd": "spec"})

    def _call(self, msg: dict) -> dict:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        if not reply.get("ok"):
            raise RuntimeError(f"env server: {reply.get('error')}")
        return reply

    def _batch(self, r: dict) -> Batch:
        obs_dim, slots = self.spec["obsDim"], self.spec["numSlots"]
        aux = None
        if r.get("aux"):
            aux = np.frombuffer(base64.b64decode(r["aux"]), dtype="<f4").reshape(-1, self.spec["auxDim"])
        return Batch(
            env=r["env"],
            seat=r["seat"],
            who=r["who"],
            obs=np.frombuffer(base64.b64decode(r["obs"]), dtype="<f4").reshape(-1, obs_dim),
            mask=np.frombuffer(base64.b64decode(r["mask"]), dtype=np.uint8).reshape(-1, slots),
            reward=np.asarray(r["reward"], dtype=np.float32),
            aux=aux,
            done=r["done"],
            episodes=r["episodes"],
        )

    def reset(self, **options) -> Batch:
        return self._batch(self._call({"cmd": "reset", "options": options}))

    def step(self, actions) -> Batch:
        return self._batch(self._call({"cmd": "step", "actions": [int(a) for a in actions]}))

    def ts_forward(self, net_path: str, obs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """The TS runtime's forward pass on `obs` (export parity checks)."""
        data = base64.b64encode(np.ascontiguousarray(obs, dtype="<f4").tobytes()).decode("ascii")
        r = self._call({"cmd": "forward", "path": net_path, "obs": data})
        logits = np.frombuffer(base64.b64decode(r["logits"]), dtype="<f4").reshape(-1, self.spec["numSlots"])
        return logits, np.asarray(r["value"], dtype=np.float32)

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                assert self.proc.stdin
                self.proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                self.proc.stdin.flush()
            except OSError:
                pass
            self.proc.wait(timeout=10)

    def __enter__(self) -> "EnvClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
