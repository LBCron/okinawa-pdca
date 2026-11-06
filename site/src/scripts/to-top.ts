// 右下の「ページの先頭へ」のボタン（layouts/Base.astro の .to-top）。上にスクロールしたときと、ページのいちばん下まで来たときに出し、
// 下にスクロールしたとき・先頭から1画面ぶんの所までは隠す
// （docs/design.md の8章の例外）。指の小さな揺れで出し入れしないよう、同じ向きに少し動いてから決める。フォーカスがあるあいだは隠さない（キーボードで移ったとき）。
// 押すと、短くスクロールして先頭へ戻り（どこからどこへ戻ったかが分かる。動きを減らす設定ではすぐ移る）、フォーカスをサイトの名前に置く。
// ブラウザのなめらかなスクロールは長いページほど長くかかるので、ページの長さによらず同じ短い時間（GLIDE）で戻す。途中でホイールや指で動かしたら止める。
// 戻っているあいだは上へのスクロールが続くので、先頭に着くか、途中で下へスクロールし直すまでは出さない
import { moving } from './motion.ts';

const btn = document.querySelector<HTMLButtonElement>('.to-top');
if (btn) {
  // この px より動いたら、向きを決める
  const STEP = 6;
  // 先頭へ戻る時間（ms）
  const GLIDE = 320;
  let last = scrollY;
  let going = false;
  const show = (on: boolean) => {
    if (!on && document.activeElement === btn) return;
    if (btn.hidden === !on) return;
    btn.hidden = !on;
  };
  const update = () => {
    const y = scrollY;
    if (going && (y < 1 || y > last)) going = false;
    if (y < innerHeight) {
      show(false);
      last = y;
      return;
    }
    if (!going && y + innerHeight >= document.documentElement.scrollHeight - 2) {
      show(true);
      last = y;
      return;
    }
    if (Math.abs(y - last) < STEP) return;
    show(y < last && !going);
    last = y;
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
  // 初めは速く、終わりはゆっくり（ease-out の3次）。html の scroll-behavior: smooth を使わないよう、1こまずつ instant で動かす
  const glide = () => {
    const from = scrollY;
    if (!moving() || from < 1) {
      scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const start = performance.now();
    const stop = new AbortController();
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(type, () => stop.abort(), { passive: true, signal: stop.signal });
    const frame = (now: number) => {
      if (stop.signal.aborted) return;
      const p = Math.min(1, (now - start) / GLIDE);
      scrollTo({ top: from * (1 - p) ** 3, behavior: 'instant' });
      if (p < 1) requestAnimationFrame(frame);
      else stop.abort();
    };
    requestAnimationFrame(frame);
  };
  btn.addEventListener('click', () => {
    going = true;
    btn.hidden = true;
    glide();
    document.querySelector<HTMLElement>('.site-title')?.focus({ preventScroll: true });
  });
  btn.addEventListener('blur', update);
}
