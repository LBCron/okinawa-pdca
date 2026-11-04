// 新・沖縄21世紀ビジョン基本計画の本文（data/extracted/kihon。scripts/extract_kihon.py）を、ページで使う形にまとめる。
// 本文は1つのページにすると重いので、章ごと（第4章は将来像ごと）のページに分ける。「はじめに」はトップ（/kihonkeikaku/）に置く
import { load } from './data.ts';
import { once } from './memo.ts';
import type { HonbunHeading, KihonHonbunRow } from './types.ts';

export const KIHON_KEIKAKU = { name: '新・沖縄21世紀ビジョン基本計画', href: '/kihonkeikaku/', period: '令和4〜13年度', published: '令和4年5月' };

export interface HonbunPart {
  slug: string; // URL の段（'1'・'4-1'）。「はじめに」は ''
  href: string;
  head: HonbunHeading; // ページの頭の見出し（章。第4章は将来像の「１」〜「５」）
  chapter?: HonbunHeading; // 第4章の将来像のページの、上の章
  lead: KihonHonbunRow[]; // 章の頭の文（第4章は将来像1のページの頭に置く）
  blocks: KihonHonbunRow[]; // 頭の見出しより後ろ
}

// 将来像ごとにページを分ける章
const SPLIT_CHAPTER = '4';

export const honbunParts = once((): HonbunPart[] => {
  const parts: HonbunPart[] = [];
  let chapter: HonbunHeading | undefined;
  let chapterLead: KihonHonbunRow[] = [];
  let cur: HonbunPart | undefined;
  for (const b of load('kihon/honbun')) {
    const split = chapter?.id === SPLIT_CHAPTER;
    if (b.kind === 'h' && (b.level === 1 || (split && b.level === 2 && b.id.startsWith(`${SPLIT_CHAPTER}-`)))) {
      if (b.level === 1) {
        chapter = b;
        chapterLead = [];
        if (b.id === SPLIT_CHAPTER) {
          cur = undefined;
          continue;
        }
      }
      const slug = b.id === '0' ? '' : b.id;
      const inSplit = b.level === 2;
      cur = { slug, href: `${KIHON_KEIKAKU.href}${slug ? `${slug}/` : ''}`, head: b, chapter: inSplit ? chapter : undefined, lead: inSplit && !parts.some((p) => p.chapter) ? chapterLead : [], blocks: [] };
      parts.push(cur);
    } else if (cur) {
      cur.blocks.push(b);
    } else {
      chapterLead.push(b); // 第4章の見出しと将来像1の見出しのあいだ
    }
  }
  return parts;
});

export const honbunPartOf = (slug: string) => honbunParts().find((p) => p.slug === slug);

// 見出しの # の名前。章からの印の並び（k-4-1-1-a-1）
export const honbunAnchor = (id: string) => `k-${id}`;

// 沖縄県PDCA の基本施策・施策展開・施策の ID → 基本計画の本文のその見出しの URL
const pdcaHrefs = once(() => {
  const m = new Map<string, string>();
  for (const p of honbunParts()) {
    for (const b of p.blocks) if (b.kind === 'h' && b.pdca) m.set(b.pdca, `${p.href}#${honbunAnchor(b.id)}`);
  }
  return m;
});
export const honbunHrefOf = (pdcaId: string) => pdcaHrefs().get(pdcaId);

// ページの中の見出しの段（頭の見出しが h1。章のページは「１」が h2、将来像のページは基本施策の「⑴」が h2）
export const headingTag = (part: HonbunPart, level: number) => `h${Math.min(6, level - part.head.level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

// 見出しの印と名前（「第１章 総説」「⑴ 世界に誇れる…」）。「はじめに」は印が無い
export const headingText = (h: HonbunHeading) => (h.level === 1 && h.mark ? `第${h.mark}章 ${h.title}` : h.mark ? `${h.mark} ${h.title}` : h.title);

// 用語の注の印（「地域循環共生圏*」の「*」。用語の説明は県の資料編にある）で文を分ける。印は前の字に付ける
export function splitNotes(text: string): { text: string; note: boolean }[] {
  return text.split(/(\*)/).filter(Boolean).map((t) => ({ text: t, note: t === '*' }));
}
