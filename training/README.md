# Training a neural HK agent

Status: **architecture, encoding, action space and the env bridge are built and tested; no training has run yet.** The training scheme below is the plan.

```bash
conda env create -f training/environment.yml   # once (the same `train` env card-collecting uses)
conda activate train                           # needed: it puts the env's CUDA / cuDNN DLLs on PATH
npm run train:build                            # bundle the env server → training/dist/hk-env.mjs
python -m pytest training/hk -q                # TS ↔ PyTorch parity, spec, rollouts
```

Running `envs/train/python.exe` directly, without activating the env, leaves `Library/bin` off PATH. cuDNN then fails to load (`Cannot load symbol cudnnGetVersion`).

## Pieces

| File | What |
|---|---|
| `src/core/nn/hkEncode.ts` | `seatView` (what one seat may know) → `encode` (tile planes + globals). `ENCODER_VERSION`. |
| `src/core/nn/hkActions.ts` | The 78 action slots, `legalMask`, `decodeSlot`, `slotOf`. `ACTION_SPACE_VERSION`. |
| `src/core/nn/hkNet.ts` | The forward pass in TS (browser / Node), the weight format `mahjong/hknet@1`, masked argmax / sampling, `netAction`. |
| `src/core/nn/nn.test.ts` | Mask = engine legality (brute force); scrambling hidden info leaves the observation unchanged; a random net plays legally. |
| `training/hk/vec-env.ts`, `env-server.ts` | Batched matches over stdio (JSON lines, base64 arrays). |
| `training/hk/model.py` | The same network in PyTorch, plus aux heads; `export_net` writes the TS format. |
| `training/hk/env_client.py`, `test_model.py` | Python client; parity and rollout tests. |

## Observation (encoder v1)

7,780 floats: 201 planes × 34 tile kinds + 946 globals. About 6% are non-zero. All seats are relative: me, next (下家), across, prev (上家).

- **My tiles:** concealed counts (4 threshold planes), the drawn tile, and the tile on offer in a claim window.
- **Every player:**
  - meld tiles, by type (pong, exposed / concealed / added kong, chow), plus the claimed tile and one plane per meld slot;
  - each slot's metadata: type, who fed it, and when;
  - everything they discarded (4 threshold planes), what is still in their pond, their 摸切 discards and their last discard;
  - their last 24 discards in order, one plane each, with 摸切 / called / age / time flags;
  - bonus tiles (all 8), seat flowers, full sets, concealed tile count, discards made, and open / concealed status.
- **Table:** unseen copies of each kind from my view (4 planes), and the faan a pong of each kind is worth to each seat.
- **Match:**
  - seat and prevailing wind, dealer, hand of the round, hands left, all-last, 連莊 streak;
  - scores, ranks and leads;
  - phase, whose turn, how the turn player drew, kong chain;
  - claim kind and source;
  - live tiles left (with last-tile and ≤5-tile flags for 海底 and 五子包生), replacement draws, discard and call counts, no-calls-yet;
  - every house rule and the whole faan table, so one network can play any rule set.
- **Derived from the same view:**
  - shanten;
  - per discard: the shanten it leaves, whether it's best, and its acceptance;
  - waits, and the faan of a win on each wait by discard or by self-draw (0 if it can't reach the minimum);
  - tiles that improve the hand;
  - the shanten after each offered pong / kong / chow;
  - the faan and points of the win on offer;
  - the legal-action mask.

Hidden information is excluded by construction. `seatView` never reads the wall order, another seat's concealed tiles, its drawn tile, or its claim answers. The scramble test enforces this.

## Actions (action space v1)

78 slots cover every HK decision. Flowers, 八仙過海 and 七搶一 are automatic, and HK has no riichi, abort or Charleston.

| Slots | Action |
|---|---|
| 0–33 | discard a tile of kind *k* from the hand |
| 34 | 摸切: discard the tile just drawn (opponents can see the difference) |
| 35–68 | kong kind *k* (concealed, or added to a pong) |
| 69 | 自摸 self-drawn win |
| 70 | pass |
| 71 | 食糊 / 搶槓 win on the discard or the robbed kong |
| 72 | pong |
| 73 | kong the discard |
| 74–76 | chow, with the discard as the low / middle / high tile |
| 77 | ready (confirm the hand result; never asked of the net) |

## Network

A 1-D ResNet over the 34 kinds, with a global-feature branch.

1. **Stem:** a conv over the planes, plus a projection of the globals added per channel → 128 channels.
2. **Body:** 6 residual blocks (conv3 → relu → conv3, starting as the identity, no normalisation).
3. **Trunk:** a 1×1 conv down to 32 channels, flattened, joined with a 256-unit global embedding → 512.
4. **Heads:**
   - policy: 78 logits from the trunk, plus a per-kind term on the discard and kong slots;
   - value: 128 → 1;
   - aux (training only): each opponent's concealed tiles, whether they are ready, and their waits.

Size and measured speed:

| | |
|---|---|
| Parameters exported | 1.83M (9.8 MB as base64 float32) |
| TS forward | ~32 ms per decision |
| RTX A2000, batch 1,024 | 15 ms inference, 46 ms per training step |
| Env server, per Node process | ~1,500 decisions / s (self-play), ~1,000 with heuristic seats |

## Training plan (not started)

1. **Behaviour cloning warm start.**
   - Record heuristic-AI self-play (normal / hard) through the env: observation, mask, and `slotOf(action)`.
   - Train policy cross-entropy, value (the hand's score change) and the aux heads on a few million decisions.
   - Why: random play almost never reaches the 3-faan minimum, so PPO from scratch gets almost no reward signal.
2. **PPO self-play.**
   - **Setup:** Node env workers (cores − 2, 32–64 matches each) feed a GPU learner that batches every request.
   - **Opponents:** about 50% pure self-play, 30% a pool of the last ~20 checkpoints, 20% the heuristic AI (normal / hard), so the policy can't drift into beating only itself.
   - **Reward:**
     - each hand's score change / 500, plus a small final-rank bonus;
     - γ = 1, GAE λ 0.95;
     - start with one hand per episode (lower variance), then move to whole matches so it learns all-last play.
   - **PPO settings:** rollouts of 128, minibatches of 4,096, 3–4 epochs, clip 0.2, entropy 0.01 → 0.003, Adam 3e-4 with cosine decay, grad-norm clip 1.0.
   - **Aux losses:** the aux heads (opponents' hands / ready / waits) stay on as auxiliary losses, which shapes the trunk around reading the table.
   - **Optional later:** an oracle teacher with hidden features, distilled into this net (Suphx style).
3. **Evaluation.**
   - Paired-seed duels: every seed played twice with seats swapped, as in `src/core/ai/bench.test.ts`.
   - Every N updates, against heuristic normal / hard and past checkpoints.
   - Tracked: points per match, win / deal-in rates, average faan, an Elo ladder.
4. **Ship.**
   - Export → `public/` (float16 would halve the file).
   - Load it lazily as a "neural" HK AI level through `netAction`.

Planned speed-ups:
- send observations sparsely (only ~6% are non-zero) or in binary rather than base64 JSON;
- run several env processes per learner.

Not built yet: `train.py` (BC + PPO), the teacher-data recorder, `evaluate.py`, and the UI hook.
