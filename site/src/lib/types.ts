// 抽出結果（data/extracted/*.json）の1行の形。scripts/extract_*.py が書き出すものに合わせる（抽出を変えたらここも直す）。
// 報告書の欄の値は文字のまま（*_raw）で持ち、数として読めたものだけ数（読めなければ null）。欄が空なら ''

// ---------------------------------------------------------------- 総括報告書（soukatsu/）

// 将来像（shouraizou.json）
export interface ShouraizouRow {
  year: number;
  id: number;
  name: string;
  source: string;
  page: number;
}

// 基本施策（kihon.json）
export interface KihonRow {
  year: number;
  id: string;
  shouraizou: number;
  code: string;
  name: string;
  mezasu: string; // 目指す姿
  source: string;
  page: number;
}

// 基本施策の主要指標（shuyou.json）。値は報告書の文字のまま（数の読み取りは lib/data.ts の shuyouRows）
export interface ShuyouRow {
  year: number;
  kihon_id: string;
  name: string;
  base_raw: string;
  actual_raw: string;
  target_raw: string;
  judgement: string;
  source: string;
  page: number;
}

// 主要指標の達成状況（shuyou_gaiyou.json。概要版の「主要指標の達成状況2」の表）。1指標1行（49指標）で、値は印字のまま。
// R5 は表が画像で読めないので無い。基準値・目標値は統計の基準改定で試算し直したもの（revised）があり、付属資料（ShuyouRow）と違うことがある
export interface ShuyouGaiyouRow {
  year: number;
  no: number; // 表の順
  kihon_id: string;
  code: string; // 1-(1)
  name: string;
  base_raw: string;
  base_ref: string | null; // 基準値の年（「R3年度」）
  target_raw: string;
  target_ref: string | null;
  actual_raw: string;
  actual_ref: string | null; // 直近の実績値が何年の値か
  rate_raw: string; // 目標値に対する達成率の印字（「51%」「達成」「後退」「-」）
  rate: number | null;
  revised: boolean;
  source: string;
  page: number;
}

// 施策（shisaku.json）。判定（judge）は R5 から
export interface ShisakuRow {
  year: number;
  id: string;
  code: string;
  name: string;
  kihon_id: string;
  tenkai_id: string;
  tenkai_name: string;
  shouraizou: number;
  kankei: string; // 関係部局
  houkou: string; // 施策の方向
  source: string;
  page: number;
  check: string;
  action: string;
  judge: string | null;
  judge_label: string | null;
  summary_counts: Record<string, number> | null; // 施策総括表の進捗状況ごとの取組の数
  summary_ref: { source: string; page: number } | null;
}

// 主な取組（torikumi.json）
export interface TorikumiRow {
  year: number;
  shisaku_id: string;
  no: number;
  name: string;
  key: string; // 年度をまたいで同じ取組とみなすための、正規化した名前
  section: string; // 所管部課
  dept: string;
  group: string;
  budget_raw: string;
  budget: number | null;
  indicator: string; // 活動指標
  summary: string;
  source: string;
  page: number;
  target: string; // 目標。セルが2行以上に分かれているものは、空でない値を改行でつないだもの（行ごとの対応は lines）
  actual: string;
  lines?: { target: string; actual: string }[]; // 目標・実績のセルが2行以上のときだけ。印字の行ごとの目標と実績（空のセルは ''）
  status: string; // 進捗状況。空欄・「-」は ''
  status_raw: string;
}

// 成果指標（seika.json）
export interface SeikaRow {
  year: number;
  shisaku_id: string;
  name: string;
  unit: string;
  base_raw: string;
  base: number | null;
  actual_raw: string;
  actual: number | null;
  actual_year: string;
  actual_ref_year: string; // 実績値が何年度の値か（「（R4年度）」など書き方はまちまち）
  actual_series: { year: string; raw: string; value: number | null; ref_year: string }[];
  plan_raw: string[]; // 計画期間の3年分の計画値
  plan: (number | null)[];
  target_raw: string;
  target: number | null;
  target_year: string;
  rate_raw: string;
  rate: number | null;
  judgement: string; // 見通し
  source: string;
  page: number;
  dept: string;
  explanation: string;
  base_fix?: { printed: string; source: string; page: number }; // 基準値の印字が欠けていて、部局の検証票の値で補ったもの
}

// 読み込んだ報告書（sources.json）
export interface SourceRow {
  id: string;
  file_url: string;
  link_text: string;
  page_url: string;
  page_title: string;
  kind: string;
  year: number;
  zip_member: string | null;
}

// ---------------------------------------------------------------- 部局別の主な取組検証票（bukyoku/）

// 予算の表の1行。金額は千円単位
export interface BudgetAmountRow {
  source: string; // 財源
  method: string;
  source_next: string;
  method_next: string;
  settled_raw: string;
  estimate_raw: string;
  initial_raw: string;
  settled: number | null; // 決算額（報告年度の前年度）
  estimate: number | null; // 決算見込額（報告年度）
  initial: number | null; // 当初予算額（翌年度）
  suspect: AmountKind[]; // 桁の誤記の疑い（scripts/extract_bukyoku.py の suspect_kinds）
  suspect_cleared?: string[];
}
export type AmountKind = 'settled' | 'estimate' | 'initial';

