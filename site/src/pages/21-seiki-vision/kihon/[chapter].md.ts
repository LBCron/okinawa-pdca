// 基本計画の本文の章ごとの Markdown（/21-seiki-vision/kihon/1.md など。中身は lib/honbun.ts）。AI とテキストで読む人向けで、ページからは読み込まない
import { honbunChapters, honbunMarkdown, honbunMdSlug, type HonbunChapter } from '../../../lib/honbun.ts';

export const getStaticPaths = () =>
  honbunChapters().map((c) => ({ params: { chapter: honbunMdSlug(c) }, props: { c } }));

export const GET = ({ props }: { props: { c: HonbunChapter } }) =>
  new Response(honbunMarkdown(props.c), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
