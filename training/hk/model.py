"""The HK policy / value network in PyTorch — layer for layer the network that
src/core/nn/hkNet.ts runs in the browser (same tensor names, same maths), plus
training-only auxiliary heads that are never exported.

    planes [P x 34] --conv3--+
    globals [G] --linear-----+-(+ per channel)-> relu            stem, C channels
    B x residual block: relu(x + conv3(relu(conv3(x))))           C x 34
    |- conv1 -> relu -> flatten (N x 34) -+
    globals --linear -> relu (Hg) --------+-> linear -> relu      trunk z (H)
    policy logits = linear(z) [78] + per-kind conv1 of x          (discard k, kong k)
    value = linear(relu(linear(z)))                                expected reward
    aux = linear(z) [207]                                          opponents' hands / ready / waits

`export_net` writes the compact binary file the TS runtime loads (`loadHkNet`):
int8 weights with a float32 scale per output row, float32 biases.
"""

from __future__ import annotations

import copy
import json
import struct
from dataclasses import asdict, dataclass

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

KINDS = 34
DISCARD0 = 0
KONG0 = 35
NET_FORMAT = "mahjong/hknet@2"
DANGER_OUT = 4  # per kind: could-win logits for next / across / prev, then the expected cost
MAGIC = b"HKN2"


@dataclass
class NetConfig:
    planes: int
    globals: int
    channels: int = 128
    blocks: int = 6
    neck: int = 32
    globalHidden: int = 256
    hidden: int = 512
    valueHidden: int = 128
    slots: int = 78
    danger: int = 0  # hidden channels of the danger head (0 = none, like the hk1 networks)

    @classmethod
    def from_spec(cls, spec: dict, **over) -> "NetConfig":
        base = dict(spec["defaultNet"])
        base.update(over)
        return cls(**base)


