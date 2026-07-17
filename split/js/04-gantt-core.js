    // ===== UI：状態・純粋関数（DOM非依存） =====
    // 【設計判断】このセクションの関数は「データ配列を受け取り、データ/文字列を返す」だけの
    //   純粋関数と、実際にDOMへ反映する薄い関数に分ける。前者はdocumentに一切触れないため、
    //   ブラウザが無い環境（Node.js等）でも配列を渡すだけで動作を検証できる。
    //
    // 【今回のスコープ（UIデザイン仕様書・基本設計書2章に基づくメイン画面の忠実再現）】
    //   実装：2段ヘッダー、WBSパネル(520px)＋ガントチャート本体（日付軸・バー・
    //   マイルストーンマーカー・親子バーの視覚差・完了時の不透明度・土日の背景色）、
    //   カンバン、マインドマップ（issueのx,y座標を使った絶対配置＋親子を結ぶ線）。
    //   静的表示のみ：バーのドラッグリサイズ、カンバンのドラッグ&ドロップ、
    //   マインドマップのノードドラッグは実装しない。
    //   別工程：サイドパネル一式（コメント/メモ/即時メモ/スナップショット/変更履歴）、
    //   モーダル（マイルストーン管理／プロジェクト編集）、インポート/エクスポート、
    //   表示粒度（週/月）切替、全て開く・閉じるの実際の開閉状態管理。
    //   これらの未実装ボタンは視覚的には配置し、クリック時は
    //   handleOutOfScopeButtonClickで「スコープ外」である旨を明示する。

    // 現在選択中のプロジェクトのid。未選択時はnull。
    let currentSelectedProjectId = null;
    // 現在選択中のプロジェクトの最新データ（startDate/endDate/locked/milestones参照用）。
    let currentProjectObject = null;
    // 列トグル（開始/終了/状態）を再描画する際、DBへ再度問い合わせずに済むようキャッシュする。
    let currentScheduleTreeRows = [];
    // 「今日」ボタンでのスクロール位置計算に使う、現在表示中タイムラインの先頭日。
    let currentTimelineStartDateString = null;
    // WBSパネルの追加列（開始/終了/状態）の表示状態。基本設計書2.2節の固定順（開始→終了→状態）で
    // 右側から列を追加する仕様のため、この順序のままレンダリングする。
    const visibleWbsColumns = { startDate: false, endDate: false, status: false };
    // 折りたたまれているスケジュールidの集合。DBには保存しない画面上だけの一時状態
    // （プロジェクト切替・再読み込みでリセットされてよい表示上の状態のため）。
    const collapsedScheduleIds = new Set();
    // 折りたたまれているマインドマップのissueidの集合。collapsedScheduleIdsと同じ理由で
    // DB非保存の画面上だけの一時状態にする。
    const collapsedMindmapIssueIds = new Set();
    // 追加実装仕様書8.1節：インライン編集中（タイトル未確定）のissueid。編集中でなければnull。
    let mindmapIssueIdPendingInlineEdit = null;
    // インライン編集の入力欄がEscapeでキャンセルされたことを、続くblurイベントへ伝えるフラグ。
    let mindmapInlineEditCancelledByEscape = false;
    // P5コメントパネルで折りたたまれているスケジュールidの集合。collapsedScheduleIdsと
    // 同じ理由でDB非保存の画面上だけの一時状態にする。
    const collapsedCommentGroupScheduleIds = new Set();
    // ドラッグ操作中のスケジュールid。ドラッグ開始時に設定し、ドロップ処理後にnullへ戻す。
    let draggedScheduleId = null;
    // ドラッグ操作中のタスクid（カンバンのカード）。draggedScheduleIdと同じ理由・同じ寿命。
    let draggedTaskId = null;

    // taskStatus（"todo"|"inprogress"|"done"）の日本語表示名（データモデル設計3.2節）。
    const SCHEDULE_STATUS_LABELS = { todo: "未着手", inprogress: "進行中", done: "完了" };

    // ガント1日あたりの描画幅（px）。表示粒度（日/週/1ヶ月/3ヶ月）ごとに、全体の横幅が
    // 極端に長大化しないよう、粒度が粗くなるほど1日あたりの幅を狭くする。
    const GRANULARITY_PIXELS_PER_DAY = { day: 32, week: 6, month: 2.2, quarter: 0.9 };
    // 現在選択中の表示粒度（"day" | "week" | "month" | "quarter"）。
    let currentGranularity = "day";
    // ガント1行の高さ（px）。CSS変数 --gantt-row-height と同じ値を保つこと（JS側で絶対配置の
    // 計算に使うため、CSSだけでなくJS定数としても持つ）。
    const GANTT_ROW_HEIGHT_PX = 44;
    const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
    // マインドマップノードの固定カラーパレット（UIデザイン仕様書1.5節・9色）。
    const MINDMAP_NODE_COLORS = ["#2563EB", "#7C3AED", "#0891B2", "#059669", "#D97706", "#DC2626", "#DB2777", "#EA580C", "#4B5563"];

    // 【前提】rawText はユーザー入力を含みうる未エスケープの文字列（null/undefinedの可能性あり）。
    // 【処理】HTML特殊文字（& < > " '）を実体参照に置き換え、意図しないタグ・属性の注入を防ぐ。
    // 【結果】そのままHTML文字列に埋め込んでよいエスケープ済み文字列を返す。
    function escapeHtmlText(rawText) {
      return String(rawText ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    // 基本設計書4.1節：親→子→孫の3階層まで（ひ孫＝孫の子は作成不可）。depthLevelは0始まりのため、
    // 「これ以上子を追加できない最大depthLevel」は2（孫）。子追加ボタンの無効化判定に使う。
    const MAX_SCHEDULE_DEPTH_LEVEL_ALLOWING_CHILDREN = 2;

    // 【前提】scheduleList は同一プロジェクト内のスケジュール全件（親子関係はparentIdで表現）。
    // 【処理】親→子の順にたどり、各行がツリー上で何階層目か（depthLevel、ルートは0）、
    //   子を1件でも持つか（hasChildren）、兄弟内の位置（siblingIndex・siblingCount）を付与する。
    //   同じ親を持つ兄弟同士はorderの昇順に揃える。
    //   hasChildrenは、ガントのバー描画で「親行の太いバー」と「葉（子なし）行の細いバー」を
    //   区別するために必要（UIデザイン仕様書3章）。
    //   siblingIndex/siblingCountは、上下矢印の並び替えが「同一階層（同じ親を持つ兄弟グループ）
    //   内でのみ可能」「先頭行では上矢印、末尾行では下矢印を無効化」という基本設計書4.1節の
    //   仕様を判定するために必要。
    // 【結果】ガントチャートの行として上から順に描画できる配列
    //   {schedule, depthLevel, hasChildren, siblingIndex, siblingCount}[] を返す。
    function buildScheduleTreeRows(scheduleList) {
      const childSchedulesByParentId = new Map();
      const rootSchedules = [];
      for (const schedule of scheduleList) {
        if (schedule.parentId === null || schedule.parentId === undefined) {
          rootSchedules.push(schedule);
          continue;
        }
        if (!childSchedulesByParentId.has(schedule.parentId)) {
          childSchedulesByParentId.set(schedule.parentId, []);
        }
        childSchedulesByParentId.get(schedule.parentId).push(schedule);
      }

      const sortByOrder = (a, b) => a.order - b.order;
      rootSchedules.sort(sortByOrder);
      for (const childSchedules of childSchedulesByParentId.values()) {
        childSchedules.sort(sortByOrder);
      }

      const scheduleTreeRows = [];
      function appendScheduleAndDescendants(schedule, depthLevel, siblingIndex, siblingCount) {
        const childSchedules = childSchedulesByParentId.get(schedule.id) || [];
        scheduleTreeRows.push({
          schedule,
          depthLevel,
          hasChildren: childSchedules.length > 0,
          siblingIndex,
          siblingCount,
        });
        childSchedules.forEach((childSchedule, childIndex) => {
          appendScheduleAndDescendants(childSchedule, depthLevel + 1, childIndex, childSchedules.length);
        });
      }
      rootSchedules.forEach((rootSchedule, rootIndex) => {
        appendScheduleAndDescendants(rootSchedule, 0, rootIndex, rootSchedules.length);
      });
      return scheduleTreeRows;
    }

    // 【前提】scheduleTreeRows は buildScheduleTreeRows の戻り値（深さ優先順）。
    // 【処理】各行のWBS番号（例：1, 1.1, 1.1.1, 1.2, 2, 2.1）を計算する。
    //   深さごとにカウンタを持ち、ある深さの行が現れるたびにそのカウンタを+1し、
    //   それより深い階層のカウンタは（兄弟が変われば無効になるため）切り捨てる。
    //   深さ優先順（親→その子孫全部→次の兄弟）で辿ることが前提のアルゴリズム。
    // 【結果】スケジュールid→WBS番号文字列 のMapを返す。
    function calculateWbsNumbers(scheduleTreeRows) {
      const counters = [];
      const wbsNumberByScheduleId = new Map();
      for (const { schedule, depthLevel } of scheduleTreeRows) {
        counters[depthLevel] = (counters[depthLevel] || 0) + 1;
        counters.length = depthLevel + 1;
        wbsNumberByScheduleId.set(schedule.id, counters.join("."));
      }
      return wbsNumberByScheduleId;
    }

    // 【前提】scheduleTreeRows は buildScheduleTreeRows の戻り値。collapsedScheduleIds は
    //   折りたたまれているスケジュールidの集合（Set）。
    // 【処理】折りたたまれた行の子孫を、深さ優先順の性質を使って除外する（折りたたまれた行
    //   自身より深いdepthLevelが続く間はスキップし、同じか浅いdepthLevelに戻ったら解除する）。
    // 【結果】実際に画面へ表示すべき行だけの配列を返す（WBS番号は事前に計算済みのものを使う
    //   前提のため、この関数はdepthLevel/hasChildren等をそのまま維持する）。
    function filterVisibleScheduleTreeRows(scheduleTreeRows, collapsedScheduleIds) {
      const visibleRows = [];
      let collapsedAncestorDepth = null;
      for (const row of scheduleTreeRows) {
        if (collapsedAncestorDepth !== null) {
          if (row.depthLevel > collapsedAncestorDepth) continue;
          collapsedAncestorDepth = null;
        }
        visibleRows.push(row);
        if (collapsedScheduleIds.has(row.schedule.id)) {
          collapsedAncestorDepth = row.depthLevel;
        }
      }
      return visibleRows;
    }

    // 【前提】scheduleTreeRows は buildScheduleTreeRows の戻り値。collapsedScheduleIds は
    //   折りたたまれているスケジュールidの集合（Set）。
    // 【処理】子を持つ行（親行）だけを抽出し、1件以上存在し、かつ全件がcollapsedScheduleIdsに
    //   含まれているかを判定する（対応表No.39のお手本ロジック：
    //   `parents.length>0&&parents.every(t=>S.collapsed.has(t.id))`と同じ判定）。
    //   親行が1件も無い場合はfalseを返す（＝「全て開く」表示にする）。
    // 【結果】親行がすべて折りたたまれていればtrue、そうでなければfalseを返す。
    function areAllParentRowsCollapsed(scheduleTreeRows, collapsedScheduleIds) {
      const parentRows = scheduleTreeRows.filter((row) => row.hasChildren);
      return parentRows.length > 0 && parentRows.every((row) => collapsedScheduleIds.has(row.schedule.id));
    }

    // 【前提】taskList は同一プロジェクト内のタスク全件。
    // 【処理】status（"backlog"|"doing"|"done"）で3列に振り分け、各列内はorderの昇順に揃える。
    // 【結果】カンバンの3列分のタスク配列 {backlog, doing, done} を返す。
    function groupTasksByStatus(taskList) {
      const sortByOrder = (a, b) => a.order - b.order;
      return {
        backlog: taskList.filter((task) => task.status === "backlog").sort(sortByOrder),
        doing: taskList.filter((task) => task.status === "doing").sort(sortByOrder),
        done: taskList.filter((task) => task.status === "done").sort(sortByOrder),
      };
    }

    // 【前提】dateString は "YYYY-MM-DD" 形式の文字列であること。
    // 【処理】ローカルタイムゾーンによるずれを避けるため、常にUTC基準のタイムスタンプとして解釈する。
    // 【結果】その日付のUTC深夜0時のミリ秒タイムスタンプを返す。
    function parseDateStringToUtcTimestamp(dateString) {
      const [year, month, day] = dateString.split("-").map(Number);
      return Date.UTC(year, month - 1, day);
    }

    // 【前提】startDateString <= endDateString（"YYYY-MM-DD"形式）であること。
    //   プロジェクトのendDateがstartDateより前という既知の非整合（基本設計書1.3節No.1相当の
    //   プロジェクト側バリデーション無し仕様）の場合でも、最低1日分は描画できるようにする。
    // 【処理】startからendまでの日数分、各日の情報（日付文字列・年月・曜日・日種別）を列挙する。
    //   日種別（dayType）はcalculateDayTypeが返す「祝日 > 日曜 > 土曜 > 平日」の判定結果
    //   （追加実装仕様書1章：土日だけでなく祝日もタイムライン背景色の判定に使うため）。
    // 【結果】タイムライン列として左から順に描画できる配列を返す。
    function buildGanttTimelineDays(startDateString, endDateString) {
      const startTimestamp = parseDateStringToUtcTimestamp(startDateString);
      const endTimestamp = parseDateStringToUtcTimestamp(endDateString);
      const totalDayCount = Math.max(Math.round((endTimestamp - startTimestamp) / MILLISECONDS_PER_DAY) + 1, 1);

      const timelineDays = [];
      for (let dayOffset = 0; dayOffset < totalDayCount; dayOffset++) {
        const currentTimestamp = startTimestamp + dayOffset * MILLISECONDS_PER_DAY;
        const currentDate = new Date(currentTimestamp);
        const dateString = formatUtcTimestampToDateString(currentTimestamp);
        timelineDays.push({
          year: currentDate.getUTCFullYear(),
          month: currentDate.getUTCMonth() + 1,
          dayOfMonth: currentDate.getUTCDate(),
          dayType: calculateDayType(dateString, currentDate.getUTCDay()),
        });
      }
      return timelineDays;
    }

    // 【前提】targetDateString/timelineStartDateStringは"YYYY-MM-DD"。
    // 【処理】タイムライン先頭日から対象日までの経過日数を計算する。
    // 【結果】経過日数（整数）。範囲外の日付なら負の値、またはタイムラインを超える大きな値になる。
    function calculateDayOffsetFromTimelineStart(targetDateString, timelineStartDateString) {
      const targetTimestamp = parseDateStringToUtcTimestamp(targetDateString);
      const startTimestamp = parseDateStringToUtcTimestamp(timelineStartDateString);
      return Math.round((targetTimestamp - startTimestamp) / MILLISECONDS_PER_DAY);
    }

    // 【前提】utcTimestamp は parseDateStringToUtcTimestampと同じ基準（UTC深夜0時）のミリ秒値。
    // 【処理】parseDateStringToUtcTimestampの逆変換として、"YYYY-MM-DD"形式の文字列を組み立てる。
    // 【結果】UTC基準の日付文字列を返す。
    function formatUtcTimestampToDateString(utcTimestamp) {
      const date = new Date(utcTimestamp);
      const padToTwoDigits = (value) => String(value).padStart(2, "0");
      return `${date.getUTCFullYear()}-${padToTwoDigits(date.getUTCMonth() + 1)}-${padToTwoDigits(date.getUTCDate())}`;
    }

    // ===== 追加実装仕様書1章：営業日・祝日カレンダー =====
    // 【設計判断：竹（忠実再現）】お手本ganttforge.html 1435〜1456行目の祝日データを
    //   そのまま踏襲し、2024年〜2027年分のみをハードコードする。2028年以降の日付は
    //   このSetに含まれないため祝日として扱われず、土日以外は平日扱いになる。
    //   これは既知の制限であり、無理に年数を拡張しない（追加実装仕様書1.1節の方針）。
    const JAPANESE_PUBLIC_HOLIDAYS = new Set([
      // 2024年
      "2024-01-01", "2024-01-08", "2024-02-11", "2024-02-12", "2024-02-23",
      "2024-03-20", "2024-04-29", "2024-05-03", "2024-05-04", "2024-05-05", "2024-05-06",
      "2024-07-15", "2024-08-11", "2024-08-12", "2024-09-16", "2024-09-22", "2024-09-23",
      "2024-10-14", "2024-11-03", "2024-11-04", "2024-11-23",
      // 2025年
      "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24",
      "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05", "2025-05-06",
      "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-21", "2025-09-22", "2025-09-23",
      "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
      // 2026年
      "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23",
      "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
      "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
      "2026-10-12", "2026-11-03", "2026-11-23",
      // 2027年
      "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23",
      "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
      "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-21", "2027-09-23",
      "2027-10-11", "2027-11-03", "2027-11-23",
    ]);

    // 【前提】dateString は "YYYY-MM-DD" 形式。
    // 【処理】JAPANESE_PUBLIC_HOLIDAYSに含まれるかを判定する。
    // 【結果】祝日ならtrue。
    function isJapaneseHoliday(dateString) {
      return JAPANESE_PUBLIC_HOLIDAYS.has(dateString);
    }

    // 【前提】dateString は "YYYY-MM-DD" 形式。dayOfWeekNumber は0(日)〜6(土)。
    // 【処理】優先順位「祝日 > 日曜 > 土曜 > 平日」で1つの日種別を判定する
    //   （追加実装仕様書1.2節。用途：タイムライン背景色の判定＝土は薄青／日は薄赤／祝は薄橙）。
    // 【結果】"holiday" | "sunday" | "saturday" | null を返す。
    function calculateDayType(dateString, dayOfWeekNumber) {
      if (isJapaneseHoliday(dateString)) return "holiday";
      if (dayOfWeekNumber === 0) return "sunday";
      if (dayOfWeekNumber === 6) return "saturday";
      return null;
    }

    // 【前提】dayType は calculateDayTypeの戻り値。
    // 【処理】タイムライン見出し・グリッド背景の両方で共通して使う、日種別→CSSクラス名の
    //   対応表（同じ変換を2箇所に重複させないための単純なラッパー）。
    // 【結果】対応するCSSクラス名。dayTypeがnull（平日）なら空文字列。
    function calculateDayTypeBackgroundClassName(dayType) {
      if (dayType === "holiday") return "is-holiday";
      if (dayType === "sunday") return "is-sunday";
      if (dayType === "saturday") return "is-saturday";
      return "";
    }

    // 【前提】startDateString <= endDateString（"YYYY-MM-DD"形式）。どちらかが空、または
    //   startDateStringがendDateStringより後の場合は0を返す（呼び出し側の未入力・不整合を
    //   許容するため、エラーにはしない）。
    // 【処理】開始日から終了日まで1日ずつ走査し、土日・祝日を除いた日数を数える
    //   （追加実装仕様書1.3節：お手本と同じ単純な走査方式でよい）。
    // 【結果】営業日数（整数）。
    function calculateBusinessDayCount(startDateString, endDateString) {
      if (!startDateString || !endDateString) return 0;
      const startTimestamp = parseDateStringToUtcTimestamp(startDateString);
      const endTimestamp = parseDateStringToUtcTimestamp(endDateString);
      if (startTimestamp > endTimestamp) return 0;

      let businessDayCount = 0;
      for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += MILLISECONDS_PER_DAY) {
        const dayOfWeekNumber = new Date(timestamp).getUTCDay();
        const dateString = formatUtcTimestampToDateString(timestamp);
        if (calculateDayType(dateString, dayOfWeekNumber) === null) businessDayCount++;
      }
      return businessDayCount;
    }

