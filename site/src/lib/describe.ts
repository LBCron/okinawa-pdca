// ページの題名と説明文（<meta name="description">・og:description）。検索結果と SNS のカードに出る。
// 検索結果で切れても意味が通るように、最新の年度の判定・件数を先に、何のページかを後ろに書く。
// 検索エンジンに重複とみなされないよう、題名と説明文はページごとに違うものにする（test/describe.test.ts で確かめ、ビルドでも同じページを数える）。
// 数はページが表示している数をそのまま受け取る（数え方は lib/data.ts の1か所。ここでは数えない）。
// 内訳は県の区分の並びのまま、0でない区分を全部同じ重みで並べる（遅れだけを書いたり、遅れを先に書いたりしない。docs/design.md の1章）
import { YEARS, LATEST, STATUSES, JUDGES, yearLong, yearsLong, judgeOf, withUnit, rateText, sameNameElsewhere, type SeikaGroup, type ShuyouGroupOfKihon, type TorikumiGroup } from './data.ts';
import type { ActivityShare } from './katsudou.ts';
import type { SeikaRow } from './types.ts';
import { fmt } from './format.ts';
import { isBlankCell, oneLine } from './text.ts';
import { shortName } from './iken.ts';

type Counts = Record<string, number>;

// 令和4〜7年度（説明文は文章なので、年は令和で書く。docs/design.md の2章）
const SPAN = yearsLong(YEARS[0], LATEST);
// 報告書の印字の目標年度（「R9年度」）を文章の書き方にする（「令和9年度」）
const longYear = (s: string) => s.replace(/^R(\d+)(年度)?$/, '令和$1年度');
const sum = (c: Counts) => Object.values(c).reduce((a, n) => a + n, 0);

// 内訳（順調8・概ね順調2）。keys の順に並べ、keys に無い区分があれば後ろに足す（内訳の合計が件数と合わなくならないように）
export function breakdown(keys: readonly string[], counts: Counts, label = (k: string) => k) {
  const all = [...keys, ...Object.keys(counts).filter((k) => !keys.includes(k))];
  return all.filter((k) => counts[k]).map((k) => `${label(k)}${fmt(counts[k])}`).join('・');
}

// 主な取組12件（順調8・概ね順調2・やや遅れ2）。0件なら ''
export const toriText = (counts: Counts) => (sum(counts) ? `主な取組${fmt(sum(counts))}件（${breakdown(STATUSES.map((s) => s.key), counts)}）` : '');
// 成果指標3（計画値に到達2）。ページの頭の札と同じ「計画値に到達」の数。0なら ''
export const seikaText = (n: number, reached: number) => (n ? `成果指標${fmt(n)}（計画値に到達${fmt(reached)}）` : '');
// 施策52（判定 A 12・B 30・D 8・G 2）。counts は lib/data.ts の countJudges。0なら ''
export const judgesText = (counts: Counts, label = '施策') =>
  sum(counts) ? `${label}${fmt(sum(counts))}（判定 ${breakdown(JUDGES.map((j) => j.key), counts, (k) => `${k} `)}）` : '';

// 件数の文を「、」でつなぎ、最新の年度を頭に付けて1文にする（令和7年度、施策52（…）、主な取組…。）。どれも無ければ ''
const facts = (xs: string[]) => {
  const s = xs.filter(Boolean).join('、');
  return s && `${yearLong(LATEST)}、${s}。`;
};

// 施策: 令和7年度の判定 B（概ね順調）。主な取組12件（…）、成果指標3（計画値に到達2）。沖縄県PDCAの施策「〇〇」の…
export function shisakuDescription(o: { name: string; judge: string | null | undefined; tori: Counts; seika: number; reached: number }) {
  const j = judgeOf(o.judge);
  const judge = j ? `${yearLong(LATEST)}の判定 ${j.key}（${j.label}）。` : `${yearLong(LATEST)}の判定はなし。`;
  const rest = [toriText(o.tori), seikaText(o.seika, o.reached)].filter(Boolean).join('、');
  return `${judge}${rest && `${rest}。`}沖縄県PDCAの施策「${o.name}」の${SPAN}の成果指標と主な取組。`;
}

// 主な取組の題名。同じ取組が複数の施策に載っている（総括報告書の「再掲」。年度の途中で施策を移ったものも）と施策ごとにページがあるので、題名が同じにならないように施策の番号を足す。
// 番号は名前より目立たせないので、後ろに置く（docs/design.md の3章）
export const torikumiTitle = (o: { name: string; code: string; reposted: boolean }) =>
  `${o.name}（沖縄県の主な取組${o.reposted ? `・施策 ${o.code}` : ''}）`;

