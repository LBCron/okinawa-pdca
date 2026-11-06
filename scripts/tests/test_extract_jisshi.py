"""実施計画の本文の読み取り（extract_jisshi.py）。PDF は読まず、行やセルを作って確かめる。"""
import unittest

import extract_jisshi as j
from extract_jisshi import Builder, Line, Table

# 本文の右の端
R = 536.0


def line(x0, text, x1=R, page=10, top=0.0, size=10.6, right=R):
    return Line(page, x0, x1, top, size, text, right)


def numbered(lines):
    """行の上からの位置を、並べた順に振る。"""
    for i, ln in enumerate(lines):
        ln.top = 100.0 + 12 * i
    return lines


def build(items):
    b = Builder()
    b.chapter = "2"
    for i, it in enumerate(items):
        b.add(it, items[i + 1] if i + 1 < len(items) else None)
    return b.out


class HeadingTest(unittest.TestCase):
    def test_plan_heading(self):
        """札の番号（全角・半角・空白・長音のような横棒が混じる）から、沖縄県PDCA の ID と段の深さを取る。名前の長音は変えない。"""
        self.assertEqual(j.plan_heading("基本施策 １－（１） 世界に誇れる島しょ型環境モデル地域の形成"), (3, "1-1", "世界に誇れる島しょ型環境モデル地域の形成"))
        self.assertEqual(j.plan_heading("【施策展開】 1－(1)－ア 脱炭素島しょ社会の実現に向けたエネルギー施策の推進"),
                         (4, "1-1-a", "脱炭素島しょ社会の実現に向けたエネルギー施策の推進"))
        self.assertEqual(j.plan_heading("【施策】３－（１）－ア－② 人材投資による生産性の向上"), (5, "3-1-a-2", "人材投資による生産性の向上"))
        self.assertEqual(j.plan_heading("【施策】4ー(12)ーイー⑩ ブルーエコノミーの先導的な展開"), (5, "4-12-b-10", "ブルーエコノミーの先導的な展開"))
        # 主な取組の表の上の帯（番号が丸数字だけ）と、ふつうの文は札ではない
        self.assertIsNone(j.plan_heading("【施策】① 再生可能エネルギー等のクリーンなエネルギーの導入促進"))
        self.assertIsNone(j.plan_heading("基本施策の体系"))

    def test_nfkc_keeps_circled(self):
        self.assertEqual(j.nfkc("１－（１）－ア－①"), "1-(1)-ア-①")

    def test_heading_of(self):
        self.assertEqual(j.heading_of("第３章 克服すべき沖縄の固有課題の解決に向けた取組"), (1, "3", "克服すべき沖縄の固有課題の解決に向けた取組"))
        self.assertEqual(j.heading_of("１ 実施計画策定の趣旨"), (2, "１", "実施計画策定の趣旨"))
        self.assertEqual(j.heading_of("（１２） 持続可能な発展")[:2], (3, "12"))
        self.assertEqual(j.heading_of("ア 概況")[:2], (4, "ア"))
        self.assertIsNone(j.heading_of("２０３０年を目途とする基本構想である"))

    def test_label_text(self):
        self.assertTrue(j.is_label_text("施策の方向"))
        self.assertTrue(j.is_label_text("【指標設定の考え方】"))
        self.assertTrue(j.is_label_text("（主な取組）"))
        self.assertFalse(j.is_label_text("（以下、「ビジョン」）で描いた県民が望む５つの将来像の実現を図るため、"))


