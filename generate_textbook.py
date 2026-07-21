#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_textbook.py

【目的】
  単一HTML（GanttForge再現アプリ）から「読み方教科書」を生成する。
  地図(generate_codemap.py)が"どこに何があるか"の索引なら、
  こちらは"どの順で、どう読み、なぜそうなっているか"の学習書。

【設計の核：なぜコードと一緒に更新できるのか（前提→結論）】
  前提：教科書には2種類の中身がある。
        (a) 学び方の型（下から読む・予測してから確認する・自己確認する）
            → コードが変わっても変わらない安定部分。この生成器の中に固定で持つ。
        (b) 各関数・各セクションが「なぜ在るのか」
            → コードが変われば変わる部分。コード内の【設計判断】コメントに書いてある。
  処理：(a)を土台テンプレとして固定し、(b)を毎回コードから抽出して流し込む。
  結論：コードの【設計判断】コメントを更新すれば、再生成だけで教科書の中身も追従する。
        → 教科書が陳腐化しない。ただし成立条件は「設計判断コメントの規約を保つこと」。

【依存】
  同じフォルダに generate_codemap.py があること（解析部品を再利用する）。

【使い方】
  python3 generate_textbook.py <入力htmlパス> <出力mdパス>
"""

import re
import sys
import datetime

# 地図の解析部品を再利用する（DRY：解析ロジックを二重に持たない）。
from generate_codemap import read_lines, find_sections, collect_functions, section_of


# =====================================================================
# 安定部分：学び方の型（layer ＝ 読む順の一区切り）。
# section_matchers はセクション見出しに含まれる文字列。上から順に最初に一致した層へ割り当てる。
# =====================================================================
LAYERS = [
    {
        "key": "L1",
        "title": "層1：DB基盤（土台）",
        "intro": "すべての保存処理が乗る土台。ここを固めないと上は読めない。",
        "section_matchers": ["IndexedDB 定数", "ストア定義", "DB接続"],
        "predict": [
            "なぜ主キーを全ストア共通で \"id\" に固定し、自動採番を使わないのか。使うと何が困る？",
            "DBへの接続は毎回開き直すのか、1つを使い回すのか。正しいのはどちらで、なぜ？",
        ],
        "self_check": [
            "「このアプリのデータはどこに・どんな単位で保存されますか？」に、ストアと主キーの話で答えられる。",
        ],
    },
    {
        "key": "L2",
        "title": "層2：単一ストアCRUD",
        "intro": "9つのストアが同じ骨格(add / get / delete)を持つ。1つ読めば残りは差分だけで読める。",
        "section_matchers": ["のCRUD"],
        "predict": [
            "getXByProject は全件を舐めるのか、インデックス(by_projectId)を使うのか。どう効く？",
            "add系が「新規追加」と「更新」を兼ねられるのはなぜ？（putの性質）",
        ],
        "self_check": [
            "逆引き表を見ずに、あるストアを触る関数を骨格(add/get/delete)で挙げられる。",
        ],
    },
    {
        "key": "L3",
        "title": "層3：複合操作（★心臓部）",
        "intro": "層2のCRUDを組み合わせて「意味のある1操作」を作る層。ここが一番説明したくなる所。",
        "section_matchers": ["複合操作"],
        "predict": [
            "子スケジュールの日付を変えたら、親は？　その親の親は？（再帰の必要性を自分で導く）",
            "子を全部消したら親の日付はリセットされる？　されない？",
            "親を消したら、子・孫・コメントはどうなる？　変更履歴は1件？　それとも個別？",
        ],
        "self_check": [
            "連鎖削除の3段階（全件読み切り→削除＋個別ログ→起点の親の日付再計算）を口で説明できる。",
        ],
    },
    {
        "key": "L4",
        "title": "層4：UIの背骨",
        "intro": "「純粋関数で計算 → 薄い関数でDOMに書く → 統括関数がつなぐ」の3分割。この型が分かると全パネルが同じ読み方で読める。",
        "section_matchers": ["UI：状態", "UI：DOM", "UI：統括"],
        "predict": [
            "なぜ「計算」と「DOMへの反映」を別の関数に分けるのか。混ぜると何が困る？",
        ],
        "self_check": [
            "「バーの位置ってどう決まるの？」に、純粋関数が日付を座標に変換していると層で答えられる。",
        ],
    },
    {
        "key": "L5",
        "title": "層5：パネル群",
        "intro": "スナップショット/即時メモ/メモ/コメント/変更履歴。層4の型で読めるので速い。",
        "section_matchers": ["P2", "P3", "P4", "P5", "P6", "リサイズハンドル", "トースト"],
        "predict": [
            "スナップショットの「戻す」は、変更履歴に記録される？　されない？（層3のchangelogを思い出して）",
        ],
        "self_check": [
            "「スナップショット復元とインポートで履歴の残り方が違いますよね？」に落ち着いて答えられる。",
        ],
    },
    {
        "key": "L6",
        "title": "層6：モーダル・ガント操作・マインドマップ",
        "intro": "層3の複合操作と層4の背骨を、実際のユーザー操作へ結線する層。層3を先に読んでいれば「再会」になる。",
        "section_matchers": [
            "モーダル", "M3", "ガントバー", "その他のイベント",
            "マインドマップ", "スクロール", "ガント背景",
        ],
        "predict": [
            "バーをドラッグして離した瞬間、何が連鎖する？（日付保存→親へ伝播→再描画→変更履歴）",
        ],
        "self_check": [
            "バー操作から変更履歴の記録までを、一続きの流れとして言える。",
        ],
    },
    {
        "key": "L7",
        "title": "層7：入出力 JSON / PDF / Excel（最後でよい）",
        "intro": "他から呼ばれるが他をほとんど呼ばない「葉」。理解の土台には要らないので最後に、必要な時だけ。",
        "section_matchers": ["H1", "H2", "H3", "H4"],
        "predict": [
            "インポートはなぜ「差分適用」なのか。全消し→全書き込みにしない理由は？（履歴とIDの保持）",
        ],
        "self_check": [
            "インポートは projects/schedules/tasks/issues だけ変更履歴に記録する、と理由つきで言える。",
        ],
    },
]


# =====================================================================
# 自動部分：コードから「なぜ」を抽出する
# =====================================================================
DECISION_MARK = "【設計判断"
STOP_MARKS = ["【前提】", "【処理】", "【結果】"]


def extract_design_blocks(lines):
    """
    ファイル全体から【設計判断】コメントブロックを抽出する。
    関数直上に限らず、セクション説明やイベント登録の上にあるものも拾う（取りこぼさない方針）。
    各ブロックは、設計判断の"理由"部分（マーカー〜最初の【前提】等の手前）に絞る。
    返り値：[{line, title, rationale(list[str])}]
    """
    blocks = []
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if DECISION_MARK in stripped and stripped.startswith("//"):
            start = i
            body = []
            # 連続するコメント行をまとめて取得
            while i < len(lines) and lines[i].strip().startswith("//"):
                body.append(lines[i].strip()[2:].strip())
                i += 1
            title = _decision_title(body)
            rationale = _rationale_only(body)
            blocks.append({"line": start + 1, "title": title, "rationale": rationale})
        else:
            i += 1
    return blocks


def _decision_title(body):
    joined = " ".join(body)
    m = re.search(r"【設計判断[：:]?\s*(.*?)】", joined)
    if m and m.group(1).strip():
        return m.group(1).strip()
    # タイトルが空（【設計判断】だけ）の場合は、続く最初の実質行を代わりに使う
    for line in body:
        cleaned = re.sub(r"【設計判断[：:]?\s*】", "", line).strip()
        if cleaned:
            return cleaned
    return "(無題の設計判断)"


def _rationale_only(body):
    """設計判断の理由部分だけを返す（最初の【前提】【処理】【結果】の手前で打ち切る）。"""
    out = []
    for line in body:
        if any(mark in line for mark in STOP_MARKS):
            break
        # マーカー行そのものは見出しで使うので本文からは省く
        cleaned = re.sub(r"【設計判断[：:]?.*?】", "", line).strip()
        if cleaned:
            out.append(cleaned)
    return out


def layer_of_section(section_title):
    """セクション見出しを、最初に一致した層へ割り当てる。一致なしは None。"""
    for layer in LAYERS:
        for matcher in layer["section_matchers"]:
            if matcher in section_title:
                return layer["key"]
    return None


def build_textbook(src_path, lines, sections, functions, decision_blocks):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # セクション→層 の割り当て。未分類は別に集めて明示する。
    section_layer = {}
    unclassified = []
    for s in sections:
        key = layer_of_section(s["title"])
        if key is None:
            unclassified.append(s)
        else:
            section_layer[s["title"]] = key

    # 各層に、セクション・関数・設計判断ブロックを束ねる
    def sections_in(layer_key):
        return [s for s in sections if section_layer.get(s["title"]) == layer_key]

    def funcs_in(layer_key):
        return [f for f in functions if section_layer.get(f["section"]) == layer_key]

    def decisions_in(layer_key):
        # 設計判断ブロックの行番号が属するセクション→層 で判定
        result = []
        for b in decision_blocks:
            sec = section_of(b["line"], sections)
            if section_layer.get(sec) == layer_key:
                result.append(b)
        return result

    out = []
    out.append(f"# 読み方教科書（自動生成）— {src_path}")
    out.append("")
    out.append(
        "> このファイルは `generate_textbook.py` が生成します。**手で編集しないでください。**"
    )
    out.append(
        "> 学び方の型（読む順・予測→確認・自己確認）は生成器に固定。"
        "各関数・各セクションの「なぜ」は、コード内の `【設計判断】` コメントから自動抽出しています。"
        "**コードのコメントを更新して再生成すれば、この教科書も追従します。**"
    )
    out.append(">")
    out.append("> 再生成：`python3 generate_textbook.py <入力html> <出力md>`（同フォルダに `generate_codemap.py` が必要）")
    out.append("")
    out.append(f"- 生成日時：{now}")
    out.append(f"- 総行数：{len(lines):,} / 関数：{len(functions)} / 設計判断ブロック：{len(decision_blocks)}")
    out.append("")
    out.append("## 読む順（下から上へ）")
    out.append("")
    out.append("下の層は上の層を知らなくても読める。上の層は下の層を知らないと読めない。だから下から。")
    out.append("")
    for layer in LAYERS:
        nfunc = len(funcs_in(layer["key"]))
        ndec = len(decisions_in(layer["key"]))
        out.append(f"- **{layer['title']}** … 関数{nfunc} / 設計判断{ndec}")
    out.append("")
    out.append("---")
    out.append("")

    for layer in LAYERS:
        secs = sections_in(layer["key"])
        funcs = funcs_in(layer["key"])
        decisions = decisions_in(layer["key"])

        out.append(f"## {layer['title']}")
        out.append("")
        out.append(layer["intro"])
        out.append("")

        # 読む場所（自動）
        out.append("**読む場所**")
        if secs:
            for s in secs:
                cnt = sum(1 for f in funcs if f["section"] == s["title"])
                out.append(f"- L{s['line']}〜 `{s['title']}`（関数{cnt}）")
        else:
            out.append("- （この層に該当セクションなし）")
        out.append("")

        # 読む前に予測する（固定）
        out.append("**読む前に予測する**")
        for p in layer["predict"]:
            out.append(f"- {p}")
        out.append("")

        # このコードが語る「なぜ」（自動抽出）
        out.append("**このコードが語る「なぜ」（設計判断コメントから自動抽出）**")
        if decisions:
            for b in decisions:
                rationale = " ".join(b["rationale"])
                if len(rationale) > 160:
                    rationale = rationale[:160] + "…"
                out.append(f"- L{b['line']}／**{b['title']}**")
                if rationale:
                    out.append(f"  - {rationale}")
        else:
            out.append("- （この層に設計判断コメントは検出されず）")
        out.append("")

        # 収録関数（自動）
        out.append("**収録関数**")
        if funcs:
            for f in funcs:
                purpose = f["purpose"] if f["purpose"] else "—"
                if len(purpose) > 60:
                    purpose = purpose[:60] + "…"
                out.append(f"- `{f['name']}`（L{f['line']}）— {purpose}")
        else:
            out.append("- （なし）")
        out.append("")

        # 自己確認（固定）
        out.append("**自己確認（言えたら合格）**")
        for c in layer["self_check"]:
            out.append(f"- {c}")
        out.append("")
        out.append("---")
        out.append("")

    # 未分類セクション（あれば明示：黙って捨てない）
    out.append("## 未分類セクション（層に割り当てられなかったもの）")
    out.append("")
    if unclassified:
        out.append("下記は既知の層に該当しませんでした。新しい種類のコードが増えた可能性があります。"
                   "`generate_textbook.py` の LAYERS に振り分け先を追記してください。")
        for s in unclassified:
            out.append(f"- L{s['line']} `{s['title']}`")
    else:
        out.append("なし（全セクションがいずれかの層に割り当てられています）。")
    out.append("")

    out.append("---")
    out.append("")
    out.append("## この教科書が古くならない仕組み")
    out.append("")
    out.append(
        "「読む場所・収録関数・なぜ」はコードから毎回導出しているので、"
        "機能を足して再生成すれば自動で反映されます。"
        "特に「なぜ」は `【設計判断】` コメントを写しているだけなので、"
        "**コメントを丁寧に書き続ける限り、教科書の質はコードの質と同じだけ保たれます。**"
        "逆に言えば、設計判断コメントを省くと、その関数は教科書から「なぜ」が消えます。"
        "コメント規約が、そのまま教科書の生命線です。"
    )
    out.append("")

    return "\n".join(out) + "\n"


def main():
    if len(sys.argv) != 3:
        print("usage: python3 generate_textbook.py <input.html> <output.md>", file=sys.stderr)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    lines = read_lines(src)
    sections = find_sections(lines)
    functions = collect_functions(lines, sections)
    decisions = extract_design_blocks(lines)
    md = build_textbook(src, lines, sections, functions, decisions)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"OK: {dst} を生成（関数{len(functions)} / 設計判断{len(decisions)}）")


if __name__ == "__main__":
    main()
