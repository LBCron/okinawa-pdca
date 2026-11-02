# サイトの作り

`site/`（Astro）の決まりのうち、1つのファイルのコメントには書けないもの。部品・関数ごとの説明はそのファイルのコメントにある。見た目と見せ方は [design.md](design.md)、開発の手順は [dev.md](dev.md)、データの読み方と数え方の規則は [data.md](data.md)。

## 1. データの読み込みと数え方

- 全ページをビルドで静的な HTML に書き出す。`src/lib/data.ts` が `data/extracted` を読んでページ用の形にする（沖縄県PDCA 以外の評価は `lib/plans.ts`）。
- 数え方は lib に1か所で決め、どのページもそれを使う（ページごとに書くと、数とリンク先の件数がずれる）。主なものは `lib/data.ts` の `PATTERNS`・`JUDGE_TRENDS`・`JUDGE_CELLS`・`shisakuDepts`・`SHUYOU_BINS`・`relatedOf`、予算の金額は `amountEntries`（財源・部局・将来像ごとは `fundAmounts`・`deptAmountEntries`・`visionAmountEntries`）、予算事業は `getBudgetProjects`・`budgetCardsOf`、活動指標は `lib/katsudou.ts` の `activityRuns`。ページの頭の数は `lib/heads.ts` で、ページの説明文と SNS のカードの画像（6章）も同じ数を使う。
- 年度をまたいで同じ取組・成果指標・活動指標かは名前の key（`torikumiKey`・`seikaKey`・`katsudouKey`）で比べ、県が名前を変えたものは `lib/renames.ts` で読み替える。規則は [data.md](data.md) の8章。
- 主な取組と成果指標を名前で結び付けて出さない。部局票の「対応する成果指標」には、どの取組にもその施策の成果指標すべてが書かれていて（`test/integrity.test.ts` で確かめている）、取組ごとには分かれていないため。成果指標は施策のページで、施策の取組と並べて見せる（`seikaNameMatches`）。
- ブラウザにデータ全体は配らない。ブラウザが読む JSON は `lib/hashed.ts` に並べたものだけ（読み方は `scripts/fetch-json.ts`）。

## 2. TypeScript

- Astro の `strict`。`npm run build` は `astro check` で型を確かめてから書き出すので、型の誤りがあると Cloudflare のビルドも止まる。`astro check` が TypeScript 7 に対応していないので、TypeScript は 6。
- 抽出結果の JSON の形は `src/lib/types.ts`。抽出の出力の欄を変えたらここも直す。
- ページ用の形は `lib/data.ts`・`lib/plans.ts` の型を使い、`any` にしない。状態の色と形は `lib/icons.ts` の `Tone`・`Shape`。
- 動的なページは `getStaticPaths` の `props` でデータを渡し、`InferGetStaticPropsType` で型を付ける（`Astro.params` から探し直さない）。`getStaticPaths` はページに書かず、`lib/routes.ts` の `ROUTES` に書く（8章）。
- ブラウザに渡す JSON は、書き出す側と読む側で同じ型を使う。
- 外のサイトへのリンクは、すべて `components/ExtLink.astro` で書く。素の `<a>` はサイトの中のリンクだけ。

## 3. ブラウザのスクリプトと CSP

- ブラウザのスクリプトの入口は `src/scripts/site.ts` の1つだけ。スクリプトを足すときは、ページや部品に `<script>` を書かず、`src/scripts/` のファイルにして `site.ts` から import する。どのページでも動くので、自分の部品が無いページでは何もしないように書く。
- CSP（`astro.config.ts`）で、ブラウザが動かすのはこのサイトのファイルと Astro が書き出したスクリプトだけ。外のサイトのスクリプト・フォント・画像は読み込めず、`onclick` のような属性に書いたスクリプト・`javascript:` のリンク・`eval` は動かない（style 属性は許している）。ページに `<style>` は書き出さない。
  - `<script is:inline>` は Astro がハッシュを足さないので、`layouts/Base.astro` のように中身を文字列にして `set:html` で出し、同じ文字列のハッシュを `Astro.csp.insertScriptHash` で足す。
  - 違反はブラウザのエラーになり、`make shot` で `NG` と出る。

## 4. ページ

