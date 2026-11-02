// 計画の目次（/mokuji/。pages/mokuji.astro）。
//  - 描く: ul[data-tree] の data-src（名前にハッシュの付いた JSON。読めなければ data-fallback の控え）を読み、目次を描く（データの形は lib/tree-data.ts）。
//    URL に q があれば、さがしてから一度で描く。描く HTML の形と見た目の決まりは pages/mokuji.astro の頭の説明と CSS
//  - 開く深さ: select[data-tree-depth] で i を選ぶと、木の details のうち階層（data-level。将来像が 0）が i 未満のものを開き、ほかは閉じる。
//    いまの開き方がどれかの深さにそろっているときはその深さを、そろっていないときは「ばらばら」（値が空。選べない）を選んだ形にする
//    （1つずつ開け閉めしたとき・キーワードでさがしたとき。印刷の前後に scripts/print.ts が開け閉めしたときも同じ。同じ深さを選び直せるように）
//  - キーワード: form[data-tree-search="木の id"] の言葉で、施策・取組・成果指標の名前（li[data-q] の .qn）を部分一致でさがす
//    （全角・半角と表記ゆれは lib/search.ts でそろえる）。当たった行とその親の行・当たった行の中だけを見せ、当たった行の親を開いて、当たった字に印を付ける。
//    成果指標は、PC の幅では施策の行の名前の横にあるので（同じ指標の .qn が2つある。data-qk）、施策の行が当たったことにする。
//    言葉を消すと、さがす前の開き方に戻す。言葉は URL の q に残す（ほかの一覧の絞り込みと同じ）
//  - 出す指標: scripts/tree-show.ts。選んでいない種類は CSS で隠し（pages/mokuji.astro）、キーワードでもさがさない
//  - 戻る・進む: bfcache から戻したときは、言葉の欄と木を URL の q にそろえる。bfcache を使わずに読み直したときは目次を描き直すので、
//    離れるときに開き方・出す指標・スクロールの位置を history.state に残し、描いたあとに戻す
//  - キーボード: 木（role="tree"）では Tab は1回だけ止まり（前にいた行。はじめは最初の行）、↑ ↓ で見えている行を移り、Home・End で最初・最後の行へ。
//    → は閉じた行を開き、開いた行では最初の子へ。← は開いた行を閉じ、ほかでは親の行へ。Space は開け閉め、Enter は名前のページを開く
//    （施策展開はページが無いので Enter も開け閉め。下の段の無い行は Space もページを開く）。
//    フォーカスするのは名前のリンク（施策展開は名前）で、▶ の丸（summary）は Tab で止めない（マウスと、読み上げソフトでタップして開け閉めするため）。
//    指標（PC では名前の横、スマホでは開いた中の行）にも止まらない（マウスで押すリンクにする）
import { fmt } from '../lib/format.ts';
import { esc } from '../lib/html.ts';
import { matchesAll, searchText, searchWords, splitMatches, type SearchWord } from '../lib/search.ts';
import type { TreeData, TreeKihon, TreeLink, TreeShisaku, TreeTenkai, TreeVision } from '../lib/tree-data.ts';
import { getJsonOr } from './fetch-json.ts';
import { hashId } from './hash.ts';
import { bump, reveal } from './motion.ts';
import { treeShow } from './tree-show.ts';

// ---------------------------------------------------------------- 描く

// すぐ下に並ぶものの数（0 のものは出さない）。閉じている行の名前の後ろに出す。ind は指標の数で、指標の種類（出す指標の data-show の値）を入れる
// （PC では出さないので、区切りの「・」がずれないよう後ろに置く）。
// ▶ の丸の読み上げの名前には、指標を除いた数を使う（PC では指標は名前の横にあるため）。そこで読むので、画面の数は読ませない（docs/design.md の9章）
type Count = [label: string, n: number, ind?: string];
const counts = (cs: Count[]) =>
  `<span class="cnt" aria-hidden="true">${cs.filter(([, n]) => n > 0).map(([l, n, ind]) => `<span${ind ? ` class="c-ind" data-ind="${ind}"` : ''}>${l} <b>${n}</b></span>`).join('')}</span>`;
const said = (cs: Count[]) => cs.filter(([, n, ind]) => n > 0 && !ind).map(([l, n]) => `${l} ${n}`).join('・');
// 開け閉めの丸（summary）。Tab では止めない（キーボードでは名前の行で開け閉めする）
const toggle = (level: number, cs: Count[]) =>
  `<details data-level="${level}"><summary class="tg" tabindex="-1"><span class="tw" aria-hidden="true"></span><span class="sr-only">${said(cs)}</span></summary>`;
