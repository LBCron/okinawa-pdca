// 検索エンジンと SNS に向けた URL・sitemap・robots.txt・構造化データ（JSON-LD）。本番のドメインは lib/links.ts の SITE.url
import { LINKS, PROJECT, SITE } from './links.ts';

// サイトの中のパス（/shisaku/1-1-a-1/・/#themes）を本番の完全な URL にする
export const absUrl = (path: string) => new URL(path, SITE.url).href;

// SNS のカードの画像（og:image）。どのページも同じ1枚（site/public/og-image.png）。
// 画像は scripts/shot/og-image.ts が、ここの大きさとサイトの名前（lib/links.ts の SITE・PROJECT）で書き出す（make og-image）。名前を変えたら作り直す
export const OG_IMAGE = {
  path: '/og-image.png',
  width: 1200,
  height: 630,
  alt: `${SITE.name}（${SITE.tagline}）by ${PROJECT.org}`,
};

// sitemap.xml に入れるページのパス。Astro の astro:build:done が渡す pathname（先頭の / が無く、トップは ''）を / で始まる形にそろえ、
// ページでないもの（/torikumi/data.json・/robots.txt のようにファイルの名前で終わるもの）と 404 を除く
export function sitemapPaths(pathnames: string[]): string[] {
  const paths = pathnames.map((p) => `/${p.replace(/^\/+/, '')}`).filter((p) => p.endsWith('/') && p !== '/404/');
  return [...new Set(paths)].sort();
}