// 進捗状況は年度の順に並べ、同じ区分が続く年度はまとめる（令和4〜6年度 順調・令和7年度 概ね順調）。報告の無い年度（null）はとばし、そこで区切る
export function statusRuns(statuses: (string | null)[]): string[] {
  const runs: { from: number; to: number; status: string }[] = [];
  YEARS.forEach((y, i) => {
    const status = statuses[i];
    if (!status) return;
    const last = runs.at(-1);
    if (last && last.status === status && last.to === YEARS[i - 1]) last.to = y;
    else runs.push({ from: y, to: y, status });
  });
  return runs.map((r) => `${yearsLong(r.from, r.to)} ${r.status}`);
}

// 「やったこと」は 50字ほどまで。長ければ、読点・句点のところで切って「…」を付ける（検索結果と SNS のカードで、そのあとの施策の名前まで見えるように）。
// 10字ほどの超えなら切らない（切った「…」のほうが長くなるため）
export const SUMMARY_MAX = 50;
export function shorten(s: string, max = SUMMARY_MAX): string {
  const chars = [...s];
  if (chars.length <= max + 10) return s;
  const head = chars.slice(0, max).join('');
  // 句点は3分の1より後ろ、読点は半分より後ろにあればそこで切る（前のほうの読点で切ると「〇〇では、△△が…」のように何も残らない）。無ければ 50字で切る
  const period = head.lastIndexOf('。');
  const comma = head.lastIndexOf('、');
  const at = period >= max / 3 ? period : comma >= max / 2 ? comma : head.length;
  return `${head.slice(0, at)}…`;
}

// 主な取組: 進捗状況 令和4〜6年度 順調・令和7年度 概ね順調。令和7年度にやったこと: 〇〇。所管 〇〇部〇〇課。沖縄県PDCAの施策「〇〇」の主な取組。活動指標「〇〇」。
// statuses は年度の順の進捗状況（報告の無い年度は null。lib/data.ts の TorikumiGroup の statuses）。最新の年度の報告に無い取組はそうと書く。
// 同じ施策で所管課と進捗状況が同じ取組も説明文が同じにならないように、最新の報告の「やったこと」（総括報告書の活動概要。shorten で短くする）と
// 活動指標の名前を入れる（県が複数の取組に同じ活動概要を書いていることもあるので、活動指標でも見分ける）。取組の名前は題名にあるので入れない。
// 説明文は検索結果で 120字ほどで切れるので、ページにあるもの（計画と実績・予算・検証）の案内は書かず、取組を見分ける文だけにする
export function torikumiDescription(o: { statuses: (string | null)[]; year: number; summary: string; indicator: string; section: string; shisaku: string }) {
  const ended = o.statuses.at(-1) ? '' : `（${yearLong(LATEST)}の報告には無い）`;
  // 「-」だけの欄は書かない
  const text = (v: string) => (isBlankCell(v) ? '' : oneLine(v).trim());
  const did = shorten(text(o.summary));
  const didText = did ? `${yearLong(o.year)}にやったこと: ${did}${did.endsWith('。') ? '' : '。'}` : '';
  const indicator = text(o.indicator);
  return `進捗状況 ${statusRuns(o.statuses).join('・')}${ended}。${didText}${o.section ? `所管 ${o.section}。` : ''}沖縄県PDCAの施策「${o.shisaku}」の主な取組。${indicator ? `活動指標「${indicator}」。` : ''}`;
}

// 成果指標の題名。name は lib/data.ts の SeikaGroup の name（印字で見分けられない指標は内訳の名前）
export const seikaTitle = (name: string) => `${name}（沖縄県の成果指標）`;

// 成果指標: 最新の報告の実績値・達成率・目標値を先に置く。name は題名と同じ名前
export function seikaDescription(x: SeikaRow, name: string) {
  const u = x.unit;
  return `${yearLong(x.year)}の実績値 ${oneLine(withUnit(x.actual_raw, u))}（達成率 ${rateText(x)}）、目標値 ${oneLine(withUnit(x.target_raw, u))}（${longYear(x.target_year)}）。沖縄県PDCAの成果指標「${name}」の基準値からの道のりと県による説明。`;
}

// ページの題名と説明文は *Meta で組み、ページと、ほかのページと同じにならないかのテストで同じものを使う
export const torikumiMeta = (g: TorikumiGroup) => ({
  title: torikumiTitle({ name: g.latest.name, code: g.shisaku.code, reposted: sameNameElsewhere(g) }),
  description: torikumiDescription({ statuses: g.statuses, year: g.latest.year, summary: g.latest.summary, indicator: g.latest.indicator, section: g.section, shisaku: g.shisaku.name }),
});
export const seikaMeta = (g: SeikaGroup) => ({ title: seikaTitle(g.name), description: seikaDescription(g.latest, g.name) });

