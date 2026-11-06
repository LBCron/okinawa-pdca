// サイドメニュー（layouts/Base.astro の #site-menu）。開くボタン（components/MenuButton.astro）はヘッダーと、上に貼り付く目次にある。
// <dialog> を showModal で開くので、開いているあいだは後ろを押せず、Esc で閉じ、閉じると押したボタンにフォーカスが戻る（ブラウザが受け持つ）。
// 外側（暗くした所）を押しても閉じる
const menu = document.getElementById('site-menu');
if (menu instanceof HTMLDialogElement) {
  const openers = document.querySelectorAll<HTMLButtonElement>('.menu-open');
  for (const b of openers) {
    b.addEventListener('click', () => {
      menu.showModal();
      b.setAttribute('aria-expanded', 'true');
    });
  }
  menu.addEventListener('close', () => {
    for (const b of openers) b.setAttribute('aria-expanded', 'false');
  });
  // 中身（.menu-in）がメニューの全面を覆うので、dialog そのものに当たるのは外側を押したときだけ
  menu.addEventListener('click', (e) => {
    if (e.target === menu) menu.close();
  });
  menu.querySelector('[data-menu-close]')?.addEventListener('click', () => menu.close());
}
