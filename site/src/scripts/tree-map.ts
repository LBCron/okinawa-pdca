// 計画ツリー（/mokuji/tree/。pages/mokuji/tree.astro）。
//  - 描く: [data-tree-map] の data-src（計画の目次と同じ JSON。読めなければ data-fallback の控え）を読み、枝を描く（データの形は lib/tree-data.ts）。
//    描く HTML の形と見た目の決まりは pages/mokuji/tree.astro の頭の説明と CSS
//  - 左右: 将来像を報告書の順に、前を根の右・後ろを根の左に分ける（split）。左の側の枝は、子を左に並べる（CSS で左右を入れ替える）
//  - 線: 開いている枝の枠の外側の縁から、子の枝の枠の内側の縁へ（左の側は左右が逆）、SVG の曲線を引く。図の大きさが変わるたび（開け閉め・出す指標・画面の幅・字の読み込み）に引き直す
//  - 開け閉め: 丸・施策展開の枝・名前の外を押したとき、キーボード、開く深さ。押して開け閉めしたときは、押した枝が画面の同じ高さに残るように
//    ページと箱のスクロールを合わせ、開いた子が箱の外にはみ出すときは、箱を横にすべらせて見せる（どこからどこへ出たかが分かるように）。
//    はじめと開く深さを選んだときは、根を箱の横の真ん中に置く
//  - 開く深さ（select[data-tree-depth]）・出す指標（scripts/tree-show.ts）・戻る・進む・# の行き先・キーボードは、計画の目次（scripts/tree.ts）と同じ。
//    キーワードでさがすのは目次だけ
//  - マウスでは、図の地（枝の外）をつかんで、図を上下左右に動かせる
//  - 縮尺: 図（.mm-row）を transform: scale で見た目だけ縮め・広げ、器（.mm-zoom）の大きさを縮めた図の大きさにしてスクロールの範囲を合わせる。
//    枝の並べ方と線の座標は縮尺に関係なく等倍で決まる（offsetLeft・offsetTop は transform に左右されない）。
//    縮尺を変えても、見ていた所（ボタンでは見えている所の真ん中、Ctrl ＋ホイールではマウスの所）が画面の同じ場所に残るように、スクロールを合わせる
import { esc } from '../lib/html.ts';
import type { TreeData, TreeKihon, TreeLink, TreeShisaku, TreeTenkai, TreeVision } from '../lib/tree-data.ts';
import { getJsonOr } from './fetch-json.ts';
import { hashId } from './hash.ts';
import { moving, reveal } from './motion.ts';
import { treeShow } from './tree-show.ts';

// ---------------------------------------------------------------- 描く

// すぐ下に並ぶものの数。丸に出し、丸の読み上げの名前にも使う（丸の数は読ませない。docs/design.md の9章）
const knob = (label: string, n: number) =>
  `<button type="button" class="mm-tg" tabindex="-1" aria-expanded="false" aria-label="${label} ${n}"><span class="mm-cnt" aria-hidden="true">${n}</span></button>`;
// 木の項目（treeitem）。目次（scripts/tree.ts）と同じく、li は項目にせず、中の名前を項目にする。level は将来像が 1
const ti = (level: number, open = false) => `role="treeitem" tabindex="-1" aria-level="${level}"${open ? ' aria-expanded="false"' : ''}`;
// 読み上げの名前の頭に、段の名前と番号を足す（画面の番号と指標の札は読ませない）
const sr = (s: string) => `<span class="sr-only">${esc(s)}　</span>`;
// 子の並び。はじめは閉じておき、開く深さ（または離れたときの開き方）で開く
const group = (items: string[]) => `<ul role="group" hidden>${items.join('')}</ul>`;
// 枝がはかる指標（基本施策の主要指標・施策の成果指標・取組の活動指標）。枝の子にはせず、枝と同じ列の、枝の枠のすぐ下に並べる
// （計画の段とその物差しを一緒に見せる。枝をたどると、段ごとの物差しが 主要指標 → 成果指標 → 活動指標 と続いて見える。
// 指標どうしは線で結ばない。県が決めていない結び付きになるため。docs/design.md の1章）。
// 札は指標の種類の名前。マウスで押すリンクにし、キーボードでは止まらない（目次と同じ）。show は出す指標の種類（data-show の値）
const inds = (links: TreeLink[], kind: string, show: string, hash = '') =>
  links.length
    ? `<div class="mm-inds" data-ind="${show}">${links.map(([name, href]) => `<p class="mm-i"><span class="ind" aria-hidden="true">${kind}</span><a class="sub-link" href="${esc(href)}${hash}" tabindex="-1">${sr(kind)}${esc(name)}</a></p>`).join('')}</div>`
    : '';
