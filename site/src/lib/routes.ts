// ページの URL を1か所で決め、公開したページの URL が消えないように守る（docs/site.md の 8章）。
// 動的なページ（src/pages の [..] の付いたファイル）の getStaticPaths はここの ROUTES を使う。URL の一覧（urls.txt）のテスト
// （test/routes.test.ts）・一覧を書き直すスクリプト（scripts/urls.ts）・ビルドの確かめ（astro.config.ts）も、同じものから全ページの URL を作る
import fs from 'node:fs';
import path from 'node:path';
import { DEPTS, getBudgetProjects, getKihonList, getSeikaGroups, getShisakuList, getShouraizou, getShuyouGroups, getTorikumiGroups, keySlug } from './data.ts';
import { getActivityShares } from './katsudou.ts';
import { kankoTenkaiList } from './plans.ts';
import { getThemes } from './themes.ts';

// キーは src/pages の中のファイルのパス（拡張子なし）。各ページは export const getStaticPaths = ROUTES['shisaku/[id]'] のように使う
export const ROUTES = {
  'bukyoku/[slug]': () => DEPTS.map((dept) => ({ params: { slug: dept.slug }, props: { dept } })),
  'future/[id]': () => getShouraizou().map((v) => ({ params: { id: String(v.id) }, props: { v } })),
  'katsudou/[shisaku]/[slug]': () => getActivityShares().map((a) => ({ params: { shisaku: a.torikumi.shisaku.id, slug: keySlug(a.key) }, props: { a } })),
  'keikaku/kanko/[tenkai]': () => kankoTenkaiList().map((t) => ({ params: { tenkai: t.id }, props: { t } })),
  'kihon/[id]': () => getKihonList().map((k) => ({ params: { id: k.id }, props: { k } })),
  'shihyou/[shisaku]/[slug]': () => getSeikaGroups().map((g) => ({ params: { shisaku: g.shisaku.id, slug: keySlug(g.key) }, props: { g } })),
  'shisaku/[id]': () => getShisakuList().map((s) => ({ params: { id: s.id }, props: { s } })),
  'shuyou/[kihon]/[slug]': () => getShuyouGroups().map((g) => ({ params: { kihon: g.kihon.id, slug: keySlug(g.key) }, props: { g } })),
  'theme/[id]': () => getThemes().map((t) => ({ params: { id: t.id }, props: { t } })),
  'torikumi/[shisaku]/[slug]': () => getTorikumiGroups().map((g) => ({ params: { shisaku: g.shisaku.id, slug: keySlug(g.key) }, props: { g } })),
  'yosan/jigyo/[slug]': () => getBudgetProjects().map((p) => ({ params: { slug: p.slug }, props: { p } })),
} satisfies Record<string, () => { params: Record<string, string> }[]>;

// シェア用のページ（指標ごとの SNS のカードを持ち、開いた人をその指標を見せるページの場所へ移す。docs/site.md の 4章）。
// 検索には載せず（noindex）、sitemap.xml にも入れない。公開した URL の一覧（urls.txt）には入れる
export const SHARE_ROUTES = ['katsudou/[shisaku]/[slug]', 'shihyou/[shisaku]/[slug]', 'shuyou/[kihon]/[slug]'] as const satisfies (keyof typeof ROUTES)[];
export const sharePaths = () => new Set(SHARE_ROUTES.flatMap((k) => ROUTES[k]().map(({ params }) => routePath(k, params))));

// ページのファイルのパス（'about'・'keikaku/index'・'torikumi/[shisaku]/[slug]'）と params から、ページの URL（/torikumi/1-1-a-1/0123abcd/）を作る
export function routePath(file: string, params: Record<string, string> = {}) {
  const p = file.replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, (_, k: string) => {
    if (!params[k]) throw new Error(`${file} の ${k} が無い`);
    return params[k];
  });
  return p ? `/${p}/` : '/';
}