// 書き出したページの HTML から、題名・説明文がほかのページと同じものを探す（検索結果で見分けにくく、検索エンジンに重複とみなされやすいため）。
// pages は sitemap に入れるページ（404 は除く）。見つかったものを、同じ題名・説明文ごとにページの URL を並べて返す
export function duplicateHeads(pages: { path: string; html: string }[]) {
  const kinds = { 題名: /<title>([^<]*)<\/title>/, 説明文: /<meta name="description" content="([^"]*)"/ };
  return Object.entries(kinds).flatMap(([kind, re]) => {
    const byText = new Map<string, string[]>();
    for (const p of pages) {
      const text = p.html.match(re)?.[1];
      if (text) byText.set(text, [...(byText.get(text) || []), p.path]);
    }
    return [...byText].filter(([, paths]) => paths.length > 1).map(([text, paths]) => ({ kind, text, paths }));
  });
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const sitemapXml = (paths: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((p) => `  <url><loc>${xmlEsc(absUrl(p))}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

// 巡回は止めず、sitemap の場所だけを書く（noindex のページの巡回を止めると noindex が読まれず、URL だけ検索結果に出ることがあるため。docs/deploy.md の4章）
export const robotsTxt = () => ['User-agent: *', 'Allow: /', '', `Sitemap: ${absUrl('/sitemap.xml')}`, ''].join('\n');

// 作っているのは Code for Okinawa で、県ではない。県の資料は isBasedOn（このサイトがもとにしたもの）として、作り手を県にして書く
const ORG = { '@type': 'Organization', name: PROJECT.org, url: PROJECT.orgUrl };
const PREF = { '@type': 'GovernmentOrganization', name: '沖縄県' };
// 読み取った県の資料（データについての「出典」と同じ）
const SOURCES = [
  { name: '沖縄県PDCA実施結果', url: LINKS.kekka },
  { name: '沖縄県PDCA（各部局の「主な取組」検証票）', url: LINKS.pdca },
  { name: '沖縄観光推進ロードマップPDCA実施報告書', url: LINKS.kankoRm },
  { name: '沖縄振興特別推進交付金の事後評価', url: LINKS.ikkatsu },
  { name: '新・沖縄21世紀ビジョン基本計画 評価検証報告書', url: LINKS.hyoka },
];

// トップに置く。Google の検索結果に出るサイトの名前は、この name・alternateName から取られる
export const websiteLd = (description: string) => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE.name,
  alternateName: SITE.short,
  url: absUrl('/'),
  description,
  inLanguage: 'ja',
  publisher: ORG,
  isBasedOn: SOURCES.map((s) => ({ '@type': 'CreativeWork', ...s, author: PREF })),
});

// ページの階層（components/Hierarchy.astro）。最後の項目（いまのページ）は here の URL にし、ページの無い段（施策展開。href なし）は入れない
export const breadcrumbLd = (items: { href?: string; label: string }[], here: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items
    .flatMap((it, i) => (i === items.length - 1 ? [{ name: it.label, href: here }] : it.href ? [{ name: it.label, href: it.href }] : []))
    .map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absUrl(it.href) })),
});

// 県の計画の本文を載せたページ（/21-seiki-vision/kihon/）。計画は isBasedOn に作り手を県にして書き、計画の期間（fy の年度）は temporalCoverage に
// 年度の初めの4月から終わりの翌年3月までで書く
export const planTextLd = (o: {
  title: string; description: string; path: string; plan: { name: string; url: string; fy: [number, number]; date: string };
}) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: o.title,
  url: absUrl(o.path),
  description: o.description,
  inLanguage: 'ja',
  isPartOf: { '@type': 'WebSite', name: SITE.name, url: absUrl('/') },
  publisher: ORG,
  isBasedOn: {
    '@type': 'CreativeWork',
    name: o.plan.name,
    url: o.plan.url,
    author: PREF,
    datePublished: o.plan.date,
    temporalCoverage: `${o.plan.fy[0]}-04/${o.plan.fy[1] + 1}-03`,
  },
});

// /llms.txt（AI 向けの案内。https://llmstxt.org/ の形）。サイトの中身と主なページの URL を短く並べる。
// 数はデータが増えると変わるので書かない。plan は基本計画（lib/honbun.ts の KIHON_KEIKAKU）と、本文の章ごとの Markdown
const LLMS_PAGES = [
  ['/pdca/', '沖縄県PDCAについて', '仕組み・計画の階層と指標のつながり・達成率の物差し・用語'],
  ['/future/', '5つの将来像', '将来像と基本施策の一覧。基本施策のページ（/kihon/<ID>/）に主要指標と主な取組の進み具合'],
  ['/shisaku/', '施策をさがす', '施策を将来像・判定・くらしのテーマ・担当部局で絞り込む。施策のページ（/shisaku/<ID>/）に判定・成果指標・主な取組'],
  ['/torikumi/', '取組をさがす', '主な取組を年度ごとの進捗状況つきで探す'],
  ['/shihyou/', '成果指標をさがす', '施策ごとの成果指標を達成率・見通しで探す'],
  ['/mokuji/', '計画の目次', '将来像から主な取組までの階層'],
  ['/theme/', 'くらしのテーマ', '子ども・子育て・観光・交通などで施策と取組をまとめたもの（このサイト独自の分類）'],
  ['/bukyoku/', '部局', '県の部局ごとの取組・成果指標・予算'],
  ['/yosan/', '予算と財源', '主な取組の予算事業の決算額・当初予算額と財源'],
  ['/data/', 'データについて', 'もとにした県の報告書（出典）・読み取り方・数え方・県の公表値とのずれ'],
  ['/about/', 'このサイトについて', '作っている団体・ソースコードとライセンス'],
] as const;

export function llmsTxt(plan: { name: string; href: string; period: string; chapters: { title: string; path: string }[] }) {
  const link = (path: string, title: string, note?: string) => `- [${title}](${absUrl(path)})${note ? `: ${note}` : ''}`;
  return [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline}。沖縄県PDCA（新・沖縄21世紀ビジョン実施計画の施策と主な取組を、県が毎年度点検した結果。令和4年度から）を、県の報告書の PDF から読み取って見せています。` +
      `${PROJECT.org} が作っていて、沖縄県のサイトではありません。`,
    '',
    '- 数字と文は県の報告書のものです。各ページに出典（県の PDF とそのページ）があります。',
    '- 状態の言葉（施策の判定 A〜G・主な取組の進捗状況・指標の達成状況）は県の区分のままです。',
    '- 実施計画は前期（令和4〜6年度）と中期（令和7年度から）で基準値・目標値が変わるので、達成率は期間をまたいで比べられません。',
    '',
    '## 主なページ',
    '',
    link('/', 'トップ', '全体の進み具合'),
    ...LLMS_PAGES.map(([path, title, note]) => link(path, title, note)),
    '',
    `## ${plan.name}の本文`,
    '',
    `県の基本計画（${plan.period}）の本文を章ごとに Markdown にしたもの。段落の前に印字のページと PDF のそのページへのリンクがあります。`,
    '',
    link(plan.href, '全文（HTML の1ページ）'),
    ...plan.chapters.map((p) => link(p.path, p.title)),
    '',
    '## Optional',
    '',
    link('/keikaku/', '個別計画', '観光ロードマップPDCA など、沖縄県PDCAとは別の評価'),
    link('/iken/', '意見を伝えたい人へ', '県に意見を伝える方法'),
    link('/sitemap.xml', 'sitemap.xml', '全ページの URL'),
    '',
  ].join('\n');
}