export interface BudgetBlock {
  name: string; // 予算事業名
  name_next: string; // 翌年度の予算事業名
  rows: BudgetAmountRow[];
  page: number;
}

export interface BukyokuTorikumiRow {
  year: number;
  dept_source: string;
  shisaku_id: string;
  name: string;
  key: string;
  shisaku_name: string;
  seika_name: string; // 対応する成果指標
  section: string;
  budgets: BudgetBlock[];
  activity: string;
  actor: string;
  plan: { indicator: string; values: string[] }[];
  plan_years: string[];
  url: string;
  activity_done: string;
  activity_next: string;
  indicator_name: string; // 活動指標の表が2つ以上あるときは、印字で最初の表（総括報告書の目標・実績の1行目に当たる）
  past: { year: string; value: string }[];
  achievement: string;
  indicators?: { name: string; past: { year: string; value: string }[]; achievement: string }[]; // 活動指標の表が2つ以上あるときだけ。印字の順のすべての表
  basis: string;
  improvements: { plan: string; result: string }[];
  check: { type: string; text: string }[];
  action: { type: string; text: string }[];
  source: string;
  page: number;
  do_page: number;
  check_page: number;
}

export interface BukyokuFileRow {
  id: string;
  source: string;
  year: number;
  pages: number;
  torikumi: number;
  with_budget: number;
  overview_failed: number;
  error: string;
  with_check: number;
  file_url: string;
  link_text: string;
  page_url: string;
  page_title: string;
  content_year?: number; // 中身が別の年度の票（県のページに前の年度の票が掲載されているもの）のときの、中身の年度。取組は取り込まない
  note?: string; // そのときの理由
}

// ---------------------------------------------------------------- 観光ロードマップ（kanko/）

export interface KankoKihonRow {
  id: string;
  code: string;
  name: string;
  source: string;
  page: number;
}

export interface KankoShisakuRow {
  year: number;
  id: string;
  code: string;
  name: string;
  kihon_id: string;
  tenkai_id: string;
  tenkai_code: string;
  tenkai_name: string;
  houkou: string;
  kankei: string;
  source: string;
  page: number;
  check: string;
  action: string;
}

// 総括報告書の取組と同じ欄に、沖縄県PDCA の取組との結び付き（pdca）を足したもの
export interface KankoTorikumiRow extends TorikumiRow {
  name_note?: string; // 取組名の欄で、所管部課の後ろに書かれた小事業の一覧など（R5 3-d-2 No.2 だけ）
  pdca: { shisaku_id: string; key: string; status: string }[];
  pdca_match: string | null;
}

// 実績値の欄は年度ごとに並ぶ（years・actual_raw・ref_years・actual が同じ順）
export interface KankoSeikaRow {
  year: number;
  shisaku_id: string;
  name: string;
  key: string;
  unit: string;
  base_raw: string;
  base: number | null;
  years: string[];
  actual_raw: string[];
  ref_years: string[];
  actual: (number | null)[];
  plan_raw: string[];
  plan: (number | null)[];
  target_raw: string;
  target: number | null;
  rate_raw: string;
  rate: number | null;
  judgement: string; // 前進・横ばい・後退・その他
  source: string;
  page: number;
  dept: string;
  explanation: string;
  pdca: { shisaku_id: string; name: string }[];
}

// 年度ごとの概要版の件数
export interface KankoYearRow {
  year: number;
  source: string;
  readable: boolean; // 本編が文字として読めたか（R4 は読めない）
  torikumi: number;
  status: Record<string, number>;
  seika: number;
  zenshin: number;
  reason?: string;
}

// ---------------------------------------------------------------- 一括交付金（ソフト）の事後評価（ikkatsu/）

export interface IkkatsuJigyoRow {
  year: number;
  no: number;
  name: string;
  key: string;
  period: string;
  overview: string;
  targets: { part: string; name: string; target: string; actual: string }[];
  grade: string;
  grade_label: string; // 達成・概ね達成・一部達成・未達成
  rate_raw: string;
  rate: number;
  source: string;
  page: number;
  shisaku_ids: string[];
  dept: string;
  budget: {
    total_raw: string;
    spent_raw: string;
    kofukin_raw: string;
    rate_raw: string;
    total: number;
    spent: number;
    kofukin: number | null;
    rate: number;
  };
  policy: string;
  sheet_source: string | null;
  sheet_page: number | null;
  sheet_name?: string;
  shisaku_from?: number;
  shisaku_ref?: { printed: string; source: string; page: number }; // 検証シートが画像だけの PDF で、施策のコードを画像から読んだもの（extract_ikkatsu.py の SHEET_FIXES）
  sheet_image?: { source: string; page: number; fields: string[] }; // そのとき画像から読んだ検証シートの場所と、画像から読んだ欄（shisaku_ids・dept・budget）
}

// ---------------------------------------------------------------- 評価検証報告書（hyoka/）

export interface HyokaKihonRow {
  id: string;
  name: string;
  intro: string;
  results: string[];
  shuyou: string;
  issues: { head: string; items: string[] }[];
  source: string;
  page: number;
  page_end: number;
}

