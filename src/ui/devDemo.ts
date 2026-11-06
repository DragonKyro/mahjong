// Dev-only (`npm run dev`, never in a build): `?demo=…` fast-forwards a solo
// match so a given moment of the table can be looked at (and screenshotted).
//   ?demo=40     40 actions in, then hand back to you
//   ?demo=claim  until you're offered a claim
//   ?demo=end    until the first hand ends
//   ?demo=over   until the match is over
//   ?demo=charleston  (American) at the Charleston
//   &variant=hk|taiwan|riichi|american, &seed=N for a fixed deal

import { chooseAction } from '@/core/ai';
import { applyAction, createMatch, pendingSeats, type MatchState } from '@/core/engine';
import { defaultRulesFor, type VariantId } from '@/core/variants';
import { DEFAULT_HK_RULES } from '@/core/variants/hk';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';

export function runDemo(params: URLSearchParams): void {
  const mode = params.get('demo') ?? '30';
  if (mode === 'lobby') {
    const me = useNet.getState().uuid;
    useNet.setState({
      status: 'room',
      code: 'K7PX',
      people: [
        { uuid: me, name: 'Kyle' },
        { uuid: 'g1', name: 'Ada' },
      ],
      chat: [
        { id: '1', byUuid: '', name: '', text: 'Ada joined.', ts: 0, kind: 'system' },
        { id: '2', byUuid: 'g1', name: 'Ada', text: 'ready when you are!', ts: 0, kind: 'user' },
      ],
      lobby: {
        hostUuid: me,
        seats: [
          { kind: 'human', uuid: me, name: 'Kyle' },
          { kind: 'human', uuid: 'g1', name: 'Ada' },
          { kind: 'ai', level: 'hard', name: 'Chan' },
          { kind: 'open' },
        ],
        rulesJson: JSON.stringify(DEFAULT_HK_RULES),
        variant: 'hk',
        match: null,
        matchCount: 0,
      },
    });
    return;
  }
  const seed = Number(params.get('seed') ?? 12345);
  const variant = (params.get('variant') ?? 'hk') as VariantId;
  let s: MatchState = createMatch({
    variant,
    rules: variant === 'hk' ? DEFAULT_HK_RULES : defaultRulesFor(variant),
    seed,
    seats: [
      { name: 'You', ai: false },
      { name: 'Wong', ai: true, level: 'normal' },
      { name: 'Chan', ai: true, level: 'hard' },
      { name: 'Lee', ai: true, level: 'easy' },
    ],
  });
  const steps = Number(mode);
  const done = (x: MatchState, n: number): boolean => {
    if (mode === 'claim') return x.hand.phase === 'claim' && x.hand.claim!.responses[0] === null && x.hand.claim!.options[0]!.length > 0;
    if (mode === 'charleston') return x.hand.phase === 'charleston' && pendingSeats(x).includes(0);
    if (mode === 'riichi') return x.hand.riichi.some((r) => r?.paid) && x.hand.phase === 'act' && x.hand.turn === 0;
    if (mode === 'end') return x.hand.phase === 'end';
    if (mode === 'over') return x.over;
    return n >= steps && pendingSeats(x).includes(0) && x.hand.phase === 'act';
  };
  for (let n = 0; n < 20000 && !done(s, n); n++) {
    const seat = pendingSeats(s)[0];
    if (seat === undefined) break;
    const a = chooseAction(s, seat);
    if (!a) break;
    s = applyAction(s, a);
  }
  useGame.setState({ match: s, mode: 'solo', mySeat: 0, aiDriver: params.has('live') });
}
