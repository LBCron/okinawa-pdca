// 計画のマインドマップ（/mokuji/mindmap/。pages/mokuji/mindmap.astro）。
//  - 描く: ul[data-mindmap] の data-src（計画の目次と同じ JSON。読めなければ data-fallback の控え）を読み、枝を描く（データの形は lib/tree-data.ts）。
//    描く HTML の形と見た目の決まりは pages/mokuji/mindmap.astro の頭の説明と CSS
//  - 線: 開いている枝の右の縁から、子の枝の左の縁へ、SVG の曲線を引く。図の大きさが変わるたび（開け閉め・出す指標・画面の幅・字の読み込み）に引き直す
//  - 開け閉め: 丸・施策展開の枝・名前の外を押したとき、キーボード、開く深さ。押して開け閉めしたときは、押した枝が画面の同じ高さに残るように
//    ページのスクロールを合わせ、開いた子が箱の右にはみ出すときは、箱を横にすべらせて見せる（どこからどこへ出たかが分かるように）
//  - 開く深さ（select[data-tree-depth]）・出す指標（scripts/tree-show.ts）・戻る・進む・# の行き先・キーボードは、計画の目次（scripts/tree.ts）と同じ。
//    キーワードでさがすのは目次だけ
//  - マウスでは、図の地（枝の外）をつかんで、図を上下左右に動かせる
import { esc } from '../lib/html.ts';
import type { TreeData, TreeKihon, TreeLink, TreeShisaku, TreeTenkai, TreeVision } from '../lib/tree-data.ts';
import { getJsonOr } from './fetch-json.ts';
import { hashId } from './hash.ts';
import { moving, reveal } from './motion.ts';
import { treeShow } from './tree-show.ts';

// ---------------------------------------------------------------- 描く

// すぐ下に並ぶものの数（0 のものは出さない）。丸には最初の数（指標を除いた数。取組の無い施策は成果指標の数）を出し、
// 丸の読み上げの名前には全部を使う。丸の数は読ませない（docs/design.md の9章）
type Count = [label: string, n: number];
const knob = (cs: Count[]) => {
  const has = cs.filter(([, n]) => n > 0);
  return `<button type="button" class="mm-tg" tabindex="-1" aria-expanded="false" aria-label="${esc(has.map(([l, n]) => `${l} ${n}`).join('・'))}"><span class="mm-cnt" aria-hidden="true">${has[0][1]}</span></button>`;
};
const hasKids = (cs: Count[]) => cs.some(([, n]) => n > 0);
// 木の項目（treeitem）。目次（scripts/tree.ts）と同じく、li は項目にせず、中の名前を項目にする。level は将来像が 1
const ti = (level: number, open = false) => `role="treeitem" tabindex="-1" aria-level="${level}"${open ? ' aria-expanded="false"' : ''}`;
// 読み上げの名前の頭に、段の名前と番号を足す（画面の番号と「指標」の札は読ませない）
const sr = (s: string) => `<span class="sr-only">${esc(s)}　</span>`;
// 子の並び。はじめは閉じておき、開く深さ（または離れたときの開き方）で開く
const group = (items: string[]) => `<ul role="group" hidden>${items.join('')}</ul>`;
// 指標の枝（主要指標・成果指標）。マウスで押すリンクにし、キーボードでは止まらない（目次と同じ）。show は出す指標の種類（data-show の値）
const indLeaf = ([name, href]: TreeLink, kind: string, show: string) =>
  `<li role="none" class="mm-li mm-ind" data-ind="${show}"><div class="mm-n leaf"><span class="ind" aria-hidden="true">指標</span><a class="name-link" href="${esc(href)}" tabindex="-1">${sr(kind)}${esc(name)}</a></div></li>`;
// 取組の活動指標。取組の名前の下に出し、取組のページの活動指標の節へのリンクにする
const actInd = (name: string, href: string) =>
  name ? `<span class="act" data-ind="katsudou"><span class="ind" aria-hidden="true">指標</span><a class="sub-link" href="${esc(href)}#katsudou" tabindex="-1">${sr('活動指標')}${esc(name)}</a></span>` : '';

