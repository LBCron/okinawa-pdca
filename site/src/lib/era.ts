// 年の書き方（和暦・西暦）の切り替え（フッターとサイドメニューのボタン。scripts/era.ts）。
// ページは報告書と同じ和暦（「令和7年度」「R7」）で書き出し、西暦を選んだ人のブラウザでだけ、画面の文字を西暦（「2025年度」「2025」）に書き換える。
// 書き換えるスクリプト（ERA_JS）は別のファイル（/era-<ハッシュ>.js。pages/era-[hash].js.ts）にし、西暦を選んだ人だけが読む（和暦のままの人は読まない）。
// - 西暦を覚えていれば、Base.astro の <head> のインラインスクリプト（THEME_INIT）が document.write で読み込む。読み終えるまでページを読み進めないので、
//   ページを読みながら（MutationObserver）書き換えられ、最初の描画から西暦で出る（読み終えてから書き換えると、和暦が一瞬見えて、文字の幅のぶんずれる）。
//   ページに埋め込むと、どのページの HTML も gzip で約1.5KB 増える（中央値 11KB の1割強）ので、埋め込まない
// - 和暦のままの人がボタンを押したときは、scripts/era.ts が読み込んでから切り替える
// 外のサイトへのリンク（県の資料の名前・PDF のファイル名）は印字のまま。検索エンジン・SNS のカード・ページの説明文は和暦のまま
import { sha8 } from './hashed.ts';

// ERA_JS が window.era に置く。図（scripts/charts.ts）は描く文字を text で西暦にしてから幅を測り、切り替えたら document の 'era' で描き直す。
// 吹き出し（scripts/tip.ts・terms.ts）は中身を入れたら fix で書き換えてから大きさを測る。読み込んでいないとき（和暦）は window.era が無い
export interface Era {
  readonly seireki: boolean;
  text(s: string): string; // 西暦のときだけ書き換えた文字
  fix(node: Node): void; // 西暦のときだけ、その中の文字と属性をいま書き換える
  set(seireki: boolean): void; // 切り替えて覚える（localStorage）
}
declare global {
  interface Window { era?: Era }
}

// 和暦を西暦にする関数（ブラウザでそのまま動かす JS。テストは test/era.test.ts）。
// - 令和・平成・昭和と、略した R・H・S（全角も）。数字は全角も、「元」も読む。後ろの「年度」「年」「.3」などはそのまま（令和7年度 → 2025年度、R7 → 2025、R6.3 → 2024.3）
// - 略したものは、前後が英数字のもの（GH36人・H5N1・R06102）は読まない
// - 範囲の後ろの元号の無い数（令和4〜7年度・R3～12・令和４年度～６年度）も、前の数より大きければ西暦にする（後ろに月・日が続くものは除く）
// - 西暦と和暦を並べた書き方（2024年（令和6年）・令和7年度（2025年度））は西暦だけにする
// 古いブラウザでも読めるよう、後読み（(?<=)）は使わない（読めないと ERA_JS 全体が動かない）
export const SEIREKI = String.raw`(s) => {
  if (!/[RＲHＨSＳ令平昭]/.test(s)) return s;
  const num = (d) => (d === '元' ? 1 : Number(d.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
  const base = (e) => (/^[令RＲ]/.test(e) ? 2018 : /^[平HＨ]/.test(e) ? 1988 : 1925);
  return s
    .replace(/(\d{4}年度?)[（(](?:令和|平成|昭和|[RＲHＨSＳ])[ 　]?[0-9０-９元]{1,2}年度?[）)]/g, '$1')
    .replace(/(?:令和|平成|昭和)[ 　]?[0-9０-９元]{1,2}(年度?)[（(](\d{4})年度?[）)]/g, '$2$1')
    .replace(
      /(?:(^|[^A-Za-zＡ-Ｚａ-ｚ0-9０-９_])([RＲHＨSＳ])|(令和|平成|昭和))[ 　]?([0-9０-９]{1,2}|元)(?![0-9０-９A-Za-zＡ-Ｚａ-ｚ])(?:((?:[ 　]?年度?)?[ 　]?[〜～~\-－‐―−–][ 　]?)([0-9０-９]{1,2})(?![0-9０-９.．A-Za-zＡ-Ｚａ-ｚ月日]))?/g,
      (m, pre, ab, kan, a, mid, b) => {
        const y = base(ab || kan);
        return (pre || '') + (y + num(a)) + (mid ? mid + (num(b) > num(a) ? y + num(b) : b) : '');
      },
    );
}`;

