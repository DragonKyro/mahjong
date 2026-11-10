// House-rules summaries and editors, one per variant (solo setup and the online lobby).

import type { ReactNode } from 'react';
import { defaultRulesFor, type AnyRules, type VariantId } from '@/core/variants';
import type { AmericanRules } from '@/core/variants/american';
import type { HkRules } from '@/core/variants/hk';
import type { RiichiRules } from '@/core/variants/riichi';
import type { TaiwanRules } from '@/core/variants/taiwan';

export function rulesSummary(variant: VariantId, rules: AnyRules): string[] {
  switch (variant) {
    case 'hk': {
      const r = rules as HkRules;
      const bits = [
        `${r.minFaan}-faan minimum`,
        `${r.maxFaan}-faan limit`,
        r.spicy === 'half' ? 'half-spicy' : 'full-spicy',
        r.payment === 'halfGun' ? '半銃 discarder pays half' : '全銃 discarder pays all',
        r.rounds === 1 ? 'East round only' : r.rounds === 2 ? 'East & South rounds' : 'full four rounds',
      ];
      if (r.sevenPairs) bits.push('seven pairs');
      if (r.multiWin) bits.push('multiple winners');
      return bits;
    }
    case 'taiwan': {
      const r = rules as TaiwanRules;
      return [
        `底 ${r.base} · 台 ${r.perTai}`,
        r.minTai ? `${r.minTai}-tai minimum` : 'no minimum',
        r.maxTai ? `${r.maxTai}-tai cap` : 'no cap',
        `${r.reserve} tiles left in the wall`,
        r.rounds === 1 ? 'East round only' : r.rounds === 2 ? 'two rounds' : 'four rounds',
      ];
    }
    case 'riichi': {
      const r = rules as RiichiRules;
      return [
        r.rounds === 1 ? '東風戦 East game' : '東南戦 East–South game',
        `${r.startingScore.toLocaleString()} start`,
        r.akaDora ? 'red fives' : 'no red fives',
        r.kuitan ? 'open tanyao' : 'closed tanyao only',
        r.multiRon === 'head' ? 'head bump' : r.multiRon === 'double' ? 'double ron' : 'multiple ron',
      ];
    }
    case 'american': {
      const r = rules as AmericanRules;
      return [`${r.hands} hands`, r.jokerless ? 'jokerless ×2' : 'no jokerless bonus', r.secondCharleston ? 'second Charleston' : 'one Charleston', r.courtesyPass ? 'courtesy pass' : 'no courtesy pass'];
    }
  }
}

export function RulesSummary({ variant, rules, onEdit, editing }: { variant: VariantId; rules: AnyRules; onEdit?: () => void; editing?: boolean }) {
  return (
    <div className="rules-summary">
      <span>
        <b>House rules:</b> {rulesSummary(variant, rules).join(' · ')}
      </span>
      {onEdit && (
        <button type="button" className="btn small ghost" onClick={onEdit}>
          {editing ? 'Done' : 'Change'}
        </button>
      )}
    </div>
  );
}

interface EditorProps<R> {
  rules: R;
  onChange: (r: R) => void;
  readOnly?: boolean;
}

