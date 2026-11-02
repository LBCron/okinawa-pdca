// 計画の木（目次・樹形図）の「指標」（components/TreeOptions.astro）。目次・樹形図のスクリプト（scripts/tree.ts・scripts/jukeizu.ts）から使う。
// [data-tree-show="木の id"] のボタンで、チェックボックスの吹き出しを開け閉めする。選んだ種類（主要指標・成果指標・活動指標）を
// 木の data-show に入れ、それぞれのページの CSS が選んでいない種類を隠す。選び直すたびに changed を呼ぶ。
// 吹き出しは、ボタンをもう一度押す・外を押す・Esc（ボタンにフォーカスを戻す）・フォーカスが外へ出る、で閉じる
export function treeShow(tree: HTMLElement, changed: () => void) {
  const show = document.querySelector<HTMLElement>(`[data-tree-show="${tree.id}"]`);
  const btn = show?.querySelector<HTMLButtonElement>('button[aria-controls]');
  const pop = btn ? document.getElementById(btn.getAttribute('aria-controls')!) : null;
  const now = show?.querySelector<HTMLElement>('[data-tree-show-now]');
  const boxes = [...(show?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
  const shows = new Set<string>();
  const apply = () => {
    shows.clear();
    for (const b of boxes) if (b.checked) shows.add(b.value);
    tree.dataset.show = [...shows].join(' ');
    if (now) now.textContent = boxes.filter((b) => b.checked).map((b) => b.dataset.short).join('・') || '出さない';
    changed();
  };
  const isOpen = () => btn?.getAttribute('aria-expanded') === 'true';
  const open = (o: boolean, refocus = false) => {
    if (!btn || !pop || isOpen() === o) return;
    pop.hidden = !o;
    btn.setAttribute('aria-expanded', String(o));
    if (refocus) btn.focus();
  };
  for (const b of boxes) b.addEventListener('change', apply);
  btn?.addEventListener('click', () => open(!isOpen()));
  show?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    open(false, true);
  });
  // フォーカスが吹き出しとボタンの外へ移ったら閉じる（押してもフォーカスの移らないブラウザ（Safari）があるので、移り先の無いときは外を押したかで決める）
  show?.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to instanceof Node && !show.contains(to)) open(false);
  });
  document.addEventListener('click', (e) => {
    if (show && !show.contains(e.target as Node)) open(false);
  });
  apply();
  return {
    // いま選んでいる種類（data-show と同じ）
    shows,
    // 選び直す（戻る・進むで読み直したときに、離れたときの選び方に戻す）
    set(keys: string[]) {
      for (const b of boxes) b.checked = keys.includes(b.value);
      apply();
    },
  };
}