function shisakuLi(s: TreeShisaku) {
  const cs: Count[] = [['取組', s.torikumi.length], ['成果指標', s.seika.length]];
  const kids = [
    ...s.seika.map((l) => indLeaf(l, '成果指標', 'seika')),
    // 複数の施策に載っている取組は、名前の後ろに「2施策に共通」（目次と同じ）
    ...s.torikumi.map(([no, name, href, act, common]) => `<li role="none" class="mm-li"><div class="mm-n leaf"><span class="no" aria-hidden="true">${no}</span><span class="nm"><a class="name-link" href="${esc(href)}" ${ti(5)}>${sr(`取組${no}`)}${esc(name)}</a>${common ? `<span class="common">${common}施策に共通</span>` : ''}${actInd(act, href)}</span></div></li>`),
  ];
  const has = hasKids(cs);
  return `<li role="none" class="mm-li lv3" id="s-${esc(s.id)}"><div class="mm-n box"><span class="no" aria-hidden="true">${esc(s.no)}</span><a class="name-link" href="/shisaku/${esc(s.id)}/" ${ti(4, has)}>${sr(`施策${s.no}`)}${esc(s.name)}</a>${has ? knob(cs) : ''}</div>${has ? group(kids) : ''}</li>`;
}
// 施策展開にはページが無いので、名前はリンクにせず、枝のどこを押しても開け閉めする
function tenkaiLi(t: TreeTenkai) {
  const cs: Count[] = [['施策', t.shisaku.length]];
  return `<li role="none" class="mm-li lv2" id="t-${esc(t.id)}"><div class="mm-n box"><span class="no" aria-hidden="true">${esc(t.no)}</span><span class="tk-name" ${ti(3, true)}>${sr(`施策展開${t.no}`)}${esc(t.name)}</span>${knob(cs)}</div>${group(t.shisaku.map(shisakuLi))}</li>`;
}
function kihonLi(k: TreeKihon) {
  const cs: Count[] = [['施策展開', k.tenkai.length], ['主要指標', k.shuyou.length]];
  return `<li role="none" class="mm-li lv1" id="k-${esc(k.id)}"><div class="mm-n box"><span class="no" aria-hidden="true">${esc(k.no)}</span><a class="name-link" href="/kihon/${esc(k.id)}/" ${ti(2, true)}>${sr(`基本施策${k.no}`)}${esc(k.name)}</a>${knob(cs)}</div>${group([...k.shuyou.map((l) => indLeaf(l, '主要指標', 'shuyou')), ...k.tenkai.map(tenkaiLi)])}</li>`;
}
// 将来像は帯にする（番号の印は components/Sz.astro と同じ形）
function visionLi(v: TreeVision) {
  const cs: Count[] = [['基本施策', v.kihon.length]];
  return `<li role="none" class="mm-li lv0" id="v-${v.id}"><div class="mm-n"><span class="sz-ribbon sz-${v.id}"><span class="badge-sz sz-${v.id}" aria-hidden="true">${v.id}</span><a class="name-link" href="/future/${v.id}/" ${ti(1, true)}>${sr(`将来像${v.id}`)}${esc(v.name)}</a></span>${knob(cs)}</div>${group(v.kihon.map(kihonLi))}</li>`;
}

// ---------------------------------------------------------------- 読み込み

// 離れるときに残す、開き方・出す指標・スクロールの位置（history.state の mindmap）。src は描いたデータで、データが変わったら（公開し直したら）使わない
interface Saved { src: string; open: number[]; show: string[]; x: number; y: number }
const savedOf = (src: string): Saved | null => {
  const s = (history.state as { mindmap?: Saved } | null)?.mindmap;
  return s && s.src === src ? s : null;
};

for (const tree of document.querySelectorAll<HTMLElement>('ul[data-mindmap]')) void init(tree);