// 木の項目（treeitem）。キーボードで移る先で、Tab で止まるのはいまの項目の1つだけ（下のキーボード）。level は将来像が 1。open は下の段があるもの。
// li は項目にせず（role="none"）、中の名前を項目にする
const ti = (level: number, open = false) => `role="treeitem" tabindex="-1" aria-level="${level}"${open ? ' aria-expanded="false"' : ''}`;
// 読み上げの名前の頭に、段の名前と番号を足す（画面の番号と「指標」の札は読ませない。ページの階層と同じく、番号だけでは何の段か分からないため）。
// キーワードでさがす名前（.qn）はこの外に置く
const sr = (s: string) => `<span class="sr-only">${esc(s)}　</span>`;
// 指標。q はキーワードでさがすもの（成果指標）。名前の横（PC）と開いた中の行（スマホ）の2か所に書く。
// show は出す指標の種類（data-show の値）で、data-ind に入れる
const indName = (name: string, href: string, q: boolean) => (q ? `<span class="qn" data-qk="${esc(href)}">${esc(name)}</span>` : esc(name));
const inds = (links: TreeLink[], kind: string, show: string, q: boolean) =>
  links.length
    ? `<span class="inds" data-ind="${show}">${links.map(([name, href]) => `<span class="ind-i"><span class="ind" aria-hidden="true">指標</span><a class="sub-link" href="${esc(href)}" tabindex="-1">${sr(kind)}${indName(name, href, q)}</a></span>`).join('')}</span>`
    : '';
const indRow = ([name, href]: TreeLink, kind: string, show: string, q: boolean) =>
  `<li role="none" class="leaf leaf-ind" data-ind="${show}"${q ? ' data-q="成果指標"' : ''}><div class="tb"><span class="no ind" aria-hidden="true">指標</span><a class="name-link" href="${esc(href)}" tabindex="-1">${sr(kind)}${indName(name, href, q)}</a></div></li>`;
// 取組の活動指標。取組の名前の右に、どの幅でも出す（取組は下の段の無い行なので）。取組のページの活動指標の節へのリンクにする
const actInd = (name: string, href: string) =>
  name ? `<span class="act" data-ind="katsudou"><span class="ind" aria-hidden="true">指標</span><a class="sub-link" href="${esc(href)}#katsudou" tabindex="-1">${sr('活動指標')}<span class="qn">${esc(name)}</span></a></span>` : '';

