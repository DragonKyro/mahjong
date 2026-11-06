"""Checks that the Python side matches the TS side (no training here).

    conda activate train
    npm run train:build
    python -m pytest training/hk -q
"""

from __future__ import annotations

import os
import tempfile

import numpy as np
import pytest
import torch

from env_client import EnvClient
from model import HkNet, NetConfig, export_net, masked_logits, param_count


@pytest.fixture(scope="module")
def env():
    with EnvClient() as e:
        yield e


def test_spec_matches_the_model(env):
    spec = env.spec
    assert spec["obsDim"] == spec["planes"] * spec["kinds"] + spec["globalDim"]
    assert len(spec["slotNames"]) == spec["numSlots"] == 78
    assert len(spec["featureLayout"]["planes"]) == spec["planes"]
    assert len(spec["featureLayout"]["globals"]) == spec["globalDim"]
    model = HkNet(NetConfig.from_spec(spec), aux_dim=spec["auxDim"])
    logits, value, aux = model(torch.zeros(2, spec["obsDim"]))
    assert logits.shape == (2, 78) and value.shape == (2,) and aux.shape == (2, spec["auxDim"])
    print(f"\nexported parameters: {param_count(model):,}")


def test_ts_and_torch_agree(env):
    """Random weights (residual branches included), real observations: the TS forward pass equals PyTorch's."""
    spec = env.spec
    torch.manual_seed(0)
    model = HkNet(NetConfig.from_spec(spec, channels=32, blocks=2, neck=8, globalHidden=32, hidden=64, valueHidden=16))
    with torch.no_grad():
        for p in model.parameters():
            p.normal_(0, 0.05)
    batch = env.reset(numEnvs=8, seed=3, seats=["learner", "normal", "learner", "normal"])
    obs = batch.obs
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "net.json")
        export_net(model, spec, path)
        ts_logits, ts_value = env.ts_forward(path, obs)
    with torch.no_grad():
        logits, value, _ = model(torch.from_numpy(obs.copy()))
    np.testing.assert_allclose(ts_logits, logits.numpy(), rtol=1e-4, atol=1e-4)
    np.testing.assert_allclose(ts_value, value.numpy(), rtol=1e-4, atol=1e-4)


def test_rollout_with_the_untrained_net(env):
    """Masked sampling from the initial policy plays legal moves until matches finish."""
    spec = env.spec
    model = HkNet(NetConfig.from_spec(spec, channels=16, blocks=1, hidden=64), aux_dim=spec["auxDim"])
    batch = env.reset(numEnvs=8, seed=5, seats=["learner", "normal", "normal", "normal"], aux=True)
    rng = np.random.default_rng(0)
    episodes = []
    for _ in range(3000):
        assert batch.mask.sum(1).min() >= 2  # forced moves are auto-played
        assert batch.aux is not None and batch.aux.shape == (len(batch.env), spec["auxDim"])
        with torch.no_grad():
            logits, _, _ = model(torch.from_numpy(batch.obs.copy()))
            probs = torch.softmax(masked_logits(logits, torch.from_numpy(batch.mask.copy())), -1).numpy()
        actions = [rng.choice(len(p), p=p / p.sum()) for p in probs]
        batch = env.step(actions)
        episodes += batch.episodes
        if len(episodes) >= 2:
            break
    assert len(episodes) >= 2
    for ep in episodes:
        assert sum(ep["scores"]) == 4 * 500 and ep["hands"] >= 4
