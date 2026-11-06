// lib/jisshi.ts（実施計画の本文の表を、ほかのページと同じ見せ方の形に組み直す）。data/extracted/jisshi を読む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JISSHI_PLANS, honbunRows } from '../src/lib/honbun.ts';
import { parseTargetLine, parseVal, planJigyo, planKyodo, planSeika, planShuyou, planTorikumi, seikaTargets, splitActors } from '../src/lib/jisshi.ts';

test('parseVal: 値・かっこ書き・【参考値】の後ろに分ける', () => {
  assert.deepEqual(parseVal('基準値', '8.2％\n（R２年度）\n【参考値】\n7.5％\n（R元年度）'), { label: '基準値', v: '8.2％', y: 'R２年度', note: '参考値：7.5％（R元年度）' });
  assert.deepEqual(parseVal('R6年度の目標値', '12.1％\n（挑戦的な目標 15.3％）'), { label: 'R6年度の目標値', v: '12.1％', y: '挑戦的な目標 15.3％', note: '' });
  assert.equal(parseVal('全国の現状値', '－').v, '－');
});

test('parseTargetLine: 表の後ろの目標値の行', () => {
  assert.deepEqual(parseTargetLine('R９年度の目標値：15.1％（挑戦的な目標 20.7％）'), { label: 'R9年度の目標値', v: '15.1％', y: '挑戦的な目標 20.7％', note: '' });
  assert.deepEqual(parseTargetLine('R13年度の目標値：4.8t-CO₂/人'), { label: 'R13年度の目標値', v: '4.8t-CO₂/人', y: '', note: '' });
  assert.equal(parseTargetLine('出典：沖縄県環境部'), null);
});

test('splitActors: 折り返した主体の名前をつなぎ、1行に1つの主体は分ける', () => {
  assert.deepEqual(splitActors('県\n市町村\n事業者\n関係団体\n県民'), ['県', '市町村', '事業者', '関係団体', '県民']);
  assert.deepEqual(splitActors('沖縄県国際\n交流・人材育\n成財団'), ['沖縄県国際交流・人材育成財団']);
  assert.deepEqual(splitActors('那覇港管理\n組合\n県'), ['那覇港管理組合', '県']);
  assert.deepEqual(splitActors('民間事業者\n関係団体等'), ['民間事業者', '関係団体等']);
  assert.deepEqual(splitActors('JICA沖縄\n県'), ['JICA沖縄', '県']);
});

test('成果指標・主要指標・協働・主な取組の表は、どれも組み直せる（PDF と同じ表のまま出すものが無い）', () => {
  for (const plan of JISSHI_PLANS) {
    const rows = honbunRows(plan);
    const targets = seikaTargets(rows);
    for (const b of rows) {
      if (b.kind !== 'table') continue;
      const where = `${plan} p.${b.page} ${b.table}`;
      if (b.table === 'seika') {
        const s = planSeika(b, targets.get(b) ?? []);
        assert.ok(s && s.name && s.route.some((v) => v.label.includes('目標値')), where);
      }
      if (b.table === 'shuyou') assert.ok(planShuyou(b)?.length, where);
      if (b.table === 'kyodo') assert.ok(planKyodo(b)?.length, where);
      if (b.table === 'torikumi') assert.ok(planTorikumi(b)?.rows.some((r) => r.kind === 'item'), where);
      if (b.table === 'other' && b.head[0]?.[0]?.text === 'No.') assert.ok(planJigyo(b)?.length, where);
    }
  }
});

test('成果指標の表の後ろの R9・R13 の目標値の行は、どれかの成果指標の表に入る', () => {
  for (const plan of JISSHI_PLANS) {
    const rows = honbunRows(plan);
    const targets = seikaTargets(rows);
    const left = rows.filter((b) => b.kind === 'p' && parseTargetLine(b.text) && !targets.has(b));
    assert.deepEqual(left.map((b) => b.kind === 'p' && b.text), [], plan);
  }
});
