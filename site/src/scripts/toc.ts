// ページ内の目次（components/Toc.astro の .toc。施策・基本施策・取組などのページ）。
//  - いま読んでいる節のリンクに aria-current="location" を付ける（styles/global.css）。節の見出しが画面の上（目次の下あたり）を過ぎたら、その節にいるとする。
//    ページのいちばん下まで来たら最後の節にする（短い節の見出しは上まで届かないため）。スマホで目次のリンクが横にはみ出すときは、
//    いまの節のリンクが見えるように目次だけを横にずらす（ページは動かさない）
//  - 目次が画面の上に貼り付いたら stuck を付け、何のページかの1行（.toc-head）を出す。目次のすぐ前の目印（.toc-mark）が、目次の貼り付く位置より上に出たかで決める。
//    IntersectionObserver は、# のリンクで画面の下から上へ一度に跳ぶと（目印が画面に入らないまま）知らせないので、スクロールのたびに位置を見る
import { hashId } from './hash.ts';
import { moving } from './motion.ts';

// 見出しの上の端がここ（目次の貼り付く位置からの px）より上に来たら、その節にいる。# で跳んだ見出しの位置（目次のあるページの scroll-padding-top 104px）より少し下
const LINE = 120;
for (const toc of document.querySelectorAll<HTMLElement>('.toc')) {
  const strip = toc.querySelector<HTMLElement>('.toc-links');
  const links = [...toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap((a) => {
    const h = document.getElementById(hashId(a.hash));
    return h ? [{ a, h }] : [];
  });
  const mark = toc.previousElementSibling;
  const head = toc.querySelector('.toc-head') && mark?.classList.contains('toc-mark') ? mark : null;
  if (!links.length && !head) continue;
  let cur: HTMLAnchorElement | null = null;
  const update = () => {
    // 目次の貼り付く位置（画面の上からの px）。ふつうは 0 で、スマホでは端末やアプリに覆われる高さ（styles/global.css の --safe-top）
    const top = parseFloat(getComputedStyle(toc).top) || 0;
    if (head) toc.classList.toggle('stuck', head.getBoundingClientRect().top < top);
    if (!links.length) return;
    const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const hit = bottom ? links[links.length - 1] : links.filter(({ h }) => h.getBoundingClientRect().top <= top + LINE).pop();
    const next = hit?.a ?? null;
    if (next === cur) return;
    cur?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'location');
    cur = next;
    if (next && strip && strip.scrollWidth > strip.clientWidth) {
      // 目次のリンクの並びの中での左の位置
      const l = next.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
      if (l < strip.scrollLeft || l + next.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollTo({ left: l - (strip.clientWidth - next.offsetWidth) / 2, behavior: moving() ? 'smooth' : 'auto' });
      }
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
  window.addEventListener('resize', update);
  update();
}
