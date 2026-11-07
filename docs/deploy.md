# 公開

サイト（`site/dist`）を Cloudflare Workers の静的アセットとして公開する手順。

## 1. しくみ

[Cloudflare Workers の静的アセット](https://developers.cloudflare.com/workers/static-assets/)として置き、`site/dist` をそのまま配る。GitHub 連携（[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)）で、main に push するたびに Cloudflare 側でビルドして公開する。

| ファイル | 中身 |
|---|---|
| [site/wrangler.jsonc](../site/wrangler.jsonc) | Worker の設定（名前・workers.dev の URL・プレビュー・`/api/` を Worker に通す） |
| [site/public/_headers](../site/public/_headers) | 配るときのヘッダー（キャッシュ・守りのヘッダー） |
| [site/public/_redirects](../site/public/_redirects) | 公開した後に変えた URL の転送（[site.md](site.md) の 8章） |
| [site/worker/api.ts](../site/worker/api.ts) | `/api/` を受ける Worker。`npx wrangler deploy` が `dist` と一緒に上げる |

## 2. Workers Builds の設定

ダッシュボードの「Workers & Pages」→「Create application」→「Import a repository」で `saboyutaka/okinawa-pdca` を選び、次のように設定する:

| 項目 | 値 |
|---|---|
| プロジェクト名 | `okinawa-pdca`（`site/wrangler.jsonc` の `name` と同じにする） |
| 本番ブランチ | `main` |
| ルートディレクトリ | `site` |
| ビルドコマンド | `npm run build`（`astro check` で型を確かめてから書き出す。型の誤りがあると止まる） |
| デプロイコマンド | `npx wrangler deploy` |
| Node | `site/.node-version`（26）。読まれないときは環境変数 `NODE_VERSION=26` |
| ビルドキャッシュ | 有効（プロジェクトの Settings → Build → Build cache。下を参照） |

- ビルドは `../data/extracted` と `../data/reference` を読むので、リポジトリ全体がチェックアウトされている必要がある（Workers Builds はリポジトリ全体を取得する）。
- 依存パッケージを入れるときのスクリプトは `site/.npmrc` の `ignore-scripts=true` で動かさない。Cloudflare のビルドで依存を入れるときと `npx wrangler deploy` にも効く。
- ビルドでは SNS のカードの画像（[site.md](site.md) の6章）も描き、前のビルドと同じ画像は描き直さない（`site/src/lib/card-cache.ts`）。描いた画像は `node_modules/.astro` に置き、[ビルドキャッシュ](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/)が次のビルドに残す。効いているかはビルドのログの `[card-cache]` の行で分かる。キャッシュは最後に読まれてから7日で消え、その次のビルドは全部を描く。

## 3. 本番とプレビュー

- 本番は https://okinawa-miraima.com/ 。カスタムドメインはダッシュボード（Settings → Domains & Routes）で付けていて `wrangler.jsonc` には書いていないので、デプロイのログに `No targets deployed for okinawa-pdca` と出ても、公開はされている。
- ドメインを変えるときは `site/src/lib/links.ts` の `SITE.url` を直し（`canonical`・`og:url`・sitemap・シェアの URL などがここから作られる。[site.md](site.md) の6章）、ドメインを書いた SNS のカードの画像を `make og-image` で作り直す。
- workers.dev の本番の URL は `site/wrangler.jsonc` の `workers_dev: false` で止めてある（同じページを別の URL で読ませないため）。ダッシュボードで切っても次の `npx wrangler deploy` で `wrangler.jsonc` の値に戻るので、`wrangler.jsonc` で決める。
- main 以外のブランチ（PR）は `npx wrangler preview` でブランチごとのプレビューになる。URL は `<ブランチ>-okinawa-pdca.<アカウント>.workers.dev`（Cloudflare が PR にコメントで書く）。`site/wrangler.jsonc` の `preview_urls: true` で有効にしていて、書かないと `workers_dev` に合わせて止まることがある。本番の版ごとの URL（`<版の ID の頭8文字>-okinawa-pdca.<アカウント>.workers.dev`）も開ける。プレビューと版ごとの URL には Cloudflare が `X-Robots-Tag: noindex` を付けるので、検索には載らない。

## 4. 検索エンジンに載せる

本番のページは検索エンジンに載せている（noindex を出さない。出すのは指標のシェア用のページだけ）。URL を変えるときは、古い URL から転送する（[site.md](site.md) の 8章）。

`robots.txt`（`site/src/pages/robots.txt.ts`）では巡回を止めない。止めると、またページを検索から外したくなったときに noindex が読まれず、URL だけ検索結果に出ることがある。

## 5. 手元で確かめる

`_headers`・`_redirects`・Worker は、Astro だけの `make dev`・`make shot` では効かない。`make build` のあと、`site` で `npx wrangler dev` を動かして確かめる（Alpine の `site` コンテナでは動かないので `node:26-slim` で動かす。`site/.wrangler/` に作業用のファイルができる）。
