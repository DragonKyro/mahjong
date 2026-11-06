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

`export_net` writes the JSON the TS runtime loads (`loadHkNet`).
"""

from __future__ import annotations

import base64
import json
from dataclasses import asdict, dataclass

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

KINDS = 34
DISCARD0 = 0
KONG0 = 35
NET_FORMAT = "mahjong/hknet@1"


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
        self.tile_policy = nn.Conv1d(c, 2, 1)
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
        t = self.tile_policy(x)  # [B, 2, 34]
        zeros = torch.zeros_like(t[:, 0, :1])
        tile_term = torch.cat([t[:, 0], zeros, t[:, 1], zeros.expand(-1, cfg.slots - KONG0 - KINDS)], 1)
        logits = self.policy(z) + tile_term
        value = self.value2(F.relu(self.value1(z))).squeeze(-1)
        aux = self.aux(z) if self.aux is not None else None
        return logits, value, aux


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return logits.masked_fill(mask == 0, -1e9)


def _b64(t: torch.Tensor) -> str:
    return base64.b64encode(t.detach().cpu().float().contiguous().numpy().astype("<f4").tobytes()).decode("ascii")


def export_net(model: HkNet, spec: dict, path: str, meta: dict | None = None) -> None:
    """Write the network in the TS runtime's format (aux heads left out)."""
    tensors = {
        name: {"shape": list(t.shape), "data": _b64(t)}
        for name, t in model.state_dict().items()
        if not name.startswith("aux.")
    }
    doc = {
        "format": NET_FORMAT,
        "encoderVersion": spec["encoderVersion"],
        "actionSpaceVersion": spec["actionSpaceVersion"],
        "config": asdict(model.cfg),
        "tensors": tensors,
        "meta": meta or {},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)


def param_count(model: nn.Module, exported_only: bool = True) -> int:
    return sum(p.numel() for n, p in model.named_parameters() if not (exported_only and n.startswith("aux.")))


def decode_f32(s: str, cols: int) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype="<f4").reshape(-1, cols)