class CellTest(unittest.TestCase):
    def test_cell_text(self):
        """右の端まで届いた行は折り返しなのでつなぎ、届かない行の後ろと「・」の前で改行する。"""
        right = 300.0
        lines = [line(240, "567資材（継続567資", 298, right=right), line(240, "材）", 260, right=right)]
        self.assertEqual(j.cell_text(lines, False), "567資材（継続567資材）")
        lines = [line(240, "226.33トン", 270, right=right), line(240, "（45,492.54トン）", 290, right=right)]
        self.assertEqual(j.cell_text(lines, False), "226.33トン\n（45,492.54トン）")
        lines = [line(226, "・省エネ家電の導入や節電・節水等の省エネ行動の実", 298, right=right), line(226, "践", 236, right=right),
                 line(226, "・浄化槽の適正管理", 290, right=right)]
        self.assertEqual(j.cell_text(lines, False), "・省エネ家電の導入や節電・節水等の省エネ行動の実践\n・浄化槽の適正管理")
        # 見出しのセルはすべてつなぐ
        self.assertEqual(j.cell_text([line(260, "R６年度", 280, right=right), line(260, "目標値", 280, right=right)], True), "R６年度目標値")

    def test_torikumi_name(self):
        self.assertEqual(j.torikumi_name("沖縄県クリーンエネルギー・イニシアティブの推進\n（商工労働部 産業政策課）"),
                         "沖縄県クリーンエネルギー・イニシアティブの推進")
        self.assertEqual(j.torikumi_name("自然公園区域等の見直し（沖縄戦跡国定公園）\n（環境部 自然保護課）\n【再掲】"), "自然公園区域等の見直し（沖縄戦跡国定公園）")

    def test_torikumi_body(self):
        """取組は3行の組。実施主体の列が行の区切りの線で分かれていても1つのセルにまとめ、印字の行のまま改行する。「○」の行は group。"""
        def cell(r, c, text, cs=1, rs=1):
            return {"r": r, "c": c, "cs": cs, "rs": rs, "lines": [line(60, t, 100, right=400) for t in text.split("\n")], "top": 0}
        rows = [
            [cell(0, 0, "○地域特性に合ったクリーンエネルギーの導入拡大", cs=5)],
            [cell(1, 0, "航空路線網を活用した輸送モデルの拡充\n（商工労働部）", rs=3), cell(1, 1, "県"), cell(1, 2, "輸出促進", cs=3)],
            [cell(2, 1, "事業者\n関係団体"), cell(2, 2, "輸出量", cs=3)],
            [cell(3, 2, "1,566トン"), cell(3, 3, "1,644トン"), cell(3, 4, "1,726トン")],
        ]
        out = j.torikumi_body(rows, 5)
        self.assertTrue(out[0][0]["group"])
        self.assertEqual(out[1][0]["torikumi"], "航空路線網を活用した輸送モデルの拡充")
        self.assertEqual(out[1][1], {"text": "県\n事業者\n関係団体", "rs": 3})
        self.assertEqual([c["text"] for c in out[2]], ["輸出量"])
        self.assertEqual([c["text"] for c in out[3]], ["1,566トン", "1,644トン", "1,726トン"])


class BuilderTest(unittest.TestCase):
    def test_paragraphs(self):
        """字下げで始まる行と「・」の行が段落の頭。右の端まで届いた行の次はつなぐ。「R13年度の目標値」の行は前の行が長くても別の段落。"""
        out = build(numbered([
            line(66, "人間活動と自然環境が調和する持続可能な脱炭素社会の構築に向けて、自然環境が"),
            line(59, "あることを踏まえ、世界に誇れる島しょ型環境モデル地域の形成を目指す。", 380),
            line(59, "・本県は地理的・地形的及び需要規模の制約により、現時点ではエネルギーの多くを"),
            line(59, "入拡大に取り組みます。", 170),
            line(59, "R９年度の目標値：男性前回調査から延伸、女性前回調査から延伸（R５年度に数値設定"),
            line(59, "R13年度の目標値：男性前回調査から延伸", 300),
        ]))
        self.assertEqual([b["text"][:12] for b in out], ["人間活動と自然環境が調和", "・本県は地理的・地形的及", "R９年度の目標値：男性前", "R13年度の目標値：男性"])

    def test_skip_sections(self):
        """「施策展開の体系」の節は読まず、次の■の小見出しから読む。主な取組の表の上の帯（2行に折り返したものも）は読まない。"""
        out = build(numbered([
            line(77, "施策展開の体系", 200),
            line(59, "【施策展開】", 120),
            line(59, "１－（１）－ア 脱炭素島しょ社会の実現", 300),
            line(77, "主な取組（アクティビティ）及び活動指標（アウトプット）", 340),
            line(59, "【施策】③ 経済成長を加速させる拠点港湾機能やネットワーク機能の強化拡充と", 480),
            line(59, "向上", 90),
        ]))
        self.assertEqual([(b["kind"], b.get("text")) for b in out], [("label", "主な取組（アクティビティ）及び活動指標（アウトプット）")])

    def test_shouraizou(self):
        """基本施策の札の前に、将来像が変わったら将来像の見出しを置く（名前は施策体系表から）。"""
        b = Builder()
        b.chapter = "2"
        b.shouraizou = {"1": "沖縄らしい自然と歴史、伝統、文化を大切にする島を目指して"}
        b.add(Table(14, 70, [[{"r": 0, "c": 0, "cs": 1, "rs": 1, "lines": [line(70, "基本施策", 120)], "top": 70}],
                              [{"r": 1, "c": 0, "cs": 1, "rs": 1, "lines": [line(80, "１－（１）", 120)], "top": 100},
                               {"r": 1, "c": 1, "cs": 1, "rs": 1, "lines": [line(140, "世界に誇れる島しょ型環境モデル地域の形成", 380)], "top": 100}]], 2), None)
        self.assertEqual([(h["level"], h["id"], h["mark"], h.get("pdca")) for h in b.out],
                         [(2, "2-1", "将来像1", None), (3, "2-1-1", "1－(1)", "1-1")])


if __name__ == "__main__":
    unittest.main()