function Select<R, K extends keyof R>({ p, k, label, options }: { p: EditorProps<R>; k: K; label: string; options: [R[K], string][] }) {
  const i = options.findIndex(([v]) => v === p.rules[k]);
  return (
    <label className="row">
      {label}
      <select value={Math.max(0, i)} onChange={(e) => p.onChange({ ...p.rules, [k]: options[Number(e.target.value)]![0] })}>
        {options.map(([, text], n) => (
          <option key={n} value={n}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check<R, K extends keyof R>({ p, k, label, disabled }: { p: EditorProps<R>; k: K; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="row check">
      <input type="checkbox" checked={!!p.rules[k]} disabled={p.readOnly || disabled} onChange={(e) => p.onChange({ ...p.rules, [k]: e.target.checked })} />
      {label}
    </label>
  );
}

function NumberField<R, K extends keyof R>({ p, k, label, step = 1 }: { p: EditorProps<R>; k: K; label: string; step?: number }) {
  return (
    <label className="row">
      {label}
      <input type="number" min={0} step={step} value={Number(p.rules[k])} onChange={(e) => p.onChange({ ...p.rules, [k]: Math.max(0, Number(e.target.value) || 0) })} />
    </label>
  );
}

function HkEditor(p: EditorProps<HkRules>) {
  return (
    <>
      <Select p={p} k="minFaan" label="Minimum to win" options={[0, 1, 2, 3, 4, 5].map((n) => [n, n === 0 ? '0 (雞糊 allowed)' : `${n} faan`])} />
      <Select p={p} k="maxFaan" label="Limit (爆棚)" options={[8, 10, 13].map((n) => [n, `${n} faan`])} />
      <Select p={p} k="spicy" label="Points" options={[['half', '半辣 half-spicy'], ['full', '全辣 full-spicy']]} />
      <Select p={p} k="payment" label="Discard win" options={[['halfGun', '半銃 discarder pays half'], ['fullGun', '全銃 discarder pays all']]} />
      <Select p={p} k="rounds" label="Match length" options={[[1, '東風 East round'], [2, '東南 two rounds'], [4, '全莊 all four winds']]} />
      <NumberField p={p} k="startingScore" label="Starting points" step={50} />
      <Check p={p} k="liability" label="包 liability: whoever feeds a big hand pays for everyone" disabled={p.rules.payment !== 'halfGun'} />
      <Check p={p} k="flowerHands" label="八仙過海 / 七搶一 flower wins" />
      <Check p={p} k="dealerStaysOnDraw" label="Dealer keeps the deal after a draw" />
      <Check p={p} k="robConcealedKong" label="十三么 may rob a concealed kong" />
      <Check p={p} k="sevenPairs" label="七對子 seven pairs (4 faan)" />
      <Check p={p} k="multiWin" label="一炮多響 several players may win on one discard" />
    </>
  );
}

function TaiwanEditor(p: EditorProps<TaiwanRules>) {
  return (
    <>
      <NumberField p={p} k="base" label="底 base stake" step={10} />
      <NumberField p={p} k="perTai" label="台 per tai" step={5} />
      <Select p={p} k="minTai" label="Minimum to win" options={[0, 1, 2, 3].map((n) => [n, n === 0 ? 'none (屁胡 allowed)' : `${n} tai`])} />
      <Select p={p} k="maxTai" label="Hand cap" options={[[0, 'none'], [8, '8 tai'], [16, '16 tai'], [24, '24 tai']]} />
      <Select p={p} k="reserve" label="Tiles left in the wall" options={[[16, '16 (留16張)'], [8, '8'], [0, 'none']]} />
      <Select p={p} k="rounds" label="Match length" options={[[1, '東風 East round'], [2, 'two rounds'], [4, 'all four winds (一將)']]} />
      <NumberField p={p} k="startingScore" label="Starting points" step={100} />
      <Check p={p} k="dealerStaysOnDraw" label="Dealer keeps the deal after a draw" />
      <Check p={p} k="flowerHands" label="七搶一 / 八仙過海 flower wins" />
      <Check p={p} k="liguLigu" label="嚦咕嚦咕 seven pairs and a pong" />
      <Check p={p} k="multiWin" label="一炮多響 several players may win on one discard" />
    </>
  );
}

function RiichiEditor(p: EditorProps<RiichiRules>) {
  return (
    <>
      <Select p={p} k="rounds" label="Game" options={[[1, '東風戦 East round'], [2, '東南戦 East–South']]} />
      <Select p={p} k="startingScore" label="Starting points" options={[[25000, '25,000'], [30000, '30,000'], [35000, '35,000']]} />
      <Select p={p} k="multiRon" label="Several rons on one tile" options={[['double', 'double ron (triple = abortive draw)'], ['all', 'every winner'], ['head', 'head bump: next in turn']]} />
      <Select p={p} k="doubleWindFu" label="Double-wind pair" options={[[4, '4 fu'], [2, '2 fu']]} />
      <Check p={p} k="akaDora" label="赤ドラ three red fives" />
      <Check p={p} k="kuitan" label="喰いタン open tanyao" />
      <Check p={p} k="kazoe" label="数え役満: 13+ han is yakuman" />
      <Check p={p} k="kiriage" label="切り上げ満貫: 4 han 30 fu = mangan" />
      <Check p={p} k="nagashi" label="流し満貫 nagashi mangan" />
      <Check p={p} k="tobi" label="The game ends when someone busts" />
    </>
  );
}

function AmericanEditor(p: EditorProps<AmericanRules>) {
  return (
    <>
      <Select p={p} k="hands" label="Hands in a match" options={[4, 8, 12, 16].map((n) => [n, `${n} hands`])} />
      <NumberField p={p} k="startingScore" label="Starting points" step={50} />
      <Check p={p} k="jokerless" label="Jokerless hands score double" />
      <Check p={p} k="secondCharleston" label="Offer a second Charleston" />
      <Check p={p} k="courtesyPass" label="Courtesy pass across (0–3 tiles)" />
    </>
  );
}

export function RulesEditor({ variant, rules, onChange, readOnly }: { variant: VariantId; rules: AnyRules; onChange: (r: AnyRules) => void; readOnly?: boolean }) {
  // reason: each editor is typed on its own variant's rules; `variant` picks which.
  const p = { rules, onChange, readOnly } as unknown as EditorProps<never>;
  return (
    <fieldset className="rules-editor" disabled={readOnly}>
      {variant === 'hk' && <HkEditor {...(p as unknown as EditorProps<HkRules>)} />}
      {variant === 'taiwan' && <TaiwanEditor {...(p as unknown as EditorProps<TaiwanRules>)} />}
      {variant === 'riichi' && <RiichiEditor {...(p as unknown as EditorProps<RiichiRules>)} />}
      {variant === 'american' && <AmericanEditor {...(p as unknown as EditorProps<AmericanRules>)} />}
      {!readOnly && (
        <button type="button" className="btn small ghost" onClick={() => onChange(defaultRulesFor(variant))}>
          Reset to defaults
        </button>
      )}
    </fieldset>
  );
}