- 指標（主要指標・成果指標・活動指標）は、それぞれ基本施策・施策・取組のページのカードで見せ、指標だけのページは置かない。一覧・指標のマップ・計画の目次からはカードの id へリンクする。
- 指標をシェアできるように、指標ごとに**シェア用のページ**を置く（`lib/routes.ts` の `SHARE_ROUTES`）。SNS は URL の `#` の先を見ないので、カードの id の URL をシェアすると、入っているページのカードの画像になるため。
  - 題名・説明文・SNS のカードの画像は指標のもので、`og:url` と `canonical` はシェア用のページ自身。開いた人はスクリプトでカードの場所へ移す（`layouts/Base.astro` の `jump`）。サーバーの転送（`_redirects`）にすると SNS も転送の先を読み、入っているページの画像になるので使わない。
  - 検索には載せず（noindex）、sitemap.xml にも入れない。公開した URL の一覧（`urls.txt`）には入れる。
- 取組のページとシェア用のページの URL は名前の key のハッシュなので、名前が変わると URL も変わる（8章）。
- 予算事業のページの URL は、最初の報告年度の予算事業名の key のハッシュ。あとの年度に名前が変わっても変わらない（つなぎ方は [data.md](data.md) の 9.6）。

## 5. くらしのテーマの定義

施策名・施策展開・基本施策の名前に当たる言葉と、人が直すための追加・除外は [data/reference/themes.json](../data/reference/themes.json)。主な取組・成果指標は、その施策のテーマに入る（取組・指標の名前ではテーマに入れない。言葉が当たっただけで中身の違うものが入るため）。基本施策の名前は広いので、短い言葉だと関係のない施策まで入る（「働きやすい環境づくり」の「環境」など）。言葉は長めにし、先読み・後読み（`海洋(?!性気候)`）や exclude で外す。入らない施策があると `make test` で落ちる。

## 6. 検索エンジンと SNS 向け

本番のドメインは `lib/links.ts` の `SITE.url` に1か所で決める。URL・sitemap・robots.txt・構造化データを作る関数は `lib/seo.ts`。

- 全ページの head に `canonical` と `og:url`（本番のドメインでのそのページの URL。クエリは付けない）を出す。どの URL にも出る 404 のページだけは出さない。
- `sitemap.xml` は `astro.config.ts` の小さな統合が作る（依存を足さないため `@astrojs/sitemap` は使わない）。`robots.txt` は巡回を止めない（[deploy.md](deploy.md) の4章）。
- 構造化データ（JSON-LD）では、県を作り手として書かない（県は `isBasedOn` に並べた資料の作り手として書く）。`<script type="application/ld+json">` はデータで、動くスクリプトではないので、CSP のハッシュは要らない。
- SNS のカードの画像は、施策・基本施策・将来像・くらしのテーマ・部局・主な取組のページと指標のシェア用のページはページごとの画像（`lib/card.ts`）、ほかのページはサイト共通の `public/og-image.png`（`make og-image`）。
  - ページごとの画像の中身はページの頭と同じ数で、内訳は区分の並びのまま、0でない区分を全部同じ大きさで並べ、状態は形と文字でも出す（[design.md](design.md) の1・2章）。
  - `og:image` の URL には中身のハッシュを `?v=` で付け、中身が変わったら SNS が取り直すようにする。
  - 字はカードで使う字だけを切り出したフォント（`make card-font`。[dev.md](dev.md) の3章）。
  - 描いた画像はキャッシュし、同じ画像は次のビルドで描き直さない（`lib/card-cache.ts`。Workers Builds の設定は [deploy.md](deploy.md) の2章）。
- ページの説明文は `lib/describe.ts` で作る。数はページが表示している数をそのまま渡し、`describe.ts` では数えない（1章）。内訳は県の区分の並びのまま、0でない区分を全部同じ重みで並べる（遅れだけを書く・遅れを先に書く、はしない）。くらしのテーマは、切れてもこのサイト独自の分類だと分かるように頭に書く。
- 施策・基本施策・主な取組・成果指標・部局のページの題名には「沖縄県」を入れる（取組・指標・部局の名前だけではほかの県のものと見分けにくいため。サイトが県を名乗るのではない）。くらしのテーマはこのサイト独自の分類なので入れない。
- 題名と説明文は `lib/describe.ts` の `*Meta` で組み、ページごとに違うものにする。施策・基本施策・将来像・部局・くらしのテーマ・取組のページと成果指標のシェア用のページは `make test`（`test/describe.test.ts`）で、ほかのページはビルドの終わりの警告（`astro.config.ts`）で確かめる。

