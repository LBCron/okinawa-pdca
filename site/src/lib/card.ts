// SNS のカードの画像（og:image）の中身。施策・基本施策・将来像・くらしのテーマ・部局・主な取組のページと、指標（成果指標・主要指標・活動指標）のシェア用のページごとに1枚（1200×630）。
// ここでは satori に渡す要素の木（React の要素と同じ形のただのオブジェクト）を作るだけで、画像にはしない（画像にするのは lib/card-render.ts、
// 書き出すのは pages/og/[...card].png.ts）。フォントの部分集合を作るスクリプト（scripts/shot/card-font.ts）も、ここで作った木から使う字を集める。
//
// 見た目は docs/design.md に合わせる: ページの頭と同じ太い線と硬い影のステッカーに、名前と最新の年度の様子を入れる。
// - 判定・進捗状況は県の区分の言葉で出し、内訳は区分の並びのまま0でない区分を全部同じ大きさで並べる（遅れだけを大きくしない）
// - 状態は色だけで伝えず、形（lib/icons.ts）と文字でも出す。大きな丸いハンコは施策の判定だけに使う（取組は横長の札）
// - 下の帯にサイトの名前・（非公式）・by Code for Okinawa を入れ、非公式で Code for Okinawa が作っていることが分かるようにする
// 色は styles/global.css の :root（ライト）のトークンを読んで使う（CSS は効かないので値を直接書く）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  JUDGES, LATEST, PLAN_PERIODS, RATE_BINS, STATUSES, YEARS, halfWidth, judgeOf, periodLabel, judgesOf, refText, seikaGroupsOf, shuyouSteps, seikaVerdict, statusOf, textGoalChartRow, toneOfJudgement, toneOfStatus, torikumiCells, yearLabel, yearLong,
  type ChartRow, type SeikaGroup, type SeikaGroupOfShisaku, type Shisaku, type ShuyouGroupOfKihon, type ShuyouPart, type TorikumiGroup,
} from './data.ts';
import type { ActivityRun, ActivityShare } from './katsudou.ts';
import { fmt } from './format.ts';
import { deptHead, futureHead, kihonHead, shisakuHead, themeHead, total, type AreaHead } from './heads.ts';
import { JUDGE_GROUPS, JUDGE_UI, SHAPES, shapeSvg, themeIconParts, type Shape, type Tone } from './icons.ts';
import { PROJECT, SITE } from './links.ts';
import { once } from './memo.ts';
import { ROUTES, routePath } from './routes.ts';
import { isBlankCell, isNumOnly, oneLine } from './text.ts';

export const CARD_SIZE = { width: 1200, height: 630 };
// 字の形は Noto Sans CJK JP の Bold だけ（src/fonts/card-bold.woff。使う字だけを切り出したもの）
export const CARD_FONT = 'Noto Sans JP';

// ---------------------------------------------------------------- 要素の木

type Style = Record<string, string | number | undefined>;
export interface El {
  type: string;
  props: { style: Style; children?: (El | string)[] | string; src?: string; width?: number; height?: number };
}
type Kid = El | string | null | undefined | false | Kid[];

// どの要素も幅・高さに線と内側の余白を含める（border-box）。カードの寸法はこの前提で決めていて、satori の既定は Chrome と同じ content-box
const clean = (s: Style) => Object.fromEntries(Object.entries({ boxSizing: 'border-box', ...s }).filter(([, v]) => v !== undefined));
function h(type: string, style: Style, kids: Kid[]): El {
  const children = (kids.flat(Infinity as 1) as (El | string | null | undefined | false)[]).filter((k): k is El | string => k != null && k !== false && k !== '');
  return { type, props: { style: clean(style), children } };
}
// 子を横か縦に並べる箱（satori は子が2つ以上の div に display: flex が要る）
const box = (style: Style, ...kids: Kid[]) => h('div', { display: 'flex', ...style }, kids);
// カードのフォント（Noto Sans CJK JP）に無い字を、ある字に置き換える。上付き・下付きの数字（CO₂ の ₂）は普通の数字にする。
// ローマ数字の Ⅼ・Ⅽ・Ⅾ・Ⅿ も無いので、続くローマ数字ごと英字にする（活動概要の「ⅮⅤ被害者」→ DV）。
// 無い字が出ると、フォントを切り出す make card-font が止まるので、ここに足す
export const fold = (s: string) =>
  s.replace(/[\u2070-\u209f]|[\u2160-\u217f]*[\u216c-\u216f\u217c-\u217f][\u2160-\u217f]*/g, (c) => c.normalize('NFKC'));
// 文字だけの箱。clamp は行数の上限（超えたら …。display: block が要り、そのときの子は配列でなく文字で渡す）
const txt = (style: Style, s: string, clamp?: number): El =>
  ({ type: 'div', props: { style: clean(clamp ? { display: 'block', lineClamp: clamp, ...style } : { display: 'flex', ...style }), children: fold(s) } });
const img = (src: string, w: number, h_ = w, style: Style = {}): El => ({ type: 'img', props: { src, width: w, height: h_, style: clean({ flexShrink: 0, ...style }) } });
const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// 木の中の文字（フォントの部分集合とテストで使う）
export function textOf(el: El | string): string {
  if (typeof el === 'string') return el;
  const kids = el.props.children ?? [];
  return typeof kids === 'string' ? kids : kids.map(textOf).join('');
}

// ---------------------------------------------------------------- 色

let tokens: Record<string, string> | undefined;
// styles/global.css の :root（ライト）の色。ダークはフッターかサイドメニューのボタンで選んだときだけなので、カードはライトで描く
function color(name: string) {
  if (!tokens) {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/global.css'), 'utf-8');
    const root = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1];
    if (!root) throw new Error('styles/global.css に :root の色が見つからない');
    tokens = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
  }
  const v = tokens[name];
  if (!v) throw new Error(`styles/global.css の :root に --${name} が無い`);
  return v;
}
// 状態の縁の色（styles/global.css の --*-edge。無い状態は状態の色）
const edge = (t: Tone) => (t === 'warning' || t === 'critical' || t === 'blank' ? color(`${t}-edge`) : color(t));
// 2つの色を混ぜる（ページの color-mix の代わり。t は a の割合）
function mix(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}
// 判定 E・F の斜線（styles/global.css の .hatch）
const hatch = () => `repeating-linear-gradient(135deg, ${color('paper')} 0px, ${color('paper')} 3px, transparent 3px, transparent 10px)`;

// ---------------------------------------------------------------- 部品