// 枝の列の中身（枝の枠と、その下の指標）
const cell = (box: string, ind = '') => `<div class="mm-g">${box}${ind}</div>`;

// 主な取組。活動指標は取組のページの活動指標の節へのリンクにする。複数の施策に載っている取組は、名前の後ろに「2施策に共通」（目次と同じ）
const toriLi = ([no, name, href, act, common]: TreeShisaku['torikumi'][number]) =>
  `<li role="none" class="mm-li lv4">${cell(
    `<div class="mm-n leaf"><span class="no" aria-hidden="true">${no}</span><span class="nm"><a class="name-link" href="${esc(href)}" ${ti(5)}>${sr(`取組${no}`)}${esc(name)}</a>${common ? `<span class="common">${common}施策に共通</span>` : ''}</span></div>`,
    act ? inds([[act, href]], '活動指標', 'katsudou', '#katsudou') : '',
  )}</li>`;
function shisakuLi(s: TreeShisaku) {
  const has = s.torikumi.length > 0;
  return `<li role="none" class="mm-li lv3" id="s-${esc(s.id)}">${cell(
    `<div class="mm-n box"><span class="no" aria-hidden="true">${esc(s.no)}</span><a class="name-link" href="/shisaku/${esc(s.id)}/" ${ti(4, has)}>${sr(`施策${s.no}`)}${esc(s.name)}</a>${has ? knob('取組', s.torikumi.length) : ''}</div>`,
    inds(s.seika, '成果指標', 'seika'),
  )}${has ? group(s.torikumi.map(toriLi)) : ''}</li>`;
}
// 施策展開にはページも指標も無いので、名前はリンクにせず、枝のどこを押しても開け閉めする
function tenkaiLi(t: TreeTenkai) {
  return `<li role="none" class="mm-li lv2" id="t-${esc(t.id)}">${cell(
    `<div class="mm-n box"><span class="no" aria-hidden="true">${esc(t.no)}</span><span class="tk-name" ${ti(3, true)}>${sr(`施策展開${t.no}`)}${esc(t.name)}</span>${knob('施策', t.shisaku.length)}</div>`,
  )}${group(t.shisaku.map(shisakuLi))}</li>`;
}
function kihonLi(k: TreeKihon) {
  return `<li role="none" class="mm-li lv1" id="k-${esc(k.id)}">${cell(
    `<div class="mm-n box"><span class="no" aria-hidden="true">${esc(k.no)}</span><a class="name-link" href="/kihon/${esc(k.id)}/" ${ti(2, true)}>${sr(`基本施策${k.no}`)}${esc(k.name)}</a>${knob('施策展開', k.tenkai.length)}</div>`,
    inds(k.shuyou, '主要指標', 'shuyou'),
  )}${group(k.tenkai.map(tenkaiLi))}</li>`;
}
// 将来像は帯にする（番号の印は components/Sz.astro と同じ形）
function visionLi(v: TreeVision) {
  return `<li role="none" class="mm-li lv0" id="v-${v.id}">${cell(
    `<div class="mm-n"><span class="sz-ribbon sz-${v.id}"><span class="badge-sz sz-${v.id}" aria-hidden="true">${v.id}</span><a class="name-link" href="/future/${v.id}/" ${ti(1, true)}>${sr(`将来像${v.id}`)}${esc(v.name)}</a></span>${knob('基本施策', v.kihon.length)}</div>`,
  )}${group(v.kihon.map(kihonLi))}</li>`;
}

// 将来像を左右に分ける所。前の n 個を右、残りを左にし、左右の施策の数がいちばん近くなる n にする（同じなら右を多く）。
// 開いたときの高さは、おおよそ施策（とその下の取組）の数で決まるため
function split(visions: TreeVision[]) {
  const w = visions.map((v) => v.kihon.reduce((n, k) => n + k.tenkai.reduce((m, t) => m + t.shisaku.length, 0), 0));
  const all = w.reduce((a, b) => a + b, 0);
  let best = visions.length;
  let diff = Infinity;
  for (let n = 1, right = 0; n <= visions.length; n++) {
    right += w[n - 1];
    const d = Math.abs(right - (all - right));
    if (d < diff) [best, diff] = [n, d];
  }
  return best;
}

