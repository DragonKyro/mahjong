# Training a neural HK agent

Everything runs locally:
- Node worker processes play matches with the real engine;
- one Python process batches their decisions on the GPU and trains.

The browser isn't involved.

```bash
conda env create -f training/environment.yml   # once (the same `train` env card-collecting uses)
conda activate train                           # needed: puts the env's CUDA / cuDNN DLLs on PATH
npm run train:build                            # bundle the env server → training/dist/hk-env.mjs (train.py also does it)
python -m pytest training/hk -q                # TS ↔ PyTorch parity, int8 export, env protocol, a training smoke run

python training/hk/train.py --name hk1                  # 5,000 updates: 100 imitation + 4,900 self-play
python training/hk/train.py --resume training/runs/hk1  # carry on after a stop (Ctrl-C saves a checkpoint)
```

Running `envs/train/python.exe` without activating the env leaves `Library/bin` off PATH. cuDNN then fails to load (`Cannot load symbol cudnnGetVersion`).

Outputs go to `training/runs/<name>/`:

| File | What |
|---|---|
| `progress.md` | The readable report, rewritten every 100 updates and after each evaluation: position and ETA, results against the heuristic and against the update-100 imitation snapshot, training stats per 100 updates |
| `train.log` | The console, one line per update (when run as `... > train.log 2>&1`) |
| `metrics.jsonl` | One line per update: losses, entropy, KL, clip fraction, explained variance, win / deal-in rates, timings |
| `evals.jsonl` | The periodic evaluations |
| `policies/update_NNNNN.hknet`, `latest.hknet` | Compact networks the TS runtime loads (`loadHkNet`) |
| `ckpt/latest.pt` | Model, optimiser, snapshot pool, for `--resume` |
| `config.json` | The run's settings |

## Fair play

The network only ever sees what its seat could see at a real table.

- **Inputs.**
  - `seatView(state, seat)` (`src/core/nn/hkEncode.ts`) copies only what that seat may know: its own tiles and drawn tile, and the public table.
  - It never reads the wall (the tiles to come, the replacement tiles), another player's concealed tiles (starting hand or later), another seat's drawn tile, or another seat's claim answer.
  - `encode` reads nothing but that view.
  - `nn.test.ts` shuffles all of that hidden state, including the other seats' claim options and answers, on hundreds of real positions. It asserts the view and the encoding are bit-for-bit unchanged.
- **Claims are simultaneous.** In a claim window the env asks every seat still deciding at once, from the same state, and applies all the answers afterwards (`vec-env.test.ts` checks this). Asking seats one by one would leak information: the engine closes a window early once nobody left can outrank the best answer, so being asked at all would reveal that the others passed.
- **The value head** reads the same view as the policy. There is no privileged critic.
- **Aux heads (training only):**
  - They learn to predict each opponent's concealed tiles, readiness and waits from the seat's own view, scored against the real hidden hands.
  - Those hands are labels, never inputs. The aux heads aren't exported and never influence a decision. This is learning to read the table, as a player does when hands are revealed.
  - `--aux-coef 0` switches them off.
- **The heuristic teacher** (imitation phase only) reads only its own hand and public information.

## Schedule

1. **Updates 1–100: imitation.**
   - Every seat is the heuristic AI (normal). Each of its decisions is a training example: cross-entropy towards its move, plus the value head on the hand's outcome, plus the aux heads.
   - Without this warm start, self-play has no reward to learn from: random play almost never reaches the 3-faan minimum.
   - The log shows `acc`, the agreement with the teacher on data the network hasn't trained on yet.
2. **Updates 101–5,000: PPO self-play, with no heuristic involvement.** No imitation loss, no KL to the teacher, no heuristic opponents.
   - **Opponents:** 75% of the workers play four copies of the current network. The rest play two seats against one of its own past snapshots, taken every 20 updates (the last 20 are kept; the update-100 snapshot starts the pool).
   - **Reward:** each hand's score change / 32 points. Episodes are hands, with γ = 1 and GAE λ = 0.95.
   - **Optimisation:**
     - 16,384 decisions per update, 3 epochs, minibatch 4,096;
     - clip 0.2, early stop past 1.5 × the 0.03 KL target, Huber value loss;
     - entropy bonus 0.01 → 0.002, Adam 3e-4 with cosine decay to 3e-5, grad clip 1.0, aux weight 0.1.
