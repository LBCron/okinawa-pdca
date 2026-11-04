// 基本計画の本文のページ（components/Honbun.astro）。
//  - いま読んでいる見出しの、目次のリンクに aria-current="location" を付ける。左の目次の中だけを動かして、そのリンクが見えるようにする（ページは動かさない）。
//    スマホの幅では、上に貼り付いた行に見出しの名前を出す
//  - スマホの幅では、目次を「目次」のボタンで全面に開く。リンクを押す・「閉じる」・Esc で閉じ、フォーカスはボタンに戻す
import { hashId } from './hash.ts';

const nav = document.querySelector<HTMLElement>('.hb-nav');
const body = document.querySelector<HTMLElement>('.hb-body');
const open = document.querySelector<HTMLButtonElement>('.hb-open');
const now = document.querySelector<HTMLElement>('.hb-now');
if (nav && body && open) {
  const close = nav.querySelector<HTMLButtonElement>('.hb-close');
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
    if (on) (nav.querySelector<HTMLElement>('[aria-current="location"], [aria-current="page"]') ?? close)?.focus();
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
  let cur: HTMLAnchorElement | null = null;
  const update = () => {
    const hit = links.filter(({ h }) => h.getBoundingClientRect().top <= LINE).pop();
    const next = hit?.a ?? null;
    if (next === cur) return;
    cur?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'location');
    cur = next;
    if (now) now.textContent = next?.textContent ?? first;
    // 左の目次の中で、リンクが見えるところまでだけ動かす
    if (next && nav.scrollHeight > nav.clientHeight && !nav.classList.contains('open')) {
      const n = nav.getBoundingClientRect(), a = next.getBoundingClientRect();
      if (a.top < n.top + 40 || a.bottom > n.bottom - 40) nav.scrollTop += a.top - n.top - n.height / 3;
    }
  };
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }, { passive: true });
  update();
}
