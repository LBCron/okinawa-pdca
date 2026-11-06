// 実施計画の本文の表（data/extracted/jisshi。scripts/extract_jisshi.py）を、PDF の表の形ではなく、このサイトのほかのページと同じ見せ方にする形に組み直す:
// 成果指標・主要指標は カードと同じ「基準値 → 目標値」の1行（components/RouteVals.astro）、主な取組は施策のページと同じ行の一覧と、取組のページと同じ年度の表、
// 協働の主体は主体ごとの役割の箇条、第4章の主な事業・取組は行の一覧。形が読めない表は、PDF と同じ表のまま出す（components/HonbunTable.astro）
import type { HonbunCell, HonbunRow, HonbunTable } from './types.ts';

// 値1つ（RouteVals の1つ）。y は値の後ろに小さく添えるかっこ書き（年度・挑戦的な目標）、note は【参考値】など値の下に添える文
export interface PlanVal { label: string; v: string; y: string; note: string }

const nfkcDigits = (s: string) => s.replace(/[０-９Ｒ]/g, (c) => c.normalize('NFKC'));
const unparen = (s: string) => s.replace(/^[（(]/, '').replace(/[）)]$/, '');

// セルの値（「8.2％\n（R２年度）\n【参考値】\n7.5％\n（R元年度）」）を、値・かっこ書き・【参考値】の後ろに分ける
export function parseVal(label: string, text: string): PlanVal {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const k = lines.findIndex((l) => l.startsWith('【'));
  const main = k < 0 ? lines : lines.slice(0, k);
  // 【参考値】の後ろの行は、かっこ書きは前の値に付け、ほかは空白で区切ってつなぐ（「参考値：7.5％（R元年度）」）
  const note = k < 0 ? '' : lines.slice(k).map((l) => l.replace(/^【(.+)】$/, '$1：')).reduce((a, l) => (!a || a.endsWith('：') || /^[（(]/.test(l) ? a + l : `${a} ${l}`), '');
  return {
    label,
    v: main.filter((l) => !/^[（(].*[）)]$/.test(l)).join(' ') || '―',
    y: main.filter((l) => /^[（(].*[）)]$/.test(l)).map(unparen).join('・'),
    note,
  };
}

// 表の後ろの「R９年度の目標値：15.1％（挑戦的な目標 20.7％）」の行。目標値の行でなければ null
export const TARGET_LINE = /^(R[0-9０-９]+年度の目標値)\s*[：:]\s*(.+)$/s;
export function parseTargetLine(text: string): PlanVal | null {
  const m = text.match(TARGET_LINE);
  if (!m) return null;
  const body = m[2].trim();
  const p = body.match(/^(.*\S)\s*[（(]([^（()）]+)[）)]$/);
  return { label: nfkcDigits(m[1]), v: p ? p[1] : body, y: p ? p[2] : '', note: '' };
}

// 成果指標の表の後ろに続く、R9・R13 の目標値の行。表 → その行の並び（行のかたまり自体は本文に出さない）。
// 指標が2つの成果指標は、目標値が2行に分かれて印字されている（「R９年度の目標値：…利用者数2,615人」「登録者数1,200人（累計）」）ので、
// 次に目標値の行が続く間の行は、前の目標値の続きとする
export function seikaTargets(blocks: HonbunRow[]): Map<HonbunRow, PlanVal[]> {
  const out = new Map<HonbunRow, PlanVal[]>();
  const isTarget = (b: HonbunRow | undefined) => b?.kind === 'p' && TARGET_LINE.test(b.text);
  blocks.forEach((b, i) => {
    if (b.kind !== 'table' || b.table !== 'seika') return;
    const vals: PlanVal[] = [];
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.kind !== 'p') break;
      const v = parseTargetLine(n.text);
      if (v) vals.push(v);
      else if (vals.length && isTarget(blocks[j + 1])) vals[vals.length - 1].v += ` ${n.text}`;
      else break;
      out.set(n, []);
    }
    out.set(b, vals);
  });
  return out;
}

// 列の見出しの言葉（「R６年度\n目標値」→「R6年度目標値」）
const headLabel = (c: HonbunCell) => nfkcDigits(c.text.replace(/\s+/g, ''));
const isNational = (label: string) => label.startsWith('全国');

// 成果指標: 名前・基準値 → 目標値（表の目標値と、後ろの R9・R13 の行）・全国の値
export interface PlanSeika { name: string; route: PlanVal[]; national: PlanVal | null }
export function planSeika(t: HonbunTable, targets: PlanVal[]): PlanSeika | null {
  const head = t.head[0];
  const row = t.body[0];
  if (!head || !row || t.body.length !== 1 || head.length !== row.length) return null;
  const vals = head.map((h, i) => parseVal(headLabel(h).replace(/^沖縄県の/, ''), row[i].text));
  return {
    name: t.caption ?? '',
    route: [...vals.filter((v) => !isNational(v.label)), ...targets],
    national: vals.find((v) => isNational(v.label)) ?? null,
  };
}

