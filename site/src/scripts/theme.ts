// ライト／ダークの切り替え。はじめはライトで表示し、ダークを選んだら localStorage に記憶する（端末の設定には従わない）。
// 最初の反映は Base.astro の <head> のインラインスクリプトで行う（読み込み直後の配色のちらつきを防ぐため）。
// ボタン（components/ViewToggles.astro）はフッターとサイドメニューの2か所にあり、Base.astro が最初から出す。記号と文字（☾ ダーク／☀ ライト）は styles/global.css がいまの配色で選ぶ。ここでは読み上げの名前を合わせる。
// ボタンの名前は押すと変わる（見えている文字が「ダーク」「ライト」と入れ替わるので、名前もそれに合わせて何に切り替えるかを言う）が、
// フォーカスしたまま名前が変わっても読み上げないソフトがあるので、切り替えたことは role="status" の文（#theme-status）で伝える。
// 切り替えるときは、ボタンから丸く広げて新しい配色を見せる（View Transition。styles/global.css の vt-theme。動きを減らす設定・対応していないブラウザではすぐ切り替える）
import { moving } from './motion.ts';

const root = document.documentElement;
const btns = document.querySelectorAll<HTMLElement>('.theme-toggle');
const status = document.getElementById('theme-status');
const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

function label() {
  for (const b of btns) b.setAttribute('aria-label', current() === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える');
}

for (const btn of btns) {
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        // 保存できない環境（プライベートブラウズなど）では、このページを開いている間だけ切り替える
      }
      label();
      if (status) status.textContent = next === 'dark' ? 'ダークモードにしました' : 'ライトモードにしました';
    };
    if (!document.startViewTransition || !moving()) return apply();
    // 丸の中心はボタンの真ん中、半径はそこから画面のいちばん遠い角まで
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    root.style.setProperty('--vt-x', `${x}px`);
    root.style.setProperty('--vt-y', `${y}px`);
    root.style.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.classList.add('vt-theme');
    document.startViewTransition(apply).finished.finally(() => root.classList.remove('vt-theme'));
  });
}
label();
