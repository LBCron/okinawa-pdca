// 基本計画の本文のページ（pages/kihonkeikaku/index.astro）。
//  - いま読んでいる見出しの、目次のリンクに aria-current="location" を付け、目次はその見出しまでの段だけを開く（open）。
//    左の目次の中だけを動かして、そのリンクが見えるようにする（ページは動かさない）。スマホの幅では、上に貼り付いた行に見出しの名前を出す
//  - スマホの幅では、目次を「目次」のボタンで全面に開く。リンクを押す・「閉じる」・Esc で閉じ、フォーカスはボタンに戻す
import { hashId } from './hash.ts';

const nav = document.querySelector<HTMLElement>('.hb-nav');
const open = document.querySelector<HTMLButtonElement>('.hb-open');
const now = document.querySelector<HTMLElement>('.hb-now');
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
  const update = () => {
    const next = current();
    if (next === cur) return;
    cur?.removeAttribute('aria-current');
    for (const li of nav.querySelectorAll('li.open')) li.classList.remove('open');
    next?.setAttribute('aria-current', 'location');
    for (let li = next?.closest('li'); li; li = li.parentElement?.closest('li')) li.classList.add('open');
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