// ---------------------------------------------------------------- 読み込み

// 離れるときに残す、開き方・出す指標・スクロールの位置（history.state の treeMap）。src は描いたデータで、データが変わったら（公開し直したら）使わない
interface Saved { src: string; open: number[]; show: string[]; x: number; y: number; scale: number }
const savedOf = (src: string): Saved | null => {
  const s = (history.state as { treeMap?: Saved } | null)?.treeMap;
  return s && s.src === src ? s : null;
};

for (const tree of document.querySelectorAll<HTMLElement>('[data-tree-map]')) void init(tree);

async function init(tree: HTMLElement) {
  const box = tree.closest<HTMLElement>('.mm-box')!;
  const msg = box.querySelector<HTMLElement>('.mm-msg');
  const scroller = box.querySelector<HTMLElement>('.mm-scroll')!;
  const stage = box.querySelector<HTMLElement>('.mm-row')!;
  const svg = box.querySelector<SVGSVGElement>('svg.mm-lines')!;
  const rootBox = box.querySelector<HTMLElement>('.mm-root')!;
  const sizer = box.querySelector<HTMLElement>('.mm-zoom')!;
  const depth = document.querySelector<HTMLSelectElement>(`select[data-tree-depth][aria-controls="${tree.id}"]`);

  // 出す指標。データを待たずに動かす。選び直すと枝の列の高さが変わるので、線を引き直す（描いたあとだけ）
  let ready = false;
  const show = treeShow(tree, () => { if (ready) draw(); });

  const src = tree.dataset.src!;
  let data: TreeData;
  try {
    data = await getJsonOr<TreeData>(src, tree.dataset.fallback!);
  } catch {
    tree.removeAttribute('aria-busy');
    if (msg) msg.textContent = 'ツリーを読み込めませんでした。時間をおいて、ページを再読み込みしてください。';
    return;
  }
  // 左右の枝の並びは、根の後ろに右・左の順に置く（読み上げの順を将来像の順にする。左の側は CSS の order で根の左に出す）
  const cut = split(data.visions);
  const side = (cls: string, vs: TreeVision[]) => (vs.length ? `<ul role="none" class="mm-side ${cls}">${vs.map(visionLi).join('')}</ul>` : '');
  rootBox.insertAdjacentHTML('afterend', side('mm-r', data.visions.slice(0, cut)) + side('mm-l', data.visions.slice(cut)));
  tree.setAttribute('role', 'tree');

  // ---------------------------------------------------------------- 枝
  // 木の枝。box は枝の枠（指標は含まない。線はここから引く）、item はフォーカスする名前、ul は子の並び（下の段の無い取組は null）。
  // level は将来像が 0。left は根の左の側の枝
  interface Row { li: HTMLLIElement; box: HTMLElement; item: HTMLElement; tg: HTMLButtonElement | null; ul: HTMLUListElement | null; kids: Row[]; parent: Row | null; level: number; left: boolean; open: boolean }
  const rowOf = new Map<Element, Row>(); // 枠・名前・li から枝へ
  const nodes: Row[] = []; // 開け閉めできる枝（報告書の順）
  const build = (ul: Element, parent: Row | null, level: number, left: boolean): Row[] => {
    const rs = [...ul.querySelectorAll<HTMLLIElement>(':scope > li')].map((li) => {
      const b = li.querySelector<HTMLElement>(':scope > .mm-g > .mm-n')!;
      const sub = li.querySelector<HTMLUListElement>(':scope > ul');
      const r: Row = { li, box: b, item: b.querySelector<HTMLElement>('[role="treeitem"]')!, tg: b.querySelector('.mm-tg'), ul: sub, kids: [], parent, level, left, open: false };
      rowOf.set(li, r).set(b, r).set(r.item, r);
      if (sub) {
        nodes.push(r);
        r.kids = build(sub, r, level + 1, left);
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
  const sides = [...tree.querySelectorAll(':scope > .mm-side')];
  const roots = sides.flatMap((ul) => build(ul, null, 0, ul.classList.contains('mm-l')));
  // 将来像は左右の並びに分かれているので、何番目かは全体（1〜5）で数え直す
  roots.forEach((r, i) => {
    r.item.setAttribute('aria-posinset', String(i + 1));
    r.item.setAttribute('aria-setsize', String(roots.length));
  });

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
    // a の外側の縁の真ん中から、b の内側の縁の真ん中へ（left は左の側。左右が逆になる）
    const curve = (a: HTMLElement, b: HTMLElement, cls: string, left: boolean) => {
      const pa = at(a);
      const pb = at(b);
      const x1 = left ? pa.x : pa.x + a.offsetWidth;
      const y1 = pa.y + a.offsetHeight / 2;
      const x2 = left ? pb.x + b.offsetWidth : pb.x;
      const y2 = pb.y + b.offsetHeight / 2;
      const mx = (x1 + x2) / 2;
      out.push(`<path class="${cls}" d="M${r1(x1)} ${r1(y1)}C${r1(mx)} ${r1(y1)} ${r1(mx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}"/>`);
    };
    // 線の太さは、計画から将来像へ（l0）・将来像から基本施策へ（l1）を太くする（pages/mokuji/tree.astro の CSS）
    for (const r of roots) curve(rootBox, r.box, 'l0', r.left);
    const walk = (rs: Row[]) => {
      for (const r of rs) {
        if (!r.open) continue;
        for (const k of r.kids) curve(r.box, k.box, r.level === 0 ? 'l1' : 'l2', r.left);
        walk(r.kids);
      }
    };
    walk(roots);
    svg.innerHTML = out.join('');
  };
  // ---------------------------------------------------------------- 縮尺
  const MIN = 0.3;
  const MAX = 1.5;
  // 縮小・拡大のボタンで移る段
  const STEPS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5];
  let scale = 1;
  const zoomUi = document.querySelector<HTMLElement>(`[data-zoom-for="${tree.id}"]`);
  const zbtn = (k: string) => zoomUi?.querySelector<HTMLButtonElement>(`[data-zoom="${k}"]`) ?? null;
  const zoomNow = zoomUi?.querySelector<HTMLElement>('[data-zoom-now]');
  // 器の大きさを、縮めた図の大きさにする
  const fitSizer = () => {
    sizer.style.width = `${stage.offsetWidth * scale}px`;
    sizer.style.height = `${stage.offsetHeight * scale}px`;
  };
  // 縮尺を s にする。x・y（画面の上の場所）にあった図の所が、変えたあとも同じ場所に残るように、箱とページのスクロールを合わせる
  const zoomTo = (s: number, x?: number, y?: number) => {
    s = Math.min(MAX, Math.max(MIN, Math.round(s * 1000) / 1000));
    const view = scroller.getBoundingClientRect();
    const fx = x ?? view.left + scroller.clientWidth / 2;
    const fy = y ?? (Math.max(view.top, 0) + Math.min(view.bottom, innerHeight)) / 2;
    const z = sizer.getBoundingClientRect();
    const cx = (fx - z.left) / scale;
    const cy = (fy - z.top) / scale;
    scale = s;
    stage.style.setProperty('--s', String(s));
    fitSizer();
    const z2 = sizer.getBoundingClientRect();
    scroller.scrollLeft += z2.left + cx * s - fx;
    window.scrollBy({ top: z2.top + cy * s - fy, behavior: 'instant' });
    if (zoomNow) zoomNow.textContent = `${Math.round(s * 100)}%`;
    const out = zbtn('out');
    const inn = zbtn('in');
    if (out) out.disabled = s <= MIN;
    if (inn) inn.disabled = s >= MAX;
  };
  zbtn('out')?.addEventListener('click', () => zoomTo(STEPS.findLast((v) => v < scale - 0.001) ?? MIN));
  zbtn('in')?.addEventListener('click', () => zoomTo(STEPS.find((v) => v > scale + 0.001) ?? MAX));
  zbtn('reset')?.addEventListener('click', () => zoomTo(1));
  // 全体: 図の全体が、箱の幅と画面の高さ（頭の余白を除く）に収まる縮尺にし（等倍より大きくはしない）、図の頭を画面の上にそろえて根を真ん中に置く
  zbtn('fit')?.addEventListener('click', () => {
    zoomTo(Math.min(1, scroller.clientWidth / stage.offsetWidth, (innerHeight - 32) / stage.offsetHeight));
    window.scrollBy({ top: scroller.getBoundingClientRect().top - 16, behavior: 'instant' });
    center();
  });
  // Ctrl ＋ホイール（トラックパッドのピンチを含む）では、マウスの所を中心に縮尺を変える。ほかのホイールはページのスクロールのまま
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    // ピンチは小さな量が続けて届き、マウスのホイールは1目盛りで大きな量が届くので、1回に動かす量に上限を付ける（1目盛りでおよそ2割）
    const d = Math.max(-20, Math.min(20, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    zoomTo(scale * Math.exp(-d * 0.01), e.clientX, e.clientY);
  }, { passive: false });

  // 図の大きさが変わったら（開け閉め・画面の幅・字の読み込みなど）、器の大きさを合わせて線を引き直す。一度にたくさん変わっても1回だけ
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fitSizer();
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
  // 根を箱の横の真ん中に置く（図が箱より広いとき。はじめと、開く深さ・全体を選んだとき）。縮めた図の上の場所で測る
  const center = () => {
    const r = rootBox.getBoundingClientRect();
    scroller.scrollLeft += r.left + r.width / 2 - (scroller.getBoundingClientRect().left + scroller.clientWidth / 2);
  };
  // 押して・キーボードで開け閉めする。押した枝が画面の同じ場所に残るようにページと箱のスクロールを合わせ
  // （左の側を開くと、図が左に広がって根と右の側も右へずれるため）、開いた子が箱の外にはみ出すときは箱を横にすべらせる
  const toggle = (r: Row, open: boolean) => {
    if (!r.ul || r.open === open) return;
    const before = r.box.getBoundingClientRect();
    setOpen(r, open);
    if (open) reveal([r.li], 'm-opening');
    fitSizer();
    const after = r.box.getBoundingClientRect();
    if (after.left !== before.left) scroller.scrollLeft += after.left - before.left;
    if (after.top !== before.top) window.scrollBy({ top: after.top - before.top, behavior: 'instant' });
    draw();
    sync();
    if (!open) return;
    const view = scroller.getBoundingClientRect();
    const box = r.box.getBoundingClientRect();
    const kids = r.kids.map((k) => k.box.parentElement!.getBoundingClientRect());
    // はみ出したぶん（over）だけ、押した枝が箱から出ない範囲（room）ですべらせる
    const [over, room, dir] = r.left
      ? [view.left + 16 - Math.min(...kids.map((k) => k.left)), view.right - 16 - box.right, -1]
      : [Math.max(...kids.map((k) => k.right)) + 16 - view.right, box.left - view.left - 16, 1];
    if (over > 0 && room > 0) scroller.scrollBy({ left: dir * Math.min(over, room), behavior: moving() ? 'smooth' : 'instant' });
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
    fitSizer();
    draw();
    center();
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
  // はじめに選んである深さまで開く（pages/mokuji/tree.astro の START。読み直したときにブラウザが戻した選択は使わない）。
  // bfcache を使わずに戻ったときは、離れたときの開き方・出す指標にする
  const startDepth = Number([...(depth?.options ?? [])].find((o) => o.defaultSelected)?.value ?? 0);
  const saved = savedOf(src);
  if (saved) show.set(saved.show);
  const openSet = saved ? new Set(saved.open) : null;
  nodes.forEach((r, i) => setOpen(r, openSet ? openSet.has(i) : opensAt(startDepth)(r)));
  ready = true;
  sync();
  fitSizer();
  draw();
  tree.removeAttribute('aria-busy');
  if (msg) msg.hidden = true;
  // 字が届いたら枝の大きさが変わるので引き直す（大きさが変わらないときは ResizeObserver が呼ばないため）
  void document.fonts?.ready.then(later);

  if (saved) {
    zoomTo(saved.scale);
    scroller.scrollLeft = saved.x;
    window.scrollTo(0, saved.y);
  } else {
    // # の行き先（/mokuji/tree/#s-1-1-a-1 など）が図の中にあれば、親を開いてそこへ動く
    const id = hashId();
    const target = id ? document.getElementById(id) : null;
    const r = target ? rowOf.get(target) : undefined;
    if (r && tree.contains(r.li)) {
      for (let p = r.parent; p; p = p.parent) setOpen(p, true);
      point(r.item);
      sync();
      fitSizer();
      draw();
      r.box.scrollIntoView({ block: 'start', inline: 'center' });
    } else center();
  }

  // 離れるときに、開き方とスクロールの位置を残す
  window.addEventListener('pagehide', () => {
    const state: Saved = { src, open: nodes.flatMap((r, i) => (r.open ? [i] : [])), show: [...show.shows], x: scroller.scrollLeft, y: window.scrollY, scale };
    history.replaceState({ ...(history.state as object | null), treeMap: state }, '');
  });
}
