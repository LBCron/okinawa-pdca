// 年の書き方（和暦・西暦）の切り替えボタン（フッターとサイドメニュー。components/ViewToggles.astro）。はじめは和暦（報告書の書き方）で、西暦を選んだら localStorage に記憶する。
// 書き換えは別のファイルのスクリプト（lib/era.ts の ERA_JS。window.era）が受け持ち、ここでは押したときに切り替えるだけ。
// 西暦を覚えていればページを開くときに読み込んでいる（Base.astro の THEME_INIT）。和暦のままの人が押したときは、ここで読み込んでから切り替える。
// ボタンの文字（西暦で表示／令和で表示。「和暦」はなじみが薄いので「令和」と書く）は styles/global.css がいまの書き方で選ぶ。
// 切り替えるときは、前後の画面を短く重ねて替える（View Transition。ページを移るときと同じ。動きを減らす設定・対応していないブラウザではすぐ替える）
import { moving } from './motion.ts';


function load(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} を読み込めない`));
    document.head.append(s);
  });
}

let busy = false;
for (const btn of document.querySelectorAll<HTMLElement>('.era-toggle')) {
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      if (!window.era && btn.dataset.src) await load(btn.dataset.src);
      const era = window.era;
      if (!era) return;
      const apply = () => era.set(!era.seireki);
      if (!document.startViewTransition || !moving()) apply();
      else await document.startViewTransition(apply).finished;
    } catch {
      // 読み込めなかったとき（公開し直した直後の古いページなど）は、和暦のまま
    } finally {
      busy = false;
    }
  });
}
