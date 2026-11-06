// ブラウザで動かすスクリプトの入口。どのページもこの1つだけを読み込む（layouts/Base.astro の <head>）。
// <script> を部品やページごとに書くと、Astro はそれぞれを別のファイルにし、共通の部分（motion.ts など）もまた別のファイルにする。
// ブラウザは入口を読み終えてから共通の部分を取りに行くので、そのぶん往復が増えていた（docs/site.md の 7章）。
// 1つにまとめ、ずっとキャッシュさせる（2ページ目からは読まない）。どのファイルも、自分の部品が無いページでは何もしない。
// 動く順は import の順（前は、ページと部品のスクリプトのあとに Base のスクリプトが動いていたので、その順のまま）
import './filter-more.ts';
import './list-filter.ts';
import './shisaku-trend.ts';
import './torikumi-search.ts';
import './jigyo-search.ts';
import './show-more.ts';
import './tree.ts';
import './indicator-map.ts';
import './cell-pop.ts';
import './like.ts';
import './share-menu.ts';
import './copy-link.ts';
import './tooltip.ts';
import './theme.ts';
import './era.ts';
import './terms.ts';
import './disclosure.ts';
// print.ts は charts.ts より前に置く（印刷の直前に、紙の幅にそろえてから図を描き直すため）
import './print.ts';
import './charts.ts';
import './scroll-hint.ts';
import './table-scroll.ts';
import './toc.ts';
import './honbun.ts';
import './menu.ts';
import './to-top.ts';
