// 抽出済みデータ（data/extracted/soukatsu）をビルド時に読み込み、ページで使う形にまとめる。
// ブラウザには JSON を配らず、各ページの HTML として書き出す（県民のスマホで重くしないため）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { JudgeKey, Tone } from './icons.ts';
import { once, onceBy } from './memo.ts';
import { foldVariants } from './search.ts';
import { yearLabel, yearsLong } from './years.ts';
import { isNumOnly } from './text.ts';
import { BUDGET_RENAMES, SEIKA_RENAMES, TORIKUMI_RENAMES, TORIKUMI_REPOSTS } from './renames.ts';
import type {
  AmountKind, BudgetBlock, BukyokuFileRow, BukyokuTorikumiRow, ExtractedFiles, FinanceReference, KihonRow, ShisakuRow, ShouraizouRow, ShuyouGaiyouRow, ShuyouRow, SeikaRow, TorikumiRow,
} from './types.ts';

const ROOT = path.resolve(process.cwd(), '../data/extracted');
const cache = new Map<string, unknown>();
// name は soukatsu/ の下のファイル名。部局票の抽出結果は 'bukyoku/torikumi'、個別計画などは 'kanko/torikumi' のように指定する
export function load<K extends keyof ExtractedFiles>(name: K): ExtractedFiles[K] {
  const rel = name.includes('/') ? name : `soukatsu/${name}`;
  if (!cache.has(rel)) {
    cache.set(rel, JSON.parse(fs.readFileSync(path.join(ROOT, `${rel}.json`), 'utf-8')));
  }
  return cache.get(rel) as ExtractedFiles[K];
}

// Object.keys の型付き版（PATTERNS・JUDGE_TRENDS の名前を並べる）
const keysOf = <T extends object>(o: T) => Object.keys(o) as (keyof T)[];

// 区分（進捗状況・判定・達成率など）。key は報告書の言い方、tone は状態の色と形（lib/icons.ts）
export interface Category {
  key: string;
  tone: Tone;
  note?: string;
}

// 年度をまたいだ1つの取組・成果指標など（sameKey が同じもの）。key は最新の報告の名前の key。years は報告のある年度だけ持つ
export interface YearGroup<T> {
  key: string;
  latest: T;
  years: Record<number, T>;
}

export const YEARS = [2022, 2023, 2024, 2025];
export const LATEST = YEARS[YEARS.length - 1];
export { yearLabel, yearLong, yearsLong, yearRuns, PLAN_PERIODS, periodName, periodLabel, planIndex } from './years.ts';
export { withUnit } from './text.ts';
// 成果指標の実績値が何年度の値か（actual_ref_year）。報告書の書き方はまちまち（「（R4年度）」「R5」「速報値」「R7.5月未確定値」など）なので、
// 外側の括弧を外し、年度で終わるものにだけ「の値」を付ける。空なら ''
export const refText = (raw: string | null | undefined) => {
  const s = (raw || '').trim().replace(/^[（(]\s*|\s*[）)]$/g, '');
  return s && (/(年度?|R\s*[\d０-９元]+)$/.test(s) ? `${s}の値` : s);
};
// 主要指標（概要版）の値が何年・何年度の値か（base_ref・actual_ref・target_ref）。印字の書き方がまちまち（「令和5年度」「R３年度」「平成２９年度」）なので、
// 数字を半角に、元号を R・H にそろえる。「R3年」「R3年度」だけのものは「R3」にする（概要版の中でも同じ統計に年と年度が混じるため）。
// 日付や期間（「R7.1.1」「R6.10～R7.9」）はそのまま。空なら ''
export const eraRef = (raw: string | null | undefined) => {
  const s = halfWidth(raw || '').trim().replace(/令和/g, 'R').replace(/平成/g, 'H');
  return /^[RH]\d+年度?$/.test(s) ? s.replace(/年度?$/, '') : s;
};

// 主な取組の進捗状況。「記載なし」は PDF の欄が空欄・「-」のもの
export const STATUSES: Category[] = [
  { key: '順調', tone: 'good', note: '計画の90%以上' },
  { key: '概ね順調', tone: 'warning', note: '75%以上90%未満' },
  { key: 'やや遅れ', tone: 'serious', note: '60%以上75%未満' },
  { key: '大幅遅れ', tone: 'critical', note: '60%未満' },
  { key: '未着手', tone: 'none', note: '活動に未着手' },
  { key: '記載なし', tone: 'blank', note: '報告書の欄が空欄など' },
];
export const statusOf = (t: { status: string }) => t.status || '記載なし';
export const toneOfStatus = (s: string) => (STATUSES.find((x) => x.key === s) || STATUSES[5]).tone;

// 施策の推進状況（県の判定区分）。R5から施策ごとに公表されている
export const JUDGES: (Category & { key: JudgeKey; label: string })[] = [
  { key: 'A', label: '順調', tone: 'good' },
  { key: 'B', label: '概ね順調', tone: 'warning' },
  { key: 'C', label: '取組は順調だが、成果は遅れている', tone: 'serious' },
  { key: 'D', label: '取組は概ね順調だが、成果は遅れている', tone: 'serious' },
  { key: 'E', label: '成果は順調だが、取組は遅れている', tone: 'serious' },
  { key: 'F', label: '成果は概ね順調だが、取組は遅れている', tone: 'serious' },
  { key: 'G', label: '大幅遅れ', tone: 'critical' },
];
export const judgeOf = (key: string | null | undefined) => JUDGES.find((j) => j.key === key);

// 県の概要版の「施策評価の判定基準」区分表（R4〜R7 とも同じ）。y は主な取組のうち「順調」の割合、x は成果指標の計画値に対する達成率（%）。
// A と B は「順調」の割合40%以上の2段にまたがり、C・D は達成率40%未満の列を「順調」の割合80%で分ける（components/JudgeMatrix.astro のマス）。
// 範囲は [下限, 上限)。y・x のラベルは画面の説明に使う
export const JUDGE_CELLS = [
  { key: 'A', y: [40, Infinity], x: [80, Infinity], yText: '40%以上', xText: '80%以上' },
  { key: 'B', y: [40, Infinity], x: [40, 80], yText: '40%以上', xText: '40〜80%' },
  { key: 'C', y: [80, Infinity], x: [-Infinity, 40], yText: '80%以上', xText: '40%未満' },
  { key: 'D', y: [40, 80], x: [-Infinity, 40], yText: '40〜80%', xText: '40%未満' },
  { key: 'E', y: [-Infinity, 40], x: [80, Infinity], yText: '40%未満', xText: '80%以上' },
  { key: 'F', y: [-Infinity, 40], x: [40, 80], yText: '40%未満', xText: '40〜80%' },
  { key: 'G', y: [-Infinity, 40], x: [-Infinity, 40], yText: '40%未満', xText: '40%未満' },
] as const;
export const judgeByGrid = (y: number, x: number) => JUDGE_CELLS.find((c) => y >= c.y[0] && y < c.y[1] && x >= c.x[0] && x < c.x[1])!.key;

// 施策の判定の移り変わり（施策をさがすの「判定の移り変わり」）。数え方はここだけで決め、施策の trends に入れる。判定は R5 から（R4 は公表されていない）。
// 上がった・下がったは、判定を A 順調 → B 概ね順調 → C〜F（取組か成果が遅れている）→ G 大幅遅れ の順に並べて前の年度と比べる（C〜F の中での入れ替わりは数えない）
// ranks は年度の順の判定の順位（判定の無い年度は null）
type Ranks = (number | null)[];
const JUDGE_RANK: Record<string, number> = { good: 0, warning: 1, serious: 2, critical: 3 };
const judgeRank = (key: string | null) => JUDGE_RANK[judgeOf(key)?.tone ?? ''] ?? null;
const bothYears = (r: Ranks) => r.at(-2) != null && r.at(-1) != null;
export const JUDGE_TRENDS = {
  down: (r) => bothYears(r) && r.at(-1)! > r.at(-2)!, // 前の年度より下がった
  up: (r) => bothYears(r) && r.at(-1)! < r.at(-2)!, // 前の年度より上がった
  streak: (r) => r.slice(-3).every((x) => x != null && x >= JUDGE_RANK.serious), // 最新の年度まで3年続けて C〜G
} satisfies Record<string, (r: Ranks) => boolean>;
export type JudgeTrend = keyof typeof JUDGE_TRENDS;

// 成果指標の計画値に対する達成率の区分（概要版と同じ区切り）
export const RATE_BINS: Category[] = [
  { key: '100%以上', tone: 'good' },
  { key: '60%以上100%未満', tone: 'warning' },
  { key: '0%超60%未満', tone: 'serious' },
  { key: '0%以下', tone: 'critical' },
  { key: '達成率なし', tone: 'blank', note: '報告書の達成率が「-」など' },
];
// 達成率の欄（成果指標の行）
type Rate = Pick<SeikaRow, 'rate' | 'rate_raw'>;
export function rateBin(s: Rate) {
  if (s.rate_raw === '達成') return '100%以上';
  if (s.rate_raw === '未達成') return '0%以下';
  if (s.rate == null) return '達成率なし';
  if (s.rate >= 100) return '100%以上';
  if (s.rate >= 60) return '60%以上100%未満';
  if (s.rate > 0) return '0%超60%未満';
  return '0%以下';
}
// 一覧の行の達成率の札（施策・成果指標の一覧）。文字は数字だけで（「達成」「未達成」とだけ書かれた指標はその言葉）、色と形は RATE_BINS の区分
export const rateText = (s: Rate) => (s.rate != null ? `${s.rate}%` : s.rate_raw === '達成' || s.rate_raw === '未達成' ? s.rate_raw : 'なし');
export const rateTone = (s: Rate) => RATE_BINS.find((b) => b.key === rateBin(s))?.tone;

// 成果指標1つが計画値に届いたか（施策ページのカードと、SNS のカードの画像 lib/card.ts）。
// 札（chip）の色と形は達成率の区分（RATE_BINS）、文（text）は区分ごとに言い切る
type GoalRow = Pick<SeikaRow, 'year' | 'rate' | 'rate_raw' | 'base' | 'actual' | 'target'>;
export function seikaVerdict(x: GoalRow) {
  const yl = yearLabel(x.year);
  const { base, actual, target } = x;
  const nums = base != null && actual != null && target != null && [base, actual, target].every((v) => Number.isFinite(v)) && target !== base;
  // スタートの基準値からゴールの目標値までのどこまで来たか（1でゴール）
  const progress = nums ? (actual - base) / (target - base) : null;
  const bin = rateBin(x);
  const chip = x.rate != null ? `達成率 ${x.rate}%` : x.rate_raw === '達成' || x.rate_raw === '未達成' ? x.rate_raw : '達成率なし';
  // 「達成」とだけ書かれた指標は、印字の数では計画値に届いていないものもあるので、県の判断として書く
  const text = {
    '100%以上': x.rate_raw === '達成' ? `県の報告書では${yl}の計画値を「達成」としています`
      : progress != null && progress > 1 ? `${yl}の計画値に届き、ゴールの目標値も超えています`
      : progress === 1 ? `${yl}の計画値に届き、ゴールの目標値にも届いています` : `${yl}の計画値に届いています`,
    '60%以上100%未満': `${yl}の計画値にまだ届いていません`,
    '0%超60%未満': `${yl}の計画値にまだ届いていません`,
    '0%以下': progress != null && progress < 0 ? 'スタートの基準値より悪くなっています' : x.rate_raw === '未達成' ? `${yl}の計画値に届いていません` : 'スタートの基準値から進んでいません',
    '達成率なし': '県の報告書に達成率がありません',
  }[bin];
  return { tone: RATE_BINS.find((b) => b.key === bin)?.tone, chip, text, down: nums && target < base };
}

// 成果指標の「達成状況」欄（目標の見通し）
export const JUDGEMENTS: Category[] = [
  { key: '目標達成', tone: 'good' },
  { key: '目標達成の見込み', tone: 'good' },
  { key: '達成に努める', tone: 'warning' },
  { key: '達成は困難', tone: 'critical' },
];
export const toneOfJudgement = (j: string | null | undefined) => JUDGEMENTS.find((x) => x.key === j)?.tone;

const DEPT_RE = /(知事公室|県警本部|警察本部|教育庁|企業局|病院事業局|.+?部)/g;
// 関係部等は「、」「,」で区切られていることがある（抽出で欄の中の改行を「、」にしたもの・R6以降の印字の「,」）。区切ってから部局の名前を探す
export const splitDepts = (s: string | null | undefined): string[] => (s || '').split(/[、,，]/).flatMap((x) => x.trim().match(DEPT_RE) || []);

