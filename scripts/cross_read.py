#!/usr/bin/env python3
"""総括報告書の成果指標（様式２のⅡ）と主な取組（様式２のⅠ）を、抽出（extract_soukatsu.py。pdfplumber の表抽出）とは
別の読み方（PyMuPDF の表検出 find_tables）で読み直し、data/extracted/soukatsu の値と欄ごとに比べる。

2つの読み方は、PDF の表の線から行と列を決める実装が別々なので、片方だけの読み違い（列のずれ・行の取り違え・
欄の取りこぼし・2行目以降の読み落とし）を見つけられる。どちらも PDF の文字の層を読むので、文字の層そのものが
印字と違うもの（字の対応づけの誤り）は見つけられない（そこはページを画像にして確かめる）。

比べる欄（文字は空白・改行を除いて比べる。抽出は表のセルの空白と改行を詰めている）
  成果指標: 施策ごとの数・name・unit・base_raw（基準値を部局票で補ったものは印字の base_fix.printed）・
           actual_series の raw と ref_year・plan_raw・target_raw・rate_raw・judgement
  主な取組: 取組の番号（年度・施策・番号で突き合わせる）・name・budget_raw・target・actual・status_raw・lines
           （目標・実績が2行以上ある取組は、空でない値を改行でつないだものが target / actual、各行が lines）

使い方（tools コンテナで。data/raw と data/interim の PDF を読む。make cross-read）:
  python scripts/cross_read.py                  # 全年度
  python scripts/cross_read.py --year 2025      # 年度を絞る（くり返し指定できる）
  python scripts/cross_read.py --json tmp/cross_read.json   # 食い違いを JSON にも書く

食い違いが1件でもあれば終了コード1。読み直し側の既知の癖で、抽出が正しいことを画像で確かめたもの（KNOWN）は
「既知」として数だけ出す。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
CID_RE = re.compile(r"\(cid:\d+\)")
YEAR_ROW_RE = re.compile(r"^R\d+年度$")

# 読み直し（PyMuPDF）の既知の癖で、抽出（pdfplumber）の値が印字どおりだとページの画像で確かめたもの。
# （ファイル, ページ, 欄）→ 理由。欄の名前は食い違いの表示と同じ（actual_series[2].ref_year など）
KNOWN: dict[tuple[str, int, str], str] = {
    ("soukatsu/2024-r06/r6_syouraizou2.zip!(HP)R6_将来像２.pdf", 164, "actual_series[2].ref_year"):
        "R6 2-(5)-ウ-② 民生委員の充足率。欄からはみ出した「（仮）R7.4.1時点」の「.」を PyMuPDF が落とす"
        "（抽出の「（仮）R7.4.1時点」が印字どおり。2026-10-11 画像で確認）",
}


# ---------------------------------------------------------------- 文字の扱い


def ws(s: str | None) -> str:
    """比べるための形: 空白・改行と「(cid:N)」を除く。"""
    return re.sub(r"\s+", "", CID_RE.sub("", s or ""))


def shisaku_id_of(code: str | None) -> str | None:
    """「１－（１）－ア－①」のような施策コードを施策 ID（1-1-a-1）にする。"""
    t = unicodedata.normalize("NFKC", code or "")
    t = re.sub(r"[‐－―−–—]", "-", t)
    t = re.sub(r"\s", "", t)
    m = re.match(r"^(\d)-\((\d+)\)-([ア-ン])-(\d+)", t)
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}-{chr(ord('a') + KANA.index(m.group(3)))}-{m.group(4)}"


def split_name(s: str) -> tuple[str, str]:
    """「取組名(所管部課)」を名前と所管部課に分ける。末尾の括弧の組を、入れ子を数えながら後ろから探す。"""
    if not s or s[-1] not in ")）":
        return s, ""
    depth = 0
    for i in range(len(s) - 1, -1, -1):
        if s[i] in ")）":
            depth += 1
        elif s[i] in "(（":
            depth -= 1
            if depth == 0:
                return s[:i], s[i + 1:-1]
    return s, ""


def joined(values: list[str]) -> str:
    """目標・実績が2行以上あるときの target / actual: 空でない値を改行でつなぐ。"""
    return "\n".join(v for v in values if v)


# ---------------------------------------------------------------- PDF の読み直し（PyMuPDF）


def source_path(source_id: str, raw: Path, interim: Path) -> Path:
    """出典 ID から PDF の場所。zip の中のものは「<zip>!<中のファイル名>」で、展開先は data/interim。"""
    if "!" in source_id:
        z, member = source_id.split("!", 1)
        return interim / z[:-4] / member
    return raw / source_id


def is_form2(text: str) -> bool:
    """様式２（施策）のページか。施策総括表（取組数と順調の割合が並ぶ）は除く。"""
    if "順調の割合" in text and "主な取組数" in text:
        return False
    return "様式２（施策）" in text or "成果指標名" in text or "活動指標" in text


def parse_seika_group(rows: list[list], h: int) -> dict | None:
    """成果指標の表の h 行目（「成果指標名」の見出し）から6行で1組を読む。列は見出しの文字で決める。"""
    hdr = [ws(x) for x in rows[h]]
    col: dict[str, int] = {}
    for j, k in enumerate(hdr):
        if k and k not in col:
            col[k] = j
    c_unit, c_base, c_act = col.get("単位"), col.get("基準値"), col.get("実績値")
    c_tgt = next((j for j, k in enumerate(hdr) if k.startswith("目標値")), None)
    c_rate, c_judge = col.get("達成率"), col.get("達成状況")
    if c_base is None or c_act is None or c_tgt is None:
        return None

    def cell(r: int, c: int | None) -> str:
        if c is None or r >= len(rows) or c >= len(rows[r]):
            return ""
        return ws(rows[r][c])

    name_end = c_unit if c_unit is not None else c_base
    return {
        "name": "".join(cell(h + 2, j) for j in range(name_end)),
        "unit": cell(h + 2, c_unit),
        "base_raw": cell(h + 2, c_base),
        "actual_series": [{"year": cell(h + 1, c_act + j), "raw": cell(h + 2, c_act + j),
                           "ref_year": cell(h + 3, c_act + j)} for j in range(3)],
        "plan_label": cell(h + 4, c_act),
        "plan_raw": [cell(h + 5, c_act + j) for j in range(3)],
        "target_raw": cell(h + 2, c_tgt),
        "rate_raw": cell(h + 2, c_rate),
        "judgement": cell(h + 2, c_judge),
    }


def read_pdf(job: tuple[int, str, str]) -> tuple[list[dict], list[dict], list[str]]:
    """1本の PDF の様式２のページを読み、成果指標と主な取組の行を返す。ページをまたいで施策を引き継ぐ。"""
    import pymupdf  # コンテナの中だけで使う（テストで比べ方の関数だけを読み込めるように）
    import pymupdf4llm

    # PyMuPDF 2 の find_tables は、既定で pymupdf_layout（ONNX のモデル）が表と見た範囲の表だけを返す。
    # 読み直しは表の線から行と列を決める読み方で比べるので切る（モデルは CPU も多く使う）
    pymupdf4llm.use_layout(False)
    year, source_id, path = job
    seika, torikumi, notes = [], [], []
    shisaku, group, cur, mode = None, None, None, None
    doc = pymupdf.open(path)
    for pno, page in enumerate(doc, 1):
        if not is_form2(page.get_text()):
            continue
        for t in sorted(page.find_tables().tables, key=lambda t: (t.bbox[1], t.bbox[0])):
            rows = t.extract()
            if not rows or not rows[0]:
                continue
            c0 = [ws(r[0]) if r else "" for r in rows]
            if c0[0] == "施策展開":
                code = next((r[1] for r in rows if r and ws(r[0]) == "施策" and len(r) > 1), "")
                shisaku = shisaku_id_of(code)
                if not shisaku:
                    notes.append(f"施策コードを読めない {source_id} p{pno}: {code!r}")
                group, cur, mode = None, None, "torikumi"
                continue
            if "成果指標名" in c0 or "担当部課名" in c0 or "達成状況の説明" in c0:
                mode, cur = "seika", None
                for h, c in enumerate(c0):
                    if c != "成果指標名":
                        continue
                    g = parse_seika_group(rows, h)
                    if g is None:
                        notes.append(f"成果指標の見出しを読めない {source_id} p{pno}")
                        continue
                    if h + 5 >= len(rows) or g["plan_label"] != "計画値":
                        notes.append(f"成果指標の表の形がいつもと違う（6行で1組になっていない） {source_id} p{pno}")
                    seika.append({"year": year, "source": source_id, "page": pno, "shisaku_id": shisaku, **g})
                continue
            if mode != "torikumi" or len(rows[0]) != 7:
                continue
            # 主な取組の表（7列）: 取組の行（番号・取組名(所管部課)・決算見込額・活動指標・…・活動概要）と、
            # その下の目標・実績・進捗状況の行（2行以上のこともある）。ページをまたいで続く
            for r in rows:
                c = [ws(x) if x is not None else None for x in r]
                if c[0] and (YEAR_ROW_RE.match(c[0]) or c[0].startswith("主な取組")):
                    continue
                if c[3] == "目標" and c[4] == "実績":
                    continue
                if c[0] and c[0].startswith("○"):
                    group, cur = c[0][1:], None
                    continue
                if c[0] and (m := re.match(r"^(\d+)(.*)$", c[0])):
                    name, _section = split_name(m.group(2) + (c[1] or ""))
                    cur = {"year": year, "source": source_id, "page": pno, "shisaku_id": shisaku,
                           "no": int(m.group(1)), "name": name, "budget_raw": c[2] or "", "group": group, "lines": []}
                    torikumi.append(cur)
                    continue
                if not c[0] and cur is not None and any(c[3:6]):
                    cur["lines"].append({"target": c[3] or "", "actual": c[4] or "", "status": c[5] or ""})
    return seika, torikumi, notes


def read_all(sources: list[dict], raw: Path, interim: Path, years: set[int] | None,
             workers: int | None = None) -> tuple[list[dict], list[dict], list[str]]:
    jobs = [(s["year"], s["id"], str(source_path(s["id"], raw, interim)))
            for s in sources if s.get("kind") == "body" and (not years or s["year"] in years)]
    missing = [j[2] for j in jobs if not Path(j[2]).exists()]
    if missing:
        raise FileNotFoundError("PDF が無い（make fetch と expand_zips.py を先に。worktree では main の data/raw を使う）: "
                                + ", ".join(missing[:3]) + (f" ほか {len(missing) - 3} 本" if len(missing) > 3 else ""))
    seika, torikumi, notes = [], [], []
    with ProcessPoolExecutor(max_workers=workers or os.cpu_count()) as ex:
        for s, t, n in ex.map(read_pdf, jobs):
            seika += s
            torikumi += t
            notes += n
    return seika, torikumi, notes


# ---------------------------------------------------------------- 比べ方


def diff(year: int, shisaku_id: str, item: str, field: str, extracted, reread, source: str, page: int | None) -> dict:
    return {"year": year, "shisaku_id": shisaku_id, "item": item, "field": field,
            "extracted": extracted, "reread": reread, "source": source, "page": page}


def compare_seika(extracted: list[dict], reread: list[dict]) -> list[dict]:
    """成果指標を、年度・施策ごとに並び順で突き合わせる。施策ごとの数が違えばその施策は数の食い違いだけ出す。"""
    out = []
    E, R = defaultdict(list), defaultdict(list)
    for s in extracted:
        E[(s["year"], s["shisaku_id"])].append(s)
    for s in reread:
        R[(s["year"], s["shisaku_id"])].append(s)
    for key in sorted(set(E) | set(R), key=lambda k: (k[0], str(k[1]))):
        es, rs = E.get(key, []), R.get(key, [])
        if len(es) != len(rs):
            ref = (es or rs)[0]
            out.append(diff(*key, "", "成果指標の数", len(es), len(rs), ref["source"], ref["page"]))
            continue
        for e, r in zip(es, rs):
            def cmp(field: str, a, b) -> None:
                if ws(a) != ws(b):
                    out.append(diff(*key, e["name"], field, a, b, e["source"], r["page"]))
            if e["page"] != r["page"] or e["source"] != r["source"]:
                out.append(diff(*key, e["name"], "出典", f"{e['source']} p{e['page']}",
                                f"{r['source']} p{r['page']}", e["source"], e["page"]))
            cmp("name", e["name"], r["name"])
            cmp("unit", e["unit"], r["unit"])
            cmp("base_raw", (e.get("base_fix") or {}).get("printed", e["base_raw"]), r["base_raw"])
            es_, rs_ = e.get("actual_series") or [], r["actual_series"]
            for j in range(max(len(es_), len(rs_))):
                a = es_[j] if j < len(es_) else {}
                b = rs_[j] if j < len(rs_) else {}
                cmp(f"actual_series[{j}].raw", a.get("raw"), b.get("raw"))
                cmp(f"actual_series[{j}].ref_year", a.get("ref_year"), b.get("ref_year"))
            ep, rp = e.get("plan_raw") or [], r["plan_raw"]
            for j in range(max(len(ep), len(rp))):
                cmp(f"plan_raw[{j}]", ep[j] if j < len(ep) else None, rp[j] if j < len(rp) else None)
            cmp("target_raw", e["target_raw"], r["target_raw"])
            cmp("rate_raw", e["rate_raw"], r["rate_raw"])
            cmp("judgement", e["judgement"], r["judgement"])
    return out


def expected_torikumi(lines: list[dict]) -> dict:
    """読み直した目標・実績・進捗状況の行から、抽出に入っているはずの target・actual・status_raw・lines。
    1行なら lines は無い（None）。2行以上なら target / actual は空でない値を改行でつないだもの。"""
    if not lines:
        return {"target": "", "actual": "", "status_raw": "", "lines": None}
    if len(lines) == 1:
        return {"target": lines[0]["target"], "actual": lines[0]["actual"], "status_raw": lines[0]["status"], "lines": None}
    return {"target": joined([x["target"] for x in lines]), "actual": joined([x["actual"] for x in lines]),
            "status_raw": lines[0]["status"], "lines": [{"target": x["target"], "actual": x["actual"]} for x in lines]}


def lines_key(lines: list[dict] | None) -> list[tuple[str, str]]:
    """lines を比べる形に（目標・実績とも空の行は除く）。"""
    return [(ws(x.get("target")), ws(x.get("actual"))) for x in (lines or []) if ws(x.get("target")) or ws(x.get("actual"))]


def compare_torikumi(extracted: list[dict], reread: list[dict]) -> list[dict]:
    """主な取組を、年度・施策・番号で突き合わせる。"""
    out = []
    E = {(t["year"], t["shisaku_id"], t["no"]): t for t in extracted}
    R: dict[tuple, dict] = {}
    for t in reread:
        k = (t["year"], t["shisaku_id"], t["no"])
        if k in R:
            out.append(diff(k[0], k[1], f"{k[2]}", "取組の番号が重なる（読み直し）", "", t["name"], t["source"], t["page"]))
        R[k] = t
    for k in sorted(set(E) | set(R), key=lambda k: (k[0], str(k[1]), k[2])):
        e, r = E.get(k), R.get(k)
        item = f"{k[2]} {(e or r)['name']}"
        if e is None or r is None:
            ref = e or r
            out.append(diff(k[0], k[1], item, "取組", "あり" if e else "なし", "あり" if r else "なし",
                            ref["source"], ref["page"]))
            continue

        def cmp(field: str, a, b) -> None:
            if ws(a) != ws(b):
                out.append(diff(k[0], k[1], item, field, a, b, e["source"], r["page"]))
        if e["source"] != r["source"]:
            cmp("出典", e["source"], r["source"])
        cmp("name", e["name"], r["name"])
        cmp("budget_raw", e["budget_raw"], r["budget_raw"])
        exp = expected_torikumi(r["lines"])
        if exp["lines"] is not None and "lines" not in e:
            # 目標・実績の2行目以降を抽出が持っていない（target / actual も1行目だけになる）
            out.append(diff(k[0], k[1], item, "lines", None, exp["lines"], e["source"], r["page"]))
        else:
            cmp("target", e.get("target"), exp["target"])
            cmp("actual", e.get("actual"), exp["actual"])
            if lines_key(e.get("lines")) != lines_key(exp["lines"]):
                out.append(diff(k[0], k[1], item, "lines", e.get("lines"), exp["lines"], e["source"], r["page"]))
        cmp("status_raw", e.get("status_raw"), exp["status_raw"])
    return out


def split_known(diffs: list[dict], known: dict[tuple[str, int, str], str]) -> tuple[list[dict], list[dict]]:
    """食い違いを、既知の癖（ファイル・ページ・欄が KNOWN にあるもの）とそれ以外に分ける。"""
    rest, hit = [], []
    for d in diffs:
        (hit if (d["source"], d["page"], d["field"]) in known else rest).append(d)
    return rest, hit


def format_diff(d: dict) -> str:
    def show(v) -> str:
        if v is None:
            return "（なし）"
        if isinstance(v, (list, dict)):
            return json.dumps(v, ensure_ascii=False)
        return "「" + str(v).replace("\n", "⏎") + "」"
    page = f" p{d['page']}" if d["page"] else ""
    return (f"  R{d['year'] - 2018} {d['shisaku_id']} {d['item'][:40]} | {d['field']}: 抽出{show(d['extracted'])}"
            f" 読み直し{show(d['reread'])} | {d['source']}{page}")


# ---------------------------------------------------------------- 実行


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--interim", default="data/interim")
    ap.add_argument("--extracted", default="data/extracted/soukatsu")
    ap.add_argument("--year", type=int, action="append", help="対象年度（西暦）。省略時は全年度")
    ap.add_argument("--json", help="食い違い（既知を含む）を JSON に書き出す先")
    ap.add_argument("--workers", type=int, help="同時に読む PDF の数（省略時は CPU の数）")
    args = ap.parse_args()

    started = time.time()
    d = Path(args.extracted)
    load = lambda name: json.loads((d / f"{name}.json").read_text(encoding="utf-8"))
    sources, seika, torikumi = load("sources"), load("seika"), load("torikumi")
    years = set(args.year or [])
    if years:
        seika = [s for s in seika if s["year"] in years]
        torikumi = [t for t in torikumi if t["year"] in years]

    try:
        r_seika, r_torikumi, notes = read_all(sources, Path(args.raw), Path(args.interim), years, args.workers)
    except FileNotFoundError as e:
        print(f"NG {e}", file=sys.stderr)
        return 2
    diffs_s = compare_seika(seika, r_seika)
    diffs_t = compare_torikumi(torikumi, r_torikumi)
    rest, known = split_known(diffs_s + diffs_t, KNOWN)

    for n in notes:
        print(f"注意: {n}")
    print(f"== 成果指標: 抽出 {len(seika)} 行・読み直し {len(r_seika)} 行")
    print(f"== 主な取組: 抽出 {len(torikumi)} 件・読み直し {len(r_torikumi)} 件")
    if rest:
        by_field = Counter(x["field"] for x in rest)
        print(f"NG 食い違い {len(rest)} 件（{', '.join(f'{k} {v}' for k, v in by_field.most_common())}）")
        for x in rest:
            print(format_diff(x))
    else:
        print("OK 食い違いなし")
    if known:
        print(f"既知 {len(known)} 件（読み直し側の癖。抽出が印字どおりと確かめたもの。scripts/cross_read.py の KNOWN）")
    unused = set(KNOWN) - {(x["source"], x["page"], x["field"]) for x in known}
    if unused and not years:
        print(f"注意: 当たらなかった既知の例外 {len(unused)} 件（抽出か読み直しが変わった。KNOWN を見直す）")
        for u in sorted(unused):
            print(f"  {u[0]} p{u[1]} {u[2]}")
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps({"diffs": rest, "known": known}, ensure_ascii=False, indent=1),
                                   encoding="utf-8")
    print(f"（{time.time() - started:.0f}秒）")
    return 1 if rest else 0


if __name__ == "__main__":
    sys.exit(main())
