// 基本計画の本文のページ（pages/21-seiki-vision/kihon/index.astro）。
//  - いま読んでいる見出しの、目次のリンクに aria-current="location" を付け、目次はその見出しまでの段だけを開く（open）。
//    左の目次の中だけを動かして、そのリンクが見えるようにする（ページは動かさない）。スマホの幅では、上に貼り付いた行に見出しの名前を出す
//  - 目次のリンクは、同じ章の中ならなめらかにスクロールし、ほかの章へはすぐ移る
//  - スマホの幅では、目次を「目次」のボタンで全面に開く。リンクを押す・「閉じる」・Esc で閉じ、フォーカスはボタンに戻す
//  - スマホの幅で上に貼り付く行（.hb-bar）は、すぐ前の目印（.hb-bar-mark）が画面の上から出たら（ヘッダーが隠れたら）stuck を付け、メニューのボタンを出す
import { hashId } from './hash.ts';
import { moving } from './motion.ts';

const nav = document.querySelector<HTMLElement>('.hb-nav');
const open = document.querySelector<HTMLButtonElement>('.hb-open');
const now = document.querySelector<HTMLElement>('.hb-now');
const bar = document.querySelector<HTMLElement>('.hb-bar');
const barMark = document.querySelector<HTMLElement>('.hb-bar-mark');
// # のリンクで遠くへ一度に跳んでも決められるよう、スクロールのたびに位置を見る（scripts/toc.ts と同じ）
const stick = () => bar?.classList.toggle('stuck', !!barMark && barMark.getBoundingClientRect().top < 0);
if (nav && open) {
  const close = nav.querySelector<HTMLButtonElement>('.hb-close');
  // 見出しは本文の順に並んでいる（上の端の位置が増えていく）ので、いまの見出しは2分探索で探す
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap((a) => {
    const h = document.getElementById(hashId(a.hash));
    return h ? [{ a, h }] : [];
  });
  const first = now?.textContent ?? '';

  const setOpen = (on: boolean, focus = true) => {
    nav.classList.toggle('open', on);
    open.setAttribute('aria-expanded', String(on));
    document.documentElement.style.overflow = on ? 'hidden' : '';
    if (!focus) return;
    if (on) (nav.querySelector<HTMLElement>('[aria-current="location"]') ?? close)?.focus();
    else open.focus();
  };
  open.addEventListener('click', () => setOpen(true));
  close?.addEventListener('click', () => setOpen(false));
  nav.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && e.target instanceof Element && e.target.closest('a')) setOpen(false, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) setOpen(false);
  });
  // 幅が広がって左の目次になったら、開いた状態を外す
  matchMedia('(max-width: 900px)').addEventListener('change', (m) => {
    if (!m.matches && nav.classList.contains('open')) setOpen(false, false);
  });

  // 見出しの上の端がここ（画面の上からの px）より上に来たら、その見出しの所にいる
  const LINE = 120;
  const current = () => {
    let lo = 0, hi = links.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (links[mid].h.getBoundingClientRect().top <= LINE) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return hit < 0 ? null : links[hit].a;
  };
  let cur: HTMLAnchorElement | null = null;
  // いまの見出しを next にする。目次はその見出しまでの段だけを開き、scroll なら左の目次の中をリンクが見えるところまで動かす
  const setCurrent = (next: HTMLAnchorElement | null, scroll: boolean) => {
    if (next === cur) return;
    cur?.removeAttribute('aria-current');
    for (const li of nav.querySelectorAll('li.open')) li.classList.remove('open');
    next?.setAttribute('aria-current', 'location');
    for (let li = next?.closest('li'); li; li = li.parentElement?.closest('li')) li.classList.add('open');
    cur = next;
    if (now) now.textContent = next?.textContent ?? first;
    if (scroll && next && nav.scrollHeight > nav.clientHeight && !nav.classList.contains('open')) {
      const n = nav.getBoundingClientRect(), a = next.getBoundingClientRect();
      if (a.top < n.top + 40 || a.bottom > n.bottom - 40) nav.scrollTop += a.top - n.top - n.height / 3;
    }
  };
  // 目次のリンクを押したあと、本文がその見出しまで動いているあいだは、通り過ぎる見出しで目次を開け閉めしない
  // （開け閉めのたびに目次の高さが変わり、押したリンクが目次の中で跳ぶため）。押したリンクをすぐいまの見出しにし、
  // スクロールが止まって（150ms 動かない）から、本文の位置でいまの見出しを決め直す
  // 止まったとき、押した見出しが画面の上にあれば（すぐ下の見出しも上の線を越えていても）押した見出しのままにする
  let jumping = 0;
  let clicked: { a: HTMLAnchorElement; h: HTMLElement } | undefined;
  const endJump = () => {
    jumping = 0;
    document.documentElement.style.scrollBehavior = '';
    const top = clicked?.h.getBoundingClientRect().top;
    setCurrent(clicked && top !== undefined && top > -10 && top <= LINE ? clicked.a : current(), true);
    clicked = undefined;
  };
  nav.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    const target = a && links.find((l) => l.a === a);
    if (!a || !target) return;
    // 同じ章の中の見出しへは、なめらかにスクロールして移る（どこからどこへ移ったかが分かる）。ほかの章へは、遠くて動きが長くなるので
    // すぐ移る（ページの html の scroll-behavior: auto）。押したあとに動くリンクの既定の動きに効かせるため、html に直接付けて、止まったら外す。
    // 章の中をなめらかに動いている途中に押すと、ブラウザはリンクの既定の動きで行き先を変えず、前の行き先へのスクロールを続けるので、
    // 押した見出しへ動かし直す（ほかの章へはすぐ、同じ章の中はなめらかに）
    const chapterOf = (h?: HTMLElement) => h?.closest('.hb-ch') ?? document.querySelector('.hb-ch');
    const from = chapterOf(links.find((l) => l.a === cur)?.h);
    const smooth = moving() && from === chapterOf(target.h);
    if (document.documentElement.style.scrollBehavior === 'smooth') {
      requestAnimationFrame(() => target.h.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' }));
    }
    document.documentElement.style.scrollBehavior = smooth ? 'smooth' : '';
    clicked = target;
    // 開け閉めで目次の高さが変わっても、押したリンクは目次の中で同じ所にとどめる
    const before = a.getBoundingClientRect().top;
    setCurrent(a, false);
    nav.scrollTop += a.getBoundingClientRect().top - before;
    clearTimeout(jumping);
    jumping = window.setTimeout(endJump, 600);
  });
  let queued = false;
  window.addEventListener('scroll', () => {
    stick();
    if (jumping) {
      clearTimeout(jumping);
      jumping = window.setTimeout(endJump, 150);
      return;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      setCurrent(current(), true);
    });
  }, { passive: true });
  setCurrent(current(), true);
  stick();
}