// 書き換えるスクリプト。西暦を覚えていれば、すぐに読み込みながら書き換える。
// - 書き換えるのは本文の文字と、読み上げの名前・ツールチップと用語の吹き出しの文・絞り込みの条件の名前の属性（ATTRS）。KEEP の中は書き換えない
// - 元の文字は覚えておき（texts・attrs）、和暦に戻すときはそれに戻す（逆向きに書き換えると、もとから西暦の「2030年」まで和暦になるため）。
//   書き換えたあとで後ろに足された分（読み込みの途中で分かれて届いた文字）は元に足し、ほかのスクリプトが入れ替えたものはいまの文字を元にする（orig）
// - 自分で書き換えた分の知らせ（MutationObserver）は、最後に捨てる
// - 読み終えたら（DOMContentLoaded）もう一度全体を見る。戻る・進むでキャッシュから開いたページは、ほかのページで切り替えた書き方に合わせる（pageshow）
// - 和暦のままの人がボタンを押して読み込んだとき（読み終えたあと）は、set で全体を書き換える
export const ERA_JS = `(() => {
  const root = document.documentElement;
  const conv = ${SEIREKI};
  const ATTRS = ['aria-label', 'title', 'data-tip-label', 'data-term-note', 'data-label'];
  const KEEP = 'head, script, style, textarea, a[target="_blank"]';
  const texts = new WeakMap();
  const attrs = new WeakMap();
  let on = false;
  const saved = () => { try { return localStorage.getItem('era') === 'seireki'; } catch { return false; } };
  const orig = (cur, m) => (!m ? cur : cur === m[1] ? m[0] : cur.startsWith(m[1]) ? m[0] + cur.slice(m[1].length) : cur);
  const swap = (cur, m, put) => {
    const o = orig(cur, m), c = on ? conv(o) : o;
    if (c !== cur) put(c);
    return c !== o ? [o, c] : null;
  };
  const text = (n) => {
    const m = swap(n.data, texts.get(n), (c) => { n.data = c; });
    m ? texts.set(n, m) : texts.delete(n);
  };
  const el = (e) => {
    for (const k of ATTRS) {
      const v = e.getAttribute(k);
      if (v === null) continue;
      let a = attrs.get(e);
      const m = swap(v, a && a[k], (c) => e.setAttribute(k, c));
      if (m) { if (!a) attrs.set(e, (a = {})); a[k] = m; } else if (a) delete a[k];
    }
  };
  const skip = { acceptNode: (n) => (n.nodeType === 1 && n.matches(KEEP) ? 2 : 1) };
  const fix = (node) => {
    const t = node.nodeType;
    if (t !== 1 && t !== 3) return;
    const p = t === 1 ? node : node.parentElement;
    if (!p || p.closest(KEEP)) return;
    if (t === 3) return text(node);
    const w = document.createTreeWalker(node, 5, skip);
    for (let n = node; n; n = w.nextNode()) n.nodeType === 3 ? text(n) : el(n);
  };
  const mo = new MutationObserver((rs) => {
    for (const r of rs) {
      if (r.type === 'childList') r.addedNodes.forEach(fix);
      else if (r.type === 'characterData') fix(r.target);
      else if (!r.target.closest(KEEP)) el(r.target);
    }
    mo.takeRecords();
  });
  const apply = (v) => {
    on = v;
    if (v) root.dataset.era = 'seireki';
    else delete root.dataset.era;
    mo.disconnect();
    if (document.body) fix(document.body);
    if (v) mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.dispatchEvent(new Event('era'));
  };
  window.era = {
    get seireki() { return on; },
    text: (s) => (on ? conv(s) : s),
    fix: (n) => { if (on) fix(n); },
    set: (v) => { try { localStorage.setItem('era', v ? 'seireki' : 'wareki'); } catch {} apply(v); },
  };
  if (saved()) apply(true);
  document.addEventListener('DOMContentLoaded', () => { if (on) fix(document.body); });
  addEventListener('pageshow', (e) => { if (e.persisted && saved() !== on) apply(!on); });
})();`;

// 書き出す場所。名前は中身の SHA-256 の先頭8桁で、ずっとキャッシュさせる（public/_headers）
export const ERA_JS_PATH = `/era-${sha8(ERA_JS)}.js`;
