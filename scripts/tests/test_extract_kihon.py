"""基本計画の本文の読み取り（extract_kihon.py）。PDF は読まず、行を作って確かめる。"""
import unittest

import extract_kihon as k
from extract_kihon import Line

# 本文の右の端（この PDF の明朝の行はほぼ 524 で終わる）
R = 524.4


def body(x0, text, x1=R, page=40, top=0.0):
    return Line(page, x0, x1, top, 12.0, False, text)


def head(x0, text, size=12.0, page=40, top=0.0):
    return Line(page, x0, x0 + 200, top, size, True, text)


def numbered(lines):
    """行の上からの位置を、並べた順に振る。"""
    for i, ln in enumerate(lines):
        ln.top = 70.0 + 21 * i
    return lines


class HeadingTest(unittest.TestCase):
    def test_heading_of(self):
        self.assertEqual(k.heading_of(head(228, "第４章 基本施策", 17)), (1, "４", "基本施策"))
        self.assertEqual(k.heading_of(head(237, "第１章 総 説", 17)), (1, "１", "総説"))
        self.assertEqual(k.heading_of(head(70, "１ 沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して", 14)),
                         (2, "１", "沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して"))
        self.assertEqual(k.heading_of(head(82, "⑴ 世界に誇れる島しょ型環境モデル地域の形成"))[:2], (3, "⑴"))
        self.assertEqual(k.heading_of(head(95, "ア 脱炭素島しょ社会の実現に向けたエネルギー施策の推進"))[:2], (4, "ア"))
        self.assertEqual(k.heading_of(head(107, "① 再生可能エネルギー等のクリーンなエネルギーの導入促進"))[:2], (5, "①"))

    def test_not_heading(self):
        """明朝の行の頭の「ア」「①」・14pt でない「１」は見出しにしない。"""
        self.assertIsNone(k.heading_of(body(95, "① 性の多様性（LGBT*等）、障がいの有無、国籍など")))
        self.assertIsNone(k.heading_of(body(95, "アジア・太平洋地域の島しょ国等への国際貢献")))
        self.assertIsNone(k.heading_of(head(70, "１ 小さな見出し", 12)))

    def test_label_and_skip(self):
        self.assertTrue(k.is_label(head(101, "（People 人間）")))
        self.assertTrue(k.is_label(head(76, "【主な特性と課題】")))
        self.assertFalse(k.is_label(body(101, "（People 人間）")))
        self.assertTrue(k.is_skip(head(70, "基本施策 １")))
        self.assertTrue(k.is_skip(body(70, "基本施策５")))

    def test_mark_token(self):
        self.assertEqual([k.mark_token(m) for m in "ア イ ウ １ ⑿ ⑳".split()], ["a", "b", "c", "1", "12", "20"])

    def test_join_text(self):
        self.assertEqual(k.join_text("「PPA（Power", "Purchase Agreement）モデル」"), "「PPA（Power Purchase Agreement）モデル」")
        self.assertEqual(k.join_text("再生可能エネルギ", "ー及び二酸化炭素"), "再生可能エネルギー及び二酸化炭素")
        self.assertEqual(k.join_text("令和２年の75.2万人から令和13", "年度には"), "令和２年の75.2万人から令和13年度には")

    def test_same_name(self):
        """総括報告書で途中で切れて印字された名前も、頭が同じなら同じ施策。"""
        self.assertTrue(k.same_name("ICTによる新たな観光体験の創出促進及び観光施設等における利便性向上",
                                    "ICTによる新たな観光体験の創出促進及び観光施設等における"))
        self.assertTrue(k.same_name("３Ｒの推進と環境負荷の低減化", "３Ｒの推進と環境負荷の低減化"))
        self.assertFalse(k.same_name("土壌汚染対策の推進", "土壌汚染"))