// ---------------------------------------------------------------- 基本計画・実施計画の本文（kihon/・jisshi/）

// 本文の1行（scripts/extract_kihon.py・extract_jisshi.py）。source は分冊、page は PDF のページ、printed は印字のページ（「はじめに」には無い）。
// transcribed は、県の PDF の文字が図形で読めないページを、画像を読んで文字にしたもの（実施計画（中期）の一部）
interface HonbunBase { page: number; printed?: number; source: string; transcribed?: boolean }
// 見出し。level は 1 章・2 「１」（実施計画の第2章は将来像）・3 「⑴」（基本施策）・4 「ア」（施策展開）・5 「①」（施策）。
// pdca は基本施策・施策展開・施策の見出しに当たる沖縄県PDCA の ID
export interface HonbunHeading extends HonbunBase { kind: 'h'; level: 1 | 2 | 3 | 4 | 5; id: string; mark: string; title: string; pdca?: string }
// 表のセル。cs・rs は列・行のまたぎ（1 のときは無い）。group は主な取組の表の「○…」の行、torikumi は主な取組の名前のセルの取組名
export interface HonbunCell { text: string; cs?: number; rs?: number; group?: boolean; torikumi?: string }
// 表（実施計画）。table は種類（shuyou 主要指標・seika 成果指標・kyodo 協働の主体・torikumi 主な取組・other）。
// caption は成果指標の名前、shisaku は主な取組の表の施策の ID、pages はページをまたいだ表のページ
export interface HonbunTable extends HonbunBase {
  kind: 'table';
  table: 'shuyou' | 'seika' | 'kyodo' | 'torikumi' | 'other';
  caption?: string;
  head: HonbunCell[][];
  body: HonbunCell[][];
  shisaku?: string | null;
  pages?: number[];
}
export type KihonHonbunRow =
  | HonbunHeading
  | (HonbunBase & { kind: 'p' | 'label'; text: string }) // 段落・見出しの付かない小見出し
  | (HonbunBase & { kind: 'fig' }); // 図（中身は読まない）
export type HonbunRow = KihonHonbunRow | HonbunTable;

// 個別計画などの報告書（kanko・ikkatsu・hyoka・kihon・jisshi の sources.json）。plan は実施計画の前期・中期
export interface PlanSourceRow {
  id: string;
  file_url: string;
  link_text: string;
  page_url: string;
  page_title: string;
  year?: number;
  kind?: string;
  plan?: string;
}

// ---------------------------------------------------------------- 人が用意した参照データ（data/reference/）

interface RefSource {
  title: string;
  url: string;
}

// finance.json。金額の単位は億円
export interface FinanceReference {
  checked_at: string;
  okinawa_shinko: {
    label: string;
    year: number;
    total: number;
    previous_total: number;
    items: { name: string; amount: number; note: string }[];
    next: { year: number; total: number; label: string };
    sources: RefSource[];
  };
  ikkatsu: {
    soft_rate: string;
    note: string;
    sources: RefSource[];
  };
  prefecture: {
    label: string;
    year: number;
    total: number;
    previous_total: number;
    self_financing_ratio: number;
    revenue: { name: string; amount: number; kind: string; general: boolean; note: string }[];
    expenditure_by_nature: { name: string; amount: number; note: string }[];
    sources: RefSource[];
  };
}

// themes.json の themes の1つ（くらしのテーマ）。match は施策の名前などに当てる正規表現
export interface ThemeConfig {
  id: string;
  label: string;
  match: string;
  include: string[]; // match で拾えないが入れる施策 ID
  exclude: string[]; // match に当たるが入れない施策 ID
}

// ---------------------------------------------------------------- 読み込むファイルと行の形

// lib/data.ts の load(name) の name と、そのファイルの中身
export interface ExtractedFiles {
  shouraizou: ShouraizouRow[];
  kihon: KihonRow[];
  shuyou: ShuyouRow[];
  shuyou_gaiyou: ShuyouGaiyouRow[];
  shisaku: ShisakuRow[];
  torikumi: TorikumiRow[];
  seika: SeikaRow[];
  sources: SourceRow[];
  'bukyoku/torikumi': BukyokuTorikumiRow[];
  'bukyoku/files': BukyokuFileRow[];
  'kanko/kihon': KankoKihonRow[];
  'kanko/shisaku': KankoShisakuRow[];
  'kanko/torikumi': KankoTorikumiRow[];
  'kanko/seika': KankoSeikaRow[];
  'kanko/years': KankoYearRow[];
  'kanko/sources': PlanSourceRow[];
  'ikkatsu/jigyo': IkkatsuJigyoRow[];
  'ikkatsu/sources': PlanSourceRow[];
  'hyoka/kihon': HyokaKihonRow[];
  'hyoka/sources': PlanSourceRow[];
  'kihon/honbun': KihonHonbunRow[];
  'kihon/sources': PlanSourceRow[];
  'jisshi/zenki': HonbunRow[];
  'jisshi/chuki': HonbunRow[];
  'jisshi/sources': PlanSourceRow[];
}