## 7. 表示の速さ

- 一覧の行（`.row-list > li`）は `content-visibility: auto` で、画面の外の行を描かない。行の中身は行の外へはみ出せないので、吹き出しなどは body に付ける。
- 大きなもの（取組をさがす・予算事業をさがす・計画の目次とマインドマップ・指標のマップの中身）は HTML に書かず、JSON にしてブラウザで描く・押したときに読む（1章）。
- ブラウザのスクリプトは `<head>` で読む1つのファイル（3章）、CSS もページに埋め込まず全ページで1つのファイル（`astro.config.ts`）。CSS が1つなので、部品の `<style>` で `:global()` を単独で書くと全ページに効く。`.x :global(.y)` のように、範囲をしぼった要素の中に書く。
- 読み込んだときの動き（ドーナツ・スタンプ）は CSS だけで動かす（[design.md](design.md) の8章）。
- ページから `<head>` に足すものは `<link slot="head" ...>` で渡す。
- ページを移ったあとに見た目が変わらないようにする（ずれ・ちらつき）。ヘッダーはどのページにもあるので特に気をつける。
  - スクリプトでしか動かないものを、読み込んだあとに `hidden` を外して出さない。`<head>` のインラインスクリプトが `html` に `js` を付けるので、`:root:not(.js)` で隠し、最初の描画から出す。
  - スクリプトで描く一覧（取組をさがす・計画の目次）は、データが届くまで画面の高さぶんの場所を取っておく（マインドマップは、はじめの深さの図の高さぶん）。
  - 年を西暦で表示するときの書き換え・ナビの横の位置・スマホでページの頭まで下げるのは、最初の描画の前に `layouts/Base.astro` のインラインスクリプトで行う。
  - 確かめ方: Chrome の開発者ツールの Performance（Layout shifts）か Lighthouse。手元の `make build` ではデータがすぐ届くので、回線を絞るか、データの読み込みを遅らせて測る。

## 8. URL を変えない

SNS で共有されたリンクや検索エンジンの評価が切れないように、公開したページの URL は変えない。取組のページと指標のシェア用のページの URL は名前の key のハッシュ（4章）なので、抽出を直して名前が変わったときや、新しい年度の報告で名前の書き方が変わったときにも変わる。施策・基本施策・将来像・部局・くらしのテーマのページも、ID や slug が変わると URL が変わる。予算事業のページは、データを入れ直して前の年度の名前が新しくつながったときに変わる。

- 動的なページ（`src/pages` の `[..]` の付いたファイル）の `getStaticPaths` は、`lib/routes.ts` の `ROUTES` に1か所で書く（ページは `export const getStaticPaths = ROUTES['shisaku/[id]']`）。動的なページを足したら `ROUTES` にも足す（合わないと `make test` が落ちる）。
- 公開した URL の一覧は `site/urls.txt`（1行に1つ）。一覧のどれかの URL のページが無くなり、`site/public/_redirects` の転送も無いと、`make test`（`test/routes.test.ts`）が落ちる。
- ページを足したとき・データを入れ直したときは、`make urls` で一覧に足してコミットする（消えた URL は残す）。

URL を変えるとき（テストが落ちたとき）は、テストが挙げた古い URL ごとに、`site/public/_redirects` に「古い URL 新しい URL 301」の行を足す（Cloudflare の [_redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)）。古い URL は一覧に残し、`make urls` で新しい URL を足す。

- 新しい URL は、同じ取組・指標などの新しいページ。行き先の無くなったページ（取組の終了など）も、近いページ（施策のページなど）へ転送する。
- `make test` は、状態コードが 301 であること（書かないと 302 になり、検索エンジンが新しい URL に評価を移さない）・新しい URL のページがあること・古い URL にページが無いこと（Cloudflare は転送をページより先に効かせるので、そのページが見えなくなる）も確かめる。`*` や `:name` は使わず、完全なパスで書く。
- Cloudflare の `_redirects` に書ける転送は 2,000 行まで。データの入れ直しで何百もの URL が変わるときは、転送を足す前に URL の決め方を見直す。
- 確かめ方: `make build` のあと、`site` で `npx wrangler dev` を動かし（[deploy.md](deploy.md) の5章）、古い URL が 301 と新しい URL の `Location` を返すか。
