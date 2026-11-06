// lib/honbun.ts（基本計画の本文を1ページに載せる）。data/extracted/kihon を読む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { honbunChapters, honbunHrefOf, honbunAnchor, honbunMarkdown, honbunMdPath, headingTag, headingText, headingTree, mdText, splitNotes } from '../src/lib/honbun.ts';
import { SITE } from '../src/lib/links.ts';
import { load, getKihonList, getShisakuList } from '../src/lib/data.ts';
import type { HonbunHeading } from '../src/lib/types.ts';

const h = (level: HonbunHeading['level'], id: string, mark: string, title: string): HonbunHeading => ({ kind: 'h', level, id, mark, title, page: 1, source: '' });

test('本文のどのかたまりも、どれか1つの章に入る。章の頭は「はじめに」', () => {
  const chapters = honbunChapters();
  assert.equal(chapters.reduce((a, c) => a + 1 + c.blocks.length, 0), load('kihon/honbun').length);
  assert.equal(chapters[0].head.id, '0');
  assert.ok(chapters.every((c) => c.head.level === 1 && c.blocks.every((b) => b.kind !== 'h' || b.level > 1)));
});

test('見出しの # は1つずつ違う', () => {
  const ids = load('kihon/honbun').flatMap((b) => (b.kind === 'h' ? [b.id] : []));
  assert.equal(new Set(ids).size, ids.length);
});

test('沖縄県PDCA のどの基本施策・施策にも、基本計画の本文の見出しがある', () => {
  for (const k of getKihonList()) assert.equal(honbunHrefOf(k.id), `/21-seiki-vision/kihon/#${honbunAnchor(`4-${k.id}`)}`, `基本施策 ${k.id}`);
  for (const s of getShisakuList()) assert.equal(honbunHrefOf(s.id), `/21-seiki-vision/kihon/#${honbunAnchor(`4-${s.id}`)}`, `施策 ${s.id}`);
});

test('見出しの段と書き方', () => {
  assert.equal(headingTag(1), 'h2');
  assert.equal(headingTag(5), 'h6');
  assert.equal(headingText(h(1, '1', '１', '総説')), '第１章 総説');
  assert.equal(headingText(h(1, '0', '', 'はじめに ～県民のみなさまへ～')), 'はじめに ～県民のみなさまへ～');
  assert.equal(headingText(h(3, '4-1-1', '⑴', '世界に誇れる島しょ型環境モデル地域の形成')), '⑴ 世界に誇れる島しょ型環境モデル地域の形成');
});

test('headingTree: 見出しを段の深さのまま入れ子にする（段がとんでもよい）', () => {
  const t = headingTree([h(1, '2', '２', '基本的課題'), h(2, '2-1', '１', 'a'), h(3, '2-1-1', '⑴', 'b'), h(5, '2-1-1-1', '①', 'c'), h(2, '2-2', '２', 'd'), h(1, '3', '３', '基本方向')]);
  assert.deepEqual(t.map((n) => n.h.id), ['2', '3']);
  assert.deepEqual(t[0].children.map((n) => n.h.id), ['2-1', '2-2']);
  assert.equal(t[0].children[0].children[0].children[0].h.id, '2-1-1-1');
});

test('splitNotes: 用語の注の印「*」を分ける', () => {
  assert.deepEqual(splitNotes('地域循環共生圏*の考え方'), [{ text: '地域循環共生圏', note: false }, { text: '*', note: true }, { text: 'の考え方', note: false }]);
  assert.deepEqual(splitNotes('印の無い文'), [{ text: '印の無い文', note: false }]);
});

test('mdText: 本文の文字を Markdown の書式として読ませない', () => {
  assert.equal(mdText('地域循環共生圏*の形成'), '地域循環共生圏\\*の形成');
  assert.equal(mdText('1) 観光の振興'), '1\\) 観光の振興');
  assert.equal(mdText('- a_b [c] <d>'), '\\- a\\_b \\[c\\] \\<d>');
  assert.equal(mdText('４つの課題'), '４つの課題');
});

test('章ごとの Markdown: 章が #、見出しの段は # の数。本文の段落を全部入れ、ページの頭に PDF へのリンクを置く', () => {
  const chapters = honbunChapters();
  assert.equal(new Set(chapters.map(honbunMdPath)).size, chapters.length);
  assert.equal(honbunMdPath(chapters[0]), '/21-seiki-vision/kihon/hajimeni.md');
  assert.equal(honbunMdPath(chapters[1]), '/21-seiki-vision/kihon/1.md');
  for (const c of chapters) {
    const md = honbunMarkdown(c);
    const lines = md.split('\n');
    assert.equal(lines[0], `# ${headingText(c.head)}`);
    assert.equal(lines.filter((l) => /^# /.test(l)).length, 1, c.head.id);
    const hs = c.blocks.filter((b) => b.kind === 'h');
    assert.equal(lines.filter((l) => /^#{2,5} /.test(l)).length, hs.length, c.head.id);
    assert.equal(lines.filter((l) => /^\[〔/.test(l)).length, new Set([c.head, ...c.blocks].map((b) => b.page)).size, c.head.id);
    assert.ok(!md.includes('undefined'));
  }
  const md = honbunMarkdown(chapters.find((c) => c.head.id === '4')!);
  assert.ok(md.includes('\n##### ① '));
  assert.ok(md.includes(`(${SITE.url}shisaku/1-1-a-1/)`));
  assert.match(md, /\[〔31ページ〕\]\(https:\/\/www\.pref\.okinawa\.jp\/.+\.pdf#page=39\)/);
});