class Block(nn.Module):
    def __init__(self, c: int):
        super().__init__()
        self.conv1 = nn.Conv1d(c, c, 3, padding=1)
        self.conv2 = nn.Conv1d(c, c, 3, padding=1)
        # Start as the identity: deep stacks without normalisation stay stable.
        nn.init.zeros_(self.conv2.weight)
        nn.init.zeros_(self.conv2.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.relu(x + self.conv2(F.relu(self.conv1(x))))


class HkNet(nn.Module):
    def __init__(self, cfg: NetConfig, aux_dim: int = 0):
        super().__init__()
        self.cfg = cfg
        c = cfg.channels
        self.stem_conv = nn.Conv1d(cfg.planes, c, 3, padding=1)
        self.stem_global = nn.Linear(cfg.globals, c)
        self.blocks = nn.ModuleList(Block(c) for _ in range(cfg.blocks))
        self.neck = nn.Conv1d(c, cfg.neck, 1)
        self.global_embed = nn.Linear(cfg.globals, cfg.globalHidden)
        self.trunk = nn.Linear(cfg.neck * KINDS + cfg.globalHidden, cfg.hidden)
        self.policy = nn.Linear(cfg.hidden, cfg.slots)
        self.tile_policy = nn.Conv1d(c + (DANGER_OUT if cfg.danger else 0), 2, 1)
        if cfg.danger:
            self.danger_hidden = nn.Conv1d(c, cfg.danger, 1)
            self.danger_global = nn.Linear(cfg.hidden, cfg.danger)
            self.danger_out = nn.Conv1d(cfg.danger, DANGER_OUT, 1)
        self.value1 = nn.Linear(cfg.hidden, cfg.valueHidden)
        self.value2 = nn.Linear(cfg.valueHidden, 1)
        self.aux = nn.Linear(cfg.hidden, aux_dim) if aux_dim else None
        # Small initial logits: the first policy is close to uniform over legal moves.
        nn.init.normal_(self.policy.weight, std=0.01)
        nn.init.zeros_(self.policy.bias)
        nn.init.normal_(self.tile_policy.weight, std=0.01)
        nn.init.zeros_(self.tile_policy.bias)

    def forward(self, obs: torch.Tensor):
        """obs [B, obsDim] -> (logits [B, slots], value [B], aux [B, auxDim] or None)."""
        logits, value, aux, _ = self.outputs(obs)
        return logits, value, aux

    def outputs(self, obs: torch.Tensor):
        """forward, plus the danger head's raw output [B, 4, 34] (or None): could-win logits for
        next / across / prev, then the expected cost of discarding each kind now."""
        cfg = self.cfg
        p = cfg.planes * KINDS
        x = obs[:, :p].reshape(-1, cfg.planes, KINDS)
        g = obs[:, p:]
        x = F.relu(self.stem_conv(x) + self.stem_global(g)[:, :, None])
        for b in self.blocks:
            x = b(x)
        neck = F.relu(self.neck(x)).flatten(1)
        ge = F.relu(self.global_embed(g))
        z = F.relu(self.trunk(torch.cat([neck, ge], 1)))
        danger = None
        tile_in = x
        if cfg.danger:
            raw = self.danger_out(F.relu(self.danger_hidden(x) + self.danger_global(z)[:, :, None]))  # [B, 4, 34]
            danger = raw
            # The policy sees probabilities for the three could-win channels and the raw expected cost.
            tile_in = torch.cat([x, torch.sigmoid(raw[:, :3]), raw[:, 3:]], 1)
        t = self.tile_policy(tile_in)  # [B, 2, 34]
        zeros = torch.zeros_like(t[:, 0, :1])
        tile_term = torch.cat([t[:, 0], zeros, t[:, 1], zeros.expand(-1, cfg.slots - KONG0 - KINDS)], 1)
        logits = self.policy(z) + tile_term
        value = self.value2(F.relu(self.value1(z))).squeeze(-1)
        aux = self.aux(z) if self.aux is not None else None
        return logits, value, aux, danger


def adapt_state(state: dict, model: "HkNet") -> dict:
    """Weights from a network without a danger head, made to fit `model`: tensors that match are
    taken, the per-kind policy weights gain zero columns for the danger inputs (so the policy
    starts out exactly as it was), and everything else keeps `model`'s own initialisation."""
    out = {}
    for k, cur in model.state_dict().items():
        src = state.get(k)
        if src is None:
            out[k] = cur
        elif tuple(src.shape) == tuple(cur.shape):
            out[k] = src.to(cur.dtype)
        elif k == "tile_policy.weight" and src.shape[0] == cur.shape[0] and src.shape[1] < cur.shape[1]:
            w = torch.zeros_like(cur)
            w[:, : src.shape[1]] = src.to(cur.dtype)
            out[k] = w
        else:
            raise ValueError(f"{k}: can't fit {tuple(src.shape)} into {tuple(cur.shape)}")
    return out


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Illegal slots get a large negative logit (finite, so 0 * logp stays 0 in the entropy)."""
    return logits.float().masked_fill(mask == 0, -1e9)


def _align4(n: int) -> int:
    return (n + 3) & ~3


def _quantize_rows(w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rows = w.reshape(w.shape[0], -1).astype(np.float32)
    scale = (np.abs(rows).max(1) / 127).astype(np.float32)
    safe = np.where(scale > 0, scale, 1)
    q = np.clip(np.round(rows / safe[:, None]), -127, 127).astype(np.int8)
    return q, scale


def exported_state(model: HkNet) -> dict[str, np.ndarray]:
    return {k: v.detach().float().cpu().numpy() for k, v in model.state_dict().items() if not k.startswith("aux.")}


def export_net(model: HkNet, spec: dict, path: str, weights: str = "i8", meta: dict | None = None) -> int:
    """Write the network in the TS runtime's binary format; returns the file size in bytes.
    `weights` ('i8' | 'f16' | 'f32') is the storage of every tensor with 2+ dimensions."""
    entries, chunks, at = {}, [], 0

    def put(b: bytes) -> int:
        nonlocal at
        off = at
        chunks.append((off, b))
        at = _align4(at + len(b))
        return off

    for name, w in exported_state(model).items():
        dtype = weights if w.ndim >= 2 else "f32"
        e = {"shape": list(w.shape), "dtype": dtype}
        if dtype == "f32":
            e["offset"] = put(w.astype("<f4").tobytes())
        elif dtype == "f16":
            e["offset"] = put(w.astype("<f2").tobytes())
        else:
            q, scale = _quantize_rows(w)
            e["offset"] = put(q.tobytes())
            e["scale"] = put(scale.astype("<f4").tobytes())
        entries[name] = e
    header = {
        "format": NET_FORMAT,
        "encoderVersion": spec["encoderVersion"],
        "actionSpaceVersion": spec["actionSpaceVersion"],
        "config": asdict(model.cfg),
        "meta": meta or {},
        "tensors": entries,
    }
    js = json.dumps(header).encode("utf-8")
    start = _align4(8 + len(js))
    buf = bytearray(start + at)
    buf[0:4] = MAGIC
    buf[4:8] = struct.pack("<I", len(js))
    buf[8 : 8 + len(js)] = js
    for off, b in chunks:
        buf[start + off : start + off + len(b)] = b
    with open(path, "wb") as f:
        f.write(buf)
    return len(buf)


def read_net(path: str) -> tuple[dict, dict[str, torch.Tensor]]:
    """A network file's header and its tensors as float32 (dequantised) — what the TS runtime computes with."""
    with open(path, "rb") as f:
        buf = f.read()
    if buf[:4] != MAGIC:
        raise ValueError("not an HK network file")
    (n,) = struct.unpack("<I", buf[4:8])
    header = json.loads(buf[8 : 8 + n])
    start = _align4(8 + n)
    out = {}
    for name, t in header["tensors"].items():
        shape, size = t["shape"], int(np.prod(t["shape"]))
        base = start + t["offset"]
        if t["dtype"] == "f32":
            a = np.frombuffer(buf, "<f4", size, base)
        elif t["dtype"] == "f16":
            a = np.frombuffer(buf, "<f2", size, base).astype(np.float32)
        else:
            rows = shape[0]
            q = np.frombuffer(buf, np.int8, size, base).reshape(rows, -1).astype(np.float32)
            scale = np.frombuffer(buf, "<f4", rows, start + t["scale"])
            a = q * scale[:, None]
        out[name] = torch.from_numpy(np.array(a, dtype=np.float32).reshape(shape))
    return header, out


def load_net(path: str, aux_dim: int = 0) -> HkNet:
    header, tensors = read_net(path)
    model = HkNet(NetConfig(**header["config"]), aux_dim=aux_dim)
    model.load_state_dict(tensors, strict=False)
    return model


def quantized_copy(model: HkNet, weights: str = "i8") -> HkNet:
    """The network as the exported file computes it (weights rounded to int8 / f16)."""
    q = copy.deepcopy(model)
    with torch.no_grad():
        for name, p in q.named_parameters():
            if p.ndim < 2 or name.startswith("aux."):
                continue
            w = p.detach().float().cpu().numpy()
            if weights == "f16":
                d = w.astype(np.float16).astype(np.float32)
            elif weights == "i8":
                qq, scale = _quantize_rows(w)
                d = (qq.astype(np.float32) * scale[:, None]).reshape(w.shape)
            else:
                d = w
            p.copy_(torch.from_numpy(d).to(p.device, p.dtype))
    return q


def param_count(model: nn.Module, exported_only: bool = True) -> int:
    return sum(p.numel() for n, p in model.named_parameters() if not (exported_only and n.startswith("aux.")))