export function countBy<T>(rows: T[], keyFn: (r: T) => string, keys: string[]) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = keyFn(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// 主な取組の進捗状況の内訳（STATUSES の並びのまま、0の区分も残す）。keyOf は1件の進捗状況（行なら statusOf）
export const countStatuses = <T>(rows: T[], keyOf: (r: T) => string) => countBy(rows, keyOf, STATUSES.map((s) => s.key));
// 成果指標の計画値に対する達成率の内訳（RATE_BINS の並びのまま、0の区分も残す）
export const countRates = (rows: Rate[]) => countBy(rows, rateBin, RATE_BINS.map((b) => b.key));

// ページの URL が重ならないか（重なると、どちらかのページが書き出されない）。what は「取組のページ」など
export function assertUnique<T>(items: T[], url: (x: T) => string, what: string) {
  const seen = new Set<string>();
  for (const x of items) {
    if (seen.has(url(x))) throw new Error(`${what}の URL が重複している: ${url(x)}`);
    seen.add(url(x));
  }
}

// 施策 ID の報告書の順（1-1-a-10 を 1-1-a-9 の後ろに）
const idOrder = (sid: string) => sid.split('-').map((x) => (/^\d+$/.test(x) ? x.padStart(3, '0') : x)).join('-');
export const compareShisakuId = (a: string, b: string) => idOrder(a).localeCompare(idOrder(b));

// ---------------------------------------------------------------- 将来像・基本施策

// 将来像の名前。県の総括報告書（付属資料）は将来像ごとの章の見出しの形「〜島を目指して」で印字しているが、
// 基本計画の概念図などでは将来像そのものを「〜島」と呼ぶので、画面では語尾の「を目指して」を外す（データは印字のまま）
export const shouraizouName = (printed: string) => printed.replace(/を目指して$/, '');

export const getShouraizou = once(() => load('shouraizou').filter((s) => s.year === LATEST).map((s) => ({ ...s, name: shouraizouName(s.name) })));

export const getKihonList = once(() => {
  const all = load('kihon');
  return all
    .filter((k) => k.year === LATEST)
    .map((k) => ({
      ...k,
      // 目指す姿が読み取れなかった年度は、他の年度の記載で補う（基本計画で固定の文章）
      mezasu: k.mezasu || all.find((x) => x.id === k.id && x.mezasu)?.mezasu || '',
    }));
});

// 主要指標の数（県の概要版「主要指標の達成状況」の「主要指標N指標」。R4〜R7 とも49）。付属資料の表は1行に複数の指標が並ぶので、行の数（37）とは違う
export const SHUYOU_COUNT: Record<number, number> = { 2022: 49, 2023: 49, 2024: 49, 2025: 49 };

// 付属資料の主要指標の1行に並ぶ指標の数（県の数え方。見通しの欄の名前「男性:」「女性:」などの数で、名前が無ければ1）
export const shuyouPartCount = (r: { judgement: string | null }) => Math.max(1, judgesOf(r.judgement)?.length ?? 0);

// 親1つあたりの子の数の幅（「4〜13」）。size は子1つの数（主要指標の行なら shuyouPartCount）
export function childRange<T>(rows: T[], parent: (r: T) => string | number, size: (r: T) => number = () => 1) {
  const n = new Map<string | number, number>();
  for (const r of rows) n.set(parent(r), (n.get(parent(r)) || 0) + size(r));
  const v = [...n.values()];
  return `${Math.min(...v)}〜${Math.max(...v)}`;
}

export function getShuyou(kihonId: string) {
  return load('shuyou').filter((s) => s.kihon_id === kihonId);
}

export function getShuyouByYear(year: number) {
  return load('shuyou').filter((s) => s.year === year);
}

// 主要指標は報告書の文字のまま持っている（基準値に基準年が付く・1つの欄に男女別などの値が並ぶ・目標値が文章のものがある）。
// 成果指標と同じ「ゴールまでの道のり」の図に置くため、ここで数を読み取る。画面に出す値は報告書の文字で、読み取った数は図の位置にだけ使う
const MULT: Record<string, number> = { 兆: 1e12, 億: 1e8, 百万: 1e6, 万: 1e4, 千: 1e3 };
const MULT_NAME = Object.fromEntries(Object.entries(MULT).map(([k, v]) => [v, k]));
// 全角の英数字と「，」「．」「％」を半角にする（「㎡」「CO₂」はそのまま）。報告書の印字は全角と半角がまじる（計画「１施設」・実績「1施設」）ので、
// 値を半角にそろえて見せるところ（ページとカードの画像）はどこもこれを使う
export const halfWidth = (s: string) => s.replace(/[０-９Ａ-Ｚａ-ｚ．，％]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
// 欄の中の折り返しを詰める（日本語の言葉の途中で折り返しているので、空白を入れない）
export const joinCell = (raw: string | null | undefined) => (raw || '').replace(/\s*\n\s*/g, '').trim();

// 「1,032万t-CO₂」「３兆2,885億円」「8,060億92百万円」を { value: 数, scale: 最初の位（万なら1e4）, unit: 位の後ろの単位 } にする。数と単位だけの値でなければ null
function jaNum(text: string) {
  const s = halfWidth(text).replace(/,/g, '').replace(/^△/, '-');
  const re = /(-?\d+(?:\.\d+)?)(兆|億|百万|万|千)?/y;
  let value = 0;
  let scale: number | null = null;
  let last = Infinity;
  let end = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const k = MULT[m[2]] || 1;
    if (k >= last) return null;
    value += Number(m[1]) * k;
    scale ??= k;
    last = k;
    end = re.lastIndex;
    if (k === 1) break;
  }
  const unit = s.slice(end).trim();
  return scale == null || /\d/.test(unit) ? null : { value, scale, unit };
}

// 1つの指標のスタート・いま・ゴールの値の位をそろえる。県の印字は同じ指標の中でも位がまちまち（「32,866億円 → 3兆4,517億円」）なので、
// 同じ単位の数の値で位が違うときは、いちばん小さい位に書き直す（「3兆4,517億円」→「34,517億円」）。割り切れないもの・文の値は印字のまま。画面に出すときだけ
const intFmt = new Intl.NumberFormat('ja-JP');
export function sameScale(texts: string[]): string[] {
  const ns = texts.map((t) => jaNum(t));
  const nums = ns.filter((n): n is NonNullable<typeof n> => n != null);
  if (nums.length < 2 || new Set(nums.map((n) => n.unit.normalize('NFKC'))).size > 1) return texts;
  const to = Math.min(...nums.map((n) => n.scale));
  return texts.map((t, i) => {
    const n = ns[i];
    if (!n || n.scale === to) return t;
    const v = n.value / to;
    return Math.abs(v - Math.round(v)) < 1e-6 ? `${intFmt.format(Math.round(v))}${MULT_NAME[to] ?? ''}${n.unit}` : t;
  });
}

// 欄の値。数と単位の後ろが括弧（基準年・「速報値」など。PDF で途中で切れて閉じていないものも）だけなら、括弧を note に分けて数を読む。
// 文章の値（「可能な限り減少させる」など）や、1つの欄に値が並ぶもの（「1,117億円（R３年）農業922億円…」）は value が null
type NumCell = { text: string; note: string; value: number; scale: number; unit: string };
export type Cell = NumCell | { text: string; note: string; value: null };
function cellOf(raw: string | null | undefined): Cell {
  const s = joinCell(raw);
  const [, text, note] = s.match(/^(.*?)((?:\s*[（(][^（()）]*(?:[）)]|$))*)$/)!;
  const n = jaNum(text);
  return n ? { text: halfWidth(text), note: halfWidth(note.trim()), ...n } : { text: halfWidth(s) || '—', note: '', value: null };
}
const unitKey = (c: Cell) => (c.value == null ? null : c.unit.normalize('NFKC'));

// 見通しの欄を [{ label, key }] にする。「男性:目標達成\n女性:達成は困難」のように1つの欄に並ぶものは名前ごとに分ける。決まった言い方でできていなければ null
const JUDGE_KEYS = JUDGEMENTS.map((j) => j.key).sort((a, b) => b.length - a.length);
export function judgesOf(raw: string | null | undefined) {
  const s = joinCell(raw);
  if (JUDGE_KEYS.includes(s)) return [{ label: '', key: s }];
  const out: { label: string; key: string }[] = [];
  let end = 0;
  for (const m of s.matchAll(new RegExp(`(.*?)[:：](${JUDGE_KEYS.join('|')})`, 'gy'))) {
    out.push({ label: m[1].trim(), key: m[2] });
    end = m.index + m[0].length;
  }
  return out.length && end === s.length ? out : null;
}

// 1つの欄に並ぶ値を、見通しの欄の名前（男性・女性など）で分ける。欄が名前で始まり、名前が順に見つかるときだけ
function splitByLabels(raw: string, labels: string[]) {
  const s = joinCell(raw);
  const at: number[] = [];
  for (const l of labels) {
    const i = s.indexOf(l, at.length ? at[at.length - 1] + 1 : 0);
    if (i < 0 || (!at.length && i !== 0)) return null;
    at.push(i);
  }
  return labels.map((l, k) => s.slice(at[k] + l.length, at[k + 1] ?? s.length).trim());
}

// 道のりの図（components/SeikaChart.astro）に渡す1年度分。成果指標の行（SeikaRow）はそのまま渡せる
export type ChartYear = Pick<SeikaRow, 'year' | 'base' | 'actual' | 'target' | 'plan' | 'plan_raw' | 'base_raw' | 'actual_raw' | 'actual_ref_year' | 'target_raw' | 'target_year'>;
// 道のりの図に渡す指標。成果指標の年度をまたいだまとまり（SeikaGroup）と、主要指標の部分（ShuyouPart）を渡せる。name は読み上げる名前
export interface ChartRow {
  name: string;
  latest: { year: number };
  years: Record<number, ChartYear>;
}
// 主要指標の部分の1年度分。b・a・t は基準値・実績値・目標値の欄を読んだもの（画面には text を出す）
export interface ShuyouYear extends ChartYear {
  b: Cell;
  a: Cell;
  t: Cell;
  judgement: string;
}
export interface ShuyouPart {
  label: string; // 男性・女性など（分けない指標は ''）
  name: string;
  years: Record<number, ShuyouYear>;
  unit: string; // 図の目盛りの位と単位
  scale: number;
  drawable: boolean;
  goal: boolean; // 目標値が数で読めるか（読めなければゴールの丸を置かない）
  latest: ShuyouYear & { name: string };
}

// 主要指標1つの図と「スタート → いま → ゴール」の材料（部分ごと）。男性・女性のように1つの欄に並ぶ指標は、最新の報告の見通しの名前で分ける
// （どの年度も分けられた年度だけを載せる）。分けられない指標は1つのまま。形は成果指標の行（SeikaChart の row）に合わせる
function shuyouParts(latest: ShuyouRow, years: Record<number, ShuyouRow>): ShuyouPart[] {
  const labels = (judgesOf(latest.judgement) || []).map((j) => j.label);
  const pick = (x: ShuyouRow) => [x.base_raw, x.actual_raw, x.target_raw].map((raw) => splitByLabels(raw, labels));
  const split = labels.length > 1 && labels.every(Boolean) && pick(latest).every(Boolean);
  const parts = (split ? labels : ['']).map((label) => ({ label, name: label ? `${latest.name}（${label}）` : latest.name, cells: {} as Record<number, PartCells> }));
  for (const [y, x] of Object.entries(years)) {
    const cells: (string[] | null)[] = split ? pick(x) : [[x.base_raw], [x.actual_raw], [x.target_raw]];
    if (!cells.every((c): c is string[] => c != null)) continue;
    const judges = judgesOf(x.judgement);
    parts.forEach((p, i) => {
      const [b, a, t] = cells.map((c) => cellOf(c[i]));
      p.cells[+y] = { year: +y, b, a, t, judgement: split ? judges?.find((j) => j.label === p.label)?.key || '' : x.judgement };
    });
  }
  return parts.map(({ label, name, cells }) => partOf(label, name, cells, latest.year));
}

// 主要指標の部分の1年度分の欄（基準値・実績値・目標値を読んだもの）
type PartCells = Pick<ShuyouYear, 'year' | 'b' | 'a' | 't' | 'judgement'>;
// 年度ごとの欄から、図に渡す主要指標の部分を作る。図の目盛りの位と単位は、最新の報告（latestYear）の目標値（なければ基準値・実績値）の書き方に合わせる
function partOf(label: string, name: string, cells: Record<number, PartCells>, latestYear: number): ShuyouPart {
  const cur = cells[latestYear];
  const ref = [cur.t, cur.b, cur.a].find((c): c is NumCell => c.value != null);
  const scaled = (c: Cell) => (ref && c.value != null && (!c.unit || unitKey(c) === unitKey(ref)) ? c.value / ref.scale : null);
  const years: Record<number, ShuyouYear> = {};
  for (const [y, r] of Object.entries(cells)) {
    years[+y] = {
      ...r,
      base: scaled(r.b), actual: scaled(r.a), target: scaled(r.t),
      base_raw: r.b.text, actual_raw: r.a.text, actual_ref_year: r.a.note, target_raw: r.t.text,
      target_year: r.year <= 2024 ? 'R6年度' : 'R9年度', plan: [], plan_raw: [],
    };
  }
  // 図は、実績値と基準値か目標値が数で読めれば描く（目標値が「可能な限り減少させる」のような文の指標も、スタートからの動きを見せる）
  const ys = Object.values(years);
  const goal = ys.some((r) => r.target != null);
  const drawable = ys.some((r) => r.actual != null) && (goal || ys.some((r) => r.base != null));
  return { label, name, years, unit: ref ? `${MULT_NAME[ref.scale] || ''}${ref.unit}` : '', scale: ref?.scale ?? 1, drawable, goal, latest: { ...years[latestYear], name } };
}
// 主要指標の部分の、数だけの値に添える単位（図の目盛りにも使う）。図の位が1でない指標（万t-CO₂ など）は、位の書かれていない数に単位を添えない（どの位の数か分からないため）
export const shuyouUnit = (p: ShuyouPart) => (p.scale === 1 ? p.unit : '');
// 主要指標の部分の最新の報告のスタート・いま・ゴールの値（ページのカードと SNS のカードの画像）。位は1つの部分の中でそろえ（sameScale。印字は「3兆2,885億円 → 34,516億円」のようにまちまち）、
// 数だけの値には単位を添える
export const shuyouSteps = (p: ShuyouPart) =>
  sameScale([p.latest.b.text, p.latest.a.text, p.latest.t.text]).map((text) => ({ text, unit: isNumOnly(text) ? shuyouUnit(p) : '' }));

// 成果指標で目標値が文のもの（「跡地における事業の取組を目指す」など）の図の材料。基準値・実績値も「3区域」「男性72.11年」のように
// 単位や名前（指標の名前の括弧の中）付きで書かれていて数になっていないので、主要指標と同じように読む。図はゴールの丸を置かず、スタートと実績値だけを描く。
// 目標が「〜との差の縮小」のもの（県平均・全国一位の都道府県との差）は、値の図では目標に近づいたか分からないので描かない。描けなければ null
export function textGoalChartRow(row: SeikaGroup): SeikaGroup | null {
  const rs = Object.values(row.years);
  if (rs.some((r) => r.target != null || /差/.test(r.target_raw || ''))) return null;
  const read = (r: SeikaRow, raw: string) => {
    const label = r.name.match(/[（(]([^（()）]+)[)）]$/)?.[1];
    const s = joinCell(raw);
    const c = cellOf(label && s.startsWith(label) ? s.slice(label.length) : s);
    if (c.value == null) return null;
    const u = `${MULT_NAME[c.scale] || ''}${c.unit}`.normalize('NFKC');
    if (!u) return c.value;
    return u === (r.unit || '').normalize('NFKC') ? c.value / c.scale : null;
  };
  const years = Object.fromEntries(Object.entries(row.years).map(([y, r]) => [y, { ...r, base: r.base ?? read(r, r.base_raw), actual: r.actual ?? read(r, r.actual_raw) }]));
  const vs = Object.values(years);
  return vs.some((r) => r.actual != null) && vs.some((r) => r.base != null) ? { ...row, years } : null;
}

// 基本施策の主要指標を、年度をまたいだ指標ごとのまとまりにする。最新の報告の指標ごとに、4年分の行を名前で結び付ける
// （名前が少し変わった年度は、その年度の指標が1つだけで単位が同じなら同じ指標とみなす。ただし基準値の年が同じなのに基準値が違うものは、
// 調査の設問などが変わった別の指標とみなす。5-(2) の「将来の夢や目標を持ち、自らやると決めたことをやり遂げる〜」（R3 小学校82.3%）と
// R7の「〜課題の解決に向けて、自分で考え、自分から取り組んでいる〜」（R3 小学校78.3%））。
// どれにも結び付かなかった行（最新の報告に無い指標）も、名前ごとに1つのまとまりにして、ページから落とさない
export interface ShuyouGroup {
  latest: ShuyouRow;
  years: Record<number, ShuyouRow>;
  parts: ShuyouPart[];
}
export const shuyouRows = onceBy((kihonId: string): ShuyouGroup[] => {
  const rows = getShuyou(kihonId);
  const latestRows = rows.filter((r) => r.year === LATEST);
  const used = new Set<ShuyouRow>();
  const unitOf = (r: ShuyouRow) => [r.target_raw, r.base_raw, r.actual_raw].map((raw) => unitKey(cellOf(raw))).find((u) => u != null);
  const sameUnit = (a: ShuyouRow, b: ShuyouRow) => !unitOf(a) || !unitOf(b) || unitOf(a) === unitOf(b);
  const baseText = (r: ShuyouRow) => joinCell(r.base_raw).normalize('NFKC').replace(/\s/g, '');
  const baseYear = (r: ShuyouRow) => baseText(r).match(/\((R\d+)年度?\)/)?.[1];
  const sameBase = (a: ShuyouRow, b: ShuyouRow) => !baseYear(a) || baseYear(a) !== baseYear(b) || baseText(a) === baseText(b);
  const group = (r: ShuyouRow, single: boolean) => {
    const years: Record<number, ShuyouRow> = {};
    for (const y of YEARS) {
      const ys = rows.filter((x) => x.year === y && !used.has(x));
      const x = y === r.year ? r : ys.find((q) => q.name === r.name) || (single && ys.length === 1 && sameUnit(ys[0], r) && sameBase(ys[0], r) ? ys[0] : null);
      if (x) {
        used.add(x);
        years[y] = x;
      }
    }
    return { latest: r, years, parts: shuyouParts(r, years) };
  };
  const out = latestRows.map((r) => group(r, latestRows.length === 1));
  for (const r of [...rows].sort((a, b) => b.year - a.year)) if (!used.has(r)) out.push(group(r, false));
  return out;
});
// 基本施策ページの主要指標のカードの id（#shuyou-1, #shuyou-2 …。shuyouRows の順で、最新の報告の指標が先）。将来像のページの主要指標の名前から飛ぶ
export const shuyouAnchor = (groups: ShuyouGroup[], g: ShuyouGroup) => `shuyou-${groups.indexOf(g) + 1}`;

// すべての基本施策の主要指標。href は基本施策のページのカード（anchor はその id）、share はシェア用のページ
// （/shuyou/<基本施策ID>/<key のハッシュ8桁>/。key は基本施策の中の最新の報告の名前で、同じ名前が2つあれば #2。年度をまたいで同じで、名前が変わると別の URL）
export interface ShuyouGroupOfKihon extends ShuyouGroup {
  kihon: KihonRow;
  key: string;
  anchor: string;
  href: string;
  share: string;
}
export const getShuyouGroups = once((): ShuyouGroupOfKihon[] => {
  const list = getKihonList().flatMap((k) => {
    const groups = shuyouRows(k.id);
    const seen = new Map<string, number>();
    return groups.map((g) => {
      const base = `${k.id}|${nameKey(g.latest.name)}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const key = `${base}#${n}`;
      const anchor = shuyouAnchor(groups, g);
      return { ...g, kihon: k, key, anchor, href: `/kihon/${k.id}/#${anchor}`, share: `/shuyou/${k.id}/${keySlug(key)}/` };
    });
  });
  assertUnique(list, (g) => g.share, '主要指標のシェア用のページ');
  return list;
});

// ---------------------------------------------------------------- 主要指標の達成状況（概要版）

// 主要指標の達成状況の区分（概要版「主要指標の達成状況1」の表と同じ。前進のうち 100%以上・60%以上・60%未満、横ばい、後退、その他）。
// 達成率は計画期間の最後（中期はR9、前期はR6）の目標値に対する割合で、成果指標の達成率（その年度の計画値に対する割合）とは違う。
// 区分は概要版の表の達成率の印字で決める（scripts/check_extracted.py の shuyou_bin と同じ数え方）。目標が数でない指標（「増加」
// 「可能な限り減少させる」など）は、県が「達成」「後退」と印字している。「-」は統計がまだ出ていないなどで比べられないもの
// 色と形（tone）は成果指標の達成率の区分（RATE_BINS）にそろえ、横ばいは未着手と同じ灰色の「—」、比べられないものは空の印にする。
// word は札に書く県の言葉（5つの将来像のページの「後退 -6%」の札。前進は60%の上下を分けない）
export const SHUYOU_BINS = [
  { key: '100%以上', label: '目標値に到達', word: '到達', tone: 'good' },
  { key: '60%以上100%未満', label: '前進（60%以上）', word: '前進', tone: 'warning' },
  { key: '0%超60%未満', label: '前進（60%未満）', word: '前進', tone: 'serious' },
  { key: '横ばい', label: '横ばい', word: '横ばい', tone: 'none' },
  { key: '後退', label: '後退', word: '後退', tone: 'critical' },
  { key: 'その他', label: '比べられない', word: '比べられない', tone: 'blank' },
] as const satisfies readonly { key: string; label: string; word: string; tone: Tone }[];
export type ShuyouBin = (typeof SHUYOU_BINS)[number]['key'];
type ShuyouRate = Pick<ShuyouGaiyouRow, 'rate' | 'rate_raw'>;
export function shuyouBin(r: ShuyouRate): ShuyouBin {
  const t = r.rate_raw.normalize('NFKC').trim();
  if (t === '達成' || t === '100%以上' || (r.rate != null && r.rate >= 100)) return '100%以上';
  if (r.rate != null) return r.rate >= 60 ? '60%以上100%未満' : r.rate > 0 ? '0%超60%未満' : r.rate === 0 ? '横ばい' : '後退';
  return t === '後退' ? '後退' : 'その他';
}
// 前進（基準値より良くなった）の区分
export const SHUYOU_FORWARD: ShuyouBin[] = ['100%以上', '60%以上100%未満', '0%超60%未満'];
export const shuyouBinOf = (bin: ShuyouBin) => SHUYOU_BINS.find((b) => b.key === bin)!;
// 達成率の札の文字（「51%」「達成」「後退」。比べられないものは「—」）
export const shuyouRateText = (r: ShuyouRate) => (r.rate != null ? `${r.rate}%` : shuyouBin(r) === 'その他' ? '—' : r.rate_raw.normalize('NFKC').trim());
// 主要指標の達成状況の区分の内訳の棒（components/StatusBar.astro）に渡す区分と、区分ごとの数。棒の区間と読み上げは概要版の言葉（「目標値に到達」など）で出す。
// トップと将来像のページの頭の3つの段（Ladder。つながった棒）と、トップの将来像の行（Tiers。1指標1マスのマス目の棒）が使う
export const SHUYOU_CATS = SHUYOU_BINS.map((b) => ({ key: b.label, tone: b.tone }));
export const shuyouCounts = (rows: { bin: ShuyouBin }[]) => countBy(rows, (r) => shuyouBinOf(r.bin).label, SHUYOU_CATS.map((c) => c.key));

// 概要版の指標（1指標1行）が、付属資料のどの主要指標（基本施策ページのカード）にあたるか。カードの id を返す。
// 基本施策の主要指標が1つならそれ（男性・女性などはカードの中の部分）、2つ以上（3-(12) の県内空港の旅客数・重要港湾の公共取扱貨物量）なら名前で選ぶ
// どの年度の行でも、その年度の付属資料の行を持つカードから選ぶ
function shuyouCardId(r: ShuyouGaiyouRow) {
  const groups = shuyouRows(r.kihon_id);
  const now = groups.filter((g) => g.years[r.year]);
  const key = (s: string) => s.normalize('NFKC').replace(/[\s※]/g, '');
  const name = (g: ShuyouGroup) => key(g.years[r.year].name);
  const g = now.length === 1 ? now[0] : now.find((g) => key(r.name).startsWith(name(g)) || name(g).startsWith(key(r.name))) ?? now[0];
  return g ? shuyouAnchor(groups, g) : 'shuyou';
}
// 2つの年度の概要版の行が、同じ主要指標（基本施策ページの同じカード）か。指標のマップで年度をつなぐときに使う
// （概要版の行の番号は R4〜R7 で同じだが、4-(1) の No.38・5-(2) の No.44・45 は R7 で別の指標に入れ替わっている）
export const sameShuyouCard = (a: ShuyouGaiyouRow, b: ShuyouGaiyouRow) => a.kihon_id === b.kihon_id && shuyouCardId(a) === shuyouCardId(b);
// 概要版の行（どの年度でも）の、基本施策ページのカードの URL
export const shuyouCardHref = (r: ShuyouGaiyouRow) => `/kihon/${r.kihon_id}/#${shuyouCardId(r)}`;

export interface ShuyouStatus extends ShuyouGaiyouRow {
  bin: ShuyouBin;
  kihon: { id: string; name: string; code: string; shouraizou: number };
  href: string; // 基本施策ページのその主要指標のカード
}
// 最新の報告の主要指標の達成状況（概要版の表の順。良い・悪いで並べ替えない）。概要版の表が読めない年度は空
export const getShuyouStatus = once((): ShuyouStatus[] => {
  const kihon = new Map(getKihonList().map((k) => [k.id, k]));
  const latest = load('shuyou_gaiyou').filter((r) => r.year === LATEST);
  return latest.map((r) => {
    const k = kihon.get(r.kihon_id)!;
    return {
      ...r, bin: shuyouBin(r),
      kihon: { id: k.id, name: k.name, code: k.code, shouraizou: k.shouraizou },
      href: shuyouCardHref(r),
    };
  });
});
// 基本施策ページの主要指標のカードに置く、最新の年度の概要版の達成状況の札（将来像のページと同じ components/ShuyouTags.astro）。
// 概要版は男性・女性などを分けた1指標1行なので、カードを部分に分けていて行の数が部分の数と同じなら、報告書の順で部分ごとに当てる
// （概要版の行の順は付属資料の欄の中の順と同じ）。当てられない行（付属資料の欄が分けられない 2-(8)・3-(7)）は、カードの頭にまとめる
export function shuyouStatusOfCard(g: Pick<ShuyouGroupOfKihon, 'href' | 'parts'>): { head: ShuyouStatus[]; parts: ShuyouStatus[][] } {
  const rows = getShuyouStatus().filter((r) => r.href === g.href);
  return g.parts.length > 1 && rows.length === g.parts.length
    ? { head: [], parts: rows.map((r) => [r]) }
    : { head: rows, parts: g.parts.map(() => []) };
}

// ---------------------------------------------------------------- 施策

// 施策（最新の報告の行に、4年分の行・判定と、取組・成果指標の全年度の行を付けたもの）
export interface Shisaku extends ShisakuRow {
  years: Record<number, ShisakuRow>;
  judges: Record<number, string | null>;
  trends: JudgeTrend[];
  depts: string[];
  torikumi: TorikumiRow[];
  seika: SeikaRow[];
}

export const getShisakuList = once(() => {
  const tori = Map.groupBy(load('torikumi'), (t) => t.shisaku_id);
  const seika = Map.groupBy(load('seika'), (s) => s.shisaku_id);
  const list: Shisaku[] = [];
  for (const [id, rows] of Map.groupBy(load('shisaku'), (s) => s.id)) {
    const years = Object.fromEntries(rows.map((s) => [s.year, s]));
    const latest = years[LATEST];
    const judges = Object.fromEntries(YEARS.map((y) => [y, years[y]?.judge ?? null]));
    const ranks = YEARS.map((y) => judgeRank(judges[y]));
    list.push({
      ...latest,
      years,
      judges,
      trends: keysOf(JUDGE_TRENDS).filter((k) => JUDGE_TRENDS[k](ranks)),
      depts: splitDepts(latest.kankei),
      torikumi: tori.get(id) || [],
      seika: seika.get(id) || [],
    });
  }
  return list.sort((a, b) => compareShisakuId(a.id, b.id));
});

export function getShisaku(id: string) {
  return getShisakuList().find((s) => s.id === id);
}

// ページの階層（components/Hierarchy.astro）の1段。いまのページの上の段だけを並べる。href の無い段（施策展開）は、ページが無いのでリンクにしない
export interface PathItem {
  label: string;
  href?: string;
  code?: string; // 報告書の番号のうち、その段の分（「(1)」「ア」「①」）
  kind?: string; // 段の名前（読み上げ用）
  title?: string; // 番号の title（報告書での番号の全体）
  sz?: number; // 将来像の番号（色の丸で出す）
}

// 計画の体系での、将来像から at の段まで（将来像 → 基本施策 → 施策展開 → 施策）。主な取組のページの階層は、入っている施策までのこれ。
// 基本施策・施策のページは自身を除いた planParents。将来像のページは上の段が無いので階層を置かない
export function planPath(at: { kihon: string } | { shisaku: string }): PathItem[] {
  const s = 'shisaku' in at ? getShisaku(at.shisaku) : undefined;
  const k = getKihonList().find((x) => x.id === ('kihon' in at ? at.kihon : s?.kihon_id));
  const v = getShouraizou().find((x) => x.id === k?.shouraizou);
  if (!k || !v || ('shisaku' in at && !s)) throw new Error(`ページの階層を作れない: ${JSON.stringify(at)}`);
  const items: PathItem[] = [
    { label: v.name, href: `/future/${v.id}/`, sz: v.id },
    { label: k.name, href: `/kihon/${k.id}/`, code: k.code.split('-')[1], kind: '基本施策', title: `基本施策 ${k.code}` },
  ];
  if (s) {
    // 施策の番号は「3-(1)-ア-①」（将来像-基本施策-施策展開-施策）
    const [, , tenkai, no] = s.code.split('-');
    items.push(
      { label: s.tenkai_name, code: tenkai, kind: '施策展開', title: `施策展開 ${s.code.slice(0, s.code.lastIndexOf('-'))}` },
      { label: s.name, href: `/shisaku/${s.id}/`, code: no, kind: '施策', title: `施策 ${s.code}` },
    );
  }
  return items;
}
export const planParents = (at: { kihon: string } | { shisaku: string }) => planPath(at).slice(0, -1);

// 施策の最新の年度の判定の内訳（A〜G。判定の無い施策は「なし」）。判定のマス目（トップ・将来像・部局・テーマ）とページの説明文で同じものを使う
export const countJudges = (list: Pick<Shisaku, 'judges'>[]) => countBy(list, (s) => s.judges[LATEST] ?? 'なし', JUDGES.map((j) => j.key));

// 年度をまたいで同じ取組を1行にまとめる。名前（torikumiKey）が同じものを同じ取組とみなす
export function torikumiRows(shisaku: Shisaku) {
  const rows = new Map<string, YearGroup<TorikumiRow>>();
  const sorted = [...shisaku.torikumi].sort((a, b) => b.year - a.year || a.no - b.no);
  for (const t of sorted) {
    const k = torikumiKey(shisaku.id, t.key);
    if (!rows.has(k)) rows.set(k, { key: t.key, latest: t, years: {} });
    rows.get(k)!.years[t.year] = t;
  }
  return [...rows.values()].sort((a, b) => b.latest.year - a.latest.year || a.latest.no - b.latest.no);
}

// 成果指標も名前で年度をまたいでまとめる（R7で指標が入れ替わった施策は別の行になる）。
// 名前の正規化は抽出側の取組の key と同じ規則（scripts/extract_soukatsu.py の name_key。同じになるかは test/integrity.test.ts で確かめる）。同じ施策に同じ名前の指標が複数ある（男女別など）ときは出てくる順で区別する
// （印字の名前が同じで見分けられないものは、内訳の名前で出す。SEIKA_ALIASES）
export const nameKey = (s: string) => s.normalize('NFKC').replace(/[\s・･、，,。.（）()「」『』〔〕]/g, '');
// 年度をまたいで同じ取組・成果指標かを比べる key。名前の key の表記ゆれ（R7からの「こども」の書き方など。lib/search.ts）をそろえたもの。
// 同じ年度の中の照合（部局票との結び付けなど）も、年度をまたいだまとまりから引くときはこれで比べる
export const sameKey = (key: string) => foldVariants(key);
// 年度をまたいで同じ取組かを比べる key。sameKey に、県が名前を変えた取組の読み替え（lib/renames.ts の TORIKUMI_RENAMES）を足したもの。
// 前の名前は、その施策でだけ新しい名前に読み替える。部局票・観光ロードマップとの結び付けも、施策が分かるところはこれで比べる
const torikumiRenames = once(() => new Map(TORIKUMI_RENAMES.flatMap((r) => r.shisaku.map((s) => [`${s}|${sameKey(nameKey(r.from))}`, sameKey(nameKey(r.to))]))));
export function torikumiKey(shisakuId: string, key: string) {
  const k = sameKey(key);
  return torikumiRenames().get(`${shisakuId}|${k}`) ?? k;
}
// 年度をまたいで同じ成果指標かを比べる key。sameKey に、県が名前を変えた成果指標の読み替え（lib/renames.ts の SEIKA_RENAMES）を足したもの
const seikaRenames = once(() => new Map(SEIKA_RENAMES.map((r) => [`${r.shisaku}|${sameKey(nameKey(r.from))}`, sameKey(nameKey(r.to))])));
export function seikaKey(shisakuId: string, key: string) {
  const k = sameKey(key);
  return seikaRenames().get(`${shisakuId}|${k}`) ?? k;
}

// 同じ施策の同じ年度の報告書に、同じ名前で2つ以上載っている成果指標（内訳の名前が印字に無いもの）。名前だけでは見分けられず、ページの題名も同じになるので、
// 内訳の名前で載っているほかの報告書の名前で出し、年度をまたいでその名前の指標とまとめる。どの内訳かは、ほかの報告書と同じ値の欄（field）で選ぶ。
// 2026-10-12 にページの画像で、印字の名前が同じことと、ほかの報告書の名前・値を確かめた
interface SeikaAlias {
  shisaku: string;
  printed: string; // 印字の名前
  field: 'base_raw' | 'target_raw';
  names: Record<string, string>; // field の値 → 出す名前
  from: string; // 出す名前を取った報告書（施策ページの出典に書く）
}
export const SEIKA_ALIASES: SeikaAlias[] = [
  // R7 は3つとも内訳の無い名前。R4〜R6 は（大学）（短大）（専門学校）を付けて、同じ基準値で載っている
  {
    shisaku: '5-3-c-3', printed: '新規学卒者（大学・短大・専門学校）の就職内定率', field: 'base_raw', from: '基準値が同じ令和4〜6年度の報告書',
    names: { '85.7': '新規学卒者（大学・短大・専門学校）の就職内定率（大学）', '92': '新規学卒者（大学・短大・専門学校）の就職内定率（短大）', '90': '新規学卒者（大学・短大・専門学校）の就職内定率（専門学校）' },
  },
  // R4・R5 は2つとも同じ名前。R6 から（娯楽・入場費）（宿泊費）に分かれ、R6 の基準値が同じ
  {
    shisaku: '3-2-c-4', printed: '一人当たり観光消費額（娯楽・入場費、宿泊費）', field: 'base_raw', from: '基準値が同じ令和6年度の報告書',
    names: { '6,647': '一人当たり観光消費額（娯楽・入場費）', '23,398': '一人当たり観光消費額（宿泊費）' },
  },
  // R4〜R6 は2つとも同じ名前。R7 から（小学校）（中学校）に分かれ、基準値が同じ
  {
    shisaku: '5-2-b-1', printed: '人が困っているときは、進んで助けていると考えている児童生徒の割合', field: 'base_raw', from: '基準値が同じ令和7年度の報告書',
    names: { '82.1': '人が困っているときは、進んで助けていると考えている児童の割合（小学校）', '83.4': '人が困っているときは、進んで助けていると考えている生徒の割合（中学校）' },
  },
  // R4〜R6 は2つとも同じ名前で、基準値も0。観光ロードマップの報告書（R5・R6）には、同じ目標値・計画値で（オフライン参加者数）（オンライン参加者数）として載っている
  {
    shisaku: '3-6-b-3', printed: '大型eスポーツイベント参加者数', field: 'target_raw', from: '目標値が同じ観光ロードマップの報告書',
    names: { '6,000': '大型eスポーツイベント参加者数（オフライン参加者数）', '30,000': '大型eスポーツイベント参加者数（オンライン参加者数）' },
  },
];
// 成果指標の1行に SEIKA_ALIASES の名前があれば、その名前と取った報告書
export function seikaAlias(s: SeikaRow) {
  const a = SEIKA_ALIASES.find((x) => x.shisaku === s.shisaku_id && nameKey(x.printed) === nameKey(s.name));
  const name = a?.names[s[a.field]];
  return a && name ? { name, from: a.from } : null;
}
// 成果指標の名前（ページ・一覧に出す名前）。ふつうは印字のまま
export const seikaName = (s: SeikaRow) => seikaAlias(s)?.name ?? s.name;

// name は最新の報告の名前（seikaName）
export interface SeikaGroup extends YearGroup<SeikaRow> {
  name: string;
}
export function seikaRows(shisaku: Shisaku) {
  const rows = new Map<string, SeikaGroup>();
  const seen = new Map<string, number>();
  const sorted = [...shisaku.seika].sort((a, b) => b.year - a.year);
  for (const s of sorted) {
    const name = seikaName(s);
    const base = seikaKey(shisaku.id, nameKey(name));
    const n = (seen.get(`${s.year}|${base}`) || 0) + 1;
    seen.set(`${s.year}|${base}`, n);
    const k = `${base}#${n}`;
    if (!rows.has(k)) rows.set(k, { key: k, name, latest: s, years: {} });
    rows.get(k)!.years[s.year] = s;
  }
  return [...rows.values()].sort((a, b) => b.latest.year - a.latest.year);
}

// 前の年度の報告での成果指標の名前と、その名前で載っていた年度（formersOf）
export const seikaFormerNames = (g: YearGroup<SeikaRow>) => formersOf(namesByYear(g, seikaName), seikaName(g.latest));
// 成果指標は施策のページのカードで見せる。カードの id は seika-<指標名の key のハッシュ8桁>。年度をまたいで同じ（名前が変わると別の id。SEIKA_RENAMES でまとめた指標は新しい名前の id）
export const seikaAnchor = (key: string) => `seika-${keySlug(key)}`;
export const seikaHref = (shisakuId: string, key: string) => `/shisaku/${shisakuId}/#${seikaAnchor(key)}`;
// 成果指標のシェア用のページの URL: /shihyou/<施策ID>/<指標名の key のハッシュ8桁>/（もとは成果指標のページ。docs/site.md の 4章のシェア用のページ）
export const seikaShareHref = (shisakuId: string, key: string) => `/shihyou/${shisakuId}/${keySlug(key)}/`;
// 成果指標の前の年度の県による説明（最新の報告より前の年度で、説明のあるもの。新しい年度から）
export const seikaPastSays = (g: YearGroup<SeikaRow>) => [...YEARS].reverse().filter((y) => y < g.latest.year && g.years[y]?.explanation).map((y) => g.years[y]);
// 成果指標1件（seika.json の行）から、年度をまたいだまとまりを求める
export function seikaGroupOf(row: SeikaRow) {
  return seikaGroupsOf(row.shisaku_id).find((r) => r.years[row.year] === row);
}

// ---------------------------------------------------------------- 年度をまたいだ取組・成果指標

// 遅れている進捗状況（報告の無い年度の null を渡してもよい）
export const DELAYS: ReadonlySet<string | null | undefined> = new Set(['やや遅れ', '大幅遅れ', '未着手']);

// 取組の4年間の様子。statuses は年度の順の進捗状況（報告の無い年度は null）。
// 取組をさがすの「4年間の様子」（/torikumi/data.json の patterns）・部局の「前の年度からの変化」・トップの文章・テーマと部局の件数で、
// 同じ数え方を使う（ページごとに書くと、数とリンク先の件数がずれるため）
type Statuses = (string | null)[];
const isDelay = (x: string | null | undefined) => DELAYS.has(x);
export const PATTERNS = {
  delay4: (st) => st.every(Boolean) && st.filter(isDelay).length === 4, // 4年とも遅れ
  delay3: (st) => st.every(Boolean) && st.filter(isDelay).length >= 3, // 4年のうち3年以上遅れた（4年とも報告にあるもの。間に順調の年度をはさむものも入る）
  streak: (st) => st.slice(-3).every(isDelay), // 最新の年度まで3年続けて遅れ（今も遅れている）
  recover: (st) => isDelay(st.at(-2)) && st.at(-1) === '順調', // 前の年度の遅れから順調に
  newdelay: (st) => ['順調', '概ね順調'].includes(st.at(-2) ?? '') && isDelay(st.at(-1)), // 前の年度の順調・概ね順調から遅れ
  new: (st) => Boolean(st.at(-1)) && !st.at(-2), // 最新の年度で新しく出た
  ended: (st) => !st.at(-1), // 最新の年度の報告に無い（終了・名称変更）
} satisfies Record<string, (st: Statuses) => boolean>;
export type Pattern = keyof typeof PATTERNS;
// 部局の「前の年度からの変化」の札の1組（components/Moves.astro）。施策の判定の移り変わり（JUDGE_TRENDS）か取組の4年間の様子（PATTERNS）の件数と、その一覧へのリンク
export interface MoveGroup { label: string; unit: string; items: { tone: Tone; title: string; n: number; href: string }[] }
// 取組の年度の順の進捗状況（報告の無い年度は null。PATTERNS に渡す）
export const statusesOf = (g: YearGroup<TorikumiRow>): Statuses => YEARS.map((y) => (g.years[y] ? statusOf(g.years[y]) : null));
// 年度ごとの進捗状況のスタンプ（components/Stamps.astro に渡す形。観光ロードマップの取組は years に報告のある年度を渡す）
export const statusStamps = (g: { years: Record<number, { status: string }> }, years = YEARS) =>
  years.map((y) => (g.years[y] ? { year: y, tone: toneOfStatus(statusOf(g.years[y])), text: statusOf(g.years[y]) } : { year: y, tone: null, text: '報告なし' }));

// 全施策の取組を、年度をまたいで1行にまとめたもの。部局は最新年度の所管部局（docs/data.md 7.2）
export interface TorikumiGroup extends YearGroup<TorikumiRow> {
  shisaku: Shisaku;
  dept: string;
  section: string;
  statuses: Statuses; // 年度の順の進捗状況（報告の無い年度は null）
  inAllYears: boolean;
  delayYears: number;
  patterns: Pattern[];
  href: string;
}
export const getTorikumiGroups = once((): TorikumiGroup[] => {
  const list = getShisakuList().flatMap((s) =>
    torikumiRows(s).map((row) => {
      const statuses = statusesOf(row);
      return {
        ...row,
        shisaku: s,
        dept: row.latest.dept,
        section: row.latest.section,
        statuses,
        inAllYears: statuses.every(Boolean),
        delayYears: statuses.filter(isDelay).length,
        patterns: keysOf(PATTERNS).filter((k) => PATTERNS[k](statuses)),
        href: torikumiHref(s.id, row.key),
      };
    }),
  );
  assertUnique(list, (g) => g.href, '取組のページ');
  return list;
});

// 名前の key のハッシュ8桁。取組のページ・指標のシェア用のページの URL と、成果指標・観光ロードマップ・一括交付金のカードの id に使う
export const keySlug = (key: string) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
// 取組のページの URL: /torikumi/<施策ID>/<取組名の key のハッシュ8桁>/。年度をまたいで同じ（名前が変わると別のページ）
export const torikumiHref = (shisakuId: string, key: string) => `/torikumi/${shisakuId}/${keySlug(key)}/`;

// 取組のページがあれば、その URL（部局票にしか無い施策・取組名の組み合わせには、ページが無い）。
// key はどの年度の名前でもよい（表記ゆれや名前の変更でまとめた取組も、まとめたページへ）
const groupHrefs = once(() => new Map(getTorikumiGroups().map((g) => [`${g.shisaku.id}|${torikumiKey(g.shisaku.id, g.key)}`, g.href])));
export function torikumiPage(shisakuId: string, key: string) {
  return groupHrefs().get(`${shisakuId}|${torikumiKey(shisakuId, key)}`) ?? null;
}

// 四角を押すと出す1件の中身（components/StatusBar.astro の pop）。key は区分（棒の categories の key）、sub は名前の下の補足（「基本施策 〇〇」）、vals は値の名前と値
export interface CellItem {
  key: string;
  name: string;
  href: string;
  sub?: { label: string; name: string; href: string; code: string };
  vals?: [label: string, value: string][];
}
// 施策の最新の報告の主な取組（報告書の順）を、進捗状況・名前・取組のページの四角にする（施策の行と、施策の SNS のカードの画像）
export const torikumiCells = (s: Shisaku): CellItem[] =>
  s.torikumi.filter((t) => t.year === LATEST).map((t) => ({ key: statusOf(t), name: t.name, href: torikumiPage(s.id, t.key) ?? torikumiHref(s.id, t.key) }));

// 計画の目次（/mokuji/）の木。将来像 → 基本施策 → 施策展開 → 施策 → 主な取組で、どれも報告書の順。
// 施策展開は施策の行の tenkai_id・tenkai_name で、番号は施策の番号から最後の「-①」を外したもの（1-(1)-ア）。
// 基本施策には主要指標（概要版の表の行。男女別などを分けた県の数え方で、名前は概要版の印字）、施策には成果指標を付ける。
// 主な取組・成果指標・主要指標は最新の年度の報告にあるものだけ（主な取組は延べ。いくつかの施策に載る取組は、それぞれの施策の下に出る）
export interface PlanTreeShisaku { shisaku: Shisaku; seika: SeikaGroupOfShisaku[]; torikumi: TorikumiGroup[] }
export interface PlanTreeTenkai { id: string; code: string; name: string; shisaku: PlanTreeShisaku[] }
export interface PlanTreeKihon { kihon: KihonRow; shuyou: ShuyouStatus[]; tenkai: PlanTreeTenkai[] }
export interface PlanTreeVision { vision: ShouraizouRow; kihon: PlanTreeKihon[] }
export function getPlanTree(): PlanTreeVision[] {
  const tori = Map.groupBy(getTorikumiGroups().filter((g) => g.latest.year === LATEST), (g) => g.shisaku.id);
  const shisaku = getShisakuList();
  const kihon = getKihonList();
  const shuyou = getShuyouStatus();
  const tenkaiOf = (kihonId: string): PlanTreeTenkai[] =>
    [...Map.groupBy(shisaku.filter((x) => x.kihon_id === kihonId), (s) => s.tenkai_id)].map(([id, ss]) => ({
      id,
      code: ss[0].code.replace(/-[^-]+$/, ''),
      name: ss[0].tenkai_name,
      shisaku: ss.map((s) => ({ shisaku: s, seika: seikaGroupsOf(s.id).filter((g) => g.latest.year === LATEST), torikumi: tori.get(s.id) ?? [] })),
    }));
  return getShouraizou().map((vision) => ({
    vision,
    kihon: kihon.filter((k) => k.shouraizou === vision.id).map((k) => ({ kihon: k, shuyou: shuyou.filter((r) => r.kihon_id === k.id), tenkai: tenkaiOf(k.id) })),
  }));
}
// 計画の木の段ごとの数（計画の目次とマインドマップのページの頭の文と説明文）。主な取組は延べ件数、主要指標は概要版の数え方（getPlanTree）
export function planTreeCounts() {
  const tree = getPlanTree();
  const kihon = tree.flatMap((v) => v.kihon);
  const tenkai = kihon.flatMap((k) => k.tenkai);
  const shisaku = tenkai.flatMap((t) => t.shisaku);
  return {
    vision: tree.length,
    kihon: kihon.length,
    tenkai: tenkai.length,
    shisaku: shisaku.length,
    torikumi: shisaku.reduce((n, s) => n + s.torikumi.length, 0),
    shuyou: kihon.reduce((n, k) => n + k.shuyou.length, 0),
    seika: shisaku.reduce((n, s) => n + s.seika.length, 0),
  };
}

// 最新の報告の名前が同じ取組（別の施策のものを含む）
const groupsByKey = once(() => Map.groupBy(getTorikumiGroups(), (x) => sameKey(x.key)));
const sameNameGroups = (g: TorikumiGroup) => groupsByKey().get(sameKey(g.key)) ?? [];
// 同じ取組が別の施策にも載っているもの（総括報告書の「再掲」）。同じ年度に同じ名前で載っているものと、名前を変えて載っているもの（lib/renames.ts の TORIKUMI_REPOSTS）。
// 名前は最新の報告の名前（名前が変わった取組は新しい名前）のほか、年度ごとの名前でも比べる（R6まで 2-4-a-1・3-2-a-1 の再掲で、
// R7で 2-4-a-1 だけ名前が変わった「ICTを活用した観光危機情報の収集・発信」も R4〜R6 の再掲になる）。
// years は再掲だった年度、partial は両方が載っている年度の一部だけが再掲のとき、name は名前を変えて載っているものの相手の名前（最新の報告）。
// R6まで施策Aに、R7から施策Bに同じ名前で載っている「沖縄平和賞の開催」は、年度が重ならないので再掲ではなく施策の移動として renameCandidates で出す
export interface Repost { group: TorikumiGroup; years: number[]; partial: boolean; name: string | null }
// 年度ごとの名前の取組（その年度の報告にある取組を、年度と名前で引く）
const groupsByYearKey = once(() => {
  const m = new Map<string, TorikumiGroup[]>();
  for (const x of getTorikumiGroups()) {
    for (const y of YEARS) {
      if (!x.years[y]) continue;
      const k = `${y}|${sameKey(x.years[y].key)}`;
      m.set(k, [...(m.get(k) || []), x]);
    }
  }
  return m;
});
// TORIKUMI_REPOSTS（名前を変えて別の施策に載っている取組）の、取組ごとの相手
const listedReposts = once(() => {
  const m = new Map<TorikumiGroup, TorikumiGroup[]>();
  const groupOf = (r: { shisaku: string; name: string }) => {
    const x = getTorikumiGroups().find((o) => o.shisaku.id === r.shisaku && sameKey(o.key) === sameKey(nameKey(r.name)));
    if (!x) throw new Error(`TORIKUMI_REPOSTS の取組が見つからない: ${r.shisaku} ${r.name}`);
    return x;
  };
  for (const set of TORIKUMI_REPOSTS) {
    const xs = set.map(groupOf);
    for (const x of xs) m.set(x, [...(m.get(x) || []), ...xs.filter((o) => o !== x)]);
  }
  return m;
});
export function repostsOf(g: TorikumiGroup): Repost[] {
  const years = new Map<TorikumiGroup, number[]>();
  for (const y of YEARS) {
    if (!g.years[y]) continue;
    for (const x of [...sameNameGroups(g).filter((o) => o.years[y]), ...(groupsByYearKey().get(`${y}|${sameKey(g.years[y].key)}`) ?? [])]) {
      if (x.shisaku.id !== g.shisaku.id && !years.get(x)?.includes(y)) years.set(x, [...(years.get(x) || []), y]);
    }
  }
  const listed = listedReposts().get(g) || [];
  for (const x of listed) years.set(x, YEARS.filter((y) => g.years[y] && x.years[y]));
  return [...years].map(([x, ys]) => ({
    group: x,
    years: ys,
    partial: ys.length < YEARS.filter((y) => g.years[y] && x.years[y]).length,
    name: listed.includes(x) ? x.latest.name : null,
  }));
}
// 別の施策に同じ名前の取組（のページ）があるか。再掲のほか、施策を移ったものも含む（ページの題名に施策の番号を足すかを決める。lib/describe.ts）
export const sameNameElsewhere = (g: TorikumiGroup) => sameNameGroups(g).some((x) => x.shisaku.id !== g.shisaku.id);

// 名前が変わった（または分割・統合された）可能性のある取組。この取組が最後に載った年度の翌年度から載り始めた取組（またはその逆）のうち、
// 同じ施策で、部局票に同じ予算事業名があるもの、または名前が似ているもの（文字の2つ組の一致率 0.5 以上）。年度をまたぐ照合は名前だけなので、その補い。
// 別の施策のもの（施策の移動。R6まで 3-9-a-3、R7から 3-9-b-3 に載っている「スポーツイベント開催支援」→「スポーツイベント開催の支援」など）は、
// 同じ予算事業名があり、境目の年度の活動指標も同じもの（katsudouNameKey）。この取組の施策にも同じ名前で載っている取組（再掲）は、同じ施策のほうを出すので除く
const NO_BUDGET = /^([ー―\-－‐—]|なし|事業なし|県事業なし|予算事業なし|予算措置なし|)$/;
// 予算事業の欄が「―」「なし」など、名前の無いもの（部局票の空欄の書き方）
export const isNoBudgetName = (s: string | null | undefined) => NO_BUDGET.test(budgetKey(s));
const budgetNamesOf = onceBy((g: TorikumiGroup) => {
  const m = new Map<string, string>();
  for (const y of YEARS) {
    if (!g.years[y]) continue;
    for (const b of budgetOf(y, g.shisaku.id, g.key)?.budgets || []) {
      for (const n of [b.name, b.name_next]) if (!isNoBudgetName(n)) m.set(budgetKey(n), n);
    }
  }
  return m;
});
const bigrams = (s: string) => {
  const k = nameKey(s);
  return new Set([...k].slice(0, -1).map((c, i) => c + k[i + 1]));
};
const similarity = (a: string, b: string) => {
  const [x, y] = [bigrams(a), bigrams(b)];
  if (!x.size || !y.size) return 0;
  return (2 * [...x].filter((v) => y.has(v)).length) / (x.size + y.size);
};
// 取組のその年度の活動指標の名前（総括報告書の欄。無ければ部局票の活動指標の表の名前）
export const indicatorOf = (g: TorikumiGroup, y: number) => g.years[y]?.indicator || budgetOf(y, g.shisaku.id, g.key)?.indicator_name || '';
// 活動指標の名前の key。名前の key の表記ゆれ（sameKey）をそろえ、「（累計）」「（内訳）」を除いたもの（R7の中期実施計画で、かっこの中に書く数の種類を
// 名前に添える書き方がそろい、R6の「〜数」がR7で「〜数（累計）」に、「（累計）」が「（内訳）」になったものがある。数えるものは同じ）
export const katsudouNameKey = (name: string) => sameKey(nameKey(name.normalize('NFKC').replace(/\((累計|内訳)\)/g, '')));
// 報告のある最初の年度（まとまりには、どれかの年度の報告がある）
export const firstYearOf = (g: { years: Record<number, unknown> }) => YEARS.find((y) => g.years[y])!;
export function renameCandidates(g: TorikumiGroup) {
  const last = g.latest.year;
  const first = firstYearOf(g);
  const mine = budgetNamesOf(g);
  const out: { group: TorikumiGroup; after: boolean; moved: boolean; shared: string[]; sim: number }[] = [];
  for (const o of getTorikumiGroups()) {
    if (o === g) continue;
    const moved = o.shisaku.id !== g.shisaku.id;
    const after = last < LATEST && firstYearOf(o) === last + 1;
    const before = first > YEARS[0] && o.latest.year === first - 1;
    if (!after && !before) continue;
    const shared = [...budgetNamesOf(o)].filter(([k]) => mine.has(k)).map(([, n]) => n);
    const sim = similarity(g.latest.name, o.latest.name);
    if (moved) {
      const [a, b] = after ? [indicatorOf(g, last), indicatorOf(o, firstYearOf(o))] : [indicatorOf(g, first), indicatorOf(o, o.latest.year)];
      if (!shared.length || !a || katsudouNameKey(a) !== katsudouNameKey(b)) continue;
      if (sameNameGroups(o).some((x) => x !== g && x.shisaku.id === g.shisaku.id)) continue;
    } else if (!shared.length && sim < 0.5) continue;
    out.push({ group: o, after, moved, shared, sim });
  }
  return out.sort((a, b) => b.shared.length - a.shared.length || b.sim - a.sim).slice(0, 3);
}
// 取組のページの頭に出す、ほかの取組とのつながり。前回までの取組（この取組の前の年度で終わったもの）・後続の取組（この取組の次の年度から始まったもの）・再掲（別の施策にも載っている同じ取組）。
// 取組をさがすの「複数の施策に共通」の絞り込みも、これで決める（ページに出る再掲と、絞り込みの件数をそろえるため）
export function relatedOf(g: TorikumiGroup) {
  const cs = renameCandidates(g);
  return { before: cs.filter((c) => !c.after), after: cs.filter((c) => c.after), repost: repostsOf(g) };
}
// この取組が載っている施策の数（「2施策に共通」。複数の施策に載っている取組＝再掲だけで、ほかは 0）。year を渡すと、その年度に再掲だったものだけ（目次は最新の年度）
export function commonShisakuCount(g: TorikumiGroup, year?: number) {
  const n = repostsOf(g).filter((r) => year == null || r.years.includes(year)).length;
  return n ? n + 1 : 0;
}
// その年度の主な取組を、複数の施策に載っている同じ取組（再掲）を1件として数えた数。県の件数とこのサイトのほかの数は、施策ごとに1件と数える延べ件数で、
// トップの主な取組の数に「重なりを除くと」として添える
export function distinctTorikumiCount(year: number) {
  const gs = getTorikumiGroups().filter((g) => g.years[year]);
  const root = new Map(gs.map((g) => [g, g]));
  const find = (g: TorikumiGroup): TorikumiGroup => (root.get(g) === g ? g : find(root.get(g)!));
  for (const g of gs) for (const r of repostsOf(g)) if (r.years.includes(year)) root.set(find(g), find(r.group));
  return new Set(gs.map(find)).size;
}
// 前の年度の報告での名前（書き方の違い・名前の変更でまとめたものの、いまの名前と名前の key が違うもの）と、その名前で載っていた年度。
// 取組・成果指標・活動指標で同じ比べ方（書き方の違いだけでも出す。前の年度の報告書をその名前で探せるように）
export function formersOf(names: { name: string; y: number }[], latest: string) {
  const m = new Map<string, number[]>();
  for (const { name, y } of names) if (nameKey(name) !== nameKey(latest)) m.set(name, [...(m.get(name) ?? []), y]);
  return [...m].map(([name, years]) => ({ name, years }));
}
const namesByYear = <T>(g: YearGroup<T>, nameOf: (r: T) => string) => YEARS.flatMap((y) => (g.years[y] ? [{ name: nameOf(g.years[y]), y }] : []));
export const formerNames = (g: YearGroup<TorikumiRow>) => formersOf(namesByYear(g, (r) => r.name), g.latest.name);
// 前の名前を出典に書くときの文（「R4〜R6の報告では「〇〇」」）。取組・活動指標・成果指標で同じ書き方
export const formerText = (fs: { name: string; years: number[] }[]) =>
  fs.map((f) => `${yearsLong(f.years[0], f.years[f.years.length - 1])}の報告では「${f.name}」`).join('、');

// 全施策の成果指標を、年度をまたいで1行にまとめたもの
// href は施策のページのカード（anchor はその id）、share はシェア用のページ
export interface SeikaGroupOfShisaku extends SeikaGroup {
  shisaku: Shisaku;
  anchor: string;
  href: string;
  share: string;
}
export const getSeikaGroups = once((): SeikaGroupOfShisaku[] => {
  const list = getShisakuList().flatMap((s) => seikaRows(s).map((row) => ({ ...row, shisaku: s, anchor: seikaAnchor(row.key), href: seikaHref(s.id, row.key), share: seikaShareHref(s.id, row.key) })));
  assertUnique(list, (g) => g.share, '成果指標のシェア用のページ');
  return list;
});
const seikaGroupsByShisaku = once(() => Map.groupBy(getSeikaGroups(), (g) => g.shisaku.id));
// 1つの施策の成果指標（施策ページの並び。最新の報告にあるものが先）
export const seikaGroupsOf = (shisakuId: string) => seikaGroupsByShisaku().get(shisakuId) || [];

// a の字が b に同じ順で出てくるか（間に別の字があってもよい）
function inOrder(a: string, b: string) {
  const xs = [...a];
  let i = 0;
  for (const c of b) if (c === xs[i]) i++;
  return i === xs.length;
}
// 名前の末尾の括弧（「（小学校）」「（さとうきび）」のような内訳の名前）
const NAME_TAIL = /[（(][^（()）]*[)）]\s*$/;
// 部局票の「対応する成果指標」（名前）が成果指標の名前に当たるか。名前の空白・記号の違いと表記ゆれ（sameKey）は無視する。
// 部局票の名前は、内訳のある指標をまとめた名前（「健康寿命」→「健康寿命（男性）」）のことも、複数の指標をまとめた名前
// （「交通事故重傷者数及び死者数」→「交通事故死者数」、「〜（①相談支援センター、②ピアサポート）に対する認知度」、「〜と考えている児童生徒の割合」→「〜児童の割合（小学校）」）のこともある。
// そのため、どちらかがもう一方を含むか、指標の名前の字が部局票の名前に同じ順で出てくれば当たりとする（指標の名前の末尾の内訳の括弧は、外しても比べる）
export function seikaNameMatches(seikaName: string | null | undefined, name: string) {
  const a = sameKey(nameKey(seikaName || ''));
  const b = sameKey(nameKey(name));
  if (!a || !b) return false;
  const head = sameKey(nameKey(name.replace(NAME_TAIL, '')));
  return a.includes(b) || b.includes(a) || inOrder(b, a) || (Boolean(head) && inOrder(head, a));
}
// 名前（観光ロードマップの報告書の「沖縄県PDCAの成果指標」など）から、同じ施策の成果指標のカード（施策のページ）を探す（SeikaGroup の name で比べ、同じ名前の指標があればそれを先に）
export function seikaHrefByName(shisakuId: string, name: string | null | undefined) {
  const list = seikaGroupsOf(shisakuId);
  const k = sameKey(nameKey(name || ''));
  return (list.find((r) => sameKey(nameKey(r.name)) === k) ?? list.find((r) => seikaNameMatches(name, r.name)))?.href ?? null;
}

// ---------------------------------------------------------------- 部局

// 並びは県の「各部局等の検証票」一覧の順。R5の組織再編後の名前
export const DEPTS = [
  { slug: 'chiji-koshitsu', name: '知事公室' },
  { slug: 'somu', name: '総務部' },
  { slug: 'kikaku', name: '企画部' },
  { slug: 'kankyo', name: '環境部' },
  { slug: 'kodomo-mirai', name: 'こども未来部' },
  { slug: 'seikatsu-fukushi', name: '生活福祉部' },
  { slug: 'hoken-iryo-kaigo', name: '保健医療介護部' },
  { slug: 'norin', name: '農林水産部' },
  { slug: 'shoko', name: '商工労働部' },
  { slug: 'bunka-kanko', name: '文化観光スポーツ部' },
  { slug: 'doboku', name: '土木建築部' },
  { slug: 'kyoiku', name: '教育庁' },
  { slug: 'kigyo', name: '企業局' },
  { slug: 'keisatsu', name: '県警本部' },
  { slug: 'byoin', name: '病院事業局' },
];
// R5の組織再編で無くなった部。R4の報告書にだけ出てくる
export const FORMER_DEPTS = ['子ども生活福祉部', '保健医療部'];
export const REORGANIZED = new Set(['知事公室', 'こども未来部', '生活福祉部', '保健医療介護部']);
export const deptOf = (section: string | null | undefined) => (section || '').match(DEPT_RE)?.[0] || '';
// 部局ページの URL。部局名（「商工労働部」）でも所管部課名（「商工労働部産業政策課」）でもよい。旧部局名など該当が無ければ null
export function deptHref(nameOrSection: string) {
  const name = DEPTS.some((d) => d.name === nameOrSection) ? nameOrSection : deptOf(nameOrSection);
  const d = DEPTS.find((x) => x.name === name);
  return d ? `/bukyoku/${d.slug}/` : null;
}
// 所管部課の課の名前（「こども未来部子育て支援課」→「子育て支援課」）。部局の名前だけなら空
export const sectionName = (section: string) => {
  const d = deptOf(section);
  return d && section.startsWith(d) ? section.slice(d.length) : section;
};
// 部局のページの課ごとの図の行の id
export const sectionAnchor = (section: string) => `ka-${sectionName(section)}`;
// 所管部課・担当部課のリンク先。最新の報告に取組がある課なら部局のページのその課の行、無ければ部局のページ（部局のページも無ければ null）。
// 担当部課に課がいくつか書かれているときは最初の課
const latestSections = once(() => new Set(getTorikumi(LATEST).map((t) => t.section)));
export function sectionHref(section: string | null | undefined) {
  const first = (section || '').split(/[、,，]/)[0].trim();
  const href = deptHref(first);
  if (!href) return null;
  return latestSections().has(first) && sectionName(first) ? `${href}#${sectionAnchor(first)}` : href;
}

// 施策と部局のかかわり方。施策総括表の「関係部等」に名前がある（kankei）か、関係部等には無いが、その部局が所管する主な取組がある（torikumi）か。
// 関係部等の順に並べ、その後ろに取組だけある部局を toriDepts の順で置く
export type DeptRole = 'kankei' | 'torikumi';
export function deptRoles(kankei: string[], toriDepts: Iterable<string>) {
  const out: { dept: string; role: DeptRole }[] = [];
  for (const dept of kankei) if (!out.some((d) => d.dept === dept)) out.push({ dept, role: 'kankei' });
  for (const dept of toriDepts) if (dept && !out.some((d) => d.dept === dept)) out.push({ dept, role: 'torikumi' });
  return out;
}
// 施策にかかわる部局。部局のページ・部局の一覧・施策をさがすの部局の絞り込みは、どれもこれで数える（数とリンク先の件数がずれないように）。
// 取組の部局は、年度をまたいだ取組のまとまりの最新の所管部局（docs/data.md 7.2）。取組だけある部局は DEPTS の順
const toriDeptsOf = once(() => Map.groupBy(getTorikumiGroups(), (g) => g.shisaku.id));
export function shisakuDepts(s: Shisaku) {
  const order = (name: string) => DEPTS.findIndex((d) => d.name === name);
  return deptRoles(s.depts, [...new Set((toriDeptsOf().get(s.id) || []).map((g) => g.dept))].sort((a, b) => order(a) - order(b)));
}

// 部局の検証票の県のページ。その部局の取組（最新の所管部局で数える）が載っている部局票と、取得元がその部局の部局票のページを、
// ページごとに年度と、載っているその部局の取組の数（n。年度の合計）をまとめて返す。年度の順、同じ年度は取組の多い順。
// 再編した部局の R4 は、再編前の部の票のページになる。ほかの部局の票に載った年度がある取組もあるので、1つの年度に何ページか出ることがある。
// 取組を読み取れなかった部局票（病院事業局）は、取得元（fetch_pdca.py の部局の名前。DEPTS の slug と同じ）で結び付ける
export function deptSourcePages(deptName: string) {
  const slug = DEPTS.find((d) => d.name === deptName)?.slug;
  const pages = new Map<string, { href: string; title: string; years: number[]; n: number }>();
  const add = (f: BukyokuFileRow | undefined, n: number) => {
    if (!f?.page_url) return;
    const p = pages.get(f.page_url) || { href: f.page_url, title: f.page_title, years: [], n: 0 };
    if (!p.years.includes(f.year)) p.years.push(f.year);
    p.n += n;
    pages.set(f.page_url, p);
  };
  for (const b of getBudgetRecords()) if (currentDeptOf(b.year, b.shisaku_id, b.key) === deptName) add(bukyokuFile(b.source), 1);
  for (const f of load('bukyoku/files')) if (f.source === slug) add(f, 0);
  return [...pages.values()].map((p) => ({ ...p, years: p.years.sort() })).sort((a, b) => a.years[0] - b.years[0] || b.n - a.n);
}

// その年度の取組を、最新の報告での所管部局で数えるための部局（docs/data.md 7.2）
const currentDept = once(() => new Map(getTorikumiGroups().flatMap((g) => Object.keys(g.years).map((y) => [`${y}|${g.shisaku.id}|${torikumiKey(g.shisaku.id, g.key)}`, g.dept]))));
export function currentDeptOf(year: number, shisakuId: string, key: string) {
  return currentDept().get(`${year}|${shisakuId}|${torikumiKey(shisakuId, key)}`) || '';
}

// R4の旧部局の課 → R5でその課の取組が最も多く移った先の課（成果指標の担当部課の読み替えに使う）
const formerSectionMap = once(() => {
  const r5 = new Map(load('torikumi').filter((t) => t.year === 2023).map((t) => [`${t.shisaku_id}|${sameKey(t.key)}`, t.section]));
  const votes = new Map<string, Map<string, number>>();
  for (const t of load('torikumi')) {
    if (t.year !== 2022 || !FORMER_DEPTS.includes(t.dept)) continue;
    const to = r5.get(`${t.shisaku_id}|${sameKey(t.key)}`);
    if (!to) continue;
    const v = votes.get(t.section) || new Map();
    v.set(to, (v.get(to) || 0) + 1);
    votes.set(t.section, v);
  }
  return new Map([...votes].map(([from, v]) => [from, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
});
// 成果指標の担当部局（R4の旧部局名は読み替える）。担当部課に複数の課が書かれているときは最初の課で決める
export function seikaDept(s: SeikaRow) {
  const first = (s.dept || '').split(/[、,，]/)[0];
  const section = s.year === 2022 ? formerSectionMap().get(first) || first : first;
  return deptOf(section);
}

// ---------------------------------------------------------------- 全体集計

export const getTorikumi = onceBy((year: number) => load('torikumi').filter((t) => t.year === year));
export const getSeika = onceBy((year: number) => load('seika').filter((s) => s.year === year));

// 4年間の推移（トップ・将来像・くらしのテーマのページの図と表）。年度ごとに、主な取組のうち「順調」の割合（a）と、成果指標のうち計画値に届いた割合（b）。
// どの取組・成果指標を数えるかはページが決める（省くと全部）
export function trendPoints(pickTori: (t: TorikumiRow) => boolean = () => true, pickSeika: (s: SeikaRow) => boolean = () => true) {
  return YEARS.map((y) => {
    const t = getTorikumi(y).filter(pickTori);
    const s = getSeika(y).filter(pickSeika);
    const aOk = t.filter((x) => x.status === '順調').length;
    const bOk = s.filter((x) => rateBin(x) === '100%以上').length;
    return { y, a: (aOk / t.length) * 100, b: (bOk / s.length) * 100, aOk, aN: t.length, bOk, bN: s.length };
  });
}
export type TrendRow = ReturnType<typeof trendPoints>[number];

// ---------------------------------------------------------------- 出典

// 読み込んだ県の PDF の数（取得台帳 data/raw/manifest.jsonl のうち、取得できた対象年度 R4〜R7 の PDF。zip の中の PDF は数えない）
export const getPdfCount = once(() => {
  const file = path.resolve(process.cwd(), '../data/raw/manifest.jsonl');
  // 県が同じファイルを別の年度・別の名前でも掲載していることがあるので、中身（sha256）が同じものは1件と数える
  return new Set(fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((l): { sha256?: string; local_path?: string; fiscal_year?: string | number } => JSON.parse(l))
    .filter((r) => r.sha256 && /\.pdf$/i.test(r.local_path || '') && YEARS.includes(Number(r.fiscal_year))).map((r) => r.sha256)).size;
});

const sources = once(() => new Map(load('sources').map((s) => [s.id, s])));
const sourceOf = (id: string) => sources().get(id);

// 部局票（data/raw/<部局>/...）の PDF の情報。URL と、その PDF を載せている県のページは bukyoku/files.json にある
const bukyokuFiles = once(() => new Map(load('bukyoku/files').map((x) => [x.id, x])));
const bukyokuFile = (id: string) => bukyokuFiles().get(id);
// 県のPDFへのリンク。zip の中のPDFはページ指定できないので zip へのリンクにする
export function sourceLink(id: string, page: number): { href: string; label: string } | null {
  if (!id.startsWith('soukatsu/')) {
    const f = bukyokuFile(id);
    if (!f?.file_url) return null;
    const text = (f.link_text || '').replace(/\s*（\s*(PDF|zip|Excel)[^）]*）\s*$/i, '');
    return { href: `${f.file_url}#page=${page}`, label: `${text} ${page}ページ` };
  }
  const s = sourceOf(id);
  if (!s) return null;
  // リンク文言の末尾の「（PDF 609.1KB）」などは除く
  const text = s.link_text.replace(/\s*（\s*(PDF|zip|Excel)[^）]*）\s*$/i, '');
  if (s.zip_member) {
    return { href: s.file_url, label: `${text}（zip内 ${s.zip_member} の${page}ページ）` };
  }
  return { href: `${s.file_url}#page=${page}`, label: `${text} ${page}ページ` };
}

// ---------------------------------------------------------------- 予算・財源（部局別の主な取組検証票）
// 金額は千円単位。決算額は報告年度の前年度、決算見込額は報告年度、当初予算額は翌年度のもの（docs/data.md 9章）

// 財源の区分と説明（/yosan/zaigen/ で使う）。who は事業費を誰が負担するか
export const FUNDS = [
  {
    key: '県単等', series: 1,
    short: '県が自分の裁量で使えるお金で行う事業',
    who: '県（元になるお金は県税・地方交付税・県債・基金など）',
    desc: '国の補助金のように使い道が決められたお金を使わず、県が自分で使い道を決められるお金で行う事業です。元になるお金には、県民や県内の会社が納める県税のほか、国から配られる地方交付税（使い道は自由）や、借金（県債）、貯金（基金）も含まれます。「県単独」でも、県民の税金だけでまかなっているわけではありません。',
  },
  {
    key: '一括交付金（ソフト）', series: 2,
    short: '沖縄振興特別推進交付金。県が選んだソフト事業に使える国の交付金',
    who: '国が8割、県が2割',
    desc: '沖縄振興のために国が交付する、使い道の自由度が高いお金です。人材育成・観光・離島の振興など、県が自主的に選んだソフト事業に使えます。事業費の8割を国が出し、2割は県の負担です（金額は県の負担分を含む事業費）。',
  },
  {
    key: '一括交付金（ハード）', series: 3,
    short: '沖縄振興公共投資交付金。道路や学校の整備などに使える国の交付金',
    who: '国と県（国の負担の割合は事業の種類による）',
    desc: '沖縄振興のための一括交付金のうち、道路整備や学校の建築・改築などのハード事業を対象とするものです。',
  },
  {
    key: '内閣府計上', series: 4,
    short: '国の沖縄振興予算（内閣府に計上）から補助を受ける事業',
    who: '国の補助と県の負担',
    desc: '沖縄の公共事業などの国の予算は、内閣府にまとめて計上されています（沖縄振興予算）。その補助を受けて県が行う、農業の基盤整備・下水道・港湾などの事業です。',
  },
  {
    key: '各省計上', series: 5,
    short: '内閣府以外の省庁の予算から補助を受ける事業',
    who: '国の補助と県の負担',
    desc: '厚生労働省・こども家庭庁・農林水産省など、内閣府以外の省庁の予算に計上された補助金を受けて行う事業です。子育て支援や水道、地すべり対策など、全国共通の制度によるものが多くあります。',
  },
  {
    key: 'その他', series: 6, note: '国直轄・市町村・記載なし',
    short: '国が直接行う事業、市町村の事業、財源の記載が無いもの',
    who: '—',
    desc: '国が直接行う事業（国直轄）や市町村の事業、財源の欄が「―」のものです。金額はわずかです。',
  },
];
export function fundOf(raw: string | null | undefined) {
  const t = (raw || '').normalize('NFKC').replace(/\s/g, '');
  if (t === '県単等') return '県単等';
  if (t.startsWith('一括交付金')) return t.includes('ハード') ? '一括交付金（ハード）' : '一括交付金（ソフト）';
  if (t === '内閣府計上' || t === '各省計上') return t;
  return 'その他';
}

export const AMOUNT_KINDS: Record<AmountKind, { label: string; offset: number }> = {
  settled: { label: '決算額', offset: -1 },
  estimate: { label: '決算見込額', offset: 0 },
  initial: { label: '当初予算額', offset: 1 },
};
export const budgetKey = (s: string | null | undefined) => (s || '').normalize('NFKC').replace(/\s/g, '');

// 桁の誤記の疑い（r.suspect）は抽出時に判定している（scripts/extract_bukyoku.py の suspect_kinds）。
// 同じ行の3つの金額のうち1つだけが他の50倍以上・10億円以上のもの。合計から除く

// 年度×取組の予算の記載。同じ取組が複数の部局のファイルに載っている（R5の組織再編の年）ときは最初の1件
export const getBudgetRecords = once(() => {
  const seen = new Set<string>();
  const out: BukyokuTorikumiRow[] = [];
  for (const b of load('bukyoku/torikumi')) {
    const k = `${b.year}|${b.shisaku_id}|${b.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
});
// 総括報告書の取組に対応する部局票の記載。施策コードと取組名で結び付ける（名前は torikumiKey で比べるので、年度をまたいだまとまりの key で引いてもよい）。
// 総括報告書で別の施策に再掲された取組は、部局票では元の施策にしか載っていないことがあるので、
// 同じ年度に同じ名前の取組が部局票に1件だけなら名前で結び付ける（matchedByName）
const budgetIndex = once(() => {
  const exact = new Map<string, BukyokuTorikumiRow>();
  const byName = new Map<string, BukyokuTorikumiRow | null>();
  for (const b of getBudgetRecords()) {
    exact.set(`${b.year}|${b.shisaku_id}|${torikumiKey(b.shisaku_id, b.key)}`, b);
    const k = `${b.year}|${torikumiKey(b.shisaku_id, b.key)}`;
    byName.set(k, byName.has(k) ? null : b); // 2件以上あれば null（名前だけでは決められない）
  }
  return { exact, byName };
});
export function budgetOf(year: number, shisakuId: string, key: string): (BukyokuTorikumiRow & { matchedByName?: boolean }) | undefined {
  const { exact, byName } = budgetIndex();
  const hit = exact.get(`${year}|${shisakuId}|${torikumiKey(shisakuId, key)}`);
  if (hit) return hit;
  const named = byName.get(`${year}|${torikumiKey(shisakuId, key)}`);
  return named ? { ...named, matchedByName: true } : undefined;
}

// 金額の種類の、確定に近い順（決算額 → 決算見込額 → 当初予算額。予算事業の金額の推移で、お金の年度ごとに選ぶ順）
const SERIES_KINDS: AmountKind[] = ['settled', 'estimate', 'initial'];
// 予算事業の金額を1行ずつに平らにしたもの
export interface BudgetLine {
  report: number; // 報告年度
  shisaku_id: string;
  key: string;
  torikumi: string;
  name: string;
  name_next: string;
  source: string;
  source_next: string;
  settled: number | null;
  estimate: number | null;
  initial: number | null;
  suspect: AmountKind[];
  file: string;
  page: number;
}
export const getBudgetLines = once((): BudgetLine[] =>
  getBudgetRecords().flatMap((b) =>
    b.budgets.flatMap((blk) =>
      blk.rows.map((r) => ({
        report: b.year,
        shisaku_id: b.shisaku_id,
        key: b.key,
        torikumi: b.name,
        name: blk.name,
        name_next: blk.name_next || blk.name,
        source: r.source,
        source_next: r.source_next || r.source,
        settled: r.settled,
        estimate: r.estimate,
        initial: r.initial,
        suspect: r.suspect || [],
        file: b.source,
        page: blk.page || b.page, // 予算の表があるページ
      })),
    ),
  ),
);

// 同じ予算事業の同じ金額とみなす差（大きいほうの1%以下。取組ごとの転記の誤りの疑い。data.md の 9.3、issues.md の B2）
export const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.01;
// 報告年度・金額の種類ごとに、同じ予算事業（名前・財源が同じで、金額が同じかわずかに違うもの）を1回だけ数えた金額の一覧。
// 財源が「―」の票は、同じ名前・金額で財源の書かれた票があればそちらと同じものとする（data.md の 9.3）。
// 1つの予算事業が複数の取組に載っているときは、最初に出てくる取組（施策コード順）に寄せる
export interface AmountEntry extends BudgetLine {
  budgetName: string;
  fund: string;
  amount: number;
  year: number; // 金額の年度
  kind: AmountKind;
}
// 部局のページなどから同じ組で何度も呼ばれる（部局のページ1つで19回）ので、報告年度・金額の種類ごとに1度だけ作る
const amountEntriesOf = onceBy((report: number) => onceBy((kind: AmountKind) => {
  const lines = getBudgetLines().flatMap((l) => {
    const v = l[kind];
    if (l.report !== report || v == null || v === 0 || l.suspect.includes(kind)) return [];
    return [{ l, v, name: kind === 'initial' ? l.name_next : l.name, source: kind === 'initial' ? l.source_next : l.source }];
  });
  // 財源の書かれた金額（予算事業名ごと）と、数えた金額（予算事業名・財源ごと）
  const written = Map.groupBy(lines.filter((x) => !isNoBudgetName(x.source)), (x) => budgetKey(x.name));
  const seen = new Map<string, number[]>();
  const out: AmountEntry[] = [];
  for (const { l, v, name, source } of lines) {
    if (isNoBudgetName(source) && written.get(budgetKey(name))?.some((x) => sameAmount(x.v, v))) continue;
    const k = `${budgetKey(name)}|${budgetKey(source)}`;
    const vs = seen.get(k) ?? [];
    seen.set(k, vs);
    if (vs.some((w) => sameAmount(w, v))) continue;
    vs.push(v);
    out.push({ ...l, budgetName: name, fund: fundOf(source), amount: v, year: report + AMOUNT_KINDS[kind].offset, kind });
  }
  return out;
}));
export const amountEntries = (report: number, kind: AmountKind) => amountEntriesOf(report)(kind);
// 金額の合計（千円）
export const amountTotal = (es: readonly { amount: number }[]) => es.reduce((s, e) => s + e.amount, 0);
// 財源（FUNDS の key）ごとの金額の合計（千円）
export const fundAmounts = (es: readonly AmountEntry[]): Record<string, number> => Object.fromEntries(FUNDS.map((f) => [f.key, amountTotal(es.filter((e) => e.fund === f.key))]));
// 部局の金額の一覧。部局は、予算事業を寄せた取組の最新の報告での所管部局（currentDeptOf。部局のページ・部局の一覧・予算と財源のページで同じ）
export const deptAmountEntries = (report: number, kind: AmountKind, deptName: string) => amountEntries(report, kind).filter((e) => currentDeptOf(report, e.shisaku_id, e.key) === deptName);
// 将来像の金額の一覧。将来像は、予算事業を寄せた取組の施策の将来像（将来像のページと予算と財源のページで同じ）
export const visionAmountEntries = (report: number, kind: AmountKind, visionId: number) => amountEntries(report, kind).filter((e) => e.shisaku_id.startsWith(`${visionId}-`));

// 予算事業ごと（同じ名前の予算事業をまとめたもの。予算と財源のページの一覧）。金額は amountEntries の重複を除いたもの。
// funds は財源ごとの決算見込額、related はこの予算事業が書かれている取組（同じ取組は1回）
export interface BudgetGroup {
  key: string;
  name: string;
  estimate: number;
  settled: number | undefined;
  initial: number | undefined;
  funds: Map<string, number>;
  related: BudgetLine[];
}
export function budgetGroups(report: number): BudgetGroup[] {
  const sumByName = (kind: AmountKind) => {
    const m = new Map<string, number>();
    for (const e of amountEntries(report, kind)) m.set(budgetKey(e.budgetName), (m.get(budgetKey(e.budgetName)) || 0) + e.amount);
    return m;
  };
  const settled = sumByName('settled');
  const initial = sumByName('initial');
  const lines = getBudgetLines().filter((l) => l.report === report);
  const m = new Map<string, BudgetGroup>();
  for (const e of amountEntries(report, 'estimate')) {
    const k = budgetKey(e.budgetName);
    if (!m.has(k)) {
      const related = [...new Map(lines.filter((l) => budgetKey(l.name) === k).map((l) => [`${l.shisaku_id}|${l.key}`, l])).values()];
      m.set(k, { key: k, name: e.budgetName, estimate: 0, settled: settled.get(k), initial: initial.get(k), funds: new Map(), related });
    }
    const g = m.get(k)!;
    g.estimate += e.amount;
    g.funds.set(e.fund, (g.funds.get(e.fund) || 0) + e.amount);
  }
  return [...m.values()].sort((a, b) => b.estimate - a.estimate);
}

export function getSuspects() {
  return getBudgetLines().flatMap((l) => l.suspect.map((kind) => ({ ...l, kind, amount: l[kind] })));
}

// ---------------------------------------------------------------- 予算事業（年度をまたいで同じもの）
// 予算事業のページ（/yosan/jigyo/<slug>/）・取組のページの予算の節・予算と財源のリンクで使う。data.md の 9.6

// 予算事業の欄に、県の予算事業の名前ではなく、国や市町村の事業であることだけが書かれたもの（「国直轄」「市町村事業」）。同じ書き方でも同じ予算事業ではない
const NOT_PREF_BUDGET = /^(国直轄|市町村)(事業)?$/;
// 同じ名前が続けて2回以上入った予算事業名（「犯罪抑止対策強化事業犯罪抑止対策強化事業」。部局票の読み取りのくり返し）を1回にしたもの
const projectName = (s: string) => s.replace(/^(.{4,}?)\1+$/su, '$1');
// 予算事業の名前の key。書き方の違い（子供・こども）とくり返しをそろえる。名前の無いもの・県の予算事業でないものは ''
const projectKeyOf = (s: string | null | undefined) => {
  const k = budgetKey(projectName(s ?? ''));
  return isNoBudgetName(k) || NOT_PREF_BUDGET.test(k) ? '' : sameKey(k);
};
// 名前の似ていない予算事業名の変更のうち、確かめたもの（lib/renames.ts の BUDGET_RENAMES）
const budgetRenamed = once(() => new Set(BUDGET_RENAMES.map((r) => `${projectKeyOf(r.from)}|${projectKeyOf(r.to)}`)));
// その報告年度に、どれかの票で決算見込額がある予算事業の名前の key
const fundedKeys = onceBy((y: number) => new Set(getBudgetRecords().filter((r) => r.year === y).flatMap((r) => r.budgets.filter((b) => b.rows.some((x) => x.estimate)).map((b) => projectKeyOf(b.name)))));

// slug は URL（/yosan/jigyo/<slug>/）で、最初の報告年度の名前の key のハッシュ（あとで名前が変わっても変わらない）。name はいちばん新しい報告での名前、names は報告年度ごとの名前
export interface BudgetProject { slug: string; href: string; name: string; names: { name: string; y: number }[] }
// 予算事業。部局票の予算事業の名前（key）ごとにまとめ、名前の変更をつなぐ。つなぐのは、ある取組の票の予算事業 A の翌年度の予算事業名が B で、翌年度のその取組の票に B があり、
// A は翌年度にどの票でも決算見込額が無く（終わった）、B は前の年度にどの票でも決算見込額が無い（始まった）もので、A と B の名前が似ているか（文字の2つ組の一致率 0.5 以上）、
// 確かめた名前の変更（BUDGET_RENAMES）のもの。取組が、前からある別の予算事業に乗り換えただけのもの（翌年度の予算事業名が続いている予算事業）はつながない
const budgetProjectIndex = once(() => {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k);
    if (p == null || p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  for (const g of getTorikumiGroups()) {
    for (const y of YEARS) {
      const [a, b] = [budgetOf(y, g.shisaku.id, g.key), budgetOf(y + 1, g.shisaku.id, g.key)];
      if (!g.years[y] || !g.years[y + 1] || !a || !b) continue;
      const next = new Set(b.budgets.map((x) => projectKeyOf(x.name)));
      for (const blk of a.budgets) {
        const [from, to] = [projectKeyOf(blk.name), projectKeyOf(blk.name_next)];
        if (!from || !to || from === to || !next.has(to) || fundedKeys(y + 1).has(from) || fundedKeys(y).has(to)) continue;
        if (similarity(projectName(blk.name), projectName(blk.name_next)) >= 0.5 || budgetRenamed().has(`${from}|${to}`)) parent.set(find(to), find(from));
      }
    }
  }
  const names = new Map<string, Map<number, string>>();
  for (const r of getBudgetRecords()) {
    for (const b of r.budgets) {
      const k = projectKeyOf(b.name);
      if (!k) continue;
      const m = names.get(k) ?? new Map<number, string>();
      names.set(k, m);
      if (!m.has(r.year)) m.set(r.year, projectName(b.name));
    }
  }
  const keysOf = new Map<string, string[]>();
  for (const k of names.keys()) keysOf.set(find(k), [...(keysOf.get(find(k)) ?? []), k]);
  const list: BudgetProject[] = [];
  const byKey = new Map<string, BudgetProject>();
  for (const keys of keysOf.values()) {
    const ns = keys.flatMap((k) => [...names.get(k)!].map(([y, name]) => ({ k, y, name }))).sort((a, b) => a.y - b.y || a.k.localeCompare(b.k));
    const last = ns.at(-1)!.y;
    // いちばん新しい報告に名前が2つあるとき（前の名前の決算額だけが載っている票）は、決算見込額がある名前
    const latest = ns.filter((x) => x.y === last).sort((a, b) => Number(fundedKeys(last).has(b.k)) - Number(fundedKeys(last).has(a.k)))[0];
    const slug = keySlug(ns[0].k);
    const p = { slug, href: `/yosan/jigyo/${slug}/`, name: latest.name, names: ns.map(({ name, y }) => ({ name, y })) };
    list.push(p);
    for (const k of keys) byKey.set(k, p);
  }
  assertUnique(list, (p) => p.href, '予算事業のページ');
  return { list, byKey };
});
export const getBudgetProjects = () => budgetProjectIndex().list;
// 予算事業の名前から予算事業（名前の無いもの・県の予算事業でないものは undefined）
export const budgetProjectOf = (name: string | null | undefined) => budgetProjectIndex().byKey.get(projectKeyOf(name));
// 予算の表の、金額の種類ごとの予算事業。当初予算額は翌年度の予算事業名で載っているので、その名前の予算事業（まだどの票にも無い名前なら、その年度の名前の予算事業）
const projectOfBlock = (b: { name: string; name_next: string }, kind: AmountKind) =>
  (kind === 'initial' ? budgetProjectOf(b.name_next) : undefined) ?? budgetProjectOf(b.name);

// 予算事業が書かれている取組（のページ）。報告年度ごとに、その取組の部局票の予算の表（budgetOf。名前で結び付けたものを含む）と、表のあるページ
export interface BudgetUse { group: TorikumiGroup; y: number; block: BudgetBlock; project: BudgetProject; file: string; page: number }
const budgetUses = once(() => {
  const byProject = new Map<BudgetProject, BudgetUse[]>();
  for (const group of getTorikumiGroups()) {
    for (const y of YEARS) {
      const rec = group.years[y] && budgetOf(y, group.shisaku.id, group.key);
      for (const block of rec ? rec.budgets : []) {
        const project = budgetProjectOf(block.name);
        if (!project) continue;
        const u = { group, y, block, project, file: rec!.source, page: block.page || rec!.page };
        byProject.set(project, [...(byProject.get(project) ?? []), u]);
      }
    }
  }
  return byProject;
});
export const usesOfProject = (p: BudgetProject) => budgetUses().get(p) ?? [];
// 複数の施策に載っている同じ取組（再掲）を1つに数えるための代表（報告書の順で最初のもの）
const repostRoot = onceBy((g: TorikumiGroup) => [g, ...repostsOf(g).map((r) => r.group)].sort((a, b) => getTorikumiGroups().indexOf(a) - getTorikumiGroups().indexOf(b))[0]);
// 取組を、再掲を1つにして報告書の順に並べる
const distinctGroups = (gs: Iterable<TorikumiGroup>) => {
  const roots = new Set([...gs].map(repostRoot));
  return getTorikumiGroups().filter((g) => roots.has(g));
};

// 予算事業が書かれている取組（予算事業のページ）。再掲は1つにし、years は書かれていた報告年度。並びは書かれていた最後の年度の新しい順、同じなら報告書の順
// estimates は報告年度ごとに、その取組の票に書かれた決算見込額（再掲の取組の票が2つあるときは1つめ）
export interface SameBudget { group: TorikumiGroup; years: number[]; estimates: Map<number, number | null> }
const newestFirst = (a: { years: number[] }, b: { years: number[] }) => b.years.at(-1)! - a.years.at(-1)!;
function rowsOf(uses: BudgetUse[]): SameBudget[] {
  const byRoot = new Map<TorikumiGroup, Map<number, BudgetUse[]>>();
  for (const u of uses) {
    const m = byRoot.get(repostRoot(u.group)) ?? new Map<number, BudgetUse[]>();
    byRoot.set(repostRoot(u.group), m);
    m.set(u.y, [...(m.get(u.y) ?? []), u]);
  }
  return distinctGroups(byRoot.keys()).map((group) => {
    const m = byRoot.get(group)!;
    const estimates = new Map([...m].map(([y, us]) => {
      const vs = us.filter((u) => u.group === us[0].group).map((u) => blockSum(u.block, 'estimate')).filter((v) => v != null);
      return [y, vs.length ? vs.reduce((a, v) => a + v, 0) : null] as const;
    }));
    return { group, years: [...m.keys()].sort((a, b) => a - b), estimates };
  }).sort(newestFirst);
}
export const budgetProjectRows = (p: BudgetProject) => rowsOf(usesOfProject(p));

const blockSum = (b: BudgetBlock, kind: AmountKind) => {
  const vs = b.rows.flatMap((r) => (r[kind] != null && !r.suspect?.includes(kind) ? [r[kind]] : []));
  return vs.length ? vs.reduce((s, v) => s + v, 0) : null;
};
// 共通の金額（lib/terms.ts の「共通の金額」）: 同じ年度に、同じ予算事業の予算の表の同じ決算見込額（差が1%以下を含む。sameAmount。0 と記載なしは比べない）が、2つ以上の取組（再掲は1件）に書かれているもの。
// 予算事業全体の金額をそれぞれの取組にくり返し書いたもの。1つの取組に同じ予算事業の表が2つあることがある（つないだ前の名前と新しい名前など）ので、表1つずつの額で比べる。
// 取組のページの予算の箱（budgetCardsOf）と予算事業をさがす（budgetProjectShared）で、この rootsWithEstimate を使う
const rootsWithEstimate = (p: BudgetProject, y: number, v: number | null) =>
  new Set(v ? usesOfProject(p).filter((u) => { const w = blockSum(u.block, 'estimate'); return u.y === y && w != null && sameAmount(w, v); }).map((u) => repostRoot(u.group)) : []);
// 予算事業のその年度の共通の金額と、それが書かれている取組の数（いちばん多くの取組に書かれている額。無ければ null）
export function budgetProjectShared(p: BudgetProject, y: number) {
  const vs = [...new Set(usesOfProject(p).filter((u) => u.y === y).map((u) => blockSum(u.block, 'estimate')))];
  const best = vs.map((v) => ({ amount: v!, count: rootsWithEstimate(p, y, v).size })).sort((a, b) => b.count - a.count)[0];
  return best && best.count >= 2 ? best : null;
}

// 取組のページの予算の節の、予算事業ごとの箱。この取組の最後の報告（g.latest.year）の部局票の予算の表を予算事業ごとにまとめる
// （県の予算事業でない表は名前ごと。名前が無く金額も無いか0の表は出さない）。ほかの年度の金額は予算事業のページに任せる。
// name は票の名前、amount はその年度の決算見込額、sharedWith は同じ予算事業の同じ決算見込額が書かれているほかの取組の数（共通の金額。rootsWithEstimate）、
// funds は財源（「―」は数えない）、others は同じ年度の票に同じ予算事業が書かれているほかの取組（再掲は1件にし、この取組の再掲は除く）
export interface BudgetCard { project: BudgetProject | undefined; name: string; amount: number | null; sharedWith: number; funds: string[]; others: SameBudget[] }
export function budgetCardsOf(g: TorikumiGroup): BudgetCard[] {
  const y = g.latest.year;
  const self = repostRoot(g);
  const blocks = budgetOf(y, g.shisaku.id, g.key)?.budgets ?? [];
  const groups = Map.groupBy(blocks, (b) => budgetProjectOf(b.name) ?? (isNoBudgetName(b.name) ? '' : budgetKey(b.name)));
  return [...groups.values()].map((bs): BudgetCard => {
    const project = budgetProjectOf(bs[0].name);
    const vs = bs.map((b) => blockSum(b, 'estimate')).filter((v) => v != null);
    const amount = vs.length ? vs.reduce((a, v) => a + v, 0) : null;
    const others = project ? usesOfProject(project).filter((u) => u.y === y && repostRoot(u.group) !== self) : [];
    return {
      project,
      name: isNoBudgetName(bs[0].name) ? '' : projectName(bs[0].name),
      amount,
      sharedWith: project ? Math.max(0, ...bs.map((b) => [...rootsWithEstimate(project, y, blockSum(b, 'estimate'))].filter((r) => r !== self).length)) : 0,
      funds: [...new Set(bs.flatMap((b) => b.rows.flatMap((r) => { const src = [r.source, r.source_next].find((x) => !isNoBudgetName(x)); return src ? [fundOf(src)] : []; })))],
      others: rowsOf(others),
    };
  }).filter((c) => c.name || c.amount);
}

// 取組の、最後の報告より前の報告に書かれた予算事業（最後の報告に予算事業の無い取組のページから、予算事業のページへつなぐ）。
// name はこの取組の票に書かれた名前（最後に書かれた年度のもの）、years は書かれていた報告年度
export function pastBudgetProjectsOf(g: TorikumiGroup) {
  const m = new Map<BudgetProject, { project: BudgetProject; name: string; years: number[] }>();
  for (const y of YEARS.filter((y) => y < g.latest.year && g.years[y])) {
    for (const b of budgetOf(y, g.shisaku.id, g.key)?.budgets ?? []) {
      const project = budgetProjectOf(b.name);
      if (!project) continue;
      const x = m.get(project) ?? { project, name: '', years: [] };
      m.set(project, x);
      x.name = projectName(b.name);
      if (!x.years.includes(y)) x.years.push(y);
    }
  }
  return [...m.values()];
}

// 予算事業の金額（予算と財源と同じく、同じ予算事業・財源・金額は1回だけ数えた amountEntries）
const projectEntries = once(() => {
  const m = new Map<BudgetProject, AmountEntry[]>();
  for (const report of YEARS) {
    for (const kind of SERIES_KINDS) {
      for (const e of amountEntries(report, kind)) {
        const p = projectOfBlock(e, kind);
        if (p) m.set(p, [...(m.get(p) ?? []), e]);
      }
    }
  }
  return m;
});
export const budgetProjectEntries = (p: BudgetProject) => projectEntries().get(p) ?? [];
// 予算事業の金額の推移。お金の年度ごとに、いちばん確定に近い金額（決算額 → 決算見込額 → 当初予算額）の、財源ごとの額。
// 決算額は次の年度の報告の、続いている取組の票にしか載らないので、決算額を書いている取組が決算見込額を書いている取組より少ない年度は、決算見込額にする
export function budgetProjectSeries(p: BudgetProject) {
  const es = budgetProjectEntries(p);
  const fys = [...new Set(es.map((e) => e.year))].sort((a, b) => a - b);
  // その報告で、その種類の金額（0 でないもの）を書いている取組の数（再掲は1件）
  const writers = (report: number, kind: AmountKind) => new Set(usesOfProject(p).filter((u) => u.y === report && blockSum(u.block, kind)).map((u) => repostRoot(u.group))).size;
  return fys.flatMap((fy) => {
    const kinds = SERIES_KINDS.filter((k) => es.some((e) => e.year === fy && e.kind === k));
    const kind = kinds[0] === 'settled' && kinds[1] === 'estimate' && writers(fy + 1, 'settled') < writers(fy, 'estimate') ? 'estimate' : kinds[0];
    if (!kind) return [];
    const xs = es.filter((e) => e.year === fy && e.kind === kind);
    return [{ fy, kind, report: fy - AMOUNT_KINDS[kind].offset, amount: amountTotal(xs), funds: Object.fromEntries(FUNDS.map((f) => [f.key, amountTotal(xs.filter((e) => e.fund === f.key))])) }];
  });
}

// 財源の説明ページで使う、国・県の公式資料の数字（data/reference/finance.json。出典つきで人が転記したもの）
export function getFinanceReference(): FinanceReference {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../data/reference/finance.json'), 'utf-8'));
}
