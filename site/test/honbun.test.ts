// lib/honbun.ts（基本計画の本文を章・将来像のページに分ける）。data/extracted/kihon を読む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { honbunParts, honbunHrefOf, honbunAnchor, headingTag, headingText, splitNotes } from '../src/lib/honbun.ts';
import { load, getKihonList, getShisakuList } from '../src/lib/data.ts';
import type { HonbunHeading } from '../src/lib/types.ts';

test('本文のどのかたまりも、どれか1つのページに入る', () => {
  const parts = honbunParts();
  const n = parts.reduce((a, p) => a + 1 + p.lead.length + p.blocks.length, 0);
  // 第4章の見出しは、将来像のページの上の章（chapter）として出すので、ページの頭と中のかたまりには入らない
  assert.equal(n + 1, load('kihon/honbun').length);
  assert.equal(new Set(parts.map((p) => p.slug)).size, parts.length);
  assert.equal(parts[0].slug, '');
  assert.equal(parts[0].href, '/kihonkeikaku/');
});

test('第4章は将来像ごとのページで、章の頭の文は将来像1のページに置く', () => {
  const four = honbunParts().filter((p) => p.chapter);
  assert.deepEqual(four.map((p) => p.slug), ['4-1', '4-2', '4-3', '4-4', '4-5']);
  assert.ok(four[0].lead.length > 0);
  assert.ok(four.slice(1).every((p) => p.lead.length === 0));
  assert.ok(four.every((p) => p.chapter?.id === '4' && p.head.level === 2));
});

test('沖縄県PDCA のどの基本施策・施策にも、基本計画の本文の見出しがある', () => {
  for (const k of getKihonList()) assert.ok(honbunHrefOf(k.id), `基本施策 ${k.id}`);
  for (const s of getShisakuList()) {
    const href = honbunHrefOf(s.id);
    assert.ok(href, `施策 ${s.id}`);
    assert.equal(href, `/kihonkeikaku/4-${s.id.split('-')[0]}/#${honbunAnchor(`4-${s.id}`)}`);
  }
});

test('見出しの段と書き方', () => {
  const [top, ch1] = honbunParts();
  const four = honbunParts().find((p) => p.slug === '4-1');
  assert.ok(four && ch1);
  assert.equal(headingTag(ch1, 2), 'h2');
  assert.equal(headingTag(four, 3), 'h2');
  assert.equal(headingTag(four, 5), 'h4');
  assert.equal(headingText(ch1.head), '第１章 総説');
  assert.equal(headingText(top.head), top.head.title);
  const h: HonbunHeading = { kind: 'h', level: 3, id: '4-1-1', mark: '⑴', title: '世界に誇れる島しょ型環境モデル地域の形成', page: 39, source: '' };
  assert.equal(headingText(h), '⑴ 世界に誇れる島しょ型環境モデル地域の形成');
});

test('splitNotes: 用語の注の印「*」を分ける', () => {
  assert.deepEqual(splitNotes('地域循環共生圏*の考え方'), [{ text: '地域循環共生圏', note: false }, { text: '*', note: true }, { text: 'の考え方', note: false }]);
  assert.deepEqual(splitNotes('印の無い文'), [{ text: '印の無い文', note: false }]);
});