// 状態の印（lib/icons.ts の形）
function icon(tone: Tone | null | undefined, shape: Shape | null | undefined, size: number) {
  const t = tone || 'blank';
  const s = tone ? shape || SHAPES[t] : 'ring';
  const fill = color(t);
  const inner = s === 'ring'
    ? `<circle cx="6" cy="6" r="4.6" fill="none" stroke="${color('ink-2')}" stroke-width="1.2" stroke-dasharray="2 1.6"/>`
    : `<g fill="${fill}" stroke="${t === 'warning' ? color('warning-edge') : fill}" stroke-width="1">${shapeSvg(s)}</g>`;
  return img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="${size}" height="${size}">${inner}</svg>`), size);
}

// 将来像の番号の印（色は基本計画のパンフレットの色。番号の印だけに使う）。将来像のものなので、将来像と、「将来像Nの基本施策」の行だけに置き、
// 施策・取組・基本施策の名前の前には置かない（その将来像の施策と読めないため）
const sz = (id: number, size = 40) =>
  box({ width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: `3px solid ${color('line')}`, background: color(`sz-${id}`), color: color(`sz-${id}-ink`), fontSize: size * 0.56, lineHeight: 1 }, String(id));

// 施策の判定のハンコ（丸いハンコは施策の判定だけ）。size が大きいものはページの頭の大きなハンコ、小さいものは親の施策の札の小さなハンコ
function judgeStamp(key: string | null | undefined, size: number) {
  const j = judgeOf(key);
  const ui = j && JUDGE_UI[j.key];
  return box(
    {
      width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center', columnGap: size * 0.04, borderRadius: '50%',
      border: `${size > 80 ? 5 : 3}px solid ${color('line')}`, backgroundColor: mix(color(j ? j.tone : 'blank'), color('paper'), 0.26),
      backgroundImage: ui?.hatch ? hatch() : undefined, boxShadow: size > 80 ? `6px 6px 0 ${color('shadow')}` : undefined, transform: 'rotate(-6deg)',
    },
    j && icon(j.tone, JUDGE_UI[j.key].shape, size * 0.22),
    txt({ fontSize: size * (j ? 0.5 : 0.4), lineHeight: 1 }, j ? j.key : '—'),
  );
}

// ---------------------------------------------------------------- 寸法

// ステッカーの外の余白（右と下は影の分）・線・中の余白。中の高さを、名前・内訳・下の帯に割り振る
const OUTER = { top: 24, right: 40, bottom: 40, left: 24 };
const BORDER = 5;
const PAD = { top: 22, side: 40, bottom: 18 };
const INNER_W = CARD_SIZE.width - OUTER.left - OUTER.right - 2 * BORDER - 2 * PAD.side;
const FOOT_H = 48;
// 下の帯より上の高さ
const BODY_H = CARD_SIZE.height - OUTER.top - OUTER.bottom - 2 * BORDER - PAD.top - PAD.bottom - FOOT_H - 12;
const KICK_H = 40;
const LH = 1.3; // 名前の行の高さ（文字の大きさに対する割合）

// 文字の幅の見積もり（文字の大きさに対する割合）。Noto Sans CJK の仮名・漢字・全角の記号は1、英数字はおよそ0.6。
// 名前の大きさと内訳の行数を決めるのに使う（折り返しそのものは satori が実際の幅でする）
const em = (c: string) => (/[ -~]/.test(c) ? 0.6 : 1);
const widthOf = (s: string, size: number) => [...s].reduce((a, c) => a + em(c), 0) * size;

// ---------------------------------------------------------------- 名前

// 名前を文節に分ける。単語の区切り（Intl.Segmenter。satori の keep-all と同じ）のうち、ひらがな・句読点の後ろで次がひらがなでないところだけで区切る
// （「再生可能エネルギー等の / クリーンな / エネルギーの / 導入促進」。ページの見出しの word-break: auto-phrase に近い切れ方）
const HIRA = /[ぁ-ゟ]/;
const SMALL = /[ぁぃぅぇぉっゃゅょゎ]/; // この後ろでは区切らない（「島しょ / 型」にしない）
const AFTER = /[、。・，．）」』〕】！？：]/; // この後ろで区切る
const BEFORE = /[（「『〔【]/; // この前で区切る
const NO_HEAD = /[、。・，．）」』〕】！？：ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/; // 行の頭に来ない
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
export function phrases(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const { segment: w } of segmenter.segment(s)) {
    const prev = cur.at(-1) ?? '';
    const cut = cur && !NO_HEAD.test(w[0]) && ((HIRA.test(prev) && !SMALL.test(prev) && !HIRA.test(w[0])) || AFTER.test(prev) || BEFORE.test(w[0]));
    if (cut) {
      out.push(cur);
      cur = w;
    } else cur += w;
  }
  if (cur) out.push(cur);
  return out;
}

// 行に入らない長さの文節は、単語・文字に分けて折り返せるようにする
function pieces(s: string, size: number, width: number): string[] {
  return phrases(s).flatMap((p) => {
    if (widthOf(p, size) <= width) return [p];
    const words = [...segmenter.segment(p)].map((x) => x.segment);
    return words.flatMap((w) => (widthOf(w, size) <= width ? [w] : [...w]));
  });
}
// 見積もりの幅で、文節を行に詰める
function lines(ps: string[], size: number, width: number): string[][] {
  const out: string[][] = [[]];
  let w = 0;
  for (const p of ps) {
    const pw = widthOf(p, size);
    if (w && w + pw > width) {
      out.push([]);
      w = 0;
    }
    out.at(-1)!.push(p);
    w += pw;
  }
  return out;
}

// 名前（ページの題名）。高さ height に収まる一番大きな文字（largest まで）で、文節の箱を折り返して並べる（satori に text-wrap の文節の折り返しが無いため）。
// いちばん小さい文字でも入らないときは、入る行までにして … を付ける（全文は og:title にある）
const SIZES = [64, 60, 56, 52, 48, 44, 40, 36, 32];
function title(name: string, width: number, height: number, largest = SIZES[0]) {
  const fit = width * 0.95; // 見積もりの誤差の分
  let size = SIZES.at(-1)!;
  let ps = pieces(name, size, fit);
  for (const s of SIZES.filter((x) => x <= largest)) {
    const p = pieces(name, s, fit);
    if (lines(p, s, fit).length * s * LH <= height) {
      size = s;
      ps = p;
      break;
    }
  }
  const max = Math.max(1, Math.floor(height / (size * LH)));
  const ls = lines(ps, size, fit);
  if (ls.length > max) {
    ps = ls.slice(0, max).flat();
    ps[ps.length - 1] = `${ps.at(-1)!.slice(0, -1)}…`;
  }
  return box(
    { flexWrap: 'wrap', width, maxHeight: height, flexShrink: 0, overflow: 'hidden' },
    ps.map((p) => txt({ fontSize: size, lineHeight: LH }, p)),
  );
}
// 「何のページか」の行と名前。2つをまとめて、高さ height の中で上下の真ん中に置く
const heading = (kick: El, name: string, width: number, height: number, largest?: number) =>
  box({ flexDirection: 'column', justifyContent: 'center', height, flexShrink: 0 }, kick, title(name, width, height - KICK_H, largest));

// ---------------------------------------------------------------- 部品

// 名前の上の「何のページか」の行
const kicker = (...kids: Kid[]) => box({ alignItems: 'center', gap: 12, height: KICK_H, flexShrink: 0, fontSize: 26, color: color('ink-2') }, ...kids);

// 親の札（施策・基本施策・取組）。lead は名前の前の印（施策の札は施策の判定のハンコ。基本施策・取組の札は印を付けない）、
// kind（「この取組が入っている施策」など）は行の右端に小さく
const PARENT_H = 62;
function parentBar(lead: Kid, name: string, kind: string) {
  return box(
    { alignItems: 'center', columnGap: 12, height: PARENT_H, paddingBottom: 12, flexShrink: 0, borderBottom: `3px solid ${color('grid')}` },
    lead,
    txt({ fontSize: 26, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, name, 1),
    txt({ fontSize: 18, color: color('ink-2'), flexShrink: 0 }, kind),
  );
}
// 親の施策の札（施策の判定は小さな丸いハンコ）
const parent = (s: Shisaku, kind: string) => parentBar(judgeStamp(s.judges[LATEST], 44), s.name, kind);

// 区分（進捗状況・判定・達成率）
interface Cat { key: string; label: string; tone: Tone; shape: Shape; hatch?: boolean }
const STATUS_CATS: Cat[] = STATUSES.map((s) => ({ key: s.key, label: s.key, tone: s.tone, shape: SHAPES[s.tone] }));
const JUDGE_CATS: Cat[] = [...JUDGE_GROUPS.map((g) => ({ ...g })), { key: 'なし', label: '判定なし', tone: 'blank', shape: 'ring' }];
const RATE_CATS: Cat[] = RATE_BINS.map((b) => ({ key: b.key, label: b.key, tone: b.tone, shape: SHAPES[b.tone] }));
// 施策の判定（A〜G）を、トップ・テーマの棒と同じ区分（JUDGE_GROUPS）にまとめる
const judgeGroupCounts = (judges: Record<string, number>) =>
  Object.fromEntries([...JUDGE_GROUPS.map((g) => [g.key, g.keys.reduce((a, k) => a + (judges[k] || 0), 0)]), ['なし', judges['なし'] || 0]]);

interface Row { label: string; unit: string; cats: Cat[]; counts: Record<string, number> }

// 内訳の1行: 見出し（名前と件数）・100%積み上げの横棒（components/StatusBar.astro と同じ形）・区分ごとの数
const ROW = { head: 30, bar: 30, item: 30, gap: 6, icon: 22, label: 22, num: 26, inGap: 7, itemGap: 22 };
const STATS_PAD = { y: 14, x: 22, gap: 12 };
const STATS_W = INNER_W - 2 * STATS_PAD.x;
const shown = (r: Row) => r.cats.filter((c) => r.counts[c.key] > 0);
const itemWidth = (r: Row, c: Cat) => ROW.icon + ROW.inGap + widthOf(c.label, ROW.label) + ROW.inGap + widthOf(fmt(r.counts[c.key]), ROW.num);
// 区分の数の並びが何行になるか（見積もり）
function legendLines(r: Row) {
  let n = 1;
  let w = 0;
  for (const c of shown(r)) {
    const iw = itemWidth(r, c);
    if (w && w + ROW.itemGap + iw > STATS_W * 0.97) {
      n++;
      w = iw;
    } else w += (w ? ROW.itemGap : 0) + iw;
  }
  return n;
}
const rowHeight = (r: Row) => (total(r.counts) ? ROW.head + ROW.gap + ROW.bar + ROW.gap + legendLines(r) * ROW.item : ROW.head + ROW.gap + ROW.item);
const statsHeight = (rows: Row[]) => 2 * STATS_PAD.y + rows.reduce((a, r) => a + rowHeight(r), 0) + STATS_PAD.gap * (rows.length - 1);

function bar(r: Row) {
  const segs = shown(r);
  const end = (i: number) => (segs.length === 1 ? '999px' : i === 0 ? '999px 0 0 999px' : i === segs.length - 1 ? '0 999px 999px 0' : '0');
  return box(
    { height: ROW.bar, padding: 3, columnGap: 3, border: `3px solid ${color('line')}`, borderRadius: 999, background: color('paper') },
    // ページの内訳の棒と同じく、区間は淡い塗りに状態の色の縁（--*-edge があればそれ）
    segs.map((c, i) => box({
      flexGrow: r.counts[c.key], flexBasis: 0, minWidth: 6, borderRadius: end(i), border: `2px solid ${edge(c.tone)}`,
      backgroundColor: color(`${c.tone}-fill`), backgroundImage: c.hatch ? hatch() : undefined,
    })),
  );
}
// 区分の並びのまま、0でない区分を全部同じ大きさで並べる（遅れだけを大きくしない）
function legend(r: Row) {
  return box(
    { flexWrap: 'wrap', columnGap: ROW.itemGap, alignItems: 'center' },
    shown(r).map((c) =>
      box(
        { alignItems: 'center', columnGap: ROW.inGap, height: ROW.item },
        icon(c.tone, c.shape, ROW.icon),
        txt({ fontSize: ROW.label }, c.label),
        txt({ fontSize: ROW.num }, fmt(r.counts[c.key])),
      )),
  );
}
function statRow(r: Row) {
  const n = total(r.counts);
  return box(
    { flexDirection: 'column', rowGap: ROW.gap },
    box(
      { alignItems: 'baseline', columnGap: 14, height: ROW.head },
      txt({ fontSize: 24 }, r.label),
      txt({ fontSize: 20, color: color('ink-2') }, `${yearLong(LATEST)}・${fmt(n)}${r.unit}`),
    ),
    n ? [bar(r), legend(r)] : txt({ fontSize: 22, color: color('ink-2'), height: ROW.item }, `${yearLong(LATEST)}の報告にはありません`),
  );
}
// ステッカーの中の箱（線も影も付けず地の色だけ。styles/global.css の .inset）
const inset = (style: Style, ...kids: Kid[]) => box({ flexDirection: 'column', flexShrink: 0, background: color('bg'), borderRadius: 18, padding: `${STATS_PAD.y}px ${STATS_PAD.x}px`, ...style }, ...kids);
const stats = (rows: Row[]) => inset({ rowGap: STATS_PAD.gap, height: statsHeight(rows) }, rows.map(statRow));

const toriRow = (counts: Record<string, number>): Row => ({ label: '主な取組の進捗状況', unit: '件', cats: STATUS_CATS, counts });
const judgeRow = (a: AreaHead, label = '施策の判定'): Row => ({ label, unit: '施策', cats: JUDGE_CATS, counts: judgeGroupCounts(a.judges) });

// 下の帯: サイトの名前・（非公式）・作っている団体
let logo: string | undefined;
function footer() {
  logo ??= svgUri(fs.readFileSync(path.resolve(process.cwd(), 'src/assets/favicon.svg'), 'utf-8'));
  return box(
    { alignItems: 'center', justifyContent: 'space-between', height: FOOT_H, marginTop: 'auto', flexShrink: 0 },
    box({ alignItems: 'center', columnGap: 12 }, img(logo, 46), txt({ fontSize: 28 }, SITE.name), txt({ fontSize: 20, color: color('ink-2') }, '（非公式）')),
    box(
      { alignItems: 'center', columnGap: 8, padding: '2px 20px 4px', borderRadius: 999, border: `3px solid ${color('line')}`, background: color('paper') },
      txt({ fontSize: 18, color: color('ink-2') }, 'by'),
      txt({ fontSize: 22 }, PROJECT.org),
    ),
  );
}

// ステッカー（ページの頭と同じ太い線と硬い影）。bg はステッカーの地の色
function frame(bg: string, ...kids: Kid[]) {
  return box(
    { width: CARD_SIZE.width, height: CARD_SIZE.height, padding: `${OUTER.top}px ${OUTER.right}px ${OUTER.bottom}px ${OUTER.left}px`, background: color('bg'), fontFamily: CARD_FONT, color: color('ink') },
    box(
      {
        flex: 1, flexDirection: 'column', padding: `${PAD.top}px ${PAD.side}px ${PAD.bottom}px`, background: bg, border: `${BORDER}px solid ${color('line')}`,
        borderRadius: 36, boxShadow: `12px 12px 0 ${color('shadow')}`, overflow: 'hidden',
      },
      ...kids,
      footer(),
    ),
  );
}
const gap = (n: number) => box({ height: n, flexShrink: 0 });

// ---------------------------------------------------------------- ページごとのカード

// 施策（施策のページの頭と同じ形。成果指標は名前ではなく数）。名前の下の箱に、県の判定のハンコと言葉、右に4年間の判定のスタンプ。細い線の下に判定のもとを2列で、
// 成果指標（計画値に到達した数と、指標ごとの達成率の札）→ 主な取組（順調の数と、1件1つの四角）の順に置く
const SQ = 26;
const WHY_GAP = 32;
function judgeStamps(s: Shisaku) {
  const W = 96;
  const kids: El[] = [];
  YEARS.forEach((y, i) => {
    const j = judgeOf(s.judges[y]);
    const ui = j && JUDGE_UI[j.key];
    if (i > 0) kids.push(box({ width: 24, marginTop: 48, borderTop: `4px ${j && judgeOf(s.judges[YEARS[i - 1]]) ? 'solid' : 'dashed'} ${color('line')}` }));
    kids.push(box(
      { flexDirection: 'column', alignItems: 'center', rowGap: 4, width: W },
      txt({ fontSize: 18, color: color('ink-2') }, yearLabel(y)),
      box(
        {
          width: 48, height: 48, alignItems: 'center', justifyContent: 'center', columnGap: 2, borderRadius: '50%', border: `3px solid ${color('line')}`,
          backgroundColor: mix(color(j ? j.tone : 'blank'), color('paper'), 0.26), backgroundImage: ui?.hatch ? hatch() : undefined,
        },
        j ? [icon(j.tone, JUDGE_UI[j.key].shape, 12), txt({ fontSize: 22, lineHeight: 1 }, j.key)] : icon(null, null, 22),
      ),
      txt({ fontSize: 16, lineHeight: 1.25, textAlign: 'center', width: W }, ui ? ui.short : y === YEARS[0] ? '未公表' : '判定なし'),
    ));
  });
  return box({ alignItems: 'flex-start', flexShrink: 0 }, kids);
}
function shisakuCard(s: Shisaku) {
  const hd = shisakuHead(s);
  const j = judgeOf(hd.judge);
  const seika = seikaGroupsOf(s.id).filter((r) => r.latest.year === LATEST).map((r) => seikaVerdict(r.latest));
  const tori = torikumiCells(s);
  const ok = tori.filter((t) => t.key === '順調').length;
  // 判定のもとの列の幅と、札・四角が何行になるか（入らなければ折り返す）
  const COL_W = (INNER_W - 2 * STATS_PAD.x - WHY_GAP) / 2;
  const chipW = (c: string) => 20 + 6 + widthOf(c, 20) + 14;
  const chipLines = seika.reduce((acc, v) => {
    const w = chipW(v.chip);
    return acc.x + w > COL_W ? { n: acc.n + 1, x: w } : { n: acc.n, x: acc.x + w };
  }, { n: 1, x: 0 }).n;
  const sqLines = Math.max(1, Math.ceil(tori.length / Math.floor((COL_W + 4) / (SQ + 4))));
  const lines = Math.max(chipLines, sqLines);
  // 高さ: 頭の行（4年間のスタンプの言葉は2行まで）、区切り（上のあき・線・下のあき）、判定のもと（見出し・数・札か四角の行）
  const TOP_H = 116;
  const RULE_H = 14 + 3 + 14;
  const WHY_H = 26 + 4 + 44 + 4 + 6 + lines * 30 + (lines - 1) * 4;
  const INSET_H = 2 * STATS_PAD.y + TOP_H + RULE_H + WHY_H;
  const why = (label: string, num: string, after: string, itemGap: number, items: Kid) => box(
    { flexDirection: 'column', rowGap: 4, width: COL_W, flexShrink: 0 },
    txt({ fontSize: 20, color: color('ink-2'), height: 26 }, label),
    box({ alignItems: 'baseline', columnGap: 6, height: 44 }, txt({ fontSize: 36 }, num), txt({ fontSize: 22 }, after)),
    box({ flexWrap: 'wrap', alignItems: 'center', rowGap: 4, columnGap: itemGap, marginTop: 6 }, items),
  );
  return frame(
    color('paper'),
    heading(kicker('施策'), s.name, INNER_W, BODY_H - 12 - INSET_H),
    gap(12),
    inset(
      { height: INSET_H },
      box(
        { alignItems: 'center', justifyContent: 'space-between', columnGap: 20, height: TOP_H, flexShrink: 0 },
        box(
          { alignItems: 'center', columnGap: 18, minWidth: 0, flex: 1 },
          judgeStamp(hd.judge, 88),
          box(
            { flexDirection: 'column', rowGap: 2, minWidth: 0 },
            txt({ fontSize: 30 }, j ? `${j.key} ${JUDGE_UI[j.key].short}` : '判定なし'),
            txt({ fontSize: 18, color: color('ink-2') }, `${yearLong(LATEST)}の県の判定`),
          ),
        ),
        box({ alignItems: 'center', columnGap: 10, flexShrink: 0 }, txt({ fontSize: 18, color: color('ink-2') }, '4年間'), judgeStamps(s)),
      ),
      box(
        { columnGap: WHY_GAP, marginTop: 14, paddingTop: 14, borderTop: `3px solid ${color('grid')}`, flexShrink: 0 },
        why('成果指標', `${fmt(hd.reached)}/${fmt(seika.length)}`, 'が計画値に到達', 14,
          seika.map((v) => box({ alignItems: 'center', columnGap: 6, height: 30 }, icon(v.tone, null, 20), txt({ fontSize: 20 }, v.chip)))),
        why('主な取組', `${fmt(ok)}/${fmt(tori.length)}`, '件が順調', 4,
          // ページの四角（components/StatusBar.astro の squares）と同じく、淡い塗りに状態の色の縁
          tori.map((t) => {
            const tone = STATUSES.find((x) => x.key === t.key)?.tone || 'blank';
            return box({ width: SQ, height: SQ, borderRadius: 5, flexShrink: 0, border: `2px solid ${edge(tone)}`, background: color(`${tone}-fill`) });
          })),
      ),
    ),
  );
}

function areaCard(bg: string, head: El, name: string, rows: Row[]) {
  return frame(bg, heading(head, name, INNER_W, BODY_H - 12 - statsHeight(rows)), gap(12), stats(rows));
}

// 主な取組（取組のページの頭と同じ並び）。「主な取組」の行に最後の報告の年度の進捗状況の札を並べ、名前の下の箱に、それを決めた活動指標の計画 → 実績、
// その下に県の吹き出しでその年度にやったこと（総括報告書の活動概要。県の資料の言葉なので吹き出し）。年度は進捗状況の札の横に1回だけ書く。
// SNS では小さく出るので文字は絞り、所管・達成割合は取組のページに任せる。やったことは2行まで（入らない分は …。全文は取組のページにある）。
// 名前は 52px まで（大きくすると、名前と下の箱が詰まって見える）
const TORI = { line: 30, vals: 40, title: 52, avatar: 46, bubble: { y: 12, x: 18 }, foot: 10 };
function torikumiCard(g: TorikumiGroup) {
  const t = g.latest;
  const status = statusOf(t);
  const tone = toneOfStatus(status);
  const did = isBlankCell(t.summary) ? '' : oneLine(t.summary);
  const W = INNER_W - 2 * STATS_PAD.x;
  // 計画 → 実績の行が入らない値（かっこの中に内訳があるものなど）は、大きな数字にせず1行の文字で出す（短い値は縮めず、長い値のほうを …）。
  // 数字の幅の見積もり（0.6em）は実際より広めなので、行の幅そのものと比べる
  const plan = one(t.target);
  const actual = one(t.actual);
  const fits = widthOf('計画→ 実績', 20) + 3 * 8 + valueWidth(plan) + valueWidth(actual) <= W;
  const val = (raw: string) => (fits ? valueText(raw) : txt({ fontSize: 22, flexShrink: widthOf(raw, 22) > W * 0.3 ? 1 : 0, minWidth: 0 }, halfWidth(raw), 1));
  const valsH = fits ? TORI.vals : TORI.line;
  const INSET_H = 2 * STATS_PAD.y + TORI.line + 2 + valsH;
  const BUBBLE_W = INNER_W - TORI.avatar - 14 - 2 * TORI.bubble.x - 6;
  const didLines = did ? Math.min(2, Math.ceil(widthOf(did, 22) / (BUBBLE_W * 0.95))) : 0;
  const BUBBLE_H = 2 * TORI.bubble.y + 6 + didLines * TORI.line;
  const lh = `${TORI.line}px`;
  const sub = (s: string) => txt({ fontSize: 20, color: color('ink-2'), flexShrink: 0 }, s);
  // 県の吹き出し（components/Says.astro と同じ形。ステッカーの中なので影は付けない）。尾は線を2辺だけ引いた正方形を回したもの
  const says = (text: string) => box(
    { alignItems: 'flex-start', columnGap: 14, flexShrink: 0 },
    box({ width: TORI.avatar, height: TORI.avatar, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: `3px solid ${color('line')}`, background: color('paper'), fontSize: 20 }, '県'),
    box(
      { position: 'relative', flex: 1, minWidth: 0, height: BUBBLE_H, padding: `${TORI.bubble.y}px ${TORI.bubble.x}px`, borderRadius: 18, border: `3px solid ${color('line')}`, background: color('paper') },
      box({ position: 'absolute', left: -12, top: 13, width: 18, height: 18, background: color('paper'), borderLeft: `3px solid ${color('line')}`, borderBottom: `3px solid ${color('line')}`, transform: 'rotate(45deg)' }),
      txt({ fontSize: 22, lineHeight: lh }, text, didLines),
    ),
  );
  return frame(
    color('paper'),
    parent(g.shisaku, 'この取組が入っている施策'),
    gap(8),
    heading(
      kicker(
        '主な取組',
        box(
          { alignItems: 'center', columnGap: 10, flexShrink: 0, marginLeft: 8, padding: '0 20px 2px 14px', borderRadius: 999, border: `3px solid ${color('line')}`, background: mix(color(tone), color('paper'), 0.26) },
          icon(tone, null, 22),
          txt({ fontSize: 24, lineHeight: 1.2, color: color('ink') }, status),
        ),
        txt({ fontSize: 20 }, `${yearLong(t.year)}の進捗状況${t.year === LATEST ? '' : '（最後の報告）'}`),
      ),
      // 残りの高さ（吹き出しと下の帯の間を TORI.foot だけ余分にあける）
      t.name, INNER_W, BODY_H - PARENT_H - 8 - 12 - INSET_H - (did ? 14 + BUBBLE_H : 0) - TORI.foot, TORI.title,
    ),
    gap(12),
    inset(
      { height: INSET_H, rowGap: 2 },
      box(
        { alignItems: 'baseline', columnGap: 14, height: TORI.line, minWidth: 0 },
        txt({ fontSize: 20, color: color('ink-2'), flexShrink: 0 }, '活動指標'),
        txt({ fontSize: 22, lineHeight: lh, flex: 1, minWidth: 0 }, oneLine(t.indicator), 1),
      ),
      // 大きな数字の行の高さを詰める（行の高さは中の文字に受け継がれる）
      box(
        { alignItems: 'baseline', columnGap: 8, height: valsH, minWidth: 0, lineHeight: fits ? 1.1 : lh },
        sub('計画'), val(plan), sub('→ 実績'), val(actual),
      ),
    ),
    did ? [gap(14), says(did)] : null,
  );
}

// ---------------------------------------------------------------- 図

// 図は線と点を SVG の画像にし、文字は satori の文字として上に重ねる（画像の中の SVG の文字にはカードのフォントが効かないため）。
// 図の中の文字は計画期間・年度・スタート・ゴール・いまここだけ（数字は図の横にある）
type Pt = [x: number, y: number];
type Box = [number, number, number, number];
const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const pathD = (pts: Pt[]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');

// 文字を置く場所を、印と重ならないように選ぶ（scripts/charts.ts の placer と同じ考え方）。top・bottom は文字を置ける上下の端
function placer(W: number, top: number, bottom: number) {
  const boxes: Box[] = [];
  const mark = (cx: number, cy: number, r: number) => { boxes.push([cx - r, cy - r, cx + r, cy + r]); };
  const markPath = (pts: Pt[]) => pts.slice(1).forEach(([bx, by], i) => {
    const [ax, ay] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 0; k <= n; k++) mark(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, 2);
  });
  const overlap = (b: Box) => boxes.reduce((a, o) => a + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1])), 0);
  // 候補（左上の座標）のうち、図に収まって重なりのいちばん少ない場所。重なりの面積も返す
  const place = (w: number, h: number, cands: Pt[]): [x: number, y: number, overlap: number] => {
    const bs = cands.map(([bx, by]): Box => [bx, by, bx + w, by + h]);
    const ok = bs.filter((b) => b[0] >= 0 && b[2] <= W && b[1] >= top && b[3] <= bottom);
    const b = (ok.length ? ok : bs).reduce((a, q) => (overlap(q) < overlap(a) ? q : a));
    const o = overlap(b);
    boxes.push(b);
    return [b[0], b[1], o];
  };
  return { mark, markPath, place };
}

// 横は報告年度（計画期間ごとに3年）。最新の報告の計画期間でない方は地の色の帯にし、前期と中期の境に線を引く（ページの図と同じ）
function yearFrame(periods: { ys: number[]; cur: boolean }[], W: number, H: number) {
  const m = { l: 14, r: 14, t: 34, b: 30 };
  const slots = periods.flatMap((p) => p.ys);
  const sw = (W - m.l - m.r) / slots.length;
  const ih = H - m.t - m.b;
  const x = (s: number) => m.l + (slots.indexOf(s) + 0.5) * sw;
  const left = (p: { ys: number[] }) => x(p.ys[0]) - sw / 2;
  const svg: string[] = [];
  const labels: El[] = [];
  const label = (s: string, px: number, py: number, style: Style = {}) =>
    labels.push(txt({ position: 'absolute', left: Math.round(px), top: Math.round(py), fontSize: 17, lineHeight: 1, color: color('ink-2'), ...style }, s));
  for (const p of periods) {
    if (!p.cur) svg.push(`<rect x="${left(p)}" y="0" width="${sw * 3}" height="${m.t + ih + 4}" rx="10" fill="${color('bg')}"/>`);
    label(periodLabel(p.ys[0]), left(p) + 10, 10, p.cur ? { color: color('ink') } : {});
  }
  if (periods.length > 1) svg.push(`<line x1="${left(periods[1])}" x2="${left(periods[1])}" y1="0" y2="${m.t + ih + 4}" stroke="${color('hair')}" stroke-width="2"/>`);
  slots.forEach((s) => label(yearLabel(s), x(s) - 13, H - 22));
  return { m, sw, ih, x, left, svg, labels, label, ...placer(W, m.t - 4, m.t + ih + 4) };
}

// 最後の実績に添える「いまここ」の札
function hereTag(text: string, [cx, cy]: Pt, place: ReturnType<typeof placer>['place']) {
  const w = widthOf(text, 18) + 24;
  const h = 30;
  const [bx, by] = place(w, h, [[cx + 16, cy - h / 2], [cx - w / 2, cy - 16 - h], [cx - w / 2, cy + 16], [cx - 16 - w, cy - h / 2]]);
  return box(
    { position: 'absolute', left: Math.round(bx), top: Math.round(by), width: Math.round(w), height: h, alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: `3px solid ${color('line')}`, background: color('paper'), fontSize: 18, color: color('ink') },
    text,
  );
}

const chartBox = (W: number, H: number, svg: string[], labels: El[]) => box(
  { position: 'relative', width: W, height: H, flexShrink: 0, borderRadius: 14, background: color('paper') },
  img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svg.join('')}</svg>`), W, H, { position: 'absolute', left: 0, top: 0 }),
  labels,
);