async function init(tree: HTMLElement) {
  const box = tree.closest<HTMLElement>('.mm-box')!;
  const msg = box.querySelector<HTMLElement>('.mm-msg');
  const scroller = box.querySelector<HTMLElement>('.mm-scroll')!;
  const stage = box.querySelector<HTMLElement>('.mm-row')!;
  const svg = box.querySelector<SVGSVGElement>('svg.mm-lines')!;
  const rootBox = box.querySelector<HTMLElement>('.mm-root')!;
  const depth = document.querySelector<HTMLSelectElement>(`select[data-tree-depth][aria-controls="${tree.id}"]`);

  // 出す指標。データを待たずに動かす。選び直したら線を引き直す（描いたあとだけ）
  let ready = false;
  const show = treeShow(tree, () => { if (ready) draw(); });

  const src = tree.dataset.src!;
  let data: TreeData;
  try {
    data = await getJsonOr<TreeData>(src, tree.dataset.fallback!);
  } catch {
    tree.removeAttribute('aria-busy');
    if (msg) msg.textContent = 'マインドマップを読み込めませんでした。時間をおいて、ページを再読み込みしてください。';
    return;
  }
  tree.innerHTML = data.visions.map(visionLi).join('');
  tree.setAttribute('role', 'tree');

  // ---------------------------------------------------------------- 枝
  // 木の枝（指標の枝は除く）。box は枝の枠、item はフォーカスする名前、ul は子の並び（下の段の無い取組は null）、inds は子の指標の枝の枠。level は将来像が 0
  interface Row { li: HTMLLIElement; box: HTMLElement; item: HTMLElement; tg: HTMLButtonElement | null; ul: HTMLUListElement | null; kids: Row[]; inds: HTMLElement[]; parent: Row | null; level: number; open: boolean }
  const rowOf = new Map<Element, Row>(); // 枠・名前・li から枝へ
  const nodes: Row[] = []; // 開け閉めできる枝（報告書の順）
  const build = (ul: Element, parent: Row | null, level: number): Row[] => {
    const rs = [...ul.querySelectorAll<HTMLLIElement>(':scope > li:not(.mm-ind)')].map((li) => {
      const b = li.querySelector<HTMLElement>(':scope > .mm-n')!;
      const sub = li.querySelector<HTMLUListElement>(':scope > ul');
      const r: Row = { li, box: b, item: b.querySelector<HTMLElement>('[role="treeitem"]')!, tg: b.querySelector('.mm-tg'), ul: sub, kids: [], inds: [], parent, level, open: false };
      rowOf.set(li, r).set(b, r).set(r.item, r);
      if (sub) {
        nodes.push(r);
        r.inds = [...sub.querySelectorAll<HTMLElement>(':scope > .mm-ind > .mm-n')];
        r.kids = build(sub, r, level + 1);
      }
      return r;
    });
    // 兄弟の中の何番目か（さがして隠すことは無いので、描いたときに1回だけ）
    rs.forEach((r, i) => {
      r.item.setAttribute('aria-posinset', String(i + 1));
      r.item.setAttribute('aria-setsize', String(rs.length));
    });
    return rs;
  };
  const roots = build(tree, null, 0);

  // ---------------------------------------------------------------- 線
  // 枝の場所は、図の全体（.mm-row。position: relative）を基にした、レイアウトの上の場所（動きの transform に左右されない）。
  // 開いた子の並びが動いているあいだは、その並び（transform）が offsetParent になるので、図の全体までたどって足す
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const at = (el: HTMLElement) => {
    let x = 0;
    let y = 0;
    for (let e: Element | null = el; e && e !== stage && e instanceof HTMLElement; e = e.offsetParent) {
      x += e.offsetLeft;
      y += e.offsetTop;
    }
    return { x, y };
  };
  const draw = () => {
    const out: string[] = [];
    const curve = (a: HTMLElement, b: HTMLElement, cls: string) => {
      if (!b.offsetParent) return; // 隠した指標
      const pa = at(a);
      const pb = at(b);
      const x1 = pa.x + a.offsetWidth;
      const y1 = pa.y + a.offsetHeight / 2;
      const x2 = pb.x;
      const y2 = pb.y + b.offsetHeight / 2;
      const mx = (x1 + x2) / 2;
      out.push(`<path class="${cls}" d="M${r1(x1)} ${r1(y1)}C${r1(mx)} ${r1(y1)} ${r1(mx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}"/>`);
    };
    // 線の太さは、計画から将来像へ（l0）・将来像から基本施策へ（l1）を太くし、指標へ（li）は細い点線にする（pages/mokuji/mindmap.astro の CSS）
    for (const r of roots) curve(rootBox, r.box, 'l0');
    const walk = (rs: Row[]) => {
      for (const r of rs) {
        if (!r.open) continue;
        for (const b of r.inds) curve(r.box, b, 'li');
        for (const k of r.kids) curve(r.box, k.box, r.level === 0 ? 'l1' : 'l2');
        walk(r.kids);
      }
    };
    walk(roots);
    svg.innerHTML = out.join('');
  };
  // 図の大きさが変わったら（画面の幅・字の読み込みなど）引き直す。一度にたくさん変わっても1回だけ
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  };
  new ResizeObserver(later).observe(stage);

  // ---------------------------------------------------------------- 開け閉め
  // Tab で止まる項目（いまの項目）。ほかは tabindex="-1"
  let current = roots[0].item;
  current.tabIndex = 0;
  const point = (el: HTMLElement) => {
    current.tabIndex = -1;
    el.tabIndex = 0;
    current = el;
  };
  const setOpen = (r: Row, open: boolean) => {
    if (!r.ul || r.open === open) return;
    r.open = open;
    r.ul.hidden = !open;
    r.item.setAttribute('aria-expanded', String(open));
    r.tg?.setAttribute('aria-expanded', String(open));
    // いまの項目が閉じた枝の中にあれば、閉じた枝にする
    if (!open && r.ul.contains(current)) point(r.item);
  };
  const opensAt = (n: number) => (r: Row) => r.level < n;
  const depths = [...(depth?.options ?? [])].filter((o) => o.value).map((o) => Number(o.value));
  // いまの開き方がどれかの深さにそろっていればその深さを、そろっていなければ「ばらばら」（値が空）を選んだ形にする
  const sync = () => {
    if (depth) depth.value = String(depths.find((n) => nodes.every((r) => r.open === opensAt(n)(r))) ?? '');
  };
  // 押して・キーボードで開け閉めする。押した枝が画面の同じ高さに残るようにページのスクロールを合わせ、開いた子が箱の右にはみ出すときは箱を横にすべらせる
  const toggle = (r: Row, open: boolean) => {
    if (!r.ul || r.open === open) return;
    const before = r.box.getBoundingClientRect().top;
    setOpen(r, open);
    if (open) reveal([r.li], 'm-opening');
    const dy = r.box.getBoundingClientRect().top - before;
    if (dy) window.scrollBy({ top: dy, behavior: 'instant' });
    draw();
    sync();
    if (!open) return;
    const view = scroller.getBoundingClientRect();
    const right = Math.max(...[...r.kids.map((k) => k.box), ...r.inds].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().right));
    const over = right + 16 - view.right;
    const room = r.box.getBoundingClientRect().left - view.left - 16;
    if (over > 0 && room > 0) scroller.scrollBy({ left: Math.min(over, room), behavior: moving() ? 'smooth' : 'instant' });
  };

  // ---------------------------------------------------------------- キーボード
  // 見えている項目（画面の上からの並び）
  const visible = () => {
    const out: HTMLElement[] = [];
    const walk = (rs: Row[]) => {
      for (const r of rs) {
        out.push(r.item);
        if (r.open) walk(r.kids);
      }
    };
    walk(roots);
    return out;
  };
  tree.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t.getAttribute('role') === 'treeitem') point(t);
  });
  tree.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // 丸にフォーカスがあるとき（マウスで押したあと）は、その枝にいるものとする。Enter・Space は丸（button）に任せる
    const tg = (e.target as Element).closest('.mm-tg');
    const r = rowOf.get((e.target as Element).closest('.mm-n') ?? (e.target as Element));
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
        if (!r.ul) break;
        if (!r.open) toggle(r, true);
        else next = r.kids[0]?.item;
        break;
      case 'ArrowLeft':
        if (r.open) toggle(r, false);
        else next = r.parent?.item;
        break;
      case ' ':
      case 'Enter':
        if (tg) return;
        if (r.ul && (e.key === ' ' || !(r.item instanceof HTMLAnchorElement))) toggle(r, !r.open);
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
  // マウスで丸か枝の名前の外を押したとき（名前のリンクはページを開く）。押した枝を、次に Tab で図に入ったときの項目にし、
  // 図の中にフォーカスがあれば、その枝の名前へ移す
  tree.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('a')) return;
    const r = rowOf.get(t.closest('.mm-n')!);
    if (!r?.ul) return;
    // 名前の外を押したときは、文字を選んだときは開け閉めしない
    if (!t.closest('.mm-tg') && !getSelection()?.isCollapsed) return;
    toggle(r, !r.open);
    point(r.item);
    if (tree.contains(document.activeElement)) r.item.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- 開く深さ
  depth?.addEventListener('change', () => {
    if (!depth.value) return;
    const open = opensAt(Number(depth.value));
    for (const r of nodes) setOpen(r, open(r));
    draw();
  });

  // ---------------------------------------------------------------- 地をつかんで動かす（マウスだけ。指では箱とページのスクロールのまま）
  let grab: { id: number; x: number; y: number; left: number; top: number } | null = null;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest('.mm-n, .mm-root')) return;
    grab = { id: e.pointerId, x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: window.scrollY };
    scroller.setPointerCapture(e.pointerId);
    scroller.classList.add('mm-drag');
    e.preventDefault();
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    scroller.scrollLeft = grab.left - (e.clientX - grab.x);
    window.scrollTo({ top: grab.top - (e.clientY - grab.y), behavior: 'instant' });
  });
  const release = () => {
    grab = null;
    scroller.classList.remove('mm-drag');
  };
  scroller.addEventListener('pointerup', release);
  scroller.addEventListener('pointercancel', release);

  // ---------------------------------------------------------------- はじめの開き方
  // はじめに選んである深さまで開く（pages/mokuji/mindmap.astro の START。読み直したときにブラウザが戻した選択は使わない）。
  // bfcache を使わずに戻ったときは、離れたときの開き方・出す指標にする
  const startDepth = Number([...(depth?.options ?? [])].find((o) => o.defaultSelected)?.value ?? 0);
  const saved = savedOf(src);
  if (saved) show.set(saved.show);
  const openSet = saved ? new Set(saved.open) : null;
  nodes.forEach((r, i) => setOpen(r, openSet ? openSet.has(i) : opensAt(startDepth)(r)));
  ready = true;
  sync();
  draw();
  tree.removeAttribute('aria-busy');
  if (msg) msg.hidden = true;
  // 字が届いたら枝の大きさが変わるので引き直す（大きさが変わらないときは ResizeObserver が呼ばないため）
  void document.fonts?.ready.then(later);

  if (saved) {
    scroller.scrollLeft = saved.x;
    window.scrollTo(0, saved.y);
  } else {
    // # の行き先（/mokuji/mindmap/#s-1-1-a-1 など）が図の中にあれば、親を開いてそこへ動く
    const id = hashId();
    const target = id ? document.getElementById(id) : null;
    const r = target ? rowOf.get(target) : undefined;
    if (r && tree.contains(r.li)) {
      for (let p = r.parent; p; p = p.parent) setOpen(p, true);
      point(r.item);
      sync();
      draw();
      r.box.scrollIntoView({ block: 'start', inline: 'center' });
    }
  }

  // 離れるときに、開き方とスクロールの位置を残す
  window.addEventListener('pagehide', () => {
    const state: Saved = { src, open: nodes.flatMap((r, i) => (r.open ? [i] : [])), show: [...show.shows], x: scroller.scrollLeft, y: window.scrollY };
    history.replaceState({ ...(history.state as object | null), mindmap: state }, '');
  });
}
