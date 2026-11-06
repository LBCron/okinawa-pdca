// /llms.txt（AI 向けの案内。中身は lib/seo.ts）
import { llmsTxt } from '../lib/seo.ts';
import { KIHON_KEIKAKU, honbunChapters, honbunMdPath, headingText } from '../lib/honbun.ts';

export const GET = () =>
  new Response(llmsTxt({ ...KIHON_KEIKAKU, chapters: honbunChapters().map((c) => ({ title: headingText(c.head), path: honbunMdPath(c) })) }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
