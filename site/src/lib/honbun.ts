// 新・沖縄21世紀ビジョン基本計画の本文（data/extracted/kihon。scripts/extract_kihon.py）を、ページで使う形にまとめる。
// 本文は全部を1つのページ（/21-seiki-vision/kihon/）に載せ、ブラウザのページ内検索で全文を探せるようにする
import { load } from './data.ts';
import { once } from './memo.ts';
import { planSourceLink } from './plans.ts';
import { absUrl } from './seo.ts';
import { yearsLong } from './years.ts';
import type { HonbunHeading, KihonHonbunRow } from './types.ts';

// fy は計画の期間（年度）。date は策定した年月（構造化データの datePublished）
const FY: [number, number] = [2022, 2031];
export const KIHON_KEIKAKU = {
  name: '新・沖縄21世紀ビジョン基本計画', href: '/21-seiki-vision/kihon/', fy: FY, period: yearsLong(...FY), published: '令和4年5月', date: '2022-05',
};

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

// 沖縄県PDCA のページ（基本施策・施策）。施策展開のページは無いので付けない
export const honbunPdcaLink = (h: HonbunHeading) =>
  h.pdca && h.level === 3 ? { href: `/kihon/${h.pdca}/`, label: 'この基本施策の進み具合' }
  : h.pdca && h.level === 5 ? { href: `/shisaku/${h.pdca}/`, label: 'この施策の進み具合' }
  : null;

// 段落の頭に出す印字のページ（「はじめに」には印字が無いので PDF のページ）
export const printedPage = (b: { page: number; printed?: number }) => (b.printed ? `${b.printed}ページ` : `PDFの${b.page}ページ`);

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

// ---------------------------------------------------------------- 章ごとの Markdown（AI とテキストで読む人向け。/llms.txt から並べる）

// URL は /21-seiki-vision/kihon/1.md（「はじめに」は hajimeni.md）。ページからは読み込まない
export const honbunMdSlug = (c: HonbunChapter) => (c.head.id === '0' ? 'hajimeni' : c.head.id);
export const honbunMdPath = (c: HonbunChapter) => `${KIHON_KEIKAKU.href}${honbunMdSlug(c)}.md`;

// 本文の文字を Markdown の書式として読まれないようにする（用語の注の「*」・「1) 」で始まる箇条など）
export const mdText = (s: string) =>
  s.replace(/[\\`*_[\]<]/g, '\\$&').replace(/^([#>+-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');

// 見出しの段は # の数に（章が #）。印字のページは入れない（読むのに要らず、文の流れを切るため。出典の PDF は頭に書く）
export function honbunMarkdown(c: HonbunChapter): string {
  const src = planSourceLink('kihon', c.head.source);
  const pdfPage = (page: number) => planSourceLink('kihon', c.head.source, page)?.href ?? '';
  const out = [
    `# ${mdText(headingText(c.head))}`,
    [
      `${KIHON_KEIKAKU.name}（沖縄県、${KIHON_KEIKAKU.published}策定。計画の期間は${KIHON_KEIKAKU.period}）の本文のうち「${mdText(headingText(c.head))}」です。`,
      `県の PDF（[${src?.label}](${src?.href})）の文字を、非公式サイト「おきなわ、みらい、いま」（Code for Okinawa）が読み取りました。図とふりがなは省いています。`,
      '「\\*」の付いた言葉は、県の資料編に用語の説明があります。',
      '本文の著作権は沖縄県にあります。引用するときは PDF で確かめてください。',
      `Web のページ: ${absUrl(`${KIHON_KEIKAKU.href}#${honbunAnchor(c.head.id)}`)}`,
    ].map((l) => `> ${l}`).join('\n>\n'),
  ];
  for (const b of [c.head, ...c.blocks]) {
    if (b.kind === 'h') {
      if (b !== c.head) out.push(`${'#'.repeat(b.level)} ${mdText(headingText(b))}`);
      const link = honbunPdcaLink(b);
      if (link) out.push(`[${link.label}（沖縄県PDCA）](${absUrl(link.href)})`);
    } else if (b.kind === 'label') out.push(`**${mdText(b.text)}**`);
    else if (b.kind === 'fig') out.push(`（図は省いています。[PDF の${printedPage(b)}](${pdfPage(b.page)})）`);
    else out.push(mdText(b.text));
  }
  return `${out.join('\n\n')}\n`;
}