class BuildTest(unittest.TestCase):
    def test_paragraphs(self):
        """段落の頭は字下げか、前の行が右の端まで届かずに終わっていること。見出しの id は印の並び。"""
        lines = numbered([
            head(228, "第４章 基本施策", 17),
            head(70, "１ 沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して", 14),
            head(82, "⑴ 世界に誇れる島しょ型環境モデル地域の形成"),
            body(107, "世界に誇れる島しょ型環境モデル構築に向けては、「社会的共通資本」の理"),
            body(95, "念を土台にすることができます。"),
            body(107, "本基本施策の展開においては、人間活動と自然環境が調和する持続可能な脱"),
            body(95, "炭素社会の構築に向けて取り組みます。いっぱいまで届いて終わる行。"),
            body(107, "次の段落。"),
            head(95, "ア 脱炭素島しょ社会の実現に向けたエネルギー施策の推進"),
        ])
        lines[4].x1 = 300
        out = k.build(lines, {})
        self.assertEqual([b["kind"] for b in out], ["h", "h", "h", "p", "p", "p", "h"])
        self.assertEqual([b["id"] for b in out if b["kind"] == "h"], ["4", "4-1", "4-1-1", "4-1-1-a"])
        self.assertEqual(out[3]["text"], "世界に誇れる島しょ型環境モデル構築に向けては、「社会的共通資本」の理念を土台にすることができます。")
        self.assertTrue(out[4]["text"].endswith("いっぱいまで届いて終わる行。"))
        self.assertEqual(out[5]["text"], "次の段落。")

    def test_hanging_list(self):
        """箇条の2行目以降（印の後ろにそろえて右から始まる）は、次の行が箇条の頭でも前の箇条に付ける。"""
        lines = numbered([
            head(101, "（People 人間）"),
            body(113, "① 性の多様性（LGBT*等）、障がいの有無、国籍など、互いの違いを認", x1=518),
            body(125, "め合い、一人ひとりが大切にされ、あらゆる場所で活躍できる社会の実", x1=518),
            body(125, "現（多様性の尊重、個人の尊厳）", x1=308),
            body(113, "② 医療・福祉の充実、健康長寿と生きがい、子どもを貧困から守る子育", x1=518),
            body(125, "てしやすい暮らし（右の端の近くまで届いて終わる行のつもり）", x1=516),
            body(113, "③ 地域への誇り", x1=247),
        ])
        out = k.build(lines, {})
        self.assertEqual([b["kind"] for b in out], ["label", "p", "p", "p"])
        self.assertTrue(out[1]["text"].endswith("（多様性の尊重、個人の尊厳）"))
        self.assertTrue(out[2]["text"].startswith("② ") and "てしやすい暮らし" in out[2]["text"])
        self.assertEqual(out[3]["text"], "③ 地域への誇り")

    def test_wrapped_heading_and_figure(self):
        """2行に折り返した見出しはつなぐ。図はページの中の位置に置く。"""
        lines = [head(82, "⑿ 持続可能な発展と県民生活を支える社会基盤の高度化及び", top=100),
                 head(95, "ネットワークの形成", top=121),
                 body(107, "本文。", x1=200, top=142)]
        out = k.build(lines, {40: [130.0]})
        self.assertEqual(out[0]["title"], "持続可能な発展と県民生活を支える社会基盤の高度化及びネットワークの形成")
        self.assertEqual([b["kind"] for b in out], ["h", "fig", "p"])


class MergeSmallTest(unittest.TestCase):
    def tl(self, text, x0, top, size=12.0, chars=None):
        chars = chars or [{"x0": x0 + 12 * i, "size": size} for i, c in enumerate(text) if not c.isspace()]
        for c in chars:
            c["size"] = size
        return {"text": text, "x0": x0, "top": top, "bottom": top + size, "chars": chars}

    def test_subscript_and_ruby(self):
        """下付きの字は高さの重なる行のその位置に入れ、ふりがなは読まない。"""
        host = self.tl("「沖縄県CO 吸収量認証制度」", 119, 532.6)
        sub = self.tl("2", 190, 538.2, 6.0, [{"x0": 190}])  # 「O」（7字目）のすぐ後ろ
        ruby = self.tl("きこえおおきみ", 193, 569.8, 6.0)
        out = k.merge_small([host, sub, ruby])
        self.assertEqual([t["text"] for t in out], ["「沖縄県CO2 吸収量認証制度」"])


class TocTest(unittest.TestCase):
    def test_check_toc(self):
        blocks = [{"kind": "h", "level": 1, "title": "総説", "page": 9},
                  {"kind": "h", "level": 2, "title": "計画策定の意義", "page": 9},
                  {"kind": "p", "text": "本文", "page": 9},
                  {"kind": "h", "level": 4, "title": "目次に無い段", "page": 9}]
        toc = [(1, "総 説", 0), (2, "計画策定の意義", 1)]
        self.assertEqual(k.check_toc(blocks, toc, offset=8), [])
        self.assertEqual(len(k.check_toc(blocks, [(1, "総説", 0), (2, "計画策定の意義", 2)], offset=8)), 1)


if __name__ == "__main__":
    unittest.main()