3. **Evaluation (measurement only; it never feeds training).**
   - Every 100 updates: 64 paired-seed matches (each seed twice, seats swapped) against the heuristic AI, and against the update-100 imitation snapshot. The second measures how far self-play has moved past the starting point.
   - The network plays greedily.
   - **Points per match** (network seats minus opponent seats) is the headline. It's also what training maximises: the reward is each hand's score change, not whether the hand was won.
   - Where the points come from, per side:
     - win %, points per win, average winning faan, and the share of wins at 6+ faan;
     - deal-in %, and points lost per deal-in;
     - points paid on the other side's wins: self-draw shares, 半銃 bystander shares, and 包. This is where denying big hands shows up.
   - The update-100 snapshot is also played against the heuristic once, to give the imitation baseline.
   - On `--resume`, the restored network is evaluated right away.

## Speed

Measured on this machine (Xeon w5-2445 10C/20T, RTX A2000 12 GB): about **3 s per update**, so 5,000 updates take about 4 hours. Where the speed comes from:

- **Env workers:** 16 Node processes × 48 matches (`vec-env.ts`), served in 4 groups, so the GPU decides for one group while the others play.
- **Faster engine and encoder** (results identical, guarded by tests):
  - shanten folds its groups through a tiny table;
  - draws that can't help are skipped;
  - the engine shares the immutable config and history between states instead of copying them.
- **Sparse binary transport:** an observation is 7,780 floats but only ~6% non-zero. Workers send (index, value) pairs as raw bytes after a JSON header, and the GPU scatters them back.
- **bf16 everywhere:** autocast for training (2.4× faster than fp32 here), and a bf16 acting copy of the network replayed through CUDA graphs, one launch per batch.
- **Overlap:** update k trains in a background thread on its own CUDA stream while update k+1 is collected. The policy is at most one update behind; every decision stores the log-probability of the policy that made it, so PPO's ratios stay exact.

Knobs:
- `--workers` and `--envs` set the CPU side.
- `--samples` and `--epochs` set the GPU work per update.
- `--precision fp16|tf32` is available if bf16 misbehaves.

## Network and files

| File | What |
|---|---|
| `src/core/nn/hkEncode.ts` | `seatView` → `encode`: 201 tile planes × 34 kinds + 946 globals. `ENCODER_VERSION`. |
| `src/core/nn/hkActions.ts` | 78 action slots, `legalMask`, `decodeSlot`, `slotOf`. `ACTION_SPACE_VERSION`. |
| `src/core/nn/hkNet.ts` | The forward pass in TS, the `.hknet` file format (`writeHkNet` / `readHkNet`), masked sampling, `netAction`. |
| `training/hk/model.py` | The same network in PyTorch, plus aux heads; `export_net` / `read_net` / `quantized_copy`. |
| `training/hk/vec-env.ts`, `env-server.ts` | Batched matches and their stdio protocol. |
| `training/hk/env_client.py` | The Python side of that protocol. |
| `training/hk/train.py` | The trainer. |
| `training/hk/test_model.py` | The Python tests. |

**The network.** A 1-D ResNet over the 34 tile kinds:
1. Stem: conv3 over the planes, plus the globals projected per channel → 128 channels.
2. 6 residual blocks, which start as the identity; no normalisation.
3. A 1×1 conv down to 32 channels, flattened, joined with a 256-unit global embedding → 512.
4. Heads: policy (78 logits, plus a per-kind term on the discard and kong slots), value, and aux (training only).

1.83M exported parameters.

**The `.hknet` file.**
- **Layout:** `'HKN2'`, then a JSON header (shapes, dtypes, offsets, config, versions), then the data.
- **Weights:** int8, with one float32 scale per output row. Biases are float32.
- **Size:** 1.85 MB, against 7.3 MB as float32 and 9.8 MB as the earlier base64 JSON.
- **Learning is unaffected:** training keeps float32 master weights, and only the exported file is rounded. Every export logs how closely the int8 file plays like the float network on that update's positions (`int8_agreement`, `int8_kl`). On a test network: 100% the same moves, KL ~1e-6.
- **Other storage:** `writeHkNet` / `export_net` can also write f16 or f32.
