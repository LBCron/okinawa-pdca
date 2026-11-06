// lib/honbun.ts（計画の本文を計画ごとに1ページに載せる）。data/extracted/kihon・jisshi を読む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HONBUN_PLANS, JISSHI_PLANS, honbunChapters, honbunHrefOf, honbunAnchor, honbunRows, headingTag, headingText, headingTree, splitNotes, transcribedPages, type HonbunPlan } from '../src/lib/honbun.ts';
import { getKihonList, getShisakuList, nameKey, torikumiPage } from '../src/lib/data.ts';
import type { HonbunCell, HonbunHeading } from '../src/lib/types.ts';

const h = (level: HonbunHeading['level'], id: string, mark: string, title: string): HonbunHeading => ({ kind: 'h', level, id, mark, title, page: 1, source: '' });
const PLANS = Object.keys(HONBUN_PLANS) as HonbunPlan[];

test('本文のどのかたまりも、どれか1つの章に入る。基本計画の章の頭は「はじめに」', () => {
  for (const plan of PLANS) {
    const chapters = honbunChapters(plan);
    assert.equal(chapters.reduce((a, c) => a + 1 + c.blocks.length, 0), honbunRows(plan).length, plan);
    assert.ok(chapters.every((c) => c.head.level === 1 && c.blocks.every((b) => b.kind !== 'h' || b.level > 1)), plan);
  }
  assert.equal(honbunChapters('kihon')[0].head.id, '0');
});

test('見出しの # は計画の中で1つずつ違う', () => {
  for (const plan of PLANS) {
    const ids = honbunRows(plan).flatMap((b) => (b.kind === 'h' ? [b.id] : []));
    assert.equal(new Set(ids).size, ids.length, plan);
  }
});

test('沖縄県PDCA のどの基本施策・施策にも、基本計画と実施計画（前期・中期）の本文の見出しがある', () => {
  for (const k of getKihonList()) assert.equal(honbunHrefOf(k.id), `/21-seiki-vision/kihon/#${honbunAnchor(`4-${k.id}`)}`, `基本施策 ${k.id}`);
  for (const s of getShisakuList()) assert.equal(honbunHrefOf(s.id), `/21-seiki-vision/kihon/#${honbunAnchor(`4-${s.id}`)}`, `施策 ${s.id}`);
  for (const plan of JISSHI_PLANS) {
    for (const k of getKihonList()) assert.equal(honbunHrefOf(k.id, plan), `${HONBUN_PLANS[plan].href}#${honbunAnchor(`2-${k.id}`)}`, `${plan} 基本施策 ${k.id}`);
    for (const s of getShisakuList()) assert.equal(honbunHrefOf(s.id, plan), `${HONBUN_PLANS[plan].href}#${honbunAnchor(`2-${s.id}`)}`, `${plan} 施策 ${s.id}`);
  }
});

test('実施計画の表は、行と列のまたぎを並べると欠けも重なりも無い長方形になる', () => {
  // HTML の表と同じ置き方で、セルをマス目に置いていく（rowspan で上から伸びてきたマスは飛ばす）
  const width = (rows: HonbunCell[][]) => {
    const filled: boolean[][] = [];
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of row) {
        while (filled[r]?.[c]) c++;
        for (let dr = 0; dr < (cell.rs ?? 1); dr++) for (let dc = 0; dc < (cell.cs ?? 1); dc++) {
          (filled[r + dr] ??= [])[c + dc] = true;
        }
        c += cell.cs ?? 1;
      }
    });
    return filled.slice(0, rows.length).map((r) => r.filter(Boolean).length);
  };
  for (const plan of JISSHI_PLANS) {
    for (const b of honbunRows(plan)) {
      if (b.kind !== 'table') continue;
      const ws = [...width(b.head), ...width(b.body)];
      assert.equal(new Set(ws).size, 1, `${plan} p.${b.page} ${b.table} ${ws.join(',')}`);
    }
  }
});

test('実施計画の主な取組の表は施策の中にあり、取組の名前の多くはこのサイトの取組のページにつながる', () => {
  for (const plan of JISSHI_PLANS) {
    let names = 0, linked = 0;
    for (const b of honbunRows(plan)) {
      if (b.kind !== 'table' || b.table !== 'torikumi') continue;
      assert.ok(b.shisaku, `${plan} p.${b.page}`);
      for (const c of b.body.flat()) {
        if (!c.torikumi) continue;
        names++;
        if (torikumiPage(b.shisaku!, nameKey(c.torikumi))) linked++;
      }
    }
    assert.ok(names > 1000 && linked / names > 0.8, `${plan} ${linked}/${names}`);
  }
});

test('画像から読んだのは中期の一部のページだけ', () => {
  assert.equal(transcribedPages('kihon').size, 0);
  assert.equal(transcribedPages('zenki').size, 0);
  assert.ok(transcribedPages('chuki').size > 0);
});

test('見出しの段と書き方', () => {
  assert.equal(headingTag(1), 'h2');
  assert.equal(headingTag(5), 'h6');
  assert.equal(headingText(h(1, '1', '１', '総説')), '第１章 総説');
  assert.equal(headingText(h(1, '0', '', 'はじめに ～県民のみなさまへ～')), 'はじめに ～県民のみなさまへ～');
  assert.equal(headingText(h(3, '4-1-1', '⑴', '世界に誇れる島しょ型環境モデル地域の形成')), '⑴ 世界に誇れる島しょ型環境モデル地域の形成');
  assert.equal(headingText(h(2, '2-1', '将来像1', '沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して')), '将来像1 沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して');
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
