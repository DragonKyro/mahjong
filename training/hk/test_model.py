"""Checks that the Python side matches the TS side.

    conda activate train
    npm run train:build
    python -m pytest training/hk -q
"""

from __future__ import annotations

import json
import os
import tempfile

import numpy as np
import pytest
import torch

from env_client import EnvClient
from model import HkNet, NetConfig, export_net, load_net, masked_logits, param_count, quantized_copy, read_net
import train


@pytest.fixture(scope="module")
def env():
    with EnvClient() as e:
        yield e


def small(spec, **over):
    return NetConfig.from_spec(spec, channels=32, blocks=2, neck=8, globalHidden=32, hidden=64, valueHidden=16, **over)


def test_spec_matches_the_model(env):
    spec = env.spec
    assert spec["obsDim"] == spec["planes"] * spec["kinds"] + spec["globalDim"]
    assert len(spec["slotNames"]) == spec["numSlots"] == 78
    model = HkNet(NetConfig.from_spec(spec), aux_dim=spec["auxDim"])
    logits, value, aux = model(torch.zeros(2, spec["obsDim"]))
    assert logits.shape == (2, 78) and value.shape == (2,) and aux.shape == (2, spec["auxDim"])
    print(f"\nexported parameters: {param_count(model):,}")


def test_sparse_batches_rebuild_the_observations(env):
    b = env.reset(numEnvs=6, seed=1, seats=["a", "b", "c", "d"], aux=True)
    x = b.dense(env.spec["obsDim"])
    assert x.shape == (b.n, env.spec["obsDim"]) and b.aux.shape == (b.n, env.spec["auxDim"])
    assert (b.mask.sum(1) >= 2).all()
    assert 0.01 < (x != 0).mean() < 0.2


@pytest.mark.parametrize("weights", ["f32", "i8"])
def test_ts_and_torch_agree(env, weights):
    """Random weights, real observations: the TS forward pass on the exported file equals PyTorch's on the same (dequantised) weights."""
    spec = env.spec
    torch.manual_seed(0)
    model = HkNet(small(spec))
    with torch.no_grad():
        for p in model.parameters():
            p.normal_(0, 0.05)
    b = env.reset(numEnvs=8, seed=3, seats=["learner", "normal", "learner", "normal"])
    obs = b.dense(spec["obsDim"])
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "net.hknet")
        size = export_net(model, spec, path, weights)
        ts_logits, ts_value = env.ts_forward(path, obs)
        header, _ = read_net(path)
        as_file = load_net(path)
    assert header["format"] == "mahjong/hknet@2"
    with torch.no_grad():
        logits, value, _ = as_file(torch.from_numpy(obs))
    np.testing.assert_allclose(ts_logits, logits.numpy(), rtol=1e-4, atol=1e-4)
    np.testing.assert_allclose(ts_value, value.numpy(), rtol=1e-4, atol=1e-4)
    if weights == "i8":
        assert size < 0.3 * param_count(model) * 4 + 8192


def test_int8_file_plays_like_the_float_network(env):
    spec = env.spec
    torch.manual_seed(1)
    model = HkNet(NetConfig.from_spec(spec)).eval()
    with torch.no_grad():
        for p in model.parameters():
            p.normal_(0, 0.03)
    b = env.reset(numEnvs=32, seed=4, seats=["a", "b", "c", "d"])
    obs = torch.from_numpy(b.dense(spec["obsDim"]))
    mask = torch.from_numpy(b.mask.copy())
    q = quantized_copy(model, "i8")
    with torch.no_grad():
        a = masked_logits(model(obs)[0], mask)
        c = masked_logits(q(obs)[0], mask)
    assert (a.argmax(-1) == c.argmax(-1)).float().mean() > 0.95


def test_training_smoke(tmp_path):
    """Two imitation updates, two self-play updates (with an evaluation and an export): the whole loop runs."""
    if not torch.cuda.is_available():
        pytest.skip("needs the GPU")
    args = train.parse_args(
        [
            "--name", "smoke", "--out", str(tmp_path), "--no-build",
            "--updates", "4", "--bc-updates", "2", "--workers", "3", "--envs", "8", "--groups", "2",
            "--samples", "1024", "--minibatch", "512", "--epochs", "2",
            "--eval-every", "4", "--eval-matches", "2", "--export-every", "2", "--ckpt-every", "2",
            "--channels", "32", "--blocks", "2", "--hidden", "64",
        ]
    )
    t = train.Trainer(args)
    t.run()
    run = tmp_path / "smoke"
    lines = (run / "metrics.jsonl").read_text().strip().splitlines()
    assert len(lines) == 4
    assert (run / "policies" / "update_00004.hknet").exists()
    assert (run / "ckpt" / "latest.pt").exists()
    # Self-play ran with deal copies (the default), and the averaged weights were exported and measured.
    ppo = [json.loads(l) for l in lines if json.loads(l)["phase"] == "ppo"]
    assert all(m["deal_share"] > 0 for m in ppo[1:])
    assert (run / "policies" / "update_00004_ema.hknet").exists()
    evals = [json.loads(l) for l in (run / "evals.jsonl").read_text().strip().splitlines()]
    assert sorted(e["vs"] for e in evals) == ["bc", "ema", "heuristic"]
    ck = torch.load(run / "ckpt" / "latest.pt", map_location="cpu", weights_only=False)
    assert ck["ema"] is not None


def test_deal_baseline_advantage():
    """A seat's decisions in a replayed hand get (return-to-go − the other copies' mean); carried decisions keep their place."""
    buf = train.Buffer(32, 4, 3, 0, torch.device("cpu"), torch.float32)
    obs, mask = torch.zeros(1, 4), torch.ones(1, 3, dtype=torch.bool)
    a = (0, 0, 0)
    b = (0, 1, 0)
    for _ in range(3):
        buf.add([a], obs, mask, None, [0], [0.0], [0.0])
    buf.add([b], obs, mask, None, [0], [0.0], [0.0])
    buf.reward_to(a, 0.5)  # an intra-hand reward, owed to a's newest decision
    buf.end(a, 1.0, baseline=0.25)
    assert buf.complete[:3].all() and buf.done[2]
    np.testing.assert_allclose(buf.deal_adv[:3], [1.25, 1.25, 1.25])  # 0.5 + 1.0 − 0.25 for every step
    assert buf.has_deal[:3].all() and not buf.has_deal[3]
    # b's hand is still going: its decision moves to the next buffer alone and is completed there.
    nxt = train.Buffer(32, 4, 3, 0, torch.device("cpu"), torch.float32)
    buf.carry_into(nxt)
    assert nxt.n == 1 and nxt.open == {b: 0} and nxt.episode == {b: [0]}
    nxt.add([b], obs, mask, None, [0], [0.0], [0.0])
    nxt.end(b, -2.0, baseline=-1.0)
    np.testing.assert_allclose(nxt.deal_adv[:2], [-1.0, -1.0])
    # No baseline (no copies): plain GAE only.
    nxt.add([a], obs, mask, None, [0], [0.0], [0.0])
    nxt.end(a, 1.0)
    assert not nxt.has_deal[2]
