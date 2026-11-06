#!/usr/bin/env python3
"""新・沖縄21世紀ビジョン実施計画（前期・中期）の本体の本文と表を、頭から順に取り出す。

使い方（解析用コンテナ内で実行する）:
  docker compose run --rm tools python scripts/extract_jisshi.py

入力: data/raw/jisshi-zenki/・data/raw/jisshi-chuki/ の分冊（ファイル名の順に読む）。
      中期の、文字が図形になっていて読めないページは data/reference/jisshi_chuki_images.json（画像を読んで文字にしたもの）
出力: data/extracted/jisshi/
  zenki.json・chuki.json  本文を頭から順に並べたもの。1行が1つのかたまり（kind）:
                  h      見出し。level 1 章・2 「１」（第2章は将来像）・3 「（１）」（第2章は基本施策）・4 「ア」（施策展開）・5 「①」（施策）。
                         id はページの # に使う（章からの印の並び）。第2章の基本施策・施策展開・施策は沖縄県PDCA の ID を pdca に持つ
                  label  見出しの付かない小見出し（「施策の方向」「【指標設定の考え方】」）
                  p      段落
                  fig    図・グラフ（中身は読まない。PDF のそのページへのリンクにする）
                  table  表。table は種類（shuyou 主要指標・seika 成果指標・kyodo 協働の主体・torikumi 主な取組・other）。
                         head・body はセル（text と、2以上なら cs 列・rs 行のまたぎ）の行。成果指標は caption に指標の名前。
                         主な取組は shisaku に沖縄県PDCA の施策の ID、取組の名前のセルは torikumi に名前（部局を除く）、「○…」の行は group
                どれも source に分冊、page に PDF のページ（1から）、printed に印字のページを持つ。画像から読んだものは transcribed
  sources.json  出典

字はすべてゴシックなので、見出しは頭の印（第１章・１・（１）・ア・①）と、表の枠（基本施策・施策展開の札）で見分ける。
表は罫線（細い長方形）と、点線（小さな点の並び。年度の列の区切り）から枠を作り、セルのまたぎを数える。
段落の切れ目は、行の頭の字下げと、前の行が右の端まで届かずに終わっていることで見分ける。セルの中も、右の端まで届かない行の後ろで改行する。
「基本施策の体系」「施策展開の体系」（見出しの一覧の図）と、第2章の頭の施策体系表・記載例は読まない（施策体系表・記載例は図とする）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_soukatsu import fix_strings, load_manifest, name_key, split_section, uncid, write_json  # noqa: E402

PLANS = {
    # 計画 → (取得元, 沖縄県PDCA の年度（施策の名前を突き合わせる）)
    "zenki": ("jisshi-zenki", (2022, 2023, 2024)),
    "chuki": ("jisshi-chuki", (2025,)),
}
# 1冊目の表紙と目次（PDF の 1〜4ページ）は読まない
FIRST_FROM = 5
# ページの上の柱と下のページ番号
HEADER_BOTTOM = 40
FOOTER_TOP = 790
# 前期の目次（基本施策の印字のページを突き合わせる）。中期の目次は文字が図形なので読めない
TOC_PAGES = {"zenki": (3, 4)}

KANA = "アイウエオカキクケコサシスセソ"
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
NUM_FULL = "１２３４５６７８９"

# 第2章の小見出し（■の付いた節の名前）
LABELS = {
    "目指す姿", "主要指標（最終アウトカム）の基準値と目標値", "協働が期待される主体と役割", "施策の方向",
    "成果指標（初期アウトカム）", "主な取組（アクティビティ）及び活動指標（アウトプット）",
}
# 見出しの一覧の図の節（読まない）
SKIP_LABELS = {"基本施策の体系", "施策展開の体系"}
# この小見出しより下（そのページの終わりまで）は図
DIAGRAM_LABEL_RE = re.compile(r"^【.+(の関係|の流れ)】$")
LIST_HEAD_RE = re.compile(rf"^\s*([・※{CIRCLED}]|\d+\)|R[0-9０-９]+年度の目標値)")


@dataclass
class Line:
    page: int
    x0: float
    x1: float
    top: float
    size: float
    text: str
    right: float = 0.0  # この行のある枠（ページ・セル）の右の端


@dataclass
class Table:
    page: int
    top: float
    rows: list  # [[{text, cs?, rs?}]]
    ncols: int


@dataclass
class Fig:
    page: int
    top: float


@dataclass
class PageItems:
    page: int
    printed: int | None
    items: list = field(default_factory=list)  # Line・Table・Fig（上から順）
    all_text: list = field(default_factory=list)  # ページのすべての行（施策体系表の将来像を拾う）


def nfkc(s: str) -> str:
    """NFKC。丸数字（施策の番号）は「1」にせずに残す。"""
    return "".join(c if c in CIRCLED else unicodedata.normalize("NFKC", c) for c in s)


# ---------------------------------------------------------------- ページを読む

def dotted_lines(page) -> tuple[list[dict], list[dict]]:
    """点線（0.6pt ほどの点の並び）を、縦と横の線にする。表の年度の列や、主な取組の3つの行の区切り。"""
    dots = [r for r in page.rects if r["width"] < 1.2 and r["height"] < 1.2]
    v, h = [], []
    for axis in ("v", "h"):
        groups = defaultdict(list)
        for d in dots:
            groups[round((d["x0"] if axis == "v" else d["top"]) * 2) / 2].append(d)
        for key, ds in groups.items():
            ds.sort(key=lambda d: d["top"] if axis == "v" else d["x0"])
            runs, run = [], [ds[0]]
            for d in ds[1:]:
                gap = d["top"] - run[-1]["bottom"] if axis == "v" else d["x0"] - run[-1]["x1"]
                if gap < 3.5:
                    run.append(d)
                else:
                    runs.append(run)
                    run = [d]
            runs.append(run)
            for run in runs:
                if len(run) < 4:
                    continue
                if axis == "v":
                    v.append({"object_type": "line", "x0": key, "x1": key, "top": run[0]["top"], "bottom": run[-1]["bottom"],
                              "width": 0, "height": run[-1]["bottom"] - run[0]["top"]})
                else:
                    h.append({"object_type": "line", "x0": run[0]["x0"], "x1": run[-1]["x1"], "top": key, "bottom": key,
                              "width": run[-1]["x1"] - run[0]["x0"], "height": 0})
    return v, h


def words_to_lines(words: list[dict], right: float) -> list[Line]:
    """語を行にまとめる（高さの近いものを1行に。語の間が字の半分より空いていれば空白を入れる）。"""
    rows: list[list[dict]] = []
    subs = [w for w in words if is_subscript(w)]
    for w in sorted((w for w in words if not is_subscript(w)), key=lambda w: (round(w["top"]), w["x0"])):
        for row in rows:
            if abs(row[0]["top"] - w["top"]) < max(2.0, w["size"] * 0.3):
                row.append(w)
                break
        else:
            rows.append([w])
    # 下付きの字（「CO2」の「2」）は、高さの重なる行の、横の位置に入れる
    for w in subs:
        cy = (w["top"] + w["bottom"]) / 2
        host = next((row for row in rows if row[0]["top"] - 1 <= cy <= row[0]["top"] + row[0]["size"] + 2), None)
        if host is None:
            rows.append([w])
        else:
            host.append(w)
    out = []
    for row in sorted(rows, key=lambda r: r[0]["top"]):
        row.sort(key=lambda w: w["x0"])
        text = row[0]["text"]
        for a, b in zip(row, row[1:]):
            gap = b["x0"] - a["x1"] > a["size"] * 0.5 and not is_subscript(a) and not is_subscript(b)
            text += (" " if gap else "") + b["text"]
        out.append(Line(0, row[0]["x0"], row[-1]["x1"], min(w["top"] for w in row), max(w["size"] for w in row),
                        fix_strings(uncid(text)), right))
    return out


def is_gothic(w: dict) -> bool:
    # フォント名は Shift_JIS のバイト列の表記（「ＭＳ Ｐゴシック」の「ゴシック」が \x83S\x83V\x83b\x83N）
    return "\\x83S\\x83V" in w["fontname"] or "Gothic" in w["fontname"]


def is_subscript(w: dict) -> bool:
    """下付きの字（「CO2」の「2」。小さな数字1〜2字）。"""
    return w["size"] < 8 and is_gothic(w) and bool(re.fullmatch(r"[0-9０-９]{1,2}", w["text"]))


def is_chart_word(w: dict) -> bool:
    """グラフの中の字（目盛りや数値。本文と違う書体の小さな字か、とても小さな字）。"""
    return (w["size"] < 9.5 and not is_gothic(w)) or (w["size"] < 7 and not is_subscript(w))


def cell_text(lines: list[Line], head: bool) -> str:
    """セルの中の行をつなぐ。右の端まで届いた行は折り返しなのでつなぎ、届かない行の後ろと「・」の前で改行する。見出しのセルはすべてつなぐ。"""
    text = ""
    for i, ln in enumerate(lines):
        t = ln.text.strip()
        if i == 0:
            text = t
            continue
        prev = lines[i - 1]
        full = prev.x1 >= prev.right - prev.size * 1.3
        if head or (full and not t.startswith("・")):
            text = join_text(text, t)
        else:
            text += "\n" + t
    return text


def join_text(a: str, b: str) -> str:
    """折り返した行をつなぐ。英字の単語が行をまたぐときだけ空白を入れる。"""
    if a and b and re.match(r"[A-Za-z]", b[0]) and re.match(r"[A-Za-z]", a[-1]):
        return a + " " + b
    return a + b


def table_cells(bboxes: list[tuple]) -> tuple[int, list[dict]]:
    """表のセル（枠）を、行・列の位置とまたぎ（cs・rs）にする。"""
    def snap(vals: set[float]) -> list[float]:
        # 罫線の位置のわずかなずれ（1〜2pt）で余分な列・行ができないよう、近い位置をまとめる
        out: list[float] = []
        for v in sorted(vals):
            if not out or v - out[-1] > 3:
                out.append(v)
        return out
    xs = snap({c[0] for c in bboxes} | {c[2] for c in bboxes})
    ys = snap({c[1] for c in bboxes} | {c[3] for c in bboxes})

    def near(vals: list[float], v: float) -> int:
        return min(range(len(vals)), key=lambda i: abs(vals[i] - v))
    cells = []
    for c in bboxes:
        c0, r0, c1, r1 = near(xs, c[0]), near(ys, c[1]), near(xs, c[2]), near(ys, c[3])
        if c1 > c0 and r1 > r0:
            cells.append({"r": r0, "c": c0, "cs": c1 - c0, "rs": r1 - r0, "bbox": c})
    cells.sort(key=lambda d: (d["r"], d["c"]))
    return len(xs) - 1, cells


def read_page(page, pno: int) -> PageItems:
    v, h = dotted_lines(page)
    # 柱とページ番号、右の余白の外の字（印字されない所に残った字。「農地農村整備課」など）は読まない
    words = [w for w in page.extract_words(x_tolerance=1.5, y_tolerance=2, extra_attrs=["size", "fontname"])
             if HEADER_BOTTOM < w["top"] < FOOTER_TOP and w["x0"] < page.width - 50]
    # 印字のページ（「- 13 -」「-664-」）
    printed = None
    for w in page.extract_words(x_tolerance=3):
        if w["top"] >= FOOTER_TOP and (m := re.fullmatch(r"[-－]\s*(\d+)\s*[-－]", nfkc(w["text"]))):
            printed = int(m.group(1))
    if printed is None:
        foot = "".join(w["text"] for w in page.extract_words(x_tolerance=3) if w["top"] >= FOOTER_TOP)
        if m := re.fullmatch(r"-(\d+)-", nfkc(foot).replace(" ", "")):
            printed = int(m.group(1))
    pi = PageItems(pno, printed)
    pi.all_text = [fix_strings(uncid(tl["text"])) for tl in page.extract_text_lines()]

    used: set[int] = set()
    # 第1章の「実施計画の構成」の図（実施計画の章と基本計画の章の箱を矢印で結んだもの）は、2列の表にする
    kousei = next((w for w in words if w["text"] == "【実施計画】"), None)
    if kousei:
        used |= {i for i, w in enumerate(words) if w["top"] >= kousei["top"] - 2}
        pi.items.append(kousei_table(pno, [w for w in words if w["top"] >= kousei["top"] - 2]))

    def center_in(w: dict, b) -> bool:
        cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
        return b[0] <= cx <= b[2] and b[1] <= cy <= b[3]

    tables = [t for t in page.find_tables({"explicit_vertical_lines": v, "explicit_horizontal_lines": h})
              if t.bbox[2] - t.bbox[0] > 150 and t.bbox[3] - t.bbox[1] > 12 and not (kousei and t.bbox[1] >= kousei["top"] - 2)]
    for t in tables:
        # 中身のある所より右の空の枠（ページの右の端の灰色の矢印の飾り）は表に入れない
        filled = [c for c in t.cells if any(center_in(w, c) for w in words)]
        right_edge = max((c[2] for c in filled), default=t.bbox[2])
        ncols, cells = table_cells([c for c in t.cells if c[0] < right_edge - 2])
        rows: dict[int, list[dict]] = defaultdict(list)
        flat: list = []  # 表の中の、横いっぱいのセル（枠で囲んだ文章・グラフ）
        for c in cells:
            ws = [w for i, w in enumerate(words) if i not in used and center_in(w, c["bbox"])]
            used |= {i for i, w in enumerate(words) if center_in(w, c["bbox"])}
            if ncols > 1 and c["cs"] == ncols and ws and not nfkc(ws[0]["text"]).startswith("○") and len(cells) > 1:
                flat.append((c, ws))
                continue
            if any(is_chart_word(w) for w in ws):
                pi.items.append(Fig(pno, c["bbox"][1]))
                continue
            right = c["bbox"][2] - 3
            lines = words_to_lines([w for w in ws if not is_chart_word(w)], right)
            rows[c["r"]].append({"r": c["r"], "c": c["c"], "cs": c["cs"], "rs": c["rs"], "lines": lines, "top": c["bbox"][1]})
        if len(cells) == 1:
            # 1つの枠だけ（文章を囲んだ枠）は、表にせず本文の行として読む
            c = cells[0]
            ws = [w for w in words if center_in(w, c["bbox"])]
            pi.items += mark_chart(words_to_lines([w for w in ws if not is_chart_word(w)], c["bbox"][2] - 3), pno, ws)
            continue
        for c, ws in flat:
            if any(is_chart_word(w) for w in ws):
                pi.items.append(Fig(pno, c["bbox"][1]))
                continue
            pi.items += [ln for ln in words_to_lines(ws, c["bbox"][2] - 3)]
        if rows:
            ordered = [rows[r] for r in sorted(rows)]
            pi.items.append(Table(pno, min(c["top"] for r in ordered for c in r), ordered, ncols))
    rest = [w for i, w in enumerate(words) if i not in used]
    chart = [w for w in rest if is_chart_word(w)]
    if chart:
        pi.items.append(Fig(pno, min(w["top"] for w in chart)))
        # グラフの字の範囲の中の字（目盛りの「R元」の「元」や凡例のように、本文と同じ書体のもの）もグラフの字とする
        # 上は軸の題（「育成数（人）」）が目盛りの少し上にあるので、そのぶん広げる
        box = (min(w["x0"] for w in chart), min(w["top"] for w in chart) - 14, max(w["x1"] for w in chart), max(w["bottom"] for w in chart))
        rest = [w for w in rest if not center_in(w, box)]
    body = [w for w in rest if not is_chart_word(w) and nfkc(w["text"]) != "主要指標のグラフ"]
    lines = words_to_lines(body, 0)
    # 本文の右の端。句読点が枠の外にはみ出した行（「、」で終わる行）があるので、いちばん右ではなく、長い行の右の端の中ほどの値にする
    ends = sorted(ln.x1 for ln in lines if len(ln.text) > 15)
    right = ends[len(ends) * 2 // 3] if ends else 0
    for ln in lines:
        ln.right = right
    pi.items += lines
    for it in pi.items:
        it.page = pno
    pi.items.sort(key=lambda it: it.top)
    return pi


def kousei_table(pno: int, words: list[dict]) -> Table:
    """「実施計画の構成」の図を、【実施計画】と【基本計画】の2列の表にする。箱は行の間が空いた所で分ける。"""
    head_top = min(w["top"] for w in words)
    # 左の箱（実施計画の章）と右の箱（基本計画の章）の間の矢印「←」で分ける
    arrows = [w for w in words if w["text"] == "←"]
    split = max(w["x1"] for w in arrows) + 1 if arrows else next(w["x0"] for w in words if w["text"] == "【基本計画】") - 15
    words = [w for w in words if w["text"] != "←"]
    head = [w for w in words if w["top"] < head_top + 4]
    body = [w for w in words if w["top"] >= head_top + 4]

    def boxes(ws: list[dict]) -> list[list[Line]]:
        lines = words_to_lines(ws, max(w["x1"] for w in ws))
        out: list[list[Line]] = []
        for ln in lines:
            if out and ln.top - out[-1][-1].top < ln.size * 2.2:
                out[-1].append(ln)
            else:
                out.append([ln])
        return out
    left, right = boxes([w for w in body if w["x0"] < split]), boxes([w for w in body if w["x0"] >= split])
    rows = [[{"r": 0, "c": i, "cs": 1, "rs": 1, "lines": words_to_lines([w for w in head if (w["x0"] >= split) == bool(i)], 0), "top": head_top}
             for i in (0, 1)]]
    for i, (a, b) in enumerate(zip(left, right)):
        rows.append([{"r": i + 1, "c": 0, "cs": 1, "rs": 1, "lines": a, "top": a[0].top},
                     {"r": i + 1, "c": 1, "cs": 1, "rs": 1, "lines": b, "top": b[0].top}])
    return Table(pno, head_top, rows, 2)


def mark_chart(lines: list[Line], pno: int, ws: list[dict]) -> list:
    if any(is_chart_word(w) for w in ws):
        return [Fig(pno, min(w["top"] for w in ws))] + lines
    return lines


# ---------------------------------------------------------------- 表を整える

def cell_out(c: dict, head: bool = False) -> dict:
    out = {"text": cell_text(c["lines"], head)}
    if c["cs"] > 1:
        out["cs"] = c["cs"]
    if c["rs"] > 1:
        out["rs"] = c["rs"]
    return out


def shape_table(t: Table, prev_table: dict | None, shisaku: str | None, caption: str | None = None) -> dict | None:
    """表の種類を見分けて、出力の形にする。前のページから続く主な取組の表は continued を付ける。"""
    texts = [nfkc(cell_text(c["lines"], True)) for row in t.rows for c in row]
    first = texts[0] if texts else ""
    if any("主な取組" in x for x in texts[:4]) and any("実施主体" in x.replace(" ", "") for x in texts[:6]):
        # 頭の行: 【施策】① の帯・主な取組・実施主体・年度別計画・活動指標・年度
        rows = [r for r in t.rows if not nfkc(cell_text(r[0]["lines"], True)).startswith("【施策】")]
        # 年度の行（「R4」「R5」「R6」。1つのセルに並んでいることもある）
        def tokens(r: list[dict]) -> list[str]:
            return " ".join(nfkc(cell_text(c["lines"], True)) for c in r).split()
        years_row = next((i for i, r in enumerate(rows) if tokens(r) and all(re.fullmatch(r"R\d+", x) for x in tokens(r))), None)
        if years_row is None:
            raise ValueError(f"主な取組の表の年度の行が無い: p.{t.page} {texts[:8]}")
        years = tokens(rows[years_row])
        n = len(years)
        head = [[{"text": "主な取組（アクティビティ）", "rs": 3}, {"text": "実施主体", "rs": 3}, {"text": "年度別計画", "cs": n}],
                [{"text": "活動指標（アウトプット）", "cs": n}],
                [{"text": y} for y in years]]
        return {"table": "torikumi", "head": head, "body": torikumi_body(rows[years_row + 1:], t.ncols), "shisaku": shisaku}
    if first.startswith("全国") or first.startswith("：") or "成果指標名" in first:
        # 成果指標名は表の枠の中（1行目）にあるものと、枠の外に印字されているもの（名前は Builder が前の行から渡す）がある。
        # 枠の下の、1つのセルだけの行（「R９年度の目標値：…」）は、表の後ろの段落にする
        rows = t.rows
        if not first.startswith("全国"):
            caption = cell_text(rows[0][1]["lines"], True) if len(rows[0]) > 1 else ""
            rows = rows[1:]
        body = [r for r in rows[1:] if len(r) > 1]
        after = [ln.text.strip() for r in rows[1:] if len(r) == 1 for ln in r[0]["lines"]]
        return {"table": "seika", "caption": caption or "", "head": [[cell_out(c, True) for c in rows[0]]],
                "body": [[cell_out(c) for c in r] for r in body], "_after": after}
    if first.startswith("主要指標名"):
        return {"table": "shuyou", "head": [[cell_out(c, True) for c in t.rows[0]]], "body": [[cell_out(c) for c in r] for r in t.rows[1:]]}
    if first.startswith("協働主体名"):
        return {"table": "kyodo", "head": [[cell_out(c, True) for c in t.rows[0]]],
                "body": [[{"text": cell_text(r[0]["lines"], True)}, *[cell_out(c) for c in r[1:]]] for r in t.rows[1:]]}
    if prev_table and prev_table["table"] == "torikumi" and t.ncols == max(sum(c.get("cs", 1) for c in r) for r in prev_table["body"]):
        return {"table": "torikumi", "head": [], "body": torikumi_body(t.rows, t.ncols), "continued": True, "shisaku": shisaku}
    if first in ("No.", "No", "【実施計画】"):
        return {"table": "other", "head": [[cell_out(c, True) for c in t.rows[0]]], "body": [[cell_out(c) for c in r] for r in t.rows[1:]]}
    return {"table": "other", "head": [], "body": [[cell_out(c) for c in r] for r in t.rows]}


def torikumi_body(rows: list[list[dict]], ncols: int) -> list[list[dict]]:
    rows = [list(r) for r in rows]
    # 実施主体の列が、取組の3つの行の区切りの線で分かれていることがある（3-(4)-ア-①）。名前の行の高さぶんを1つのセルにまとめる
    for i, r in enumerate(rows):
        if r and r[0]["c"] == 0 and r[0]["rs"] >= 2 and len(r) > 1 and r[1]["c"] == 1 and r[1]["rs"] < r[0]["rs"]:
            actor = dict(r[1], lines=list(r[1]["lines"]), rs=r[0]["rs"])
            for nxt in rows[i + 1:i + r[0]["rs"]]:
                for c in [c for c in nxt if c["c"] == 1]:
                    actor["lines"] += c["lines"]
                    nxt.remove(c)
            r[1] = actor
    out = []
    for r in rows:
        if not r:
            continue
        cells = [cell_out(c) for c in r]
        if len(r) == 1 and r[0]["cs"] == ncols and cells[0]["text"].startswith("○"):
            cells[0]["group"] = True
        elif r[0]["c"] == 0 and r[0]["rs"] >= 2:
            cells[0]["torikumi"] = torikumi_name(cells[0]["text"])
            if len(r) > 1 and r[1]["c"] == 1:
                # 実施主体は狭い列に1行に1つずつ印字されている（長い名前は途中で折り返す）ので、印字の行のまま
                cells[1]["text"] = "\n".join(ln.text.strip() for ln in r[1]["lines"])
        out.append(cells)
    return out


def torikumi_name(text: str) -> str:
    """取組の名前のセル（「名前\n（部局 課）」。後ろに【再掲】が付くこともある）から名前だけを取る。名前のページへのリンクに使う。"""
    return split_section(re.sub(r"\s*【再掲】\s*", "", text).replace("\n", ""))[0]


# ---------------------------------------------------------------- 見出しと段落

def heading_of(text: str) -> tuple[int, str, str] | None:
    """文章の章の見出しなら（段の深さ, 印, 名前）。「①」は前後を見て決めるので、ここでは段の深さ 5 として返す。"""
    t = text.strip()
    if m := re.match(r"^第\s*([１-９1-9])\s*章\s*(.+)$", t):
        return 1, nfkc(m.group(1)), m.group(2).strip()
    if (m := re.match(rf"^([{NUM_FULL}])\s+(.{{2,45}})$", t)) and not re.search(r"[。、]$", t):
        return 2, m.group(1), m.group(2)
    if m := re.match(r"^[（(]\s*([0-9０-９]{1,2})\s*[)）]\s*(.+)$", t):
        return 3, nfkc(m.group(1)), m.group(2)
    if m := re.match(rf"^([{KANA}])\s+(.+)$", t):
        return 4, m.group(1), m.group(2)
    if m := re.match(rf"^([{CIRCLED}])\s*(.+)$", t):
        return 5, m.group(1), m.group(2)
    return None


CODE_RE = re.compile(rf"([1-5])-\((\d+)\)(?:-([{KANA}]))?(?:-([{CIRCLED}]))?")


def plan_heading(text: str) -> tuple[int, str, str] | None:
    """第2章の基本施策・施策展開・施策の札（「基本施策 1-(1) …」「【施策展開】 1-(1)-ア …」「【施策】1-(1)-ア-① …」）なら（段の深さ, 沖縄県PDCA の ID, 名前）。"""
    t = re.sub(r"\s+", " ", nfkc(text)).strip()
    d = r"\s*[-－ー―]\s*"
    m = re.match(rf"^(?:基本施策|【施策展開】|【施策】)\s*([1-5]{d}\(\s*\d+\s*\)(?:{d}[{KANA}])?(?:{d}[{CIRCLED}])?)\s*(.+)$", t)
    if not m or not (cm := CODE_RE.fullmatch(re.sub(r"[-－ー―]", "-", m.group(1).replace(" ", "")))):
        return None
    pid = f"{cm.group(1)}-{cm.group(2)}"
    level = 3
    if cm.group(3):
        pid += "-" + "abcdefghijklmno"[KANA.index(cm.group(3))]
        level = 4
    if cm.group(4):
        pid += f"-{CIRCLED.index(cm.group(4)) + 1}"
        level = 5
    return level, pid, m.group(2).strip()


def is_label_text(t: str) -> bool:
    """小見出しの行（■の付いた節の名前、【…】、（主な取組））。"""
    return t in LABELS or bool(re.fullmatch(r"【[^】]{2,40}】|（[^）]{2,10}）", t))


def mark_token(mark: str) -> str:
    if mark in KANA:
        return "abcdefghijklmno"[KANA.index(mark)]
    if mark in CIRCLED:
        return str(CIRCLED.index(mark) + 1)
    return str(int(nfkc(mark)))


class Builder:
    """ページの行・表・図を、見出し・小見出し・段落・表・図のかたまりに並べる。"""

    def __init__(self) -> None:
        self.out: list[dict] = []
        self.path: dict[int, str] = {}
        self.prev: Line | None = None
        self.skip = False  # 見出しの一覧の図の節を読み飛ばしているあいだ
        self.preamble = False  # 第2章の頭（施策体系表・記載例）
        self.shouraizou: dict[str, str] = {}
        self.chapter = ""
        self.shisaku: str | None = None
        self.diagram_page = 0
        self.caption: str | None = None  # 表の枠の外に印字された成果指標名
        self.kihon_label = False
        self.bar: Line | None = None  # 主な取組の表の上の帯の行

    def emit(self, b: dict, page: int) -> None:
        b["page"] = page
        self.out.append(b)

    def heading(self, level: int, mark: str, title: str, page: int, pdca: str | None = None, hid: str | None = None) -> None:
        self.path = {k: v for k, v in self.path.items() if k < level}
        if hid is None:
            parent = self.path[max(self.path)] if self.path else ""
            hid = (parent + "-" if parent else "") + mark_token(mark)
        self.path[level] = hid
        b = {"kind": "h", "level": level, "id": hid, "mark": mark, "title": title.strip()}
        if pdca:
            b["pdca"] = pdca
        self.emit(b, page)
        self.prev = None
        self.skip = False

    def plan(self, level: int, pid: str, title: str, page: int) -> None:
        """第2章の基本施策・施策展開・施策。将来像が変わったら、将来像の見出しを先に置く。"""
        if self.preamble:
            self.preamble = False
        sz = pid.split("-")[0]
        if level == 3 and self.path.get(2) != f"2-{sz}":
            self.heading(2, f"将来像{sz}", self.shouraizou.get(sz, ""), page, hid=f"2-{sz}")
        mark = pid.split("-", 1)[1] if level == 3 else pid.split("-")[-1]
        mark = {3: f"{sz}－({pid.split('-')[1]})", 4: KANA["abcdefghijklmno".index(mark)] if level == 4 else mark, 5: CIRCLED[int(mark) - 1] if level == 5 else mark}[level]
        self.heading(level, mark, title, page, pdca=pid, hid=f"2-{pid}")
        self.shisaku = pid if level == 5 else None if level < 5 else self.shisaku

    def add(self, it, nxt) -> None:
        if isinstance(it, Fig):
            if not self.skip and not (self.out and self.out[-1]["kind"] == "fig" and self.out[-1]["page"] == it.page):
                self.emit({"kind": "fig"}, it.page)
            self.prev = None
            return
        if isinstance(it, Table):
            # 札（基本施策・施策展開）の表は見出し
            txt = " ".join(cell_text(c["lines"], True) for r in it.rows for c in r)
            if self.kihon_label:
                txt = "基本施策 " + txt
                self.kihon_label = False
            if ph := plan_heading(txt):
                self.plan(*ph, it.page)
                return
            if self.skip or self.preamble:
                return
            pt = self.out[-1] if self.out and self.out[-1]["kind"] == "table" else None
            shaped = shape_table(it, pt, self.shisaku, self.caption)
            self.caption = None
            if shaped:
                after = shaped.pop("_after", [])
                self.emit({"kind": "table", **shaped}, it.page)
                for a in after:
                    self.emit({"kind": "p", "text": a}, it.page)
            self.prev = None
            return
        ln: Line = it
        t = ln.text.strip()
        if not t:
            return
        if self.diagram_page == ln.page:
            return
        if ph := plan_heading(t):
            self.plan(*ph, ln.page)
            self.prev = ln
            return
        if t in SKIP_LABELS:
            self.skip = True
            return
        if t in LABELS:
            self.skip = False
        if self.skip:
            return
        if t == "：" or re.fullmatch(r"【施策】\s*[①-⑳].*", t):
            # 成果指標名の前の「：」と、主な取組の表の上の帯（施策の見出しの繰り返し。2行に折り返したものは次の行も）
            self.bar = ln
            return
        if self.bar is not None and self.bar.page == ln.page and ln.top - self.bar.top < ln.size * 1.8 and len(t) < 15:
            self.bar = None
            return
        self.bar = None
        if t == "成果指標名" and self.caption is None:
            self.caption = ""
            return
        if m := re.fullmatch(r"：?\s*成果指標名\s*：?\s*(.+)|：\s*(.+)", t):
            self.caption = ((self.caption + "\n") if self.caption else "") + (m.group(1) or m.group(2)).strip()
            return
        if self.caption is not None and t != "成果指標名":
            # 成果指標が2つのときの2つ目の名前（「①のうち…」「②…」）
            self.caption = (self.caption + "\n" if self.caption else "") + t
            return
        if t == "成果指標名":
            return
        if t == "基本施策":
            # 札の「基本施策」が枠の外に印字されているもの（5-(5)）。次の枠の番号と名前と合わせて見出しにする
            self.kihon_label = True
            return
        if is_label_text(t):
            if self.preamble:
                return
            self.emit({"kind": "label", "text": t}, ln.page)
            self.prev = ln
            if DIAGRAM_LABEL_RE.match(t):
                self.emit({"kind": "fig"}, ln.page)
                self.diagram_page = ln.page
            return
        if self.skip:
            return
        h = heading_of(t)
        if h and h[0] == 1 and ln.size < 12.3:
            # 章の見出しは大きな字（第1章の「実施計画の構成」の図の中の章の名前は見出しにしない）
            h = None
        if h and h[0] == 1:
            self.chapter = h[1]
            self.preamble = h[1] == "2"
            self.heading(1, h[1], h[2], ln.page)
            return
        if self.preamble:
            # 第2章の頭は、章の説明の文だけを読む（施策体系表と記載例は図）
            if re.match(r"^将来像", t) or not self.out or self.out[-1]["kind"] not in ("h", "p"):
                if not (self.out and self.out[-1]["kind"] == "fig" and self.out[-1]["page"] == ln.page):
                    self.emit({"kind": "fig"}, ln.page)
                return
            if self.out[-1]["kind"] == "fig":
                return
        if h and self.chapter != "2":
            level, mark, title = h
            # 「①」は、次が「・」の箇条か表なら見出し（第3章の「イ 主な取組」の下）、そうでなければ段落の箇条（「ア 概況」の下）
            if level == 5 and not (isinstance(nxt, Table) or (isinstance(nxt, Line) and nxt.text.strip().startswith("・"))):
                h = None
            elif level >= 2:
                self.heading(level, mark, title, ln.page)
                self.prev = ln
                return
        if (self.out and self.out[-1]["kind"] == "h" and self.prev is not None and self.prev.page == ln.page
                and (self.prev.x1 >= self.prev.right - self.prev.size * 1.3 or "pdca" in self.out[-1])
                and ln.top - self.prev.top < ln.size * 1.7):
            # 2行に折り返した見出し
            self.out[-1]["title"] = join_text(self.out[-1]["title"], t)
            self.prev = ln
            return
        prev = self.prev
        # 次の行より右から始まる行は段落の頭（字下げ）。次の行が見出し・小見出し・箇条なら比べない
        nt = nxt.text.strip() if isinstance(nxt, Line) else ""
        indented = bool(isinstance(nxt, Line) and nxt.page == ln.page and ln.x0 > nxt.x0 + 3 and not LIST_HEAD_RE.match(nt)
                        and not heading_of(nt) and not plan_heading(nt) and not is_label_text(nt))
        prev_short = bool(prev and prev.x1 < prev.right - prev.size * 1.3)
        after_prev = bool(prev and prev.page == ln.page and ln.x0 > prev.x0 + 3 and self.out and self.out[-1]["kind"] == "p"
                          and not LIST_HEAD_RE.match(self.out[-1]["text"]))
        if (not self.out or self.out[-1]["kind"] != "p" or prev is None or prev_short or indented or after_prev
                or LIST_HEAD_RE.match(t)):
            self.emit({"kind": "p", "text": t}, ln.page)
        else:
            self.out[-1]["text"] = join_text(self.out[-1]["text"], t)
        self.prev = ln


# ---------------------------------------------------------------- 画像から読んだページ

def add_transcribed(bld: Builder, page: int, blocks: list[dict]) -> None:
    """画像から読んだページのかたまりを足す（data/reference/jisshi_chuki_images.json。形は抽出と同じで、見出しは種類と番号を持つ）。"""
    start = len(bld.out)
    for b in blocks:
        k = b["kind"]
        if k == "h":
            if b["type"] in ("kihon", "tenkai", "shisaku"):
                ph = plan_heading({"kihon": "基本施策", "tenkai": "【施策展開】", "shisaku": "【施策】"}[b["type"]] + " " + b["code"] + " " + b["title"])
                if not ph:
                    raise ValueError(f"画像から読んだ見出しの番号が読めない: {b}")
                bld.plan(*ph, page)
            elif b["type"] == "chapter":
                bld.chapter = nfkc(b["mark"])
                bld.heading(1, nfkc(b["mark"]), b["title"], page)
            else:
                bld.heading(2, b["mark"], b["title"], page)
        elif k == "table":
            pt = bld.out[-1] if bld.out and bld.out[-1]["kind"] == "table" else None
            t = {key: b[key] for key in ("table", "caption", "head", "body", "continued") if key in b}
            if t["table"] == "torikumi":
                t["shisaku"] = bld.shisaku
                for row in t["body"]:
                    c = row[0]
                    if not c.get("group") and c.get("rs", 1) >= 2:
                        c["torikumi"] = torikumi_name(c["text"])
            if t.get("continued") and not pt:
                raise ValueError(f"続きの表の前に表が無い: p.{page}")
            bld.emit({"kind": "table", **t}, page)
        else:
            bld.emit({key: v for key, v in b.items()}, page)
        bld.prev = None
    for b in bld.out[start:]:
        b["transcribed"] = True


# ---------------------------------------------------------------- まとめと確かめ

def merge_continued(blocks: list[dict]) -> list[dict]:
    """ページをまたいだ主な取組の表を1つにする（続きの行を前の表の body に足す）。"""
    out: list[dict] = []
    for b in blocks:
        if b["kind"] == "table" and b.get("continued"):
            prev = next(x for x in reversed(out) if x["kind"] == "table")
            prev["body"] += b["body"]
            prev.setdefault("pages", [prev["page"]]).append(b["page"])
            if b.get("transcribed"):
                prev["transcribed"] = True
            continue
        out.append(b)
    return out


def read_toc(pdf) -> list[tuple[str, int]]:
    """前期の目次の基本施策（ID, 印字のページ）。"""
    out, sz = [], ""
    for pno in TOC_PAGES["zenki"]:
        for tl in pdf.pages[pno - 1].extract_text_lines():
            t = nfkc(tl["text"]).strip()
            if t.startswith("第"):
                sz = ""
            elif m := re.match(r"^([1-5])\s+\S.*目指して$", t):
                sz = m.group(1)
            elif sz and (m := re.match(r"^\((\d+)\).*?[・‥.\s]+(\d+)$", t)):
                out.append((f"{sz}-{m.group(1)}", int(m.group(2))))
    return out


def pdca_names(extracted: Path, years: tuple[int, ...]) -> dict[str, set[str]]:
    """沖縄県PDCA の基本施策・施策展開・施策の ID → 名前（その計画の年度の分）。"""
    names: dict[str, set[str]] = {}
    for k in json.loads((extracted / "soukatsu" / "kihon.json").read_text(encoding="utf-8")):
        if k.get("year", years[0]) in years:
            names.setdefault(k["id"], set()).add(k["name"])
    for s in json.loads((extracted / "soukatsu" / "shisaku.json").read_text(encoding="utf-8")):
        if s.get("year", years[0]) in years:
            names.setdefault(s["id"], set()).add(s["name"])
            names.setdefault(s["tenkai_id"], set()).add(s["tenkai_name"])
    return names


def same_name(plan: str, pdca: str) -> bool:
    """実施計画の見出しと沖縄県PDCA の名前が同じか（総括報告書で途中で切れて印字された名前は、頭が同じならよい）。"""
    a, b = name_key(plan), name_key(pdca)
    return a == b or (len(b) >= 10 and a.startswith(b))


def check(blocks: list[dict], names: dict[str, set[str]], toc: list[tuple[str, int]]) -> list[str]:
    errors = []
    heads = {b["pdca"]: b for b in blocks if b["kind"] == "h" and "pdca" in b}
    for pid, b in heads.items():
        if pid not in names:
            errors.append(f"沖縄県PDCA に無い: {pid} {b['title']}")
        elif not any(same_name(b["title"], n) for n in names[pid]):
            errors.append(f"沖縄県PDCA と名前が違う: {pid} {b['title']} / {' / '.join(sorted(names[pid]))}")
    for pid in names:
        if pid not in heads:
            errors.append(f"実施計画に見出しが無い: {pid} {' / '.join(sorted(names[pid]))}")
    for sid, page in toc:
        b = heads.get(sid)
        if b and b.get("printed") != page:
            errors.append(f"目次とページが違う: {sid} 本文 {b.get('printed')} / 目次 {page}")
    # 施策ごとに、成果指標と主な取組の表がある
    cur, kinds = None, set()
    for b in blocks + [{"kind": "h", "level": 1}]:
        if b["kind"] == "h" and b["level"] <= 5:
            if cur and not {"seika", "torikumi"} <= kinds:
                errors.append(f"施策に成果指標か主な取組の表が無い: {cur} {sorted(kinds)}")
            cur, kinds = (b.get("pdca") if b.get("level") == 5 else None), set()
        elif b["kind"] == "table":
            kinds.add(b["table"])
    # 主な取組の表の行は、3行（または「○」の1行）の組
    for b in blocks:
        if b["kind"] == "table" and b["table"] == "torikumi":
            n = len(b["head"][2]) + 2 if b["head"] else None
            if not b["shisaku"]:
                errors.append(f"主な取組の表が施策の外にある: p.{b['page']}")
            widths = [sum(c.get("cs", 1) for c in r) for r in b["body"]]
            if n and any(w not in (n, n - 2) for w in widths):
                errors.append(f"主な取組の表の列の数が合わない: {b['shisaku']} p.{b['page']} {widths}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--extracted", default="data/extracted")
    ap.add_argument("--reference", default="data/reference")
    ap.add_argument("--plan", choices=sorted(PLANS), action="append")
    args = ap.parse_args()
    raw, extracted, reference = Path(args.raw), Path(args.extracted), Path(args.reference)
    images_path = reference / "jisshi_chuki_images.json"
    images = json.loads(images_path.read_text(encoding="utf-8")) if images_path.exists() else {}
    manifest = load_manifest(raw)

    status = 0
    sources = []
    for plan in args.plan or sorted(PLANS):
        slug, years = PLANS[plan]
        files = sorted(k for k, r in manifest.items() if r.get("source") == slug and r.get("referrers"))
        if not files:
            print(f"警告: {slug} の分冊が無い（先に make fetch）", file=sys.stderr)
            return 1
        bld = Builder()
        toc: list[tuple[str, int]] = []
        for fi, local_path in enumerate(files):
            r = manifest[local_path]
            ref = r["referrers"][0]
            sources.append({"id": local_path, "plan": plan, "file_url": r["file_url"], "link_text": ref["link_text"],
                            "page_url": ref["page_url"], "page_title": ref["page_title"]})
            tr = {p["page"]: p for p in images.get(local_path, [])}
            start = len(bld.out)
            bld.diagram_page = 0
            with pdfplumber.open(raw / local_path) as pdf:
                if fi == 0 and plan in TOC_PAGES:
                    toc = read_toc(pdf)
                pages = [read_page(pdf.pages[i], i + 1) for i in range(FIRST_FROM - 1 if fi == 0 else 0, len(pdf.pages))]
            printed_of: dict[int, int | None] = {}
            for pi in pages:
                if pi.page in tr:
                    add_transcribed(bld, pi.page, tr[pi.page]["blocks"])
                    printed_of[pi.page] = tr[pi.page].get("printed")
                    continue
                printed_of[pi.page] = pi.printed
                if any("記載例" in t for t in pi.all_text):
                    # 第2章の頭の記載例（見本の札や表があるので、読まずに図とする）
                    bld.emit({"kind": "fig"}, pi.page)
                    continue
                if bld.preamble or any(re.match(r"^将来像", nfkc(t).strip()) for t in pi.all_text):
                    for t in pi.all_text:
                        if m := re.match(r"^将来像\s*([1-5])\s*(.+)$", nfkc(t).strip()):
                            bld.shouraizou[m.group(1)] = fix_strings(re.sub(r"^将来像\s*\S\s*", "", t.strip()))
                if not pi.items and bld.preamble:
                    bld.emit({"kind": "fig"}, pi.page)
                for i, it in enumerate(pi.items):
                    bld.add(it, pi.items[i + 1] if i + 1 < len(pi.items) else None)
            for b in bld.out[start:]:
                b["source"] = local_path
                if printed_of.get(b["page"]):
                    b["printed"] = printed_of[b["page"]]
        blocks = merge_continued(bld.out)
        errors = check(blocks, pdca_names(extracted, years), toc)
        kinds = defaultdict(int)
        for b in blocks:
            kinds[b["kind"] if b["kind"] != "table" else "table:" + b["table"]] += 1
        chars = sum(len(b.get("text", "")) + sum(len(c["text"]) for r in b.get("head", []) + b.get("body", []) for c in r) for b in blocks)
        print(f"{plan}: " + " / ".join(f"{k} {v}" for k, v in sorted(kinds.items())) + f"（{chars:,}字）"
              f" / 沖縄県PDCA の ID {sum('pdca' in b for b in blocks)} / 画像から読んだもの {sum(bool(b.get('transcribed')) for b in blocks)}",
              file=sys.stderr)
        for e in errors:
            print(f"  ! {e}", file=sys.stderr)
        if errors:
            status = 1
        write_json(extracted / "jisshi" / f"{plan}.json", blocks)
    write_json(extracted / "jisshi" / "sources.json", sources)
    return status


if __name__ == "__main__":
    sys.exit(main())
