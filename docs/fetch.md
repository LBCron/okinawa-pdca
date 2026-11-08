# 県の報告書の取り方とフォルダ

県サイトから報告書（PDF・zip）を取り、`data/` に置くまでの説明。PDF から何をどう読むか（抽出）は [data.md](data.md)、別の PC への移し方は [new-pc.md](new-pc.md)。

## 1. 取得

```sh
python3 scripts/fetch_pdca.py                  # 全取得元・全年度（H24〜）。取得済みはスキップ
python3 scripts/fetch_pdca.py --refresh        # 取得済みも県側の差し替えを確認（定期実行向け）
python3 scripts/fetch_pdca.py --since 2022     # 対象年度（西暦）で絞る
python3 scripts/fetch_pdca.py --source kikaku  # 取得元を絞る（--list-sources で一覧）
```

- 標準ライブラリのみ。robots.txt に従い、リクエスト間隔は1秒。
- 途中で止めても、同じコマンドを再実行すれば続きから取得する。
- ホストの python3 で動き、取ったファイルをホストに書くので、保存先が `data/raw` の外に出ないようにしている。URL のファイル名を戻して `/`・`\` を含むもの（`%2F` など）や `.` で始まるものは取らない（`! 保存できないファイル名` と出してエラーに数える）。県のドメイン（`pref.okinawa.jp`・`pref.okinawa.lg.jp`）の外へのリダイレクトにもついていかない。

## 2. 取得元

| 保存名 | 内容 | 起点 |
|---|---|---|
| soukatsu | 沖縄県PDCA実施結果（総括報告書） | [pref.okinawa.jp …/1014252/1014253/](https://www.pref.okinawa.jp/kensei/shisaku/1014252/1014253/index.html) |
| kikaku, doboku, hoken-iryo, kodomo-seikatsu, kodomo-mirai, kankyo, shoko, somu, chiji-koshitsu, norin, bunka-kanko | 知事部局の成果指標検証票・主な取組検証票 | [pref.okinawa.jp …/1014252/](https://www.pref.okinawa.jp/kensei/shisaku/1014252/index.html) の各部局のページ（…/1014252/<部局ID>/） |
| kyoiku | 教育庁 | [pref.okinawa.jp …/kyoiku/edu/1008438/1022404/](https://www.pref.okinawa.jp/kyoiku/edu/1008438/1022404/index.html) |
| keisatsu | 警察本部 | [police.pref.okinawa.jp /category/bunya/shokai/pdca/](https://www.police.pref.okinawa.jp/category/bunya/shokai/pdca/) |
| kigyo | 企業局 | [eb.pref.okinawa.jp /torikumi/115/137](https://www.eb.pref.okinawa.jp/torikumi/115/137) |
| byoin | 病院事業局 | [byoinjigyokyoku.pref.okinawa.jp /data/pdca/](https://byoinjigyokyoku.pref.okinawa.jp/data/pdca/) |
| kanko-rm | 沖縄観光推進ロードマップPDCA（個別計画。R4〜） | [pref.okinawa.jp …/1011741/1011810.html](https://www.pref.okinawa.jp/shigoto/kankotokusan/1011671/1011741/1011810.html) から年度別のページ |
| ikkatsu | 沖縄振興特別推進交付金（ソフトの一括交付金）の事後評価（R4〜） | [pref.okinawa.jp …/1015205/1015216/](https://www.pref.okinawa.jp/kensei/yosan/1015205/1015216/index.html) |
| hyoka | 新・沖縄21世紀ビジョン基本計画 評価検証報告書（R4〜R6） | [pref.okinawa.jp …/1014223/1039989.html](https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014223/1039989.html) |
| kihon | 新・沖縄21世紀ビジョン基本計画の本体（R4〜R13。計画の始まりの R4 として保存） | [pref.okinawa.jp …/1014223/1014250/](https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014223/1014250/index.html) |
| jisshi-zenki・jisshi-chuki | 新・沖縄21世紀ビジョン実施計画の本体の分冊（前期 R4〜R6・中期 R7〜R9。計画の始まりの年度として保存） | [前期](https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014230/1014251.html)・[中期](https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014230/1034436.html) |

- 県企業局のサイトは robots.txt で自動取得が禁止されているため、PDF はブラウザで手動ダウンロードし、`python3 scripts/import_manual.py <フォルダ> --source kigyo --since 2022` で取り込む（台帳に `fetched_by: manual` と記録される）。
- 知事部局は一覧ページから自動検出する。保存名は県のページIDで固定しているため、部局名が変わってもフォルダは分かれない（環境部は新旧2ページとも kankyo）。未登録のIDは `dept-<ID>` で保存し警告を出す。

## 3. フォルダ

```
data/
├── raw/                         ① 県サイトから取ったまま（手で編集しない）
│   ├── manifest.jsonl           ファイル台帳（元URL・参照元ページとリンク文言・対象年度とその判定根拠・sha256・取得日時）
│   ├── pages.jsonl              巡回したページの台帳
│   └── <取得元>/
│       ├── _pages/              巡回したページのHTML保存コピー
│       ├── 2025-r07/            対象年度（西暦-和暦）。ファイル名は県のまま
│       │   └── _history/YYYY-MM-DD/   県が差し替えた場合の旧版
│       └── _unknown/            対象年度を判定できなかったもの
├── interim/                     ② zip展開・ページ単位テキストなどの機械的な中間物
├── extracted/                   ③ 抽出結果（サイトはこれだけを読んでビルドする。コミットする）
└── reference/                   人が用意した参照データ（finance.json：国・県の財政の数字、themes.json：くらしのテーマの定義）
```

- **フォルダ名の年度は「対象年度」（西暦の年度）**。公表年ではない（例: 令和7年度対象の報告書は2026年8月公表 → `2025-r07`）。
- 対象年度は「リンク文言 → ページタイトル → 親ページ」の順に判定し、根拠を manifest の `fiscal_year_from` に記録する。
- 同じフォルダに同名の別ファイルがある場合は `名前__<URLハッシュ6桁>.pdf` にする。

## 4. 方針

- `raw/` は不変。抽出結果は必ず `manifest.jsonl` の `file_url`（＋PDFページ番号）を出典として持つ。
- PDF・zip・HTMLはリポジトリに含めない（`.gitignore`）。`manifest.jsonl`・`pages.jsonl` はコミットする。台帳とファイルがそろっているかは `python3 scripts/check_raw.py` で確かめる。
