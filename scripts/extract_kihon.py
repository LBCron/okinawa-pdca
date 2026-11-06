#!/usr/bin/env python3
"""新・沖縄21世紀ビジョン基本計画（本体）の本文を、見出しと段落に分けて取り出す。

使い方（解析用コンテナ内で実行する）:
  docker compose run --rm tools python scripts/extract_kihon.py

入力: data/raw/kihon/ の基本計画の本体
出力: data/extracted/kihon/
  honbun.json   本文を頭から順に並べたもの。1行が1つのかたまり（kind）:
                  h      見出し。level 1 章・2 「１」・3 「⑴」・4 「ア」・5 「①」。id はページの # に使う
                         （章からの印の並び。第4章の「⑴」以下は沖縄県PDCA の基本施策・施策展開・施策の ID を pdca に持つ）
                  label  見出しの付かない小見出し（「（People 人間）」「【主な特性と課題】」）
                  p      段落
                  fig    図（中身は読まない。PDF のそのページへのリンクにする）
                どれも page に PDF のページ（1から）を、本文の章のものは printed に印字のページ（「- 31 -」）を持つ。
  sources.json  出典

見出しはゴシック、本文は明朝で印字されている。見出しは字の形（ゴシック）と頭の印で見分け、段の深さは印の種類で決める。
段落の切れ目は、行の頭の字下げ（次の行より1字ぶん右）と、前の行が右の端まで届かずに終わっていることで見分ける。
章から「⑴」までの見出しは PDF の目次と、第4章の「⑴」「ア」「①」は沖縄県PDCA の基本施策・施策展開・施策の名前と突き合わせる。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_soukatsu import fix_strings, load_manifest, name_key, uncid, write_json  # noqa: E402

SOURCE = "kihon"
# 目次（PDF の 5〜8ページ）と、本文の前の「はじめに」（3ページ）。本文の章は 9ページから
TOC_PAGES = range(5, 9)
HAJIMENI_PAGE = 3
BODY_FROM = 9
# ページの上の柱（いまの節の名前）と下のページ番号は読まない
HEADER_BOTTOM = 45
FOOTER_TOP = 790

KANA = "アイウエオカキクケコサシスセソ"
NUM_FULL = "１２３４５６７８９"
PAREN_NUM = "⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇"
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


@dataclass
class Line:
    page: int
    x0: float
    x1: float
    top: float
    size: float
    gothic: bool
    text: str


# 本文の箇条の頭（① …、1) …）。「・」は、行の頭に来た「A・B」の「・」と見分けられないので入れない
LIST_HEAD_RE = re.compile(rf"^\s*([{CIRCLED}]|\d+\)|[（(]\d+[)）]|※)")


def heading_of(line: Line) -> tuple[int, str, str] | None:
    """見出しの行なら（段の深さ, 印, 名前）。ゴシックの行だけを見る。本文の明朝の行の頭の「ア」「①」は見出しにしない。"""
    if not line.gothic:
        return None
    t = line.text.strip()
    if m := re.match(r"^第([１-９])章\s*(.+)$", t):
        return 1, m.group(1), re.sub(r"\s+", "", m.group(2)) if len(m.group(2).replace(" ", "")) <= 4 else m.group(2)
    if (m := re.match(rf"^([{NUM_FULL}])\s+(.+)$", t)) and line.size >= 13.5:
        return 2, m.group(1), m.group(2)
    if m := re.match(rf"^([{PAREN_NUM}])\s*(.+)$", t):
        return 3, m.group(1), m.group(2)
    if m := re.match(rf"^([{KANA}])\s+(.+)$", t):
        return 4, m.group(1), m.group(2)
    if m := re.match(rf"^([{CIRCLED}])\s*(.+)$", t):
        return 5, m.group(1), m.group(2)
    return None


def is_label(line: Line) -> bool:
    """見出しの付かない小見出し（ゴシックの「（…）」「【…】」）。"""
    t = line.text.strip()
    return line.gothic and bool(re.fullmatch(r"（.+）|【.+】", t))


def is_skip(line: Line) -> bool:
    """第4章の将来像の頭の「基本施策 １」（すぐ後の「１ …を目指して」と同じことを言う札。将来像5だけ明朝で印字されている）。"""
    return bool(re.fullmatch(r"基本施策\s*[１-９]", line.text.strip()))


def mark_token(mark: str) -> str:
    """見出しの印を id の1つの段にする（「ア」は a、数字の印は数）。"""
    if mark in KANA:
        return "abcdefghijklmno"[KANA.index(mark)]
    for chars in (NUM_FULL, PAREN_NUM, CIRCLED):
        if mark in chars:
            return str(chars.index(mark) + 1)
    raise ValueError(mark)


def join_text(a: str, b: str) -> str:
    """折り返した行をつなぐ。英字の単語が行をまたぐときだけ空白を入れる（PPA（Power ／ Purchase Agreement））。"""
    if a and b and re.match(r"[A-Za-z]", b[0]) and re.match(r"[A-Za-z]", a[-1]):
        return a + " " + b
    return a + b


def build(lines: list[Line], figs: dict[int, list[float]]) -> list[dict]:
    """行（ページ順・上から順）を、見出し・小見出し・段落・図のかたまりに分ける。figs はページごとの図の上端。"""
    # ページごとの本文の右の端（段落の終わりの短い行を見分ける）
    right: dict[int, float] = {}
    for ln in lines:
        if not ln.gothic:
            right[ln.page] = max(right.get(ln.page, 0), ln.x1)

    out: list[dict] = []
    path: dict[int, str] = {}  # 段の深さ → その段の id
    prev: Line | None = None
    pending_figs = {p: sorted(ts) for p, ts in figs.items()}

    def put_figs(page: int, top: float) -> None:
        while pending_figs.get(page) and pending_figs[page][0] < top:
            pending_figs[page].pop(0)
            out.append({"kind": "fig", "page": page})

    for i, ln in enumerate(lines):
        put_figs(ln.page, ln.top)
        if is_skip(ln):
            prev = None
            continue
        h = heading_of(ln)
        if h:
            level, mark, title = h
            path = {k: v for k, v in path.items() if k < level}
            parent = path[max(path)] if path else ""
            hid = (parent + "-" if parent else "") + mark_token(mark)
            path[level] = hid
            out.append({"kind": "h", "level": level, "id": hid, "mark": mark, "title": title.strip(), "page": ln.page})
            prev = ln
            continue
        if ln.gothic and not is_label(ln) and out and out[-1]["kind"] == "h" and prev and prev.gothic and abs(ln.size - prev.size) < 0.5:
            # 2行に折り返した見出し
            out[-1]["title"] = join_text(out[-1]["title"], ln.text.strip())
            prev = ln
            continue
        if is_label(ln):
            out.append({"kind": "label", "text": ln.text.strip(), "page": ln.page})
            prev = ln
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        # 次の行より右から始まる行は段落の頭（字下げ）。ただし次の行が箇条の頭なら、この行は前の箇条の2行目以降
        # （ぶら下げの字下げ。「② 医療・福祉の…／てしやすい暮らし／③ …」）なので比べない
        indented = bool(nxt and nxt.page == ln.page and not nxt.gothic and ln.x0 > nxt.x0 + 6
                        and not LIST_HEAD_RE.match(nxt.text))
        prev_short = bool(prev and not prev.gothic and prev.x1 < right.get(prev.page, 0) - 14)
        # 前の行より右から始まる行も段落の頭（次の行が見出しの、1行だけの段落）。箇条の2行目以降は前の行より右から始まるので除く
        after_prev = bool(prev and prev.page == ln.page and not prev.gothic and ln.x0 > prev.x0 + 6
                          and out and out[-1]["kind"] == "p" and not LIST_HEAD_RE.match(out[-1]["text"]))
        # 前の行より左から始まる箇条の頭は、次の箇条（前の箇条の2行目以降がたまたま右の端近くまで届いていたとき）
        outdented_item = bool(prev and prev.page == ln.page and ln.x0 < prev.x0 - 6 and LIST_HEAD_RE.match(ln.text))
        if (not out or out[-1]["kind"] != "p" or prev is None or prev.gothic
                or prev_short or indented or after_prev or outdented_item):
            out.append({"kind": "p", "text": ln.text.strip(), "page": ln.page})
        else:
            out[-1]["text"] = join_text(out[-1]["text"], ln.text.strip())
        prev = ln
    for page, tops in pending_figs.items():
        out += [{"kind": "fig", "page": page} for _ in tops]
    return out


def merge_small(tls: list[dict]) -> list[dict]:
    """小さな字の行（6pt）を片付ける。かなだけの行はふりがな（「聞得大君」の「きこえおおきみ」）なので読まない。
    ほかは下付きの字（「CO2」の「2」）なので、高さの重なる行の、横の位置の所に入れる。"""
    small = [tl for tl in tls if tl["chars"][0]["size"] < 9]
    rest = [tl for tl in tls if tl["chars"][0]["size"] >= 9]
    for sm in small:
        if re.fullmatch(r"[\u3041-\u30ff]+", sm["text"].strip()):
            continue
        host = next((tl for tl in rest if tl["top"] - 2 < sm["top"] < tl["bottom"]), None)
        if host is None:
            rest.append(sm)
            continue
        cut = sum(1 for c in host["chars"] if c["x0"] < sm["x0"])
        # extract_text_lines の text は chars を並べて空白を足したもの。入れる位置は空白を除いた字の数で数える
        text, n, pos = host["text"], 0, len(host["text"])
        for j, ch in enumerate(text):
            if n == cut:
                pos = j
                break
            if not ch.isspace():
                n += 1
        host["text"] = text[:pos].rstrip() + sm["text"].strip() + text[pos:]
    return sorted(rest, key=lambda tl: tl["top"])


def read_lines(pdf, pages: range | list[int]) -> tuple[list[Line], dict[int, list[float]]]:
    lines: list[Line] = []
    figs: dict[int, list[float]] = {}
    for pno in pages:
        page = pdf.pages[pno - 1]
        tls = [tl for tl in page.extract_text_lines(return_chars=True) if HEADER_BOTTOM < tl["top"] < FOOTER_TOP]
        for tl in merge_small(tls):
            c = tl["chars"][0]
            # フォント名は Shift_JIS のバイト列の表記（「ＭＳ ゴシック」の「ゴシック」が \x83S\x83V\x83b\x83N）
            gothic = "\\x83S\\x83V\\x83b\\x83N" in c["fontname"] or "Gothic" in c["fontname"]
            text = fix_strings(uncid(tl["text"]))
            lines.append(Line(pno, tl["x0"], tl["x1"], tl["top"], c["size"], gothic, text))
        # 大きな画像を図とする（ロゴなどの小さな画像は数えない）
        for im in page.images:
            if im["width"] > 150 and im["height"] > 100 and HEADER_BOTTOM < im["top"] < FOOTER_TOP:
                figs.setdefault(pno, []).append(im["top"])
    return lines, figs


def read_toc(pdf) -> list[tuple[int, str, int]]:
    """目次の（段の深さ, 名前, 印字のページ）。章は印字のページが無いので 0。"""
    out = []
    for pno in TOC_PAGES:
        for tl in pdf.pages[pno - 1].extract_text_lines():
            t = tl["text"].strip()
            if m := re.match(r"^第[１-９]章\s*(.+)$", t):
                out.append((1, m.group(1), 0))
            elif m := re.match(rf"^([{NUM_FULL}]|[{PAREN_NUM}])\s*(.+?)\s*‥*\s*(\d+)$", t):
                out.append((2 if m.group(1) in NUM_FULL else 3, m.group(2).rstrip("‥ "), int(m.group(3))))
    return out


def check_toc(blocks: list[dict], toc: list[tuple[int, str, int]], offset: int) -> list[str]:
    """章から「⑴」までの見出しが、目次と同じ順・名前・ページか。offset は PDF のページと印字のページの差。"""
    heads = [(b["level"], b["title"], b["page"] - offset) for b in blocks if b["kind"] == "h" and b["level"] <= 3]
    errors = []
    if len(heads) != len(toc):
        errors.append(f"見出しの数が目次と違う: 本文 {len(heads)} / 目次 {len(toc)}")
    for (lv, name, page), (tlv, tname, tpage) in zip(heads, toc):
        if lv != tlv or name_key(name) != name_key(tname) or (tpage and page != tpage):
            errors.append(f"目次と違う: 本文 {lv} {name} p.{page} / 目次 {tlv} {tname} p.{tpage}")
    return errors


def link_pdca(blocks: list[dict], names: dict[str, set[str]]) -> list[str]:
    """第4章の「⑴」「ア」「①」に沖縄県PDCA の ID（基本施策 1-1・施策展開 1-1-a・施策 1-1-a-1）を付ける。
    第4章の見出しの id は「4-将来像-基本施策-…」なので、頭の「4-」を外したものが沖縄県PDCA の ID。名前が合わないものは付けずに返す。"""
    errors = []
    for b in blocks:
        if b["kind"] != "h" or not b["id"].startswith("4-") or b["level"] < 3:
            continue
        pid = b["id"][2:]
        if pid not in names:
            errors.append(f"沖縄県PDCA に無い: {b['id']} {b['title']}")
        elif not any(same_name(b["title"], n) for n in names[pid]):
            errors.append(f"沖縄県PDCA と名前が違う: {b['id']} {b['title']} / {' / '.join(sorted(names[pid]))}")
        else:
            b["pdca"] = pid
    return errors


def same_name(plan: str, pdca: str) -> bool:
    """基本計画の見出しと沖縄県PDCA の名前が同じか。沖縄県PDCA の総括報告書には、名前が途中で切れて印字されたもの
    （3-(2)-エ-①「…観光施設等における」。基本計画では「…観光施設等における利便性向上」）があるので、頭が同じならよい。"""
    a, b = name_key(plan), name_key(pdca)
    return a == b or (len(b) >= 10 and a.startswith(b))


def pdca_names(extracted: Path) -> dict[str, set[str]]:
    """沖縄県PDCA の基本施策・施策展開・施策の ID → 名前（年度で書き方が違うものもあるので全年度の分）。"""
    names: dict[str, set[str]] = {}
    for k in json.loads((extracted / "soukatsu" / "kihon.json").read_text(encoding="utf-8")):
        names.setdefault(k["id"], set()).add(k["name"])
    for s in json.loads((extracted / "soukatsu" / "shisaku.json").read_text(encoding="utf-8")):
        names.setdefault(s["id"], set()).add(s["name"])
        names.setdefault(s["tenkai_id"], set()).add(s["tenkai_name"])
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--extracted", default="data/extracted")
    args = ap.parse_args()
    raw, extracted = Path(args.raw), Path(args.extracted)

    sources, blocks, errors = [], [], []
    for local_path, r in sorted(load_manifest(raw).items()):
        if r.get("source") != SOURCE or not r.get("referrers"):
            continue
        ref = r["referrers"][0]
        sources.append({"id": local_path, "file_url": r["file_url"], "link_text": ref["link_text"],
                        "page_url": ref["page_url"], "page_title": ref["page_title"]})
        with pdfplumber.open(raw / local_path) as pdf:
            lines, figs = read_lines(pdf, [HAJIMENI_PAGE] + list(range(BODY_FROM, len(pdf.pages) + 1)))
            # 「はじめに」は見出しがゴシックではないので、見出しを足してから読む
            body = build(lines, figs)
            first = next(i for i, b in enumerate(body) if b["page"] >= BODY_FROM)
            hajimeni = [b for b in body[:first] if not (b["kind"] == "p" and b["text"] == "はじめに ～県民のみなさまへ～")]
            blocks = [{"kind": "h", "level": 1, "id": "0", "mark": "", "title": "はじめに ～県民のみなさまへ～",
                       "page": HAJIMENI_PAGE}] + hajimeni + body[first:]
            errors += check_toc(body[first:], read_toc(pdf), offset=BODY_FROM - 1)
        for b in blocks:
            b["source"] = local_path
            if b["page"] >= BODY_FROM:
                b["printed"] = b["page"] - (BODY_FROM - 1)
    if not blocks:
        print("警告: 基本計画の本体が見つからない・読めない（先に make fetch）", file=sys.stderr)
        return 1
    errors += link_pdca(blocks, pdca_names(extracted))

    kinds = {k: sum(b["kind"] == k for b in blocks) for k in ("h", "label", "p", "fig")}
    chars = sum(len(b.get("text", "")) for b in blocks)
    print(f"見出し {kinds['h']} / 小見出し {kinds['label']} / 段落 {kinds['p']}（{chars:,}字） / 図 {kinds['fig']}"
          f" / 沖縄県PDCA の ID {sum('pdca' in b for b in blocks)}", file=sys.stderr)
    for e in errors:
        print(f"  ! {e}", file=sys.stderr)
    write_json(extracted / "kihon" / "honbun.json", blocks)
    write_json(extracted / "kihon" / "sources.json", sources)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