// 主要指標: 行ごとに名前・基準値 → 現状値 → 目標値・全国の値
export function planShuyou(t: HonbunTable): PlanSeika[] | null {
  const head = t.head[0];
  if (!head || t.body.some((r) => r.length !== head.length)) return null;
  const labels = head.map(headLabel);
  return t.body.map((r) => {
    const vals = r.slice(1).map((c, i) => parseVal(labels[i + 1].replace(/（.*）$/, ''), c.text));
    return { name: r[0].text.replace(/\n/g, ''), route: vals.filter((v) => !isNational(v.label)), national: vals.find((v) => isNational(v.label)) ?? null };
  });
}

// 協働の主体: 主体と役割の箇条
export function planKyodo(t: HonbunTable): { who: string; roles: string[] }[] | null {
  if (t.body.some((r) => r.length !== 2)) return null;
  return t.body.map((r) => ({ who: r[0].text.replace(/\n/g, ''), roles: r[1].text.split('\n').map((l) => l.replace(/^・\s*/, '').trim()).filter(Boolean) }));
}

// 実施主体のセルの行を、主体ごとに分ける。狭い列に1行に1つずつ印字され、長い名前は途中で折り返している（「那覇港管理\n組合」）。
// 5字以上の行が名前の終わりらしい字（者・等・会・組合・法人など）で終わっていなければ、次の行に続く名前とする
const ACTOR_END = /([者等体会村県国所院局社員館構部課校学園庁市省隊道]|法人|[県住市町村島]民|組合)$|^[A-Za-zＡ-Ｚａ-ｚ].*縄$/;
export function splitActors(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (out.length && prev.length >= 5 && !ACTOR_END.test(prev)) out[out.length - 1] += l;
    else out.push(l);
  });
  return out;
}

// 主な取組の表: 「○…」のまとまりと、取組ごとの名前・所管・実施主体・活動・活動指標・年度ごとの計画値。
// 活動と活動指標は、年度で変わるときは年度の列をまたいだ区切り（span は何年度ぶんか）で持つ
export interface PlanSpan { text: string; span: number }
export interface PlanTorikumi {
  name: string;
  key: string; // 名前のセルの取組名（取組のページを引く）
  dept: string;
  repost: boolean; // 【再掲】（ほかの施策にも載っている取組）
  actors: string[];
  activity: PlanSpan[];
  indicator: PlanSpan[];
  values: PlanSpan[]; // 年度ごとの計画値（数でなく、年度をまたいだ文のこともある）
}
export type PlanTorikumiRow = { kind: 'group'; text: string } | ({ kind: 'item' } & PlanTorikumi);

const spans = (cells: HonbunCell[]) => cells.map((c) => ({ text: c.text.replace(/\n/g, ''), span: c.cs ?? 1 }));
const width = (ss: PlanSpan[]) => ss.reduce((a, s) => a + s.span, 0);

export function planTorikumi(t: HonbunTable): { years: string[]; rows: PlanTorikumiRow[] } | null {
  const years = t.head[2]?.map((c) => c.text);
  if (!years) return null;
  const rows: PlanTorikumiRow[] = [];
  for (let i = 0; i < t.body.length; i++) {
    const r = t.body[i];
    if (r.length === 1 && r[0].group) {
      rows.push({ kind: 'group', text: r[0].text.replace(/^○\s*/, '') });
      continue;
    }
    const [nameCell, actorCell, ...act] = r;
    const ind = t.body[i + 1];
    const vals = t.body[i + 2];
    if (!nameCell?.torikumi || !actorCell || nameCell.rs !== 3 || !ind || !vals) return null;
    const item = {
      name: nameCell.torikumi,
      key: nameCell.torikumi,
      dept: nameCell.text.replace(/【再掲】/g, '').replace(/\n/g, '').slice(nameCell.torikumi.length).replace(/^[（(]/, '').replace(/[）)]$/, '').trim(),
      repost: nameCell.text.includes('【再掲】'),
      actors: splitActors(actorCell.text),
      activity: spans(act),
      indicator: spans(ind),
      values: spans(vals),
    };
    if ([item.activity, item.indicator, item.values].some((ss) => width(ss) !== years.length)) return null;
    rows.push({ kind: 'item', ...item });
    i += 2;
  }
  return { years, rows };
}

// 第4章の「主な事業・取組」の表（No.・名前・概要・実施主体・事業期間）。列の見出しが違えば null
export function planJigyo(t: HonbunTable): { no: string; name: string; summary: string; actors: string[]; period: string }[] | null {
  const labels = t.head[0]?.map(headLabel) ?? [];
  if (labels.join('|') !== 'No.|主な事業・取組名|事業・取組等の概要|実施主体|事業期間' || t.body.some((r) => r.length !== 5)) return null;
  return t.body.map(([no, name, summary, actors, period]) => ({
    no: no.text,
    name: name.text.replace(/\n/g, ''),
    summary: summary.text.replace(/\n/g, ''),
    actors: splitActors(actors.text),
    period: period.text.replace(/\n/g, ''),
  }));
}