const PAGES_DIR = path.resolve(process.cwd(), 'src/pages');
// ページのファイル（src/pages の .astro。拡張子なし）。/torikumi/data.json・/robots.txt のようなファイルの書き出し（.ts）は入れない
export const pageFiles = () =>
  fs.readdirSync(PAGES_DIR, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.astro'))
    .map((f) => f.split(path.sep).join('/').replace(/\.astro$/, ''))
    .sort();

// 書き出す全ページの URL（404 は除く。sitemap.xml と同じもの）。ROUTES と動的なページのファイルが1対1でないと止める
export function pagePaths(files = pageFiles()): string[] {
  const dynamic = new Set(files.filter((f) => f.includes('[')));
  const keys = Object.keys(ROUTES) as (keyof typeof ROUTES)[];
  const noRoute = [...dynamic].filter((f) => !(f in ROUTES));
  const noFile = keys.filter((k) => !dynamic.has(k));
  if (noRoute.length || noFile.length) throw new Error(`lib/routes.ts の ROUTES と src/pages の動的なページが合わない: ${[...noRoute, ...noFile].join(', ')}`);
  const paths = files.filter((f) => !dynamic.has(f) && f !== '404').map((f) => routePath(f));
  for (const k of keys) for (const { params } of ROUTES[k]()) paths.push(routePath(k, params));
  return [...new Set(paths)].sort();
}

// ---------------------------------------------------------------- URL の一覧と転送

export const URLS_FILE = path.resolve(process.cwd(), 'urls.txt');
export const REDIRECTS_FILE = path.resolve(process.cwd(), 'public/_redirects');

// URL の一覧（urls.txt）。# で始まる行と空行は飛ばす
export const parseUrlList = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const URL_LIST_HEAD = [
  '# 公開したページの URL の一覧（docs/site.md の 8章）。ここにある URL のページが無くなり、public/_redirects の転送も無いと make test が落ちる。',
  '# make urls で、いまの全ページの URL を足して書き直す（消えた URL は残す）。手では足さない',
];
export const urlListText = (urls: string[]) => [...URL_LIST_HEAD, ...urls, ''].join('\n');

// 一覧を書き直す（make urls）。いまのページの URL を足し、消えた URL は残す（公開した URL を守るため）
export const updateUrlList = (listed: string[], pages: string[]) => [...new Set([...listed, ...pages])].sort();

// Cloudflare の _redirects の1行（古い URL・新しい URL・状態コード）。line はファイルの行番号
export interface Redirect {
  from: string;
  to: string;
  status: number | null;
  line: number;
}
// # で始まる行と空行は飛ばす。状態コードを書かない行は null（Cloudflare では 302 になる）
export const parseRedirects = (text: string): Redirect[] =>
  text.split('\n').flatMap((l, i) => {
    const [from, to, status] = l.trim().split(/\s+/);
    return from && !from.startsWith('#') ? [{ from, to: to ?? '', status: status ? Number(status) : null, line: i + 1 }] : [];
  });

const PAGE_URL = /^\/([^\s*:#?]+\/)?$/;

// 一覧の URL が、どれもページか転送で開けるか。
// missing: ページも転送も無い URL。unlisted: 一覧に無いページ（make urls で足す。増えるのはよい）。problems: 一覧と転送の書き方の誤り
export function checkUrls(listed: string[], pages: string[], redirects: Redirect[]) {
  const pageSet = new Set(pages);
  const listedSet = new Set(listed);
  const problems: string[] = [];
  for (const u of listed) if (!PAGE_URL.test(u)) problems.push(`urls.txt の ${u}: / で始まり / で終わるページの URL を書く`);
  const froms = new Set<string>();
  for (const r of redirects) {
    const at = `_redirects の ${r.line} 行目（${r.from}）`;
    // Cloudflare は * や :name の転送もできるが、このテストで確かめられるよう、完全なパスを1行に1つ書く
    if (!PAGE_URL.test(r.from) || !PAGE_URL.test(r.to)) problems.push(`${at}: 古い URL と新しい URL を、/ で始まり / で終わる完全なパスで書く`);
    // 状態コードを書かないと 302（一時的な転送）になり、検索エンジンが新しい URL に評価を移さない
    if (r.status !== 301) problems.push(`${at}: 状態コードを 301 にする`);
    if (froms.has(r.from)) problems.push(`${at}: 同じ古い URL の転送が2つある（上の行だけが使われる）`);
    froms.add(r.from);
    // 転送はページより先に効く（Cloudflare）ので、ページのある URL を転送するとそのページが見えなくなる
    if (pageSet.has(r.from)) problems.push(`${at}: 古い URL にページがある`);
    if (!pageSet.has(r.to)) problems.push(`${at}: 新しい URL（${r.to}）のページが無い`);
  }
  return {
    missing: listed.filter((u) => !pageSet.has(u) && !froms.has(u)),
    unlisted: pages.filter((u) => !listedSet.has(u)),
    problems,
  };
}
