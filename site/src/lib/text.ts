// PDFから読んだ文章の改行を整える。文の途中の折り返しはつなぎ、見出し・箇条の頭・文末の改行は残す
// 報告書の表の値の改行を空白にして1行にする（「1,032万t-CO₂\n（R3年度）」→「1,032万t-CO₂ （R3年度）」）。空なら —
export const oneLine = (v: string | null | undefined) => (v || '—').replace(/\s*\n\s*/g, ' ');
// 報告書の欄が空か（空白と「-」「―」「ー」などだけ。目標値が文の成果指標の計画値の欄・部局票の改善案の欄など）。
// ブラウザのスクリプト（scripts/charts.ts）でも読むので、ほかのファイルを import しない（下の isNumOnly・withUnit も）
export const isBlankCell = (s: string | null | undefined) => !/[^\s\-－―—‐ーｰ]/.test(s || '');
// 報告書の欄が数だけか（「1,234」「△5.2」。全角の数字も）
export const isNumOnly = (raw: string | null | undefined) => /^[-△]?[\d,.]+$/.test((raw || '').normalize('NFKC'));
// 報告書の表記に単位を付ける。数だけの欄にだけ付ける（「35件（R２年）」のように単位があるものはそのまま）。空なら —
export const withUnit = (raw: string | null | undefined, unit?: string | null) => (raw && isNumOnly(raw) && unit ? `${raw}${unit}` : raw || '—');

export function joinLines(text: string | null | undefined) {
  let out = '';
  let prev = '';
  for (const line of (text || '').split('\n')) {
    if (!out) out = line;
    else if (/^[・\[【※○◯●①-⑳（(]/.test(line) || /[。」）)】：:]$/.test(prev) || prev.length <= 20) out += `\n${line}`;
    else out += line;
    prev = line;
  }
  return out;
}

// 県の分析（Check・Action）を「[主な取組]」「[成果指標]」の行で区切る
export function sections(text: string | null | undefined) {
  const parts: { head: string | null; body: string[] }[] = [];
  let cur: { head: string | null; body: string[] } = { head: null, body: [] };
  for (const line of joinLines(text).split('\n')) {
    const m = line.match(/^\[(.+?)\]$/);
    if (m) {
      if (cur.head || cur.body.length) parts.push(cur);
      cur = { head: m[1], body: [] };
    } else cur.body.push(line);
  }
  parts.push(cur);
  return parts.filter((p) => p.head || p.body.join('').trim()).map((p) => ({ head: p.head, body: p.body.join('\n') }));
}

// 節の中の行を、県の様式の小見出しと文章に分ける。小見出しは2段:
// group は分析の分け方（「内部要因の分析」「外部環境の分析」「改善余地の検証等」）、factor はその下の要因・改善の項目
// （「④社会・経済情勢の変化」「⑤情報発信等の強化・改善」。丸数字で始まり、句点の無い30字までの行）。続く文章の行は1つにまとめる
export type ProseBlock = { kind: 'group' | 'factor' | 'text'; text: string };
const PROSE_GROUP = /^(内部要因の分析|外部環境の分析|改善余地の検証等)$/;
const PROSE_FACTOR = /^[①-⑳][^。]{1,30}$/;
export function proseBlocks(body: string) {
  const out: ProseBlock[] = [];
  for (const line of body.split('\n')) {
    const s = line.trim();
    const kind = PROSE_GROUP.test(s) ? 'group' : PROSE_FACTOR.test(s) ? 'factor' : 'text';
    const last = out.at(-1);
    if (kind === 'text' && last?.kind === 'text') last.text += `\n${line}`;
    else if (kind !== 'text' || s) out.push({ kind, text: kind === 'text' ? line : s });
  }
  return out;
}

// 最初の一文（「施策の方向」の要約に使う）
export function firstSentence(text: string | null | undefined) {
  const t = (text || '').replace(/\n/g, '').replace(/^[・\s]+/, '');
  const i = t.indexOf('。');
  return i >= 0 ? t.slice(0, i + 1) : t;
}