function shisakuRow(s: TreeShisaku) {
  const cs: Count[] = [['取組', s.torikumi.length], ['成果指標', s.seika.length, 'seika']];
  const rows = [
    ...s.seika.map((l) => indRow(l, '成果指標', 'seika', true)),
    // 複数の施策に載っている取組は、名前の後ろに「2施策に共通」（同じ名前の行がほかの施策の下にもあるわけが分かるように）
    ...s.torikumi.map(([no, name, href, act, common]) => `<li role="none" class="leaf" data-q="取組"><div class="tb"><span class="no" aria-hidden="true">${no}</span><span class="nm"><a class="name-link" href="${esc(href)}" ${ti(5)}>${sr(`取組${no}`)}<span class="qn">${esc(name)}</span></a>${common ? `<span class="common">${common}施策に共通</span>` : ''}${actInd(act, href)}</span></div></li>`),
  ];
  return `<li role="none" class="nd lv3" id="s-${esc(s.id)}" data-q="施策"><div class="tb"><span class="no" aria-hidden="true">${esc(s.no)}</span><span class="nm"><a class="name-link" href="/shisaku/${esc(s.id)}/" ${ti(4, rows.length > 0)}>${sr(`施策${s.no}`)}<span class="qn">${esc(s.name)}</span></a>${inds(s.seika, '成果指標', 'seika', true)} ${counts(cs)}</span></div>${
    rows.length ? `${toggle(3, cs)}<ul role="group">${rows.join('')}</ul></details>` : '<span class="tg" aria-hidden="true"><span class="tw tw-none"></span></span>'
  }</li>`;
}
// 施策展開にはページが無いので、名前はリンクにせず、名前の行を押しても開け閉めする
function tenkaiRow(t: TreeTenkai) {
  const cs: Count[] = [['施策', t.shisaku.length]];
  return `<li role="none" class="nd lv2" id="t-${esc(t.id)}"><div class="tb"><span class="no" aria-hidden="true">${esc(t.no)}</span><span class="nm"><span class="tk-name" ${ti(3, true)}>${sr(`施策展開${t.no}`)}${esc(t.name)}</span> ${counts(cs)}</span></div>${toggle(2, cs)}<ul role="group">${t.shisaku.map(shisakuRow).join('')}</ul></details></li>`;
}
function kihonRow(k: TreeKihon) {
  const cs: Count[] = [['施策展開', k.tenkai.length], ['主要指標', k.shuyou.length, 'shuyou']];
  return `<li role="none" class="nd lv1" id="k-${esc(k.id)}"><div class="tb"><span class="no" aria-hidden="true">${esc(k.no)}</span><span class="nm"><a class="name-link" href="/kihon/${esc(k.id)}/" ${ti(2, true)}>${sr(`基本施策${k.no}`)}${esc(k.name)}</a>${inds(k.shuyou, '主要指標', 'shuyou', false)} ${counts(cs)}</span></div>${toggle(1, cs)}<ul role="group">${k.shuyou.map((l) => indRow(l, '主要指標', 'shuyou', false)).join('')}${k.tenkai.map(tenkaiRow).join('')}</ul></details></li>`;
}
// 将来像は帯にする（番号の印は components/Sz.astro と同じ形）
function visionRow(v: TreeVision) {
  const cs: Count[] = [['基本施策', v.kihon.length]];
  return `<li role="none" class="nd lv0" id="v-${v.id}"><div class="tb"><span class="nm"><span class="sz-ribbon sz-${v.id}"><span class="badge-sz sz-${v.id}" aria-hidden="true">${v.id}</span><a class="name-link" href="/future/${v.id}/" ${ti(1, true)}>${sr(`将来像${v.id}`)}${esc(v.name)}</a></span> ${counts(cs)}</span></div>${toggle(0, cs)}<ul role="group">${v.kihon.map(kihonRow).join('')}</ul></details></li>`;
}

// ---------------------------------------------------------------- 読み込み

// 離れるときに残す、開き方・出す指標・スクロールの位置（history.state の tree）。src は描いたデータで、データが変わったら（公開し直したら）使わない
interface Saved { src: string; open: number[]; show: string[]; y: number }
const savedOf = (src: string): Saved | null => {
  const s = (history.state as { tree?: Saved } | null)?.tree;
  return s && s.src === src ? s : null;
};

for (const tree of document.querySelectorAll<HTMLElement>('ul[data-tree]')) void init(tree);

