#!/usr/bin/env python3
"""沖縄県PDCAの公開ファイル（総括報告書・部局別検証票・外部局）を一括取得する。

使い方:
  python3 scripts/fetch_pdca.py                    # 全取得元・全年度（取得済みはスキップ）
  python3 scripts/fetch_pdca.py --refresh          # 取得済みも県側の差し替えを確認（定期実行向け）
  python3 scripts/fetch_pdca.py --source kikaku --source kyoiku   # 取得元を絞る
  python3 scripts/fetch_pdca.py --since 2022       # 対象年度（西暦）で絞る
  python3 scripts/fetch_pdca.py --list-sources     # 取得元の一覧を表示
  python3 scripts/fetch_pdca.py --time-budget 600  # 指定秒数で区切る（再実行で続きから）

保存先: data/raw/<取得元>/<対象年度>/<県のファイル名>
  対象年度は西暦＋和暦（例: 2025-r07 = 令和7年度対象）。判定できないものは _unknown/。
台帳:  data/raw/manifest.jsonl（ファイル）, data/raw/pages.jsonl（巡回したページ）

標準ライブラリのみで動作。robots.txt に従い、リクエスト間隔は1秒。
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import deque
from html.parser import HTMLParser
from pathlib import Path

USER_AGENT = "okinawa-pdca-fetcher/2.0 (civic tech archive; +https://github.com/)"
REQUEST_INTERVAL = 1.0
MAX_DEPTH = 5
JST = dt.timezone(dt.timedelta(hours=9))
ATTACH_EXTS = {".pdf", ".zip", ".xlsx", ".xls", ".csv", ".docx", ".doc", ".pptx", ".txt", ".json"}
PREF_HOSTS = {"www.pref.okinawa.jp", "www.pref.okinawa.lg.jp"}
# 県サイトは .jp と .lg.jp の両方で同じ内容を配信し、ページ内リンクも両方が混在している。
# 同じページ・ファイルを二重に取らないよう、URL は正規ホストに寄せて扱う。
HOST_ALIASES = {
    "www.pref.okinawa.lg.jp": "www.pref.okinawa.jp",
    "pref.okinawa.lg.jp": "www.pref.okinawa.jp",
    "pref.okinawa.jp": "www.pref.okinawa.jp",
}
HTTPS_HOSTS = {"www.pref.okinawa.jp"}
# 取得元はどれも県のドメイン（知事部局・教育庁・警察本部・企業局・病院事業局）。リダイレクトでこの外へは行かない
PREF_DOMAINS = ("pref.okinawa.jp", "pref.okinawa.lg.jp")

# ---------------------------------------------------------------- 取得元
CHIJI_ROOT = "https://www.pref.okinawa.jp/kensei/shisaku/1014252/index.html"
CHIJI_DIR = "/kensei/shisaku/1014252/"

# 知事部局: 県のページID → 保存名。部局名が変わってもフォルダが分かれないようIDで固定する。
# 一覧にない新しいIDが見つかった場合は dept-<ID> で保存し、警告を出す。
KNOWN_DEPTS = {
    "1014253": ("soukatsu", "総括（沖縄県PDCA実施結果）"),
    "1014254": ("kikaku", "企画部"),
    "1014261": ("doboku", "土木建築部"),
    "1014266": ("hoken-iryo", "保健医療介護部（旧 保健医療部）"),
    "1014269": ("kodomo-seikatsu", "子ども生活福祉部"),
    "1034147": ("kodomo-mirai", "こども未来部"),
    "1014273": ("kankyo", "環境部（R1〜R4のページ）"),
    "1034300": ("kankyo", "環境部（R5〜のページ）"),
    "1014281": ("shoko", "商工労働部"),
    "1014283": ("somu", "総務部"),
    "1014291": ("chiji-koshitsu", "知事公室"),
    "1014297": ("norin", "農林水産部"),
    "1014301": ("bunka-kanko", "文化観光スポーツ部"),
}


@dataclasses.dataclass
class Source:
    slug: str
    name: str
    start: str
    hosts: set
    scope: list = dataclasses.field(default_factory=list)       # 巡回してよいパスの接頭辞
    follow: list = dataclasses.field(default_factory=list)      # (パス接頭辞, リンク文言に含む語) の追加巡回条件
    file_match: str | None = None   # 取るファイルのリンク文言（正規表現）。None ならページ内のファイルをすべて取る
    since: int | None = None        # この対象年度（西暦）より前のファイルは取らない（--since より優先して絞る）
    fiscal_year: int | None = None  # ページ名・リンク文言から年度が分からないときの対象年度


EXTERNAL_SOURCES = [
    Source("kyoiku", "教育庁",
           "https://www.pref.okinawa.lg.jp/kyoiku/edu/1008438/1022404/index.html",
           PREF_HOSTS, scope=["/kyoiku/edu/1008438/1022404/"]),
    Source("keisatsu", "警察本部",
           "https://www.police.pref.okinawa.jp/category/bunya/shokai/pdca/",
           {"www.police.pref.okinawa.jp"}, scope=["/category/bunya/shokai/pdca/"],
           follow=[("/docs/", "PDCA")]),
    Source("kigyo", "企業局",
           "https://www.eb.pref.okinawa.jp/torikumi/115/137",
           {"www.eb.pref.okinawa.jp"}),
    Source("byoin", "病院事業局",
           "https://byoinjigyokyoku.pref.okinawa.jp/data/pdca/",
           {"byoinjigyokyoku.pref.okinawa.jp"}, scope=["/data/pdca/"]),
]

# 沖縄県PDCA とは別に県が公表している評価（サイトの「個別計画」と、施策・基本施策のページで使う）。
# 部局票ではないので scripts/extract_bukyoku.py は読まない（RELATED_SLUGS）
RELATED_SOURCES = [
    # 沖縄観光推進ロードマップ（第6次沖縄県観光振興基本計画の実施計画）の PDCA。年度別のページはロードマップのページからたどる。
    # ロードマップ本文や意見提出用紙は取らない
    Source("kanko-rm", "沖縄観光推進ロードマップPDCA",
           "https://www.pref.okinawa.jp/shigoto/kankotokusan/1011671/1011741/1011810.html",
           PREF_HOSTS, follow=[("/shigoto/kankotokusan/1011671/1011741/", "PDCA")],
           file_match=r"PDCA", since=2022),
    # 沖縄振興特別推進交付金（ソフトの一括交付金）の事後評価。年度別のページに検証シートが基本施策ごとに並ぶ
    Source("ikkatsu", "沖縄振興特別推進交付金の事後評価",
           "https://www.pref.okinawa.jp/kensei/yosan/1015205/1015216/index.html",
           PREF_HOSTS, scope=["/kensei/yosan/1015205/1015216/"], since=2022),
    # 新・沖縄21世紀ビジョン基本計画の評価検証報告書（R4〜R6 をまとめて評価したもの。年度は R6 として保存する）
    Source("hyoka", "新・沖縄21世紀ビジョン基本計画 評価検証報告書",
           "https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014223/1039989.html",
           PREF_HOSTS, fiscal_year=2024),
    # 新・沖縄21世紀ビジョン基本計画（R4〜R13）の本体。サイトの「基本計画を読む」で本文を見せる。
    # パンフレット・概要・資料編は取らない（本体のリンク文言は「…（沖縄振興計画） （PDF 3.8MB）」）。計画の始まりの R4 として保存する
    Source("kihon", "新・沖縄21世紀ビジョン基本計画",
           "https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014223/1014250/index.html",
           PREF_HOSTS, file_match=r"\(沖縄振興計画\)\s*\(PDF", fiscal_year=2022),
    # 新・沖縄21世紀ビジョン実施計画の本体（分冊）。前期（R4〜R6）と中期（R7〜R9）。
    # 概要版・附属資料・関連体系図は取らない（本体のリンク文言は「…（表紙から…）」「…（基本施策…から…）」）。計画の始まりの年度として保存する
    Source("jisshi-zenki", "新・沖縄21世紀ビジョン実施計画（前期）",
           "https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014230/1014251.html",
           PREF_HOSTS, file_match=r"\((表紙から|基本施策)", fiscal_year=2022),
    Source("jisshi-chuki", "新・沖縄21世紀ビジョン実施計画（中期）",
           "https://www.pref.okinawa.jp/kensei/shisaku/1014211/1014230/1034436.html",
           PREF_HOSTS, file_match=r"\((表紙から|基本施策)", fiscal_year=2025),
]
RELATED_SLUGS = {s.slug for s in RELATED_SOURCES}


# ---------------------------------------------------------------- HTML 解析
class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.links: list[tuple[str, str]] = []
        self._in_title = False
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "a" and self._href is not None:
            self.links.append((self._href, re.sub(r"\s+", " ", "".join(self._text)).strip()))
            self._href = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._href is not None:
            self._text.append(data)


def parse_html(body: str, base_url: str) -> tuple[str, list[tuple[str, str]]]:
    p = LinkParser()
    p.feed(body)
    title = re.split(r"\s*[｜|]\s*", html.unescape(p.title).strip())[0]
    links = []
    for href, text in p.links:
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        links.append((urllib.parse.urljoin(base_url, href.strip()), text))
    return title, links


def clean_url(url: str) -> str:
    """クエリ・フラグメントを落とし、別名ホストを正規ホストに寄せる。"""
    u = urllib.parse.urlsplit(url)
    host = HOST_ALIASES.get(u.netloc.lower(), u.netloc.lower())
    scheme = "https" if host in HTTPS_HOSTS else u.scheme
    return urllib.parse.urlunsplit((scheme, host, u.path, "", ""))


def is_attachment(url: str) -> bool:
    return os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower() in ATTACH_EXTS


def is_page(url: str) -> bool:
    ext = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    return ext in ("", ".html", ".htm")


def is_pref_host(host: str | None) -> bool:
    host = (host or "").lower()
    return any(host == d or host.endswith("." + d) for d in PREF_DOMAINS)


def file_name(url: str) -> str:
    """保存するファイル名（URL の最後の部分）。%2F（/）や %5C（\\）を戻すと ../ が作れて data/raw の外に書けてしまうので、
    区切りの文字を含む名前と、. で始まる名前（.. や隠しファイル）は断る。"""
    name = urllib.parse.unquote(os.path.basename(urllib.parse.urlsplit(url).path))
    if not name or name.startswith(".") or any(c in name for c in "/\\\0"):
        raise ValueError(f"保存できないファイル名: {name!r}（{url}）")
    return name


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "")


# ---------------------------------------------------------------- 年度判定
TARGET_RE = re.compile(r"対象年度\s*[:：]?\s*(令和|平成)?\s*(元|\d{1,2})\s*年度")
ERA_RE = re.compile(r"(令和|平成)\s*(元|\d{1,2})\s*年度")
WEST_RE = re.compile(r"(20\d{2})\s*年度")


def infer_fy(text: str) -> int | None:
    """文字列から対象年度（西暦の年度）を推定する。「対象年度」の表記を最優先。"""
    t = nfkc(text)
    m = TARGET_RE.search(t) or ERA_RE.search(t)
    if m:
        era, n = m.group(1), m.group(2)
        n = 1 if n == "元" else int(n)
        if not era:  # 「対象年度：30年度」のように元号が省略されている場合
            era = "平成" if n >= 20 else "令和"
        return (2018 if era == "令和" else 1988) + n
    m = WEST_RE.search(t)
    return int(m.group(1)) if m else None


def fy_label(fy: int | None) -> str:
    if fy is None:
        return "_unknown"
    return f"{fy}-r{fy - 2018:02d}" if fy >= 2019 else f"{fy}-h{fy - 1988:02d}"


# ---------------------------------------------------------------- HTTP
class PrefRedirect(urllib.request.HTTPRedirectHandler):
    """県のドメインの外へのリダイレクトにはついていかない（巡回するリンクを取得元のホストに絞っているのと同じ）。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_pref_host(urllib.parse.urlsplit(newurl).hostname):
            raise urllib.error.HTTPError(req.full_url, code, f"県のドメインの外へのリダイレクト: {newurl}", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Http:
    def __init__(self) -> None:
        self.last = 0.0
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.opener = urllib.request.build_opener(PrefRedirect())

    def get(self, url: str, headers: dict | None = None, retries: int = 3):
        """(status, headers, body) を返す。304 は body=None。"""
        h = {"User-Agent": USER_AGENT, **(headers or {})}
        for attempt in range(1, retries + 1):
            wait = REQUEST_INTERVAL - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                with self.opener.open(urllib.request.Request(url, headers=h), timeout=90) as r:
                    return r.status, r.headers, r.read()
            except urllib.error.HTTPError as e:
                if e.code == 304:
                    return 304, e.headers, None
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(5 * attempt)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt < retries:
                    time.sleep(5 * attempt)
                    continue
                raise

    def allowed(self, url: str) -> bool:
        u = urllib.parse.urlsplit(url)
        key = f"{u.scheme}://{u.netloc}"
        if key not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                _, _, body = self.get(key + "/robots.txt", retries=1)
                rp.parse(body.decode("utf-8", errors="replace").splitlines())
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    rp.disallow_all = True
                else:
                    rp = None  # robots.txt が無い → 制限なし
            except Exception:
                rp = None
            self.robots[key] = rp
        rp = self.robots[key]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)


