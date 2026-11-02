// 計画の目次のデータ（lib/tree-data.ts）。コミットした data/extracted を読む
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localNo, treeDataHash, treeDataJson, treeDataPath, type TreeData } from '../src/lib/tree-data.ts';
import { getPlanTree, planTreeCounts } from '../src/lib/data.ts';

const data = () => JSON.parse(treeDataJson()) as TreeData;

test('localNo: 通しの番号から、その階層の中の番号を取り出す', () => {
  assert.equal(localNo('1-(2)'), '(2)');
  assert.equal(localNo('1-(2)-イ'), 'イ');
  assert.equal(localNo('1-(2)-イ-③'), '③');
});

test('書き出す場所の名前は、中身の SHA-256 の先頭8桁', () => {
  assert.equal(treeDataHash(), createHash('sha256').update(treeDataJson()).digest('hex').slice(0, 8));
  assert.equal(treeDataPath(), `/mokuji/data-${treeDataHash()}.json`);
});

test('目次のデータは lib/data.ts の getPlanTree と同じ並び・同じ数で、行の id とリンクは重ならない', () => {
  const d = data();
  const tree = getPlanTree();
  assert.deepEqual(d.visions.map((v) => v.id), tree.map((v) => v.vision.id));
  const kihon = d.visions.flatMap((v) => v.kihon);
  const tenkai = kihon.flatMap((k) => k.tenkai);
  const shisaku = tenkai.flatMap((t) => t.shisaku);
  const planKihon = tree.flatMap((v) => v.kihon);
  const planShisaku = planKihon.flatMap((k) => k.tenkai.flatMap((t) => t.shisaku));
  assert.deepEqual(kihon.map((k) => k.id), planKihon.map((k) => k.kihon.id));
  assert.deepEqual(shisaku.map((s) => s.id), planShisaku.map((s) => s.shisaku.id));
  assert.equal(kihon.flatMap((k) => k.shuyou).length, planKihon.flatMap((k) => k.shuyou).length);
  assert.equal(shisaku.flatMap((s) => s.seika).length, planShisaku.flatMap((s) => s.seika).length);
  assert.equal(shisaku.flatMap((s) => s.torikumi).length, planShisaku.flatMap((s) => s.torikumi).length);
  const ids = [...kihon.map((k) => `k-${k.id}`), ...tenkai.map((t) => `t-${t.id}`), ...shisaku.map((s) => `s-${s.id}`)];
  assert.equal(new Set(ids).size, ids.length);
  // 取組のリンクは施策ごとに1つずつ（同じ取組がいくつかの施策に載るときも、施策ごとのページがある）。成果指標のリンクも重ならない
  const toriHrefs = shisaku.flatMap((s) => s.torikumi.map(([, , href]) => href));
  assert.equal(new Set(toriHrefs).size, toriHrefs.length);
  const seikaHrefs = shisaku.flatMap((s) => s.seika.map(([, href]) => href));
  assert.equal(new Set(seikaHrefs).size, seikaHrefs.length);
});

test('取組の活動指標は、総括報告書の欄の名前（空なら部局の検証票の名前）で、名前の無い取組は無い', () => {
  const tori = data().visions.flatMap((v) => v.kihon.flatMap((k) => k.tenkai.flatMap((t) => t.shisaku.flatMap((s) => s.torikumi))));
  const groups = getPlanTree().flatMap((v) => v.kihon.flatMap((k) => k.tenkai.flatMap((t) => t.shisaku.flatMap((s) => s.torikumi))));
  groups.forEach((g, i) => {
    if (g.latest.indicator) assert.equal(tori[i][3], g.latest.indicator, g.href);
  });
  assert.deepEqual(tori.filter(([, , , act]) => !act).map(([, , href]) => href), []);
});

test('planTreeCounts: 計画の木の段ごとの数は、目次のデータの数と同じ', () => {
  const d = data();
  const kihon = d.visions.flatMap((v) => v.kihon);
  const tenkai = kihon.flatMap((k) => k.tenkai);
  const shisaku = tenkai.flatMap((t) => t.shisaku);
  assert.deepEqual(planTreeCounts(), {
    vision: d.visions.length,
    kihon: kihon.length,
    tenkai: tenkai.length,
    shisaku: shisaku.length,
    torikumi: shisaku.flatMap((s) => s.torikumi).length,
    shuyou: kihon.flatMap((k) => k.shuyou).length,
    seika: shisaku.flatMap((s) => s.seika).length,
  });
});