// 主要指標・活動指標のシェア用のページの題名と説明文（SNS のカードに出る。成果指標と同じく、最新の報告の値を先に置く）。
// 活動指標は同じ名前（「開催回数」など）がいくつもの取組にあるので、題名に取組の名前も入れる
export function shuyouMeta(g: ShuyouGroupOfKihon) {
  const x = g.latest;
  const judge = x.judgement ? `県の見通しは「${shortName(oneLine(x.judgement), 30)}」。` : '';
  return {
    title: `${x.name}（沖縄県の主要指標）`,
    description: `${yearLong(x.year)}の実績値 ${oneLine(x.actual_raw)}、目標値 ${oneLine(x.target_raw)}（${x.year <= 2024 ? '令和6年度' : '令和9年度'}）。${judge}沖縄県PDCAの基本施策「${g.kihon.name}」の主要指標「${x.name}」の基準値からの道のり。`,
  };
}
export function katsudouMeta(a: ActivityShare) {
  const last = [...a.run.years].reverse().find((r) => !r.future);
  const now = last ? `${yearLong(last.y)}の計画 ${oneLine(last.plan_raw)} → 実績 ${oneLine(last.actual_raw)}（${last.status}）。` : '';
  return {
    title: `${a.name}（沖縄県の主な取組「${shortName(a.torikumi.latest.name, 30)}」の活動指標）`,
    description: `${now}沖縄県PDCAの主な取組「${a.torikumi.latest.name}」の活動指標「${a.name}」の、年度ごとの計画と実績。`,
  };
}

// 基本施策・将来像・部局・くらしのテーマに渡す数（ページの頭の札・ドーナツ・判定のマス目と同じもの）
interface AreaCounts {
  judges: Counts; // 施策の判定の内訳（countJudges）
  tori: Counts; // 最新の年度の主な取組の進捗状況の内訳
  seika?: number; // 最新の年度の成果指標の数
  reached?: number; // そのうち計画値に到達した数
}
const seikaOf = (c: AreaCounts) => seikaText(c.seika ?? 0, c.reached ?? 0);

export const kihonDescription = (name: string, c: AreaCounts) =>
  `${facts([judgesText(c.judges), toriText(c.tori)])}沖縄県PDCAの基本施策「${name}」の主要指標・施策・主な取組の進み具合。`;

export const futureDescription = (id: number, name: string, c: AreaCounts) =>
  `${facts([judgesText(c.judges), toriText(c.tori), seikaOf(c)])}沖縄県PDCAの将来像${id}「${name}」の基本施策ごとの主要指標・主な取組と${SPAN}の推移。`;

// 部局のページは所管する取組が主なので、取組・成果指標を先に、かかわる施策を後ろに書く
export const deptDescription = (name: string, c: AreaCounts) =>
  `${facts([toriText(c.tori), seikaOf(c), judgesText(c.judges, 'かかわる施策')])}沖縄県PDCAで${name}が所管する主な取組・成果指標と、かかわる施策の進み具合。`;

// くらしのテーマはこのサイト独自の分類なので、切れても分かるように頭に書く（docs/design.md の5章）
export const themeDescription = (label: string, c: AreaCounts) =>
  `「${label}」はこのサイト独自の分類。${facts([judgesText(c.judges), toriText(c.tori), seikaOf(c)])}沖縄県PDCAの施策・主な取組・成果指標を、くらしのテーマで分けて見られます。`;

// 施策・基本施策・将来像・部局・くらしのテーマのページの題名と説明文。c はページの頭と同じ数（lib/heads.ts）
export const shisakuMeta = (name: string, c: { judge: string | null | undefined; tori: Counts; seika: number; reached: number }) =>
  ({ title: `${name}（沖縄県の施策）`, description: shisakuDescription({ name, ...c }) });
export const kihonMeta = (name: string, c: AreaCounts) => ({ title: `${name}（沖縄県の基本施策）`, description: kihonDescription(name, c) });
export const futureMeta = (id: number, name: string, c: AreaCounts) => ({ title: `将来像${id} ${name}`, description: futureDescription(id, name, c) });
export const deptMeta = (name: string, c: AreaCounts) => ({ title: `沖縄県${name}の取組`, description: deptDescription(name, c) });
export const themeMeta = (label: string, c: AreaCounts) => ({ title: `${label}（くらしのテーマ）`, description: themeDescription(label, c) });
// 予算事業のページ。数はページの頭と同じ（いちばん新しい報告の決算見込額と、その報告で書かれている取組の数）
export const budgetMeta = (name: string, o: { year: number; estimate: string | null; torikumi: number }) => ({
  title: `${name}（沖縄県の予算事業）`,
  description: `沖縄県の予算事業「${name}」の決算額・予算額の推移と財源、この予算事業が書かれている主な取組です。${yearLong(o.year)}の報告では主な取組${fmt(o.torikumi)}件に書かれています。${o.estimate ? `決算見込額は${o.estimate}。` : ''}`,
});

// 基本計画の本文のページ（/21-seiki-vision/kihon/。全文を1ページに載せている）
export const honbunMeta = () => ({
  title: '新・沖縄21世紀ビジョン基本計画の本文',
  description: '新・沖縄21世紀ビジョン基本計画（令和4〜13年度。令和4年5月に沖縄県が策定）の本文を全部1ページに載せ、目次からたどって読めます。基本施策と施策の見出しから、沖縄県PDCAでの進み具合のページへ移れます。',
});