def decode(body: bytes, headers) -> str:
    m = re.search(r"charset=([\w-]+)", headers.get("Content-Type", "") or "")
    enc = m.group(1) if m else None
    if not enc:
        m = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', body[:3000], re.I)
        enc = m.group(1).decode() if m else "utf-8"
    try:
        return body.decode(enc, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- 台帳
def now_iso() -> str:
    return dt.datetime.now(JST).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path: Path, key: str) -> dict:
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                out[rec[key]] = rec
    return out


def save_jsonl(path: Path, recs: dict, sort_key) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in sorted(recs.values(), key=sort_key):
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


# ---------------------------------------------------------------- 本体
class Fetcher:
    def __init__(self, args) -> None:
        self.args = args
        self.raw = Path(args.out)
        self.raw.mkdir(parents=True, exist_ok=True)
        self.http = Http()
        self.manifest = load_jsonl(self.raw / "manifest.jsonl", "file_url")
        self.pages = load_jsonl(self.raw / "pages.jsonl", "page_url")
        self.deadline = time.monotonic() + args.time_budget if args.time_budget else float("inf")
        self.stats = dict(pages=0, new=0, updated=0, unchanged=0, skipped=0,
                          filtered=0, robots=0, errors=0)
        self.merge_host_aliases()
        self.claimed = {r["local_path"]: u for u, r in self.manifest.items()}

    def merge_host_aliases(self) -> None:
        """旧版で .lg.jp 経由でも取ってしまった重複を、正規URLの記録に統合する。
        中身（sha256）が同じものだけ重複ファイルを削除する。違う場合は残して警告する。"""
        removed = rekeyed = kept = 0
        for url in list(self.manifest):
            canon = clean_url(url)
            if canon == url:
                continue
            rec = self.manifest.pop(url)
            main = self.manifest.get(canon)
            if main is None:
                rec["file_url"] = canon
                self.manifest[canon] = rec
                rekeyed += 1
                continue
            if rec.get("sha256") and rec.get("sha256") == main.get("sha256"):
                keep, drop = main["local_path"], rec["local_path"]
                # 「__ハッシュ」付きでない方の名前を残す
                if "__" in os.path.basename(keep) and "__" not in os.path.basename(drop) \
                        and (self.raw / drop).exists():
                    keep, drop = drop, keep
                    main["local_path"] = keep
                if keep != drop and (self.raw / drop).exists():
                    (self.raw / drop).unlink()
                removed += 1
            else:
                rec["file_url"] = url  # 中身が違うので別記録として残す
                self.manifest[url] = rec
                kept += 1
                print(f"! 別ホスト版の中身が異なるため残しました: {rec['local_path']}")
                continue
            refs = main.setdefault("referrers", [])
            for r in rec.get("referrers", []):
                r = {**r, "page_url": clean_url(r["page_url"])}
                if not any(x["page_url"] == r["page_url"] for x in refs):
                    refs.append(r)
        for rec in self.manifest.values():
            uniq = {}
            for r in rec.get("referrers", []):
                uniq.setdefault(clean_url(r["page_url"]), {**r, "page_url": clean_url(r["page_url"])})
            if "referrers" in rec:
                rec["referrers"] = list(uniq.values())
        pages = {}
        for url, p in self.pages.items():
            canon = clean_url(url)
            if canon not in pages or url == canon:
                pages[canon] = {**p, "page_url": canon}
        self.pages = pages
        if removed or rekeyed or kept:
            print(f"別ホスト（.lg.jp）経由の重複を整理: 重複ファイル削除 {removed} / URL付け替え {rekeyed} / 中身が異なり保持 {kept}")
            self.save()

    def save(self) -> None:
        save_jsonl(self.raw / "manifest.jsonl", self.manifest, lambda r: r["local_path"])
        save_jsonl(self.raw / "pages.jsonl", self.pages, lambda r: (r["source"], r["page_url"]))

    def timed_out(self) -> bool:
        return time.monotonic() > self.deadline

    # ---- 取得元の列挙
    def sources(self) -> list[Source]:
        try:
            st, hdrs, body = self.http.get(CHIJI_ROOT)
        except Exception as e:
            print(f"! 部局一覧の取得に失敗（外部局のみ取得します）: {e}")
            self.stats["errors"] += 1
            return EXTERNAL_SOURCES + RELATED_SOURCES
        _, links = parse_html(decode(body, hdrs), CHIJI_ROOT)
        found, seen = [], set()
        for url, text in links:
            m = re.match(r"https?://[^/]+" + re.escape(CHIJI_DIR) + r"(\d+)/index\.html$", clean_url(url))
            if not m or m.group(1) in seen:
                continue
            pid = m.group(1)
            seen.add(pid)
            slug, name = KNOWN_DEPTS.get(pid, (f"dept-{pid}", text))
            if pid not in KNOWN_DEPTS:
                print(f"! 未登録の部局ページを検出: {pid} {text} → {slug} として保存")
            found.append(Source(slug, name, clean_url(url), PREF_HOSTS, scope=[f"{CHIJI_DIR}{pid}/"]))
        return found + EXTERNAL_SOURCES + RELATED_SOURCES

    # ---- 巡回
    def in_scope(self, src: Source, url: str, text: str) -> bool:
        u = urllib.parse.urlsplit(url)
        if u.netloc not in src.hosts or not is_page(url):
            return False
        if any(u.path.startswith(p) for p in src.scope):
            return True
        return any(u.path.startswith(p) and kw in nfkc(text) for p, kw in src.follow)

    def crawl(self, src: Source) -> bool:
        print(f"\n=== {src.slug}（{src.name}）")
        queue = deque([(clean_url(src.start), 0, None)])  # (url, depth, 親ページの年度)
        visited = set()
        while queue:
            if self.timed_out():
                return False
            url, depth, parent_fy = queue.popleft()
            if url in visited:
                continue
            visited.add(url)
            if not self.http.allowed(url):
                print(f"  ! robots.txt により取得不可: {url}")
                self.stats["robots"] += 1
                continue
            try:
                st, hdrs, body = self.http.get(url)
            except Exception as e:
                print(f"  ! ページ取得失敗: {url} ({e})")
                self.stats["errors"] += 1
                continue
            title, links = parse_html(decode(body, hdrs), url)
            page_fy = infer_fy(title) or parent_fy or src.fiscal_year
            key = re.sub(r"[^\w.-]+", "_", urllib.parse.urlsplit(url).path.strip("/")) or "index"
            pdir = self.raw / src.slug / "_pages"
            pdir.mkdir(parents=True, exist_ok=True)
            (pdir / f"{key}.html").write_bytes(body)
            files = []
            for link, text in links:
                link = clean_url(link)
                if is_attachment(link) and urllib.parse.urlsplit(link).netloc in src.hosts:
                    if src.file_match and not re.search(src.file_match, nfkc(text)):
                        continue
                    if link not in {f for f, _ in files}:
                        files.append((link, text))
                elif depth < MAX_DEPTH and link not in visited and self.in_scope(src, link, text):
                    queue.append((link, depth + 1, page_fy))
            self.pages[url] = {
                "page_url": url, "source": src.slug, "title": title, "fiscal_year": page_fy,
                "depth": depth, "attachments": len(files), "snapshot": f"{src.slug}/_pages/{key}.html",
                "fetched_at": now_iso(),
            }
            self.stats["pages"] += 1
            if files:
                print(f"  [{fy_label(page_fy) if page_fy else '年度はリンクごとに判定'}] {title}（{len(files)}件）")
            for furl, text in files:
                if self.timed_out():
                    return False
                fy = infer_fy(text) or page_fy
                self.fetch_file(src, furl, text, url, title, fy,
                                "link_text" if infer_fy(text) else ("page_title" if infer_fy(title) else "parent"))
        return True

    # ---- ファイル取得
    def dest_for(self, src: Source, furl: str, fy: int | None) -> Path:
        prev = self.manifest.get(furl)
        if prev:
            rel = Path(prev["local_path"])
            if rel.is_absolute() or ".." in rel.parts:
                raise ValueError(f"台帳の local_path が data/raw の外を指している: {rel}")
            return self.raw / rel
        name = file_name(furl)
        rel = f"{src.slug}/{fy_label(fy)}/{name}"
        if rel in self.claimed and self.claimed[rel] != furl:  # 同名の別ファイル
            stem, ext = os.path.splitext(name)
            rel = f"{src.slug}/{fy_label(fy)}/{stem}__{hashlib.sha1(furl.encode()).hexdigest()[:6]}{ext}"
        self.claimed[rel] = furl
        return self.raw / rel

    def fetch_file(self, src, furl, link_text, page_url, page_title, fy, fy_source) -> None:
        a = self.args
        since = max(a.since or 0, src.since or 0)
        if fy is not None and ((since and fy < since) or (a.until and fy > a.until)):
            self.stats["filtered"] += 1
            return
        try:
            dest = self.dest_for(src, furl, fy)
        except ValueError as e:
            print(f"    ! {e}")
            self.stats["errors"] += 1
            return
        rel = dest.relative_to(self.raw).as_posix()
        prev = self.manifest.get(furl)
        rec = dict(prev) if prev else {}
        refs = rec.setdefault("referrers", [])
        if not any(r["page_url"] == page_url for r in refs):
            refs.append({"page_url": page_url, "page_title": page_title, "link_text": link_text})
        if not prev:  # 複数の取得元から同じURLが参照された場合は最初の取得元に帰属させる
            rec.update({"file_url": furl, "source": src.slug, "source_name": src.name,
                        "fiscal_year": fy, "fiscal_year_from": fy_source, "local_path": rel})
        self.manifest[furl] = rec

        if prev and dest.exists() and not a.refresh and prev.get("sha256") == sha256_file(dest):
            self.stats["skipped"] += 1
            return
        if not self.http.allowed(furl):
            print(f"    ! robots.txt により取得不可: {furl}")
            self.stats["robots"] += 1
            return
        cond = {}
        if prev and dest.exists():
            if prev.get("etag"):
                cond["If-None-Match"] = prev["etag"]
            if prev.get("last_modified"):
                cond["If-Modified-Since"] = prev["last_modified"]
        try:
            st, fh, data = self.http.get(furl, cond)
        except Exception as e:
            print(f"    ! {os.path.basename(rel)}: {e}")
            self.stats["errors"] += 1
            return
        rec["checked_at"] = now_iso()
        name = os.path.basename(rel)
        if st == 304:
            self.stats["unchanged"] += 1
            return
        digest = hashlib.sha256(data).hexdigest()
        old_sha = (prev or {}).get("sha256") or (sha256_file(dest) if dest.exists() else None)
        if dest.exists() and old_sha == digest:
            self.stats["unchanged"] += 1
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                hist = dest.parent / "_history" / dt.datetime.now(JST).strftime("%Y-%m-%d")
                hist.mkdir(parents=True, exist_ok=True)
                shutil.move(str(dest), str(hist / name))
                rec.setdefault("history", []).append({
                    "sha256": old_sha, "moved_to": (hist / name).relative_to(self.raw).as_posix(),
                    "replaced_at": now_iso()})
                print(f"    ↻ {name}（県側で更新 → 旧版を _history へ）")
                self.stats["updated"] += 1
            else:
                print(f"    + {name}（{len(data) / 1024 / 1024:.1f} MB）")
                self.stats["new"] += 1
            tmp = dest.with_name(dest.name + ".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            rec.update({"bytes": len(data), "sha256": digest, "fetched_at": now_iso()})
        rec.update({"etag": fh.get("ETag"), "last_modified": fh.get("Last-Modified"),
                    "content_type": fh.get("Content-Type")})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data/raw", help="保存先（既定: data/raw）")
    ap.add_argument("--source", action="append", help="取得元を絞る（保存名で指定、複数可）")
    ap.add_argument("--since", type=int, help="対象年度（西暦）の下限")
    ap.add_argument("--until", type=int, help="対象年度（西暦）の上限")
    ap.add_argument("--refresh", action="store_true", help="取得済みファイルも差し替えを確認")
    ap.add_argument("--time-budget", type=float, default=0, help="この秒数で区切って終了（0=無制限）")
    ap.add_argument("--list-sources", action="store_true", help="取得元の一覧を表示して終了")
    args = ap.parse_args()

    f = Fetcher(args)
    srcs = f.sources()
    if args.list_sources:
        for s in srcs:
            print(f"{s.slug:16} {s.name}\n{'':16} {s.start}")
        return 0
    if args.source:
        srcs = [s for s in srcs if s.slug in set(args.source)]

    finished = True
    try:
        for s in srcs:
            if not f.crawl(s):
                finished = False
                break
            f.save()
    except KeyboardInterrupt:
        finished = False
        print("\n中断しました。")
    finally:
        f.save()

    st = f.stats
    print(f"\nページ {st['pages']} / 新規 {st['new']} / 更新 {st['updated']} / 変更なし {st['unchanged']} / "
          f"スキップ {st['skipped']} / 年度で除外 {st['filtered']} / robots {st['robots']} / エラー {st['errors']}")
    if not finished:
        print("途中で終了しました。同じコマンドを再実行すると続きから取得します。")
        return 3
    return 1 if st["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