async function init(tree: HTMLElement) {
  const msg = tree.parentElement?.querySelector<HTMLElement>('.tree-msg');
  const form = document.querySelector<HTMLFormElement>(`form[data-tree-search="${tree.id}"]`);
  const input = form?.querySelector<HTMLInputElement>('input[name="q"]') ?? null;
  const hits = document.querySelector<HTMLElement>(`[data-tree-hits="${tree.id}"] > span`);
  const depth = document.querySelector<HTMLSelectElement>(`select[data-tree-depth][aria-controls="${tree.id}"]`);
  const urlQ = () => new URLSearchParams(location.search).get('q') || '';
  // 成果指標を施策の名前の横に出す幅（pages/mokuji.astro の CSS と同じ）
  const wide = matchMedia('(min-width: 760px)');

  // ---------------------------------------------------------------- 出す指標
  // データを待たずに動かす（scripts/tree-show.ts）。選び直したときに言葉が入っていれば、さがし直す（描いたあとだけ）
  let ready = false;
  const show = treeShow(tree, () => { if (ready && input?.value.trim()) run(); });
  const shows = show.shows;

  // 言葉の欄は、データを待たずに URL の q で埋める。届くまでに打った言葉も URL に残し、描いたあとにさがす
  let timer = 0;
  if (input) input.value = urlQ();
  const update = () => {
    if (!input) return;
    if (ready) run();
    const url = new URL(location.href);
    const q = input.value.trim();
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
  };
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(update, 120);
  });
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    update();
  });

  const src = tree.dataset.src!;
  let data: TreeData;
  try {
    data = await getJsonOr<TreeData>(src, tree.dataset.fallback!);
  } catch {
    tree.removeAttribute('aria-busy');
    if (msg) msg.textContent = '目次を読み込めませんでした。時間をおいて、ページを再読み込みしてください。';
    return;
  }
  // はじめに選んである深さまで開く（pages/mokuji.astro の START。読み直したときにブラウザが戻した選択は使わない）
  const startDepth = Number([...(depth?.options ?? [])].find((o) => o.defaultSelected)?.value ?? 1);
  tree.innerHTML = data.visions.map(visionRow).join('');
  const nodes = [...tree.querySelectorAll<HTMLDetailsElement>('details[data-level]')];
  const saved = savedOf(src);
  if (saved) show.set(saved.show);
  const openSet = saved ? new Set(saved.open) : null;
  nodes.forEach((d, i) => { d.open = openSet ? openSet.has(i) : Number(d.dataset.level) < startDepth; });
  tree.setAttribute('role', 'tree');

  // ---------------------------------------------------------------- キーボード
  // 木の行（指標の行は除く）。item はフォーカスする名前
  interface Row { li: HTMLLIElement; item: HTMLElement; details: HTMLDetailsElement | null; kids: Row[]; parent: Row | null }
  const rowOf = new Map<Element, Row>(); // 名前と li から行へ
  const rows = (ul: Element, parent: Row | null): Row[] =>
    [...ul.querySelectorAll<HTMLLIElement>(':scope > li')].filter((li) => !li.classList.contains('leaf-ind')).map((li) => {
      const details = li.querySelector<HTMLDetailsElement>(':scope > details');
      const r: Row = { li, item: li.querySelector<HTMLElement>(':scope > .tb [role="treeitem"]')!, details, kids: [], parent };
      rowOf.set(li, r).set(r.item, r);
      if (details) r.kids = rows(details.querySelector(':scope > ul')!, r);
      return r;
    });
  const roots = rows(tree, null);
  const seen = (r: Row) => !r.li.hidden;
  // 見えている項目（画面の並びの順）
  const visible = () => {
    const out: HTMLElement[] = [];
    const walk = (rs: Row[]) => {
      for (const r of rs.filter(seen)) {
        out.push(r.item);
        if (r.details?.open) walk(r.kids);
      }
    };
    walk(roots);
    return out;
  };

  // Tab で止まる項目（いまの項目）。ほかは tabindex="-1"
  let current = roots[0].item;
  current.tabIndex = 0;
  const point = (el: HTMLElement) => {
    current.tabIndex = -1;
    el.tabIndex = 0;
    current = el;
  };
  // 読み上げの開け閉め（aria-expanded）と兄弟の中の何番目か（aria-posinset・aria-setsize）を、いまの見え方にそろえる。
  // いまの項目が見えなくなったら（親を閉じた・キーワードで隠した）、見えているいちばん近い親（無ければ最初の行）にする
  const put = (el: Element, k: string, v: string) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const describe = () => {
    const shown = new Set<HTMLElement>();
    const walk = (rs: Row[]) => {
      const sibs = rs.filter(seen).map((r) => r.item);
      sibs.forEach((el, i) => {
        put(el, 'aria-posinset', String(i + 1));
        put(el, 'aria-setsize', String(sibs.length));
        shown.add(el);
      });
      for (const r of rs.filter(seen)) {
        if (r.details) put(r.item, 'aria-expanded', String(r.details.open));
        if (r.details?.open) walk(r.kids);
      }
    };
    walk(roots);
    if (shown.has(current)) return;
    let p = rowOf.get(current)!.parent;
    while (p && !shown.has(p.item)) p = p.parent;
    const next = p?.item ?? visible()[0];
    if (next) point(next);
  };
  // キーボード・施策展開の名前の行で開け閉めする。読み上げの属性は、子へ移る前にすぐそろえる（toggle を待たない）
  const openRow = (r: Row, open: boolean) => {
    if (!r.details || r.details.open === open) return;
    if (open) reveal([r.details], 'm-opening');
    r.details.open = open;
    describe();
  };

  tree.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t.getAttribute('role') === 'treeitem') point(t);
  });
  tree.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // ▶ の丸（summary）にフォーカスがあるとき（マウスで押したあと）は、その行にいるものとする。Enter・Space は summary に任せる
    const tg = (e.target as Element).closest('summary');
    const r = rowOf.get(tg ? tg.closest('li')! : (e.target as Element));
    if (!r) return;
    let next: HTMLElement | undefined;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End': {
        const list = visible();
        const i = list.indexOf(r.item);
        next = { ArrowDown: list[i + 1], ArrowUp: list[i - 1], Home: list[0], End: list.at(-1) }[e.key];
        break;
      }
      case 'ArrowRight':
        if (!r.details) break;
        if (!r.details.open) openRow(r, true);
        else next = r.kids.find(seen)?.item;
        break;
      case 'ArrowLeft':
        if (r.details?.open) openRow(r, false);
        else next = r.parent?.item;
        break;
      case ' ':
      case 'Enter':
        if (tg) return;
        if (r.details && (e.key === ' ' || !(r.item instanceof HTMLAnchorElement))) openRow(r, !r.details.open);
        else if (e.key === ' ') r.item.click();
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      point(next);
      next.focus();
    }
  });
  // マウスで ▶ の丸か施策展開の名前の行を押したとき。押した行を、次に Tab で木に入ったときの行にし、木の中にフォーカスがあれば、その行の名前へ移す
  tree.addEventListener('click', (e) => {
    const t = e.target as Element;
    const tg = t.closest('summary');
    const tb = tg ? null : t.closest('.lv2 > .tb');
    const r = tg || tb ? rowOf.get((tg || tb)!.closest('li')!) : undefined;
    if (!r) return;
    // 施策展開は名前の行を押しても開け閉めする（文字を選んだときはしない）
    if (tb) {
      if (!getSelection()?.isCollapsed) return;
      openRow(r, !r.details!.open);
    }
    point(r.item);
    if (tree.contains(document.activeElement)) r.item.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- 開く深さ
  const opensAt = (n: number) => (d: HTMLDetailsElement) => Number(d.dataset.level) < n;
  const depths = [...(depth?.options ?? [])].filter((o) => o.value).map((o) => Number(o.value));
  // キーワードでさがす前の開き方（さがしているあいだだけ持つ）
  let before: boolean[] | null = null;
  let queued = false;
  const sync = () => {
    queued = false;
    if (depth) depth.value = String(depths.find((n) => nodes.every((d) => d.open === opensAt(n)(d))) ?? '');
    describe();
  };
  // toggle は泡立たないので、木で捕まえて受ける。一度にたくさん開け閉めしたときも、そろったかを見るのは1回だけにする
  tree.addEventListener('toggle', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }, true);
  depth?.addEventListener('change', () => {
    if (!depth.value) return;
    const open = opensAt(Number(depth.value));
    for (const d of nodes) d.open = open(d);
    // さがしているあいだに選んだときは、言葉を消したあともその開き方にする
    if (before) before = nodes.map(open);
    sync();
  });

  // ---------------------------------------------------------------- キーワード
  const lis = [...tree.querySelectorAll<HTMLLIElement>('li')];
  const original = new Map([...tree.querySelectorAll<HTMLElement>('.qn')].map((el) => [el, el.textContent || '']));
  // show は出す指標の種類（選んでいないときはさがさない）。活動指標は取組の行の中にあるので、取組の行が当たったことにする
  const items = [
    ...[...tree.querySelectorAll<HTMLLIElement>('li[data-q]')].map((li) => {
      const name = li.querySelector<HTMLElement>(':scope > .tb .name-link .qn')!;
      const key = name.dataset.qk;
      return {
        li,
        kind: li.dataset.q!,
        show: li.dataset.ind,
        text: searchText(original.get(name)!),
        names: key ? [...tree.querySelectorAll<HTMLElement>(`.qn[data-qk="${CSS.escape(key)}"]`)] : [name],
        row: li.closest<HTMLLIElement>('li.lv3')!,
      };
    }),
    ...[...tree.querySelectorAll<HTMLElement>('.act .qn')].map((name) => {
      const li = name.closest('li')!;
      return { li, kind: '活動指標', show: 'katsudou', text: searchText(original.get(name)!), names: [name], row: li };
    }),
  ];
  // 件数は、言葉の欄の説明と同じ順（施策・取組・成果指標）に並べ、活動指標は最後に置く
  const kinds = ['施策', '取組', '成果指標', '活動指標'];

  // 当たった字に印（mark）を付ける。words が null なら元の文字に戻す
  const painted = new Set<HTMLElement>();
  const paint = (el: HTMLElement, words: SearchWord[] | null) => {
    const text = original.get(el)!;
    const parts = splitMatches(text, words ?? []);
    if (!parts.some((p) => p.hit)) {
      el.textContent = text;
      painted.delete(el);
      return;
    }
    el.replaceChildren(...parts.map((p) => {
      if (!p.hit) return p.text;
      const m = document.createElement('mark');
      m.textContent = p.text;
      return m;
    }));
    painted.add(el);
  };

  // 木がいま見せている言葉（URL の q と同じ形。前後の空白を除く）
  let shown = '';
  function run() {
    if (!input || !hits) return;
    shown = input.value.trim();
    const words = searchWords(input.value);
    for (const el of [...painted]) paint(el, null);
    for (const li of tree.querySelectorAll('li[data-hit]')) li.removeAttribute('data-hit');
    if (!words.length) {
      for (const li of lis) li.hidden = false;
      if (before) nodes.forEach((d, i) => { d.open = before![i]; });
      before = null;
      hits.textContent = '';
      describe();
      return;
    }
    before ??= nodes.map((d) => d.open);
    const n = new Map(kinds.map((k) => [k, 0]));
    const hit: HTMLLIElement[] = [];
    for (const it of items) {
      if ((it.show && !shows.has(it.show)) || !matchesAll(it.text, words)) continue;
      n.set(it.kind, n.get(it.kind)! + 1);
      const li = it.kind === '成果指標' && wide.matches ? it.row : it.li;
      li.dataset.hit = '';
      hit.push(li);
      for (const el of it.names) paint(el, words);
    }
    // 当たった行の親の行は見せて開き、ほかは閉じる。当たった行とその中は見せる（中は閉じたまま）
    const keep = new Set<Element>();
    const open = new Set<Element>();
    for (const li of hit) {
      for (let a = li.parentElement; a && a !== tree; a = a.parentElement) {
        if (a instanceof HTMLLIElement) keep.add(a);
        else if (a instanceof HTMLDetailsElement) open.add(a);
      }
    }
    for (const li of lis) li.hidden = !keep.has(li) && !li.closest('li[data-hit]');
    for (const d of nodes) d.open = open.has(d);
    const found = [...n].filter(([, x]) => x > 0).map(([k, x]) => `${k} ${fmt(x)}`).join('・');
    const text = found ? `${found} が見つかりました` : '見つかりませんでした';
    if (hits.textContent !== text) {
      hits.textContent = text;
      bump(hits);
    }
    describe();
  }

  // 言葉の欄と木を URL の q にそろえる。URL はさがすたびに書き換えているので、いつも正しい。木がもうその言葉を見せていれば、欄だけを直す
  const fromUrl = () => {
    if (!input) return;
    const q = urlQ();
    if (input.value.trim() !== q) input.value = q;
    if (shown !== q) run();
  };
  ready = true;
  fromUrl();
  sync();
  tree.removeAttribute('aria-busy');
  if (msg) msg.hidden = true;

  if (saved) {
    // bfcache を使わずに戻ったとき: 離れたときのスクロールの位置に戻す（描く前はページが短く、ブラウザが戻せないことがある）
    window.scrollTo(0, saved.y);
  } else {
    // # の行き先（/mokuji/#s-1-1-a-1 など）が目次の中にあれば、親を開いてそこへ動く（scripts/disclosure.ts は目次を描く前に動くので、ここで行う）
    const id = hashId();
    const target = id ? document.getElementById(id) : null;
    if (target && tree.contains(target)) {
      for (let d = target.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
      const r = rowOf.get(target);
      if (r) point(r.item);
      target.scrollIntoView();
    }
  }

  // 幅が変わって成果指標の出る場所が変わったら、さがし直す
  wide.addEventListener('change', () => { if (input?.value.trim()) run(); });
  // bfcache から戻したとき。ブラウザによっては、木の見た目はそのままで欄だけを空にし、それを pageshow より後に別の処理として行う（WebKit）ので、
  // 少しあとにもう一度そろえる
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    fromUrl();
    setTimeout(fromUrl, 0);
    setTimeout(fromUrl, 300);
  });
  // 離れるときに、開き方（さがしているときは、さがす前の開き方）とスクロールの位置を残す
  window.addEventListener('pagehide', () => {
    const opens = before ?? nodes.map((d) => d.open);
    const state: Saved = { src, open: opens.flatMap((o, i) => (o ? [i] : [])), show: [...shows], y: window.scrollY };
    history.replaceState({ ...(history.state as object | null), tree: state }, '');
  });
}
