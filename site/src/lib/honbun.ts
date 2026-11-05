// 新・沖縄21世紀ビジョン基本計画の本文（data/extracted/kihon。scripts/extract_kihon.py）を、ページで使う形にまとめる。
// 本文は全部を1つのページ（/kihonkeikaku/）に載せ、ブラウザのページ内検索で全文を探せるようにする。章ごとにまとめ、画面の外の章は描かない（ページの style）
import { load } from './data.ts';
import { once } from './memo.ts';
import type { HonbunHeading, KihonHonbunRow } from './types.ts';

export const KIHON_KEIKAKU = { name: '新・沖縄21世紀ビジョン基本計画', href: '/kihonkeikaku/', period: '令和4〜13年度', published: '令和4年5月' };

// 章（と「はじめに」）。blocks は章の見出しより後ろ
export interface HonbunChapter { head: HonbunHeading; blocks: KihonHonbunRow[] }

export const honbunChapters = once((): HonbunChapter[] => {
  const out: HonbunChapter[] = [];
  for (const b of load('kihon/honbun')) {
    if (b.kind === 'h' && b.level === 1) out.push({ head: b, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
});

// 見出しの # の名前。章からの印の並び（k-4-1-1-a-1）
export const honbunAnchor = (id: string) => `k-${id}`;

// 沖縄県PDCA の基本施策・施策展開・施策の ID → 基本計画の本文のその見出しの URL
const pdcaHrefs = once(() => {
  const m = new Map<string, string>();
  for (const b of load('kihon/honbun')) if (b.kind === 'h' && b.pdca) m.set(b.pdca, `${KIHON_KEIKAKU.href}#${honbunAnchor(b.id)}`);
  return m;
});
export const honbunHrefOf = (pdcaId: string) => pdcaHrefs().get(pdcaId);

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