// ゴールまでの道のりの図（scripts/charts.ts の seika と同じ形をカードの大きさで描く）。成果指標と主要指標の部分（ChartRow）。
// スタート（基準値）から点線の計画の道すじ（その年度の計画値）をたどってゴール（目標値）へ。年度ごとの計画値の無い主要指標は、ゴールの丸だけ
function routeChart(row: ChartRow, W: number, H: number): El {
  const years = YEARS.flatMap((y) => (row.years[y] ? [row.years[y]] : []));
  const last = years[years.length - 1];
  const periods = PLAN_PERIODS.flatMap((ys) => {
    const r = years.filter((q) => ys.includes(q.year)).pop();
    return r ? [{ ys, r, cur: ys.includes(last.year) }] : [];
  });
  const vals = [...years.map((r) => r.actual), ...periods.flatMap(({ r }) => [r.base, r.target, ...(r.plan || [])])].filter(num);
  const pad = (Math.max(...vals) - Math.min(...vals) || Math.abs(vals[0]) || 1) * 0.14;
  const [lo, hi] = [Math.min(...vals) - pad, Math.max(...vals) + pad];
  const { m, sw, ih, x, left, svg, labels, label, mark, markPath, place } = yearFrame(periods, W, H);
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const ink2 = color('ink-2');

  // 計画の道すじ（スタートの基準値 → その年度の計画値。最後の○がゴールの目標値）と実績値
  const plans = periods.map((p) => {
    const { r } = p;
    const sx = left(p) + 8;
    const plan = r.plan || [];
    const circles: Pt[] = plan.length
      ? plan.flatMap((v, i): Pt[] => (num(v) ? [[x(p.ys[i]), y(v)]] : []))
      : num(r.target) ? [[x(p.ys[2]), y(r.target)]] : [];
    const pts: Pt[] = [...(num(r.base) ? [[sx, y(r.base)] as Pt] : []), ...(plan.length ? circles : [])];
    markPath(pts);
    circles.forEach(([cx, cy]) => mark(cx, cy, 8));
    return { p, sx, pts, circles };
  });
  const act = years.flatMap((r): Pt[] => (num(r.actual) ? [[x(r.year), y(r.actual)]] : []));
  markPath(act);
  act.forEach(([cx, cy], i) => mark(cx, cy, i === act.length - 1 ? 12 : 8));
  for (const { p, sx, pts, circles } of plans) {
    const ink = p.cur ? ink2 : color('none');
    if (p.cur && num(p.r.base)) svg.push(`<line x1="${sx}" x2="${left(p) + sw * 3 - 6}" y1="${y(p.r.base)}" y2="${y(p.r.base)}" stroke="${color('hair')}" stroke-width="2" stroke-dasharray="3 4"/>`);
    if (pts.length > 1) svg.push(`<path d="${pathD(pts)}" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="8 6" stroke-linejoin="round"/>`);
    circles.forEach(([cx, cy], i) => svg.push(`<circle cx="${cx}" cy="${cy}" r="${i === circles.length - 1 ? 9 : 7}" fill="${color('paper')}" stroke="${ink}" stroke-width="3.5"/>`));
    if (num(p.r.base)) svg.push(`<circle cx="${sx}" cy="${y(p.r.base)}" r="5" fill="${ink}"/>`);
  }
  if (act.length > 1) svg.push(`<path d="${pathD(act)}" fill="none" stroke="${color('pop')}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  act.forEach(([cx, cy], i) => {
    const now = i === act.length - 1;
    svg.push(`<circle cx="${cx}" cy="${cy}" r="${now ? 11 : 7.5}" fill="${color('pop')}" stroke="${color('line')}" stroke-width="${now ? 3.5 : 3}"/>`);
  });

  // 「いまここ」の札（最新の報告で使われなくなった指標は「最後の報告」）と、スタート・ゴールの文字（最新の報告の計画期間だけ）
  const now = act.at(-1);
  if (now) labels.push(hereTag(last.year === LATEST ? 'いまここ' : '最後の報告', now, place));
  for (const { p, sx, circles } of plans) {
    if (!p.cur) continue;
    const { r } = p;
    const rising = !num(r.base) || !num(r.target) || r.target >= r.base;
    const ends: [name: string, ex: number, ey: number, start: boolean][] = [];
    if (num(r.base)) ends.push(['スタート', sx, y(r.base), true]);
    if (num(r.target) && circles.length) ends.push(['ゴール', x(p.ys[2]), y(r.target), false]);
    for (const [name, ex, ey, start] of ends) {
      const w = widthOf(name, 17);
      const up: Pt[] = start ? [[ex + 6, ey - 26], [ex + 18, ey - 28]] : [[ex - w / 2, ey - 32], [ex - w - 12, ey - 28]];
      const down: Pt[] = start ? [[ex + 6, ey + 8], [ex + 18, ey + 10]] : [[ex - w / 2, ey + 14], [ex - w - 12, ey + 10]];
      // 印や札と重ならずに置ける場所が無ければ書かない（数字は横の「スタート → いま → ゴール」にある）
      const [bx, by, o] = place(w, 18, start !== rising ? [...up, ...down] : [...down, ...up]);
      if (!o) label(name, bx, by, { color: color('ink'), background: color('paper') });
    }
  }
  return chartBox(W, H, svg, labels);
}

// 成果指標の道のりの図。目標値が文の指標は、施策ページの図と同じく基準値・実績値を読み、スタートと実績値だけを描く（components/SeikaRoute.astro）。
// 図を描けない指標（目標が「〜との差の縮小」など）は null
function seikaChart(g: SeikaGroup, W: number, H: number): El | null {
  const textGoal = textGoalChartRow(g);
  const rows = Object.values(g.years);
  if (!(textGoal || (rows.some((r) => num(r.actual)) && rows.some((r) => num(r.target))))) return null;
  return routeChart(textGoal ?? g, W, H);
}

// 活動指標の計画と実績の図（scripts/charts.ts の katsudou と同じ形）。計画期間ごとに点線でつないだ白い丸がその年度の計画、青い点が実績で、縦は0から。
// 年度別計画にだけある、この先の年度の計画も置く。実績が計画とほぼ同じ高さのときは、計画を点の外側の輪で描く。here は最後の実績に添える札。図に置ける実績が無ければ null
function katsudouChart(run: ActivityRun, W: number, H: number, here: string): El | null {
  if (!run.chart) return null;
  const done = run.years.filter((r) => !r.future);
  const last = done[done.length - 1];
  const periods = PLAN_PERIODS.flatMap((ys) => {
    const rows = run.years.filter((q) => ys.includes(q.y));
    return rows.length ? [{ ys, rows, cur: ys.includes(last.y) }] : [];
  });
  const vals = run.years.flatMap((r) => [r.plan, r.actual]).filter(num);
  const lo = Math.min(0, ...vals);
  const top = Math.max(0, ...vals);
  const hi = top + (top - lo || 1) * 0.12;
  const { m, ih, x, svg, labels, mark, markPath, place } = yearFrame(periods, W, H);
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const ink2 = color('ink-2');
  svg.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="${color('hair')}" stroke-width="2"/>`);

  const plans = periods.map((p) => ({ p, pts: p.rows.flatMap((r): Pt[] => (num(r.plan) ? [[x(r.y), y(r.plan)]] : [])) }));
  for (const { pts } of plans) {
    markPath(pts);
    pts.forEach(([cx, cy]) => mark(cx, cy, 8));
  }
  const act = done.flatMap((r): Pt[] => (num(r.actual) ? [[x(r.y), y(r.actual)]] : []));
  markPath(act);
  const now = here ? act.at(-1) : undefined;
  const dotR = (a: Pt) => (a === now ? 11 : 7.5);
  act.forEach((a) => mark(a[0], a[1], dotR(a) + 3));
  const under = (cx: number, cy: number) => act.find(([ax, ay]) => ax === cx && Math.abs(ay - cy) < 8);
  for (const { p, pts } of plans) {
    const ink = p.cur ? ink2 : color('none');
    if (pts.length > 1) svg.push(`<path d="${pathD(pts)}" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="8 6" stroke-linejoin="round"/>`);
    pts.forEach(([cx, cy]) => { if (!under(cx, cy)) svg.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${color('paper')}" stroke="${ink}" stroke-width="3.5"/>`); });
  }
  if (act.length > 1) svg.push(`<path d="${pathD(act)}" fill="none" stroke="${color('pop')}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  act.forEach((a) => svg.push(`<circle cx="${a[0]}" cy="${a[1]}" r="${dotR(a)}" fill="${color('pop')}" stroke="${color('line')}" stroke-width="${a === now ? 3.5 : 3}"/>`));
  for (const { p, pts } of plans) {
    for (const [cx, cy] of pts) {
      const a = under(cx, cy);
      if (a) svg.push(`<circle cx="${a[0]}" cy="${a[1]}" r="${dotR(a) + 4}" fill="none" stroke="${p.cur ? ink2 : color('none')}" stroke-width="3"/>`);
    }
  }
  if (now) labels.push(hereTag(here, now, place));
  return chartBox(W, H, svg, labels);
}

// 成果指標の「スタート → いま → ゴール」（components/SeikaGoal.astro と同じ並び）の1行。数字だけの値は単位を小さく添える
function goalStep(label: string, raw: string | null | undefined, unit: string, sub: string) {
  const v = oneLine(raw);
  const isNum = isNumOnly(v);
  return box(
    { alignItems: 'baseline', columnGap: 8, height: 42, minWidth: 0 },
    txt({ fontSize: 20, color: color('ink-2'), width: 92, flexShrink: 0 }, label),
    txt({ fontSize: isNum ? 34 : 24, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, v, 1),
    isNum && unit ? txt({ fontSize: 20, flexShrink: 0 }, unit) : null,
    txt({ fontSize: 17, color: color('ink-2'), flexShrink: 0, marginLeft: 4 }, sub),
  );
}

function seikaCard(g: SeikaGroupOfShisaku) {
  const x = g.latest;
  const v = seikaVerdict(x);
  const ref = refText(x.actual_ref_year);
  const INSET_H = 232;
  const STEPS_W = 440;
  const chart = seikaChart(g, INNER_W - 2 * STATS_PAD.x - STEPS_W - 20, INSET_H - 2 * STATS_PAD.y - 44);
  return frame(
    color('paper'),
    parent(g.shisaku, 'この指標の施策'),
    gap(8),
    // 名前はページの題名と同じ（印字の名前が同じで見分けられない指標は内訳の名前。lib/data.ts の seikaName）
    heading(kicker('成果指標'), g.name, INNER_W, BODY_H - PARENT_H - 8 - 12 - INSET_H),
    gap(12),
    inset(
      { rowGap: 10, height: INSET_H },
      box(
        { alignItems: 'center', columnGap: 14, height: 34 },
        box({ alignItems: 'center', columnGap: 8, flexShrink: 0 }, icon(v.tone, null, 24), txt({ fontSize: 24 }, v.chip)),
        txt({ fontSize: 21, color: color('ink-2'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, v.text, 1),
      ),
      box(
        { columnGap: 20, alignItems: 'center' },
        box(
          { flexDirection: 'column', rowGap: 4, width: chart ? STEPS_W : INNER_W - 2 * STATS_PAD.x, flexShrink: 0 },
          goalStep('スタート', x.base_raw, x.unit, '基準値'),
          goalStep(x.year === LATEST ? 'いま' : `${yearLabel(x.year)}の報告`, x.actual_raw, x.unit, ref ? `実績値（${ref}）` : '実績値'),
          goalStep('ゴール', x.target_raw, x.unit, `目標値（${x.target_year}）`),
        ),
        chart,
      ),
    ),
  );
}

// 主要指標・活動指標の値の1行。数字を大きく、位と単位を小さく出す（「32,885億円」→ 32,885 億円。components/ShuyouCard.astro と同じ）。文の値はそのまま。
// 並べたときに数字の位置と幅がそろうよう、値は半角にそろえる（lib/data.ts の halfWidth）
const DIGITS = /([-△]?\d[\d,.]*)/;
function valueText(raw: string, unit = ''): El {
  const text = halfWidth(raw);
  if (!DIGITS.test(text)) return txt({ fontSize: 24, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text, 1);
  const ps = [...text.split(DIGITS).filter(Boolean), ...(unit ? [unit] : [])];
  return box({ alignItems: 'baseline', columnGap: 2, flexShrink: 1, minWidth: 0, overflow: 'hidden' }, ps.map((t) => txt({ fontSize: DIGITS.test(t) ? 34 : 20, flexShrink: 0, whiteSpace: 'nowrap' }, t)));
}
// valueText の幅の見積もり
function valueWidth(raw: string) {
  const text = halfWidth(raw);
  if (!DIGITS.test(text)) return widthOf(text, 24);
  return text.split(DIGITS).filter(Boolean).reduce((a, t) => a + widthOf(t, DIGITS.test(t) ? 34 : 20) + 2, 0);
}
// 計画・実績の欄が2行以上に分かれている値（総括報告書の lines）を1行にする
const one = (raw: string) => (raw || '—').replace(/\s*\n\s*/g, '・');
function valueStep(label: string, value: El, sub: string) {
  return box(
    { alignItems: 'baseline', columnGap: 8, height: 42, minWidth: 0 },
    txt({ fontSize: 20, color: color('ink-2'), width: 92, flexShrink: 0 }, label),
    value,
    sub ? txt({ fontSize: 17, color: color('ink-2'), flexShrink: 0, marginLeft: 4 }, sub) : null,
  );
}
// 図の箱の頭の1行（成果指標の達成率の札と同じ高さ）
const verdictLine = (...kids: Kid[]) => box({ alignItems: 'center', columnGap: 14, height: 34, minWidth: 0 }, ...kids);

// 主要指標（シェア用のページ）。成果指標のカードと同じ並びで、達成率の代わりに県の見通し（主要指標には達成率と年度ごとの計画値がない）。
// 男性・女性のように1つの欄に値が並ぶ指標は、部分ごとに「いま → ゴール」を1行にし、図は描かない
function shuyouCard(g: ShuyouGroupOfKihon) {
  const x = g.latest;
  const INSET_H = 232;
  const STEPS_W = 440;
  const judges = judgesOf(x.judgement);
  const verdict = x.judgement && verdictLine(
    txt({ fontSize: 21, color: color('ink-2'), flexShrink: 0 }, '県の見通し'),
    judges
      ? judges.map((j) => box({ alignItems: 'center', columnGap: 8, flexShrink: 0 }, j.label && txt({ fontSize: 20, color: color('ink-2') }, j.label), icon(toneOfJudgement(j.key), null, 24), txt({ fontSize: 24 }, j.key)))
      : txt({ fontSize: 21, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, oneLine(x.judgement), 1),
  );
  // スタート・いま・ゴールの値はページのカードと同じ（lib/data.ts の shuyouSteps）
  const vals = (p: ShuyouPart) => shuyouSteps(p).map((s) => valueText(s.text, s.unit));
  const nowLabel = x.year === LATEST ? 'いま' : `${yearLabel(x.year)}の報告`;
  let body: Kid;
  if (g.parts.length > 1) {
    body = g.parts.map((p) => {
      const [, a, t] = vals(p);
      return box(
        { alignItems: 'baseline', columnGap: 10, height: 42, minWidth: 0 },
        txt({ fontSize: 22, width: 92, flexShrink: 0 }, p.label),
        txt({ fontSize: 18, color: color('ink-2'), flexShrink: 0 }, nowLabel), a,
        txt({ fontSize: 18, color: color('ink-2'), flexShrink: 0, marginLeft: 12 }, '→ ゴール'), t,
      );
    });
  } else {
    const p = g.parts[0];
    const [b, a, t] = vals(p);
    const ref = refText(p.latest.a.note);
    const chart = p.drawable ? routeChart(p, INNER_W - 2 * STATS_PAD.x - STEPS_W - 20, INSET_H - 2 * STATS_PAD.y - 44) : null;
    body = box(
      { columnGap: 20, alignItems: 'center' },
      box(
        { flexDirection: 'column', rowGap: 4, width: chart ? STEPS_W : INNER_W - 2 * STATS_PAD.x, flexShrink: 0 },
        valueStep('スタート', b, `基準値${p.latest.b.note}`),
        valueStep(nowLabel, a, ref ? `実績値（${ref}）` : '実績値'),
        valueStep('ゴール', t, `目標値（${p.latest.target_year}）`),
      ),
      chart,
    );
  }
  return frame(
    color('paper'),
    parentBar(null, g.kihon.name, 'この指標の基本施策'),
    gap(8),
    heading(kicker('主要指標'), x.name, INNER_W, BODY_H - PARENT_H - 8 - 12 - INSET_H),
    gap(12),
    inset({ rowGap: 10, height: INSET_H }, verdict, body),
  );
}

// 活動指標（シェア用のページ）。最後の報告の年度の進捗状況と計画 → 実績（取組のページの頭と同じ言い方。年度は進捗状況の行に1回だけ書く）、計画と実績の図
function katsudouCard(a: ActivityShare) {
  const { run, torikumi: g } = a;
  const done = run.years.filter((r) => !r.future);
  const last = done[done.length - 1];
  const tone = toneOfStatus(last.status);
  const INSET_H = 232;
  const STEPS_W = 440;
  // 最後の実績の札は、取組のページの図と同じ（いちばん新しい活動指標は「いまここ」、最新の報告に無い取組と前の活動指標は「最後の報告」）
  const here = run.group === 0 && last.y === LATEST ? 'いまここ' : '最後の報告';
  const chart = katsudouChart(run, INNER_W - 2 * STATS_PAD.x - STEPS_W - 20, INSET_H - 2 * STATS_PAD.y - 44, here);
  return frame(
    color('paper'),
    parentBar(null, g.latest.name, 'この指標の取組'),
    gap(8),
    heading(kicker('活動指標'), a.name, INNER_W, BODY_H - PARENT_H - 8 - 12 - INSET_H),
    gap(12),
    inset(
      { rowGap: 10, height: INSET_H },
      verdictLine(
        box({ alignItems: 'center', columnGap: 8, flexShrink: 0 }, icon(tone, null, 24), txt({ fontSize: 24 }, last.status || '—')),
        txt({ fontSize: 21, color: color('ink-2'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, `${yearLong(last.y)}の取組の進捗状況`, 1),
      ),
      box(
        { columnGap: 20, alignItems: 'center' },
        box(
          { flexDirection: 'column', rowGap: 4, width: chart ? STEPS_W : INNER_W - 2 * STATS_PAD.x, flexShrink: 0 },
          valueStep('計画', valueText(one(last.plan_raw)), ''),
          valueStep('実績', valueText(one(last.actual_raw)), ''),
          last.ach ? valueStep('達成割合', valueText(last.ach), parseFloat(last.ach.replace(/,/g, '')) >= 100 ? '計画クリア' : '') : null,
        ),
        chart,
      ),
    ),
  );
}

// ---------------------------------------------------------------- ページとカードの結び付け

export interface Card {
  page: string; // ページの URL（/shisaku/1-1-a-1/）
  image: string; // 画像の URL（/og/shisaku/1-1-a-1.png）
  alt: string; // og:image:alt
  node: () => El;
}

// 画像の URL。ページの URL の末尾の / を .png にして /og の下に置く
export const cardImage = (page: string) => `/og${page.replace(/\/$/, '')}.png`;

const LATEST_TEXT = yearLong(LATEST);
// 要素の木（node）は、ページの og:image のハッシュ（cardMeta）と画像を描くときの2回読むので、1度だけ作る
export const getCards = once((): Map<string, Card> => {
  const list: Omit<Card, 'image'>[] = [
    ...ROUTES['shisaku/[id]']().map(({ params, props: { s } }) => ({
      page: routePath('shisaku/[id]', params),
      alt: `施策「${s.name}」の${LATEST_TEXT}の県の判定と、主な取組の進捗状況・成果指標の達成率の内訳`,
      node: () => shisakuCard(s),
    })),
    ...ROUTES['kihon/[id]']().map(({ params, props: { k } }) => ({
      page: routePath('kihon/[id]', params),
      alt: `基本施策「${k.name}」の${LATEST_TEXT}の施策の判定と主な取組の進捗状況の内訳`,
      node: () => {
        const hd = kihonHead(k.id);
        return areaCard(color('paper'), kicker(sz(k.shouraizou), `将来像${k.shouraizou}の基本施策`), k.name, [judgeRow(hd), toriRow(hd.tori)]);
      },
    })),
    ...ROUTES['future/[id]']().map(({ params, props: { v } }) => ({
      page: routePath('future/[id]', params),
      alt: `将来像${v.id}「${v.name}」の${LATEST_TEXT}の施策の判定と主な取組の進捗状況の内訳`,
      node: () => {
        const hd = futureHead(v.id);
        return areaCard(color(`sz-${v.id}-wash`), kicker(sz(v.id), `将来像${v.id}`), v.name, [judgeRow(hd), toriRow(hd.tori)]);
      },
    })),
    ...ROUTES['theme/[id]']().map(({ params, props: { t } }) => ({
      page: routePath('theme/[id]', params),
      alt: `くらしのテーマ「${t.label}」（このサイト独自の分類）の${LATEST_TEXT}の施策の判定と主な取組の進捗状況の内訳`,
      node: () => {
        const hd = themeHead(t);
        const ic = img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="${color('ink')}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${themeIconParts(t.id)}</svg>`), 36);
        const own = txt({ fontSize: 20, color: color('ink'), padding: '1px 14px 3px', borderRadius: 999, border: `2px solid ${color('line')}`, background: color('pink') }, 'このサイト独自の分類');
        return areaCard(color('paper'), kicker(ic, 'くらしのテーマ', own), t.label, [judgeRow(hd), toriRow(hd.tori)]);
      },
    })),
    ...ROUTES['bukyoku/[slug]']().map(({ params, props: { dept } }) => ({
      page: routePath('bukyoku/[slug]', params),
      alt: `沖縄県${dept.name}の${LATEST_TEXT}の主な取組の進捗状況と、かかわる施策の判定の内訳`,
      // 部局のページは所管する取組が主なので、取組を先に置く（lib/describe.ts の deptDescription と同じ）
      node: () => {
        const hd = deptHead(dept.name);
        return areaCard(color('paper'), kicker('沖縄県の部局'), dept.name, [toriRow(hd.tori), judgeRow(hd, 'かかわる施策の判定')]);
      },
    })),
    ...ROUTES['torikumi/[shisaku]/[slug]']().map(({ params, props: { g } }) => ({
      page: routePath('torikumi/[shisaku]/[slug]', params),
      alt: `主な取組「${g.latest.name}」の${yearLong(g.latest.year)}の進捗状況と、活動指標の計画・実績、活動概要`,
      node: () => torikumiCard(g),
    })),
    ...ROUTES['shihyou/[shisaku]/[slug]']().map(({ params, props: { g } }) => ({
      page: routePath('shihyou/[shisaku]/[slug]', params),
      alt: `成果指標「${g.name}」の基準値・実績値・目標値と、計画値に対する達成率`,
      node: () => seikaCard(g),
    })),
    ...ROUTES['shuyou/[kihon]/[slug]']().map(({ params, props: { g } }) => ({
      page: routePath('shuyou/[kihon]/[slug]', params),
      alt: `主要指標「${g.latest.name}」の基準値・実績値・目標値と、県の見通し`,
      node: () => shuyouCard(g),
    })),
    ...ROUTES['katsudou/[shisaku]/[slug]']().map(({ params, props: { a } }) => ({
      page: routePath('katsudou/[shisaku]/[slug]', params),
      alt: `主な取組「${a.torikumi.latest.name}」の活動指標「${a.name}」の、年度ごとの計画と実績`,
      node: () => katsudouCard(a),
    })),
  ];
  return new Map(list.map((c) => [c.page, { ...c, node: once(c.node), image: cardImage(c.page) }]));
});

// ページの og:image（layouts/Base.astro）。カードの無いページは null（サイト共通の画像を使う）。
// 中身が変わると SNS が古い画像を出し続けないよう、中身のハッシュを ?v= に付ける（Cloudflare の静的ファイルはクエリを見ずに同じ画像を返す）
export function cardMeta(page: string) {
  const c = getCards().get(page);
  if (!c) return null;
  const v = crypto.createHash('sha1').update(JSON.stringify(c.node())).digest('hex').slice(0, 8);
  return { image: `${c.image}?v=${v}`, alt: c.alt };
}

// 使っている字（JUDGES など画面の区分の言葉は、カードに出ない区分も入れる。データが変わって新しい区分が出ても字が欠けないように）
export function cardChars() {
  const chars = new Set<string>();
  const add = (s: string) => { for (const c of s) chars.add(c); };
  for (const c of getCards().values()) add(textOf(c.node()));
  for (const c of [...STATUS_CATS, ...JUDGE_CATS, ...RATE_CATS]) add(c.label);
  for (const j of JUDGES) add(`${j.key} ${JUDGE_UI[j.key].short}`);
  add('0123456789,.%（）・〜—…');
  return [...chars].sort().join('');
}
