// 新・沖縄21世紀ビジョンの計画（基本計画と実施計画の前期・中期）の本文を、ページで使う形にまとめる。
// data/extracted/kihon（scripts/extract_kihon.py）と data/extracted/jisshi（scripts/extract_jisshi.py）を読む。
// 本文は計画ごとに全部を1つのページ（/21-seiki-vision/<計画>/）に載せ、ブラウザのページ内検索で全文を探せるようにする
import { load } from './data.ts';
import { onceBy } from './memo.ts';
import type { HonbunHeading, HonbunRow } from './types.ts';

export const VISION_HREF = '/21-seiki-vision/';

// 計画。file は本文、sources は出典の抽出結果
export const HONBUN_PLANS = {
  kihon: { name: '新・沖縄21世紀ビジョン基本計画', short: '基本計画', href: '/21-seiki-vision/kihon/', period: '令和4〜13年度', published: '令和4年5月', file: 'kihon/honbun', sources: 'kihon' },
  zenki: { name: '新・沖縄21世紀ビジョン実施計画（前期）', short: '実施計画（前期）', href: '/21-seiki-vision/jisshi-zenki/', period: '令和4〜6年度', published: '令和4年9月', file: 'jisshi/zenki', sources: 'jisshi' },
  chuki: { name: '新・沖縄21世紀ビジョン実施計画（中期）', short: '実施計画（中期）', href: '/21-seiki-vision/jisshi-chuki/', period: '令和7〜9年度', published: '令和7年3月', file: 'jisshi/chuki', sources: 'jisshi' },
} as const;
export type HonbunPlan = keyof typeof HONBUN_PLANS;
export const JISSHI_PLANS = ['zenki', 'chuki'] as const satisfies readonly HonbunPlan[];

export const honbunRows = (plan: HonbunPlan): HonbunRow[] => load(HONBUN_PLANS[plan].file);

// 章。blocks は章の見出しより後ろ
export interface HonbunChapter { head: HonbunHeading; blocks: HonbunRow[] }

export const honbunChapters = onceBy((plan: HonbunPlan): HonbunChapter[] => {
  const out: HonbunChapter[] = [];
  for (const b of honbunRows(plan)) {
    if (b.kind === 'h' && b.level === 1) out.push({ head: b, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
});

// 見出しの # の名前。章からの印の並び（k-4-1-1-a-1）
export const honbunAnchor = (id: string) => `k-${id}`;

// 沖縄県PDCA の基本施策・施策展開・施策の ID → 計画の本文のその見出しの URL
const pdcaHrefs = onceBy((plan: HonbunPlan) => {
  const m = new Map<string, string>();
  for (const b of honbunRows(plan)) if (b.kind === 'h' && b.pdca) m.set(b.pdca, `${HONBUN_PLANS[plan].href}#${honbunAnchor(b.id)}`);
  return m;
});
export const honbunHrefOf = (pdcaId: string, plan: HonbunPlan = 'kihon') => pdcaHrefs(plan).get(pdcaId);

// 見出しの段（ページの題名が h1 なので、章が h2、「①」が h6）
export const headingTag = (level: HonbunHeading['level']) => `h${level + 1}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

// 見出しの印と名前（「第１章 総説」「⑴ 世界に誇れる…」）。「はじめに」は印が無い
export const headingText = (h: HonbunHeading) => (h.level === 1 && h.mark ? `第${h.mark}章 ${h.title}` : h.mark ? `${h.mark} ${h.title}` : h.title);

// 用語の注の印（「地域循環共生圏*」の「*」。用語の説明は県の資料編にある）で文を分ける。印は前の字に付ける
export function splitNotes(text: string): { text: string; note: boolean }[] {
  return text.split(/(\*)/).filter(Boolean).map((t) => ({ text: t, note: t === '*' }));
}

// 目次の木（見出しを段の深さのまま入れ子にする）
export interface HonbunNode { h: HonbunHeading; children: HonbunNode[] }
export function headingTree(hs: HonbunHeading[]): HonbunNode[] {
  const root: HonbunNode[] = [];
  const stack: HonbunNode[] = [];
  for (const h of hs) {
    while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop();
    const n = { h, children: [] };
    (stack.length ? stack[stack.length - 1].children : root).push(n);
    stack.push(n);
  }
  return root;
}

// 画像から読んだかたまりのある PDF のページ（分冊とページ）。ページの頭のしるしと、ページの終わりの説明に使う
export const transcribedPages = onceBy((plan: HonbunPlan) => {
  const pages = new Set<string>();
  for (const b of honbunRows(plan)) if (b.transcribed) pages.add(`${b.source}#${b.page}`);
  return pages;
});
