    // ===== 追加実装仕様書8.3節：マインドマップの自動レイアウト計算 =====
    // 【設計判断】お手本ganttforge.html mmAutoLayout（3114〜3143行目）を踏襲する。
    //   ただしお手本は「ドラッグで手動配置した後は上書きしない」ための_manualフラグを
    //   持つが、本書8.3節の指示「ドラッグによる手動配置を上書きする形で毎回再計算される」
    //   の通り、本実装はそのフラグを持たず、呼び出すたびに全ノードの座標を計算結果で
    //   上書きする（お手本より単純化した仕様として意図的に採用）。

    // ノードの深さ（depthLevel）別の想定高さ（お手本のnodeH関数に相当）。
    function calculateMindmapNodeHeight(depthLevel) {
      if (depthLevel === 0) return 44;
      if (depthLevel === 1) return 32;
      return 28;
    }

    // レイアウト計算時、ノードの想定高さに足す余白（お手本のvgapに相当）。
    const MINDMAP_LAYOUT_VERTICAL_GAP_PX = 8;

    // 深さ（depthLevel）別の親子間の水平間隔（お手本のxOffに相当）。
    function calculateMindmapHorizontalOffset(depthLevel) {
      if (depthLevel === 0) return 200;
      if (depthLevel === 1) return 180;
      return 150;
    }

    // 新規ノードが画面の見えない位置（マイナス座標）に配置されないための基準点。
    // お手本は画面中央を(0,0)として_mmPanで合わせているが、本アプリのキャンバスは
    // 素朴なabsolute配置＋overflow:autoスクロールのため、座標そのものを正の範囲に収める。
    const MINDMAP_LAYOUT_BASE_X = 60;
    const MINDMAP_LAYOUT_BASE_Y = 60;

    // 【前提】issueList は同一プロジェクト内のissue全件（親子関係はparentNodeIdで表現）。
    // 【処理】parentNodeId→直接の子issue配列のMapを組み立てる。
    // 【結果】Map<issueId, issue[]>を返す（子を持たないissueはキーとして現れない）。
    function buildMindmapChildIssuesByParentId(issueList) {
      const childIssuesByParentId = new Map();
      for (const issue of issueList) {
        if (issue.parentNodeId === null || issue.parentNodeId === undefined) continue;
        if (!childIssuesByParentId.has(issue.parentNodeId)) {
          childIssuesByParentId.set(issue.parentNodeId, []);
        }
        childIssuesByParentId.get(issue.parentNodeId).push(issue);
      }
      return childIssuesByParentId;
    }

    // 【前提】issueId はルートissueのid。childIssuesByParentId は上記の戻り値。
    // 【処理】ルートを深さ0として、子孫issueの深さ（depthLevel）を再帰的に割り当てる。
    // 【結果】Map<issueId, depthLevel>を返す。
    function assignMindmapDepthLevels(rootIssueId, childIssuesByParentId) {
      const depthByIssueId = new Map();
      function assignDepth(issueId, depthLevel) {
        depthByIssueId.set(issueId, depthLevel);
        for (const childIssue of childIssuesByParentId.get(issueId) || []) {
          assignDepth(childIssue.id, depthLevel + 1);
        }
      }
      assignDepth(rootIssueId, 0);
      return depthByIssueId;
    }

    // 【前提】issueId は対象issueのid。他の引数は上記関数の戻り値。subtreeHeightByIssueId は
    //   計算結果を書き込む先（再帰呼び出し全体で使い回す）。
    // 【処理】ノード自身とその子孫全体が縦方向に必要とする高さを再帰的に計算する
    //   （お手本mmAutoLayoutのcalcSizeに相当）。
    // 【結果】このノードに必要な高さ（px）を返す。subtreeHeightByIssueIdに全ノード分書き込む。
    function calculateMindmapSubtreeHeight(issueId, childIssuesByParentId, depthByIssueId, subtreeHeightByIssueId) {
      const childIssues = childIssuesByParentId.get(issueId) || [];
      const ownNodeHeight = calculateMindmapNodeHeight(depthByIssueId.get(issueId));
      if (childIssues.length === 0) {
        const height = ownNodeHeight + MINDMAP_LAYOUT_VERTICAL_GAP_PX;
        subtreeHeightByIssueId.set(issueId, height);
        return height;
      }
      let totalChildHeight = 0;
      for (const childIssue of childIssues) {
        totalChildHeight += calculateMindmapSubtreeHeight(childIssue.id, childIssuesByParentId, depthByIssueId, subtreeHeightByIssueId);
      }
      const height = Math.max(totalChildHeight, ownNodeHeight + MINDMAP_LAYOUT_VERTICAL_GAP_PX);
      subtreeHeightByIssueId.set(issueId, height);
      return height;
    }

    // 【前提】issueId・x・y は配置起点。subtreeHeightByIssueId は
    //   calculateMindmapSubtreeHeightで計算済み。positionByIssueId は書き込み先。
    // 【処理】親を起点に、子ノードを縦方向へ均等配置する（お手本mmAutoLayoutのlayout()に
    //   相当）。子ノード群の合計高さぶんを中心そろえで振り分け、深さに応じた水平間隔で
    //   右へ配置する。
    // 【結果】positionByIssueIdに{x,y}が書き込まれる（戻り値なし）。
    function layoutMindmapSubtree(issueId, x, y, childIssuesByParentId, depthByIssueId, subtreeHeightByIssueId, positionByIssueId) {
      positionByIssueId.set(issueId, { x, y });
      const childIssues = childIssuesByParentId.get(issueId) || [];
      if (childIssues.length === 0) return;
      const horizontalOffset = calculateMindmapHorizontalOffset(depthByIssueId.get(issueId));
      const totalChildHeight = childIssues.reduce((sum, childIssue) => sum + subtreeHeightByIssueId.get(childIssue.id), 0);
      let currentY = y - totalChildHeight / 2;
      for (const childIssue of childIssues) {
        const childSubtreeHeight = subtreeHeightByIssueId.get(childIssue.id);
        layoutMindmapSubtree(
          childIssue.id,
          x + horizontalOffset,
          currentY + childSubtreeHeight / 2,
          childIssuesByParentId,
          depthByIssueId,
          subtreeHeightByIssueId,
          positionByIssueId
        );
        currentY += childSubtreeHeight;
      }
    }

    // 【前提】issueList は同一プロジェクト内のissue全件。ルートissue（parentNodeIdが無い行）が
    //   1件以上存在すること（無ければ空のMapを返す）。
    // 【処理】最初に見つかったルートissueを起点に、親ノードを起点として子ノードを再帰的に
    //   均等配置するツリーレイアウトを計算する（追加実装仕様書8.3節：新規実装）。
    //   計算結果は全ノードの最小x/yがMINDMAP_LAYOUT_BASE_X/Yになるよう平行移動し、
    //   マイナス座標（画面外）に配置されるノードが出ないようにする。
    // 【結果】issueId→{x,y} のMapを返す。ルートissueが無ければ空のMapを返す
    //   （ルート以外から辿れない孤立ノードの座標もこのMapには含まれない＝更新されない）。
    function calculateMindmapAutoLayoutPositions(issueList) {
      const positionByIssueId = new Map();
      const rootIssue = issueList.find((issue) => issue.parentNodeId === null || issue.parentNodeId === undefined);
      if (!rootIssue) return positionByIssueId;

      const childIssuesByParentId = buildMindmapChildIssuesByParentId(issueList);
      const depthByIssueId = assignMindmapDepthLevels(rootIssue.id, childIssuesByParentId);
      const subtreeHeightByIssueId = new Map();
      calculateMindmapSubtreeHeight(rootIssue.id, childIssuesByParentId, depthByIssueId, subtreeHeightByIssueId);
      layoutMindmapSubtree(rootIssue.id, 0, 0, childIssuesByParentId, depthByIssueId, subtreeHeightByIssueId, positionByIssueId);

      let minX = Infinity;
      let minY = Infinity;
      for (const position of positionByIssueId.values()) {
        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
      }
      const offsetX = MINDMAP_LAYOUT_BASE_X - minX;
      const offsetY = MINDMAP_LAYOUT_BASE_Y - minY;
      for (const [issueId, position] of positionByIssueId) {
        positionByIssueId.set(issueId, { x: position.x + offsetX, y: position.y + offsetY });
      }
      return positionByIssueId;
    }

    // 【前提】projectId は実在するプロジェクトのid。
    // 【処理】そのプロジェクトの全issueを取得し、calculateMindmapAutoLayoutPositionsで
    //   再計算した座標をDBへ書き戻す（追加実装仕様書8.3節：ノード追加・削除のたびに呼び出す）。
    // 【結果】ルートから辿れる全issueのx/yが最新のツリーレイアウトに更新される。
    async function applyMindmapAutoLayout(projectId) {
      const issueList = await getIssuesByProject(projectId);
      const positionByIssueId = calculateMindmapAutoLayoutPositions(issueList);
      await Promise.all(
        issueList
          .filter((issue) => positionByIssueId.has(issue.id))
          .map((issue) => {
            const position = positionByIssueId.get(issue.id);
            return addIssue({ ...issue, x: position.x, y: position.y });
          })
      );
    }

    // 【前提】issueId は対象issueのid。issueList は同一プロジェクト内のissue全件。
    // 【処理】parentNodeIdを根まで辿り、ルートを0とした深さを数える。
    // 【結果】depthLevel（整数）。issueIdが見つからない場合は0を返す。
    function calculateIssueDepthLevel(issueId, issueList) {
      const issueById = new Map(issueList.map((issue) => [issue.id, issue]));
      let depthLevel = 0;
      let currentIssue = issueById.get(issueId);
      while (currentIssue && currentIssue.parentNodeId !== null && currentIssue.parentNodeId !== undefined) {
        depthLevel++;
        currentIssue = issueById.get(currentIssue.parentNodeId);
      }
      return depthLevel;
    }

    // ===== 追加実装仕様書8.3節：画面フィット =====
    // 現在のズーム倍率（1が等倍）。プロジェクトを切り替えるたびswitchToProjectでリセットする。
    let mindmapZoomLevel = 1;
    // 画面フィット時、ノードがキャンバスの端にぴったり付かないようにする余白。
    const MINDMAP_FIT_VIEW_PADDING_PX = 120;
    const MINDMAP_FIT_VIEW_MIN_ZOOM = 0.3;
    const MINDMAP_FIT_VIEW_MAX_ZOOM = 1.5;

    // 【前提】issueList は同一プロジェクト内のissue全件（x/y座標を持つ）。
    // 【処理】全ノードのx/y座標の範囲（bounding box）を求める。
    // 【結果】{minX, maxX, minY, maxY}。issueListが空ならnullを返す。
    function calculateMindmapBoundingBox(issueList) {
      if (issueList.length === 0) return null;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const issue of issueList) {
        minX = Math.min(minX, issue.x);
        maxX = Math.max(maxX, issue.x);
        minY = Math.min(minY, issue.y);
        maxY = Math.max(maxY, issue.y);
      }
      return { minX, maxX, minY, maxY };
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。
    // 【処理】全ノードのbounding boxと表示領域の大きさから、全ノードが収まるズーム倍率を
    //   計算し、スクロール位置をbounding boxの中心に合わせる（追加実装仕様書8.3節：
    //   お手本ganttforge.html mmFitViewと同じ考え方のボタン操作として新規実装する）。
    // 【結果】mindmapZoomLevelが更新され、キャンバスが再描画・再スクロールされる。
    async function handleMindmapFitViewButtonClick() {
      if (!currentSelectedProjectId) return;
      const issueList = await getIssuesByProject(currentSelectedProjectId);
      const boundingBox = calculateMindmapBoundingBox(issueList);
      if (!boundingBox) return;

      const canvasElement = document.querySelector(".mindmap-canvas");
      const viewportWidth = canvasElement.clientWidth;
      const viewportHeight = canvasElement.clientHeight;
      const boundingWidth = boundingBox.maxX - boundingBox.minX + MINDMAP_FIT_VIEW_PADDING_PX * 2;
      const boundingHeight = boundingBox.maxY - boundingBox.minY + MINDMAP_FIT_VIEW_PADDING_PX * 2;

      mindmapZoomLevel = Math.max(
        MINDMAP_FIT_VIEW_MIN_ZOOM,
        Math.min(MINDMAP_FIT_VIEW_MAX_ZOOM, viewportWidth / boundingWidth, viewportHeight / boundingHeight)
      );

      applyMindmapPanel(renderMindmapCanvasToHtml(issueList, collapsedMindmapIssueIds, mindmapIssueIdPendingInlineEdit, mindmapZoomLevel));

      const centerX = (boundingBox.minX + boundingBox.maxX) / 2;
      const centerY = (boundingBox.minY + boundingBox.maxY) / 2;
      canvasElement.scrollLeft = centerX * mindmapZoomLevel - viewportWidth / 2;
      canvasElement.scrollTop = centerY * mindmapZoomLevel - viewportHeight / 2;
    }

    // 【前提】projectList はプロジェクト全件。selectedProjectId は現在<select>に選ばせたいid。
    // 【処理】<option>タグのHTML文字列を組み立てる（DOMには触れない）。
    // 【結果】<select>のinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderProjectOptionsToHtml(projectList, selectedProjectId) {
      if (projectList.length === 0) {
        return '<option value="">(プロジェクトがありません)</option>';
      }
      return projectList
        .map((project) => {
          const isSelectedAttribute = project.id === selectedProjectId ? " selected" : "";
          return `<option value="${escapeHtmlText(project.id)}"${isSelectedAttribute}>${escapeHtmlText(project.name)}</option>`;
        })
        .join("");
    }

    // 【前提】scheduleTreeRows は buildScheduleTreeRows の戻り値（折りたたみ状態に関係なく
    //   常に全件）。visibleColumns は {startDate, endDate, status} の表示可否
    //   （基本設計書2.2節の固定順で右側から列を追加）。collapsedScheduleIds は折りたたまれている
    //   スケジュールidの集合。
    // 【処理】WBSパネル（ドラッグハンドル＋番号＋開閉＋スケジュール名列＋トグルされた追加列＋
    //   操作アイコン）のHTML文字列を組み立てる。WBS番号はcalculateWbsNumbersで全件から計算し
    //   （折りたたみで隠れていても採番自体は変わらないようにするため）、実際に描画する行は
    //   filterVisibleScheduleTreeRowsで絞り込む。
    //
    //   1行のレイアウト（左→右）：
    //   [ドラッグハンドル・ホバー時のみ] [開閉アイコン・子を持つ行のみ・常時表示]
    //   [WBS番号（太字・強調色）＋スケジュール名] [開始/終了/状態の追加列]
    //   [操作アイコン群（↑↓✎＋🗑）・ホバー時のみ]
    //
    //   開閉アイコンだけは「常時表示」（基本設計書4.1節に記載のある機能のため、ホバー無しでも
    //   操作できるようにする）。それ以外（ドラッグハンドル・操作アイコン群）はモーダル・
    //   ダイアログ一覧「1.」の指示どおりホバー時のみうっすら表示する。
    // 【結果】wbsPanel要素のinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderWbsPanelToHtml(scheduleTreeRows, visibleColumns, collapsedScheduleIds) {
      const headerExtraColumnsHtml = [
        visibleColumns.startDate ? '<div class="wbs-column-extra">開始日</div>' : "",
        visibleColumns.endDate ? '<div class="wbs-column-extra">終了日</div>' : "",
        visibleColumns.status ? '<div class="wbs-column-extra">状態</div>' : "",
      ].join("");
      const headerHtml = `<div class="wbs-header-row"><span class="wbs-drag-handle-spacer"></span><div class="wbs-column-name">スケジュール名</div>${headerExtraColumnsHtml}<div class="wbs-row-icons"></div></div>`;

      if (scheduleTreeRows.length === 0) {
        return headerHtml + '<p class="empty-state-message">スケジュールがありません。</p>';
      }

      const wbsNumberByScheduleId = calculateWbsNumbers(scheduleTreeRows);
      const visibleRows = filterVisibleScheduleTreeRows(scheduleTreeRows, collapsedScheduleIds);

      const rowsHtml = visibleRows
        .map(({ schedule, depthLevel, hasChildren, siblingIndex, siblingCount }) => {
          const wbsNumber = wbsNumberByScheduleId.get(schedule.id);
          const indentedName =
            "　".repeat(depthLevel) +
            `<span class="wbs-number">${escapeHtmlText(wbsNumber)}</span>`;
          const statusLabel = SCHEDULE_STATUS_LABELS[schedule.taskStatus] || schedule.taskStatus;
          const extraColumnsHtml = [
            visibleColumns.startDate ? `<div class="wbs-column-extra">${escapeHtmlText(schedule.startDate)}</div>` : "",
            visibleColumns.endDate ? `<div class="wbs-column-extra">${escapeHtmlText(schedule.endDate)}</div>` : "",
            visibleColumns.status ? `<div class="wbs-column-extra">${escapeHtmlText(statusLabel)}</div>` : "",
          ].join("");

          // 開閉アイコンは「WBS番号とスケジュール名の間」に常時表示する（ホバー不要）。
          // 子を持たない行はアイコン自体を出さない（スペーサーも置かない）。
          const isCollapsed = collapsedScheduleIds.has(schedule.id);
          const toggleButtonHtml = hasChildren
            ? `<button type="button" class="wbs-icon-button wbs-toggle-button" data-action="toggle-collapse" title="開閉">${isCollapsed ? "＋" : "－"}</button>`
            : "";

          const isFirstInGroup = siblingIndex === 0;
          const isLastInGroup = siblingIndex === siblingCount - 1;
          const canAddChild = depthLevel < MAX_SCHEDULE_DEPTH_LEVEL_ALLOWING_CHILDREN;
          // 操作アイコン群は行の右端（追加列のさらに右）に、上／下／編集／子追加／削除の順で表示する。
          const iconsHtml = `<div class="wbs-row-icons">
            <button type="button" class="wbs-icon-button" data-action="move-up" ${isFirstInGroup ? "disabled" : ""} title="上へ移動">↑</button>
            <button type="button" class="wbs-icon-button" data-action="move-down" ${isLastInGroup ? "disabled" : ""} title="下へ移動">↓</button>
            <button type="button" class="wbs-icon-button" data-action="edit" title="編集">✎</button>
            <button type="button" class="wbs-icon-button" data-action="add-child" ${canAddChild ? "" : "disabled"} title="子スケジュール追加">＋</button>
            <button type="button" class="wbs-icon-button" data-action="delete" title="削除">🗑</button>
          </div>`;

          return `<div class="wbs-row" draggable="true" data-schedule-id="${escapeHtmlText(schedule.id)}"><span class="wbs-drag-handle" title="ドラッグして並び替え">⋮⋮</span><div class="wbs-column-name">${indentedName}${toggleButtonHtml} ${escapeHtmlText(schedule.name)}</div>${extraColumnsHtml}${iconsHtml}</div>`;
        })
        .join("");
      return headerHtml + rowsHtml;
    }

    // 【前提】month は1〜12の整数。
    // 【処理】月から四半期番号（1〜4）を求める（Q1=1-3月, Q2=4-6月, Q3=7-9月, Q4=10-12月）。
    // 【結果】四半期番号を返す。
    function calculateQuarterNumber(month) {
      return Math.ceil(month / 3);
    }

    // 【設計判断：なぜtimelineDaysは常に「日」単位のままなのか】
    //   表示粒度（日/週/1ヶ月/3ヶ月）が変わっても、buildGanttTimelineDaysが返す「プロジェクト
    //   全期間ぶんの日単位配列」自体は作り直さない。粒度ごとの見出し・列幅は、この日単位配列を
    //   「どうグルーピングするか」だけを変えて表現する。こうすることで、
    //   ①スケジュール件数に関係なくプロジェクト全期間の列が必ず生成される（今回の不具合の根本原因は
    //   　0件時に本体の描画自体を早期returnでスキップしていたこと。グルーピング元を「常に完全な
    //   　日単位配列」に統一し、行の有無と列の生成を分離することで解消する）、
    //   ②粒度切替のたびに日付計算をやり直さずに済む、という2つの利点がある。
    //
    // 【前提】timelineDays は buildGanttTimelineDays の戻り値（必ずプロジェクト全期間ぶん）。
    //   granularity は "day" | "week" | "month" | "quarter"。
    // 【処理】1段目（大分類の見出し）・2段目（詳細列の見出し）を、指定した粒度でグルーピングする。
    //   - day：2段目=1日ごと（日付）／1段目=同年月をまとめた「年月」
    //   - week：2段目=7日ごと（先頭日の月/日）／1段目=先頭日が属する「年月」
    //   - month：2段目=暦月ごと（月）／1段目=同じ（年,四半期）をまとめた「年 Q数」
    //   - quarter：2段目=暦四半期ごと（Q数（開始月-終了月月））／1段目=同じ年をまとめた「年」
    //   いずれの粒度でも、timelineDaysの全区間を漏れなくグループ化する（途中で打ち切らない）。
    // 【結果】{ level1Groups, level2Groups } を返す。各グループは
    //   { label, startIndex, dayCount } を持ち、startIndex/dayCountはtimelineDays配列上の
    //   位置・日数（px座標の計算にそのまま使える）。
    function buildGanttTimelineHeaderGroups(timelineDays, granularity) {
      const level2Groups = [];

      if (granularity === "day") {
        timelineDays.forEach((day, index) => {
          level2Groups.push({
            label: String(day.dayOfMonth),
            startIndex: index,
            dayCount: 1,
            level1Key: `${day.year}-${day.month}`,
            level1Label: `${day.year}年${day.month}月`,
          });
        });
      } else if (granularity === "week") {
        for (let startIndex = 0; startIndex < timelineDays.length; startIndex += 7) {
          const dayCount = Math.min(7, timelineDays.length - startIndex);
          const firstDay = timelineDays[startIndex];
          level2Groups.push({
            label: `${firstDay.month}/${firstDay.dayOfMonth}`,
            startIndex,
            dayCount,
            level1Key: `${firstDay.year}-${firstDay.month}`,
            level1Label: `${firstDay.year}年${firstDay.month}月`,
          });
        }
      } else if (granularity === "month") {
        let groupStartIndex = 0;
        for (let index = 1; index <= timelineDays.length; index++) {
          const isBoundary =
            index === timelineDays.length ||
            timelineDays[index].year !== timelineDays[groupStartIndex].year ||
            timelineDays[index].month !== timelineDays[groupStartIndex].month;
          if (!isBoundary) continue;
          const { year, month } = timelineDays[groupStartIndex];
          const quarter = calculateQuarterNumber(month);
          level2Groups.push({
            label: `${month}月`,
            startIndex: groupStartIndex,
            dayCount: index - groupStartIndex,
            level1Key: `${year}-Q${quarter}`,
            level1Label: `${year}年 Q${quarter}`,
          });
          groupStartIndex = index;
        }
      } else if (granularity === "quarter") {
        let groupStartIndex = 0;
        for (let index = 1; index <= timelineDays.length; index++) {
          const currentQuarter = calculateQuarterNumber(timelineDays[groupStartIndex].month);
          const isBoundary =
            index === timelineDays.length ||
            timelineDays[index].year !== timelineDays[groupStartIndex].year ||
            calculateQuarterNumber(timelineDays[index].month) !== currentQuarter;
          if (!isBoundary) continue;
          const { year } = timelineDays[groupStartIndex];
          const quarterStartMonth = (currentQuarter - 1) * 3 + 1;
          const quarterEndMonth = quarterStartMonth + 2;
          level2Groups.push({
            label: `Q${currentQuarter}（${quarterStartMonth}-${quarterEndMonth}月）`,
            startIndex: groupStartIndex,
            dayCount: index - groupStartIndex,
            level1Key: `${year}`,
            level1Label: `${year}年`,
          });
          groupStartIndex = index;
        }
      }

      // 1段目は、連続するlevel2Groupsのうちlevel1Keyが同じものをまとめて1つの見出しにする。
      const level1Groups = [];
      for (const level2Group of level2Groups) {
        const lastLevel1Group = level1Groups[level1Groups.length - 1];
        if (lastLevel1Group && lastLevel1Group.level1Key === level2Group.level1Key) {
          lastLevel1Group.dayCount += level2Group.dayCount;
        } else {
          level1Groups.push({
            label: level2Group.level1Label,
            level1Key: level2Group.level1Key,
            startIndex: level2Group.startIndex,
            dayCount: level2Group.dayCount,
          });
        }
      }

      return { level1Groups, level2Groups };
    }

    // 【前提】timelineDays は buildGanttTimelineDays の戻り値。granularity は表示粒度。
    //   milestones は project.milestones。timelineStartDateString は基準日（1日目の日付）。
    //   todayDateString は基準日（"YYYY-MM-DD"）。呼び出し元がnew Date()から求めて渡す。
    // 【処理】buildGanttTimelineHeaderGroupsで1段目・2段目の見出しグループを求め、
    //   それぞれをHTML文字列化する（UIデザイン仕様書1.3節：タイムラインヘッダー高さ82px＝
    //   1段目40px＋2段目42px相当として配分）。土日の色分けは「日」表示のときのみ意味を持つ。
    // 【設計判断：マイルストーンのひし形＋名前ラベルは月・日の見出し行の「上」に専用の帯として
    //   描画する（追加実装仕様書4章）】ガント本体（.gantt-body）内はバーが並ぶレイヤーのため、
    //   そこにひし形を重ねると視認性が落ちる。ヘッダーと本体は同じ横スクロールコンテナの中に
    //   あるため、calculateMilestoneMarkerPositionsが返すleftPxはどちらでもそのまま使える。
    // 【設計判断：「今日」もマイルストーンと同じ帯に表示する】マイルストーン名と同じ列
    //   （.gantt-milestone-band）に、青背景・白文字の「今日」ピンを追加する（ユーザー指示）。
    //   ピンの先端（三角形）が縦線の位置を指すよう、マーカー自体をtranslateX(-50%)で
    //   その日の左端＋半日ぶんの位置に中央揃えする。
    // 【結果】gantt-timeline-headerのHTML文字列を返す。
    function renderGanttTimelineHeaderToHtml(timelineDays, pixelsPerDay, granularity, milestones, timelineStartDateString, todayDateString) {
      const { level1Groups, level2Groups } = buildGanttTimelineHeaderGroups(timelineDays, granularity);

      const milestoneBandHtml = calculateMilestoneMarkerPositions(milestones, timelineStartDateString, pixelsPerDay)
        .map(
          (marker) =>
            `<div class="gantt-milestone-band-marker" style="left:${marker.leftPx}px"><div class="gantt-milestone-band-diamond"></div><span class="gantt-milestone-band-label">${escapeHtmlText(marker.name)}</span></div>`
        )
        .join("");

      const todayMarkerLeftPx = calculateTodayMarkerPosition(timelineDays, timelineStartDateString, pixelsPerDay, todayDateString);
      const todayBandHtml =
        todayMarkerLeftPx === null
          ? ""
          : `<div class="gantt-today-band-marker" style="left:${todayMarkerLeftPx + pixelsPerDay / 2}px"><div class="gantt-today-band-pin">今日</div></div>`;

      const level1Html = level1Groups
        .map(
          (group) =>
            `<div class="gantt-month-label" style="left:${group.startIndex * pixelsPerDay}px;width:${group.dayCount * pixelsPerDay}px">${escapeHtmlText(group.label)}</div>`
        )
        .join("");

      const level2Html = level2Groups
        .map((group) => {
          const firstDay = timelineDays[group.startIndex];
          const dayTypeClassName = granularity === "day" ? calculateDayTypeBackgroundClassName(firstDay.dayType) : "";
          const weekendClass = dayTypeClassName ? ` ${dayTypeClassName}` : "";
          return `<div class="gantt-day-column-header${weekendClass}" style="left:${group.startIndex * pixelsPerDay}px;width:${group.dayCount * pixelsPerDay}px">${escapeHtmlText(group.label)}</div>`;
        })
        .join("");

      const totalWidthPx = timelineDays.length * pixelsPerDay;
      return `<div class="gantt-timeline-header" style="width:${totalWidthPx}px"><div class="gantt-milestone-band">${milestoneBandHtml}${todayBandHtml}</div>${level1Html}${level2Html}</div>`;
    }

    // 【前提】scheduleTreeRows は buildScheduleTreeRows の戻り値。timelineDays は
    //   buildGanttTimelineDays の戻り値。milestones は project.milestones。todayDateString は
    //   基準日（"YYYY-MM-DD"）。呼び出し元がnew Date()から求めて渡す（純粋関数として保つため）。
    // 【処理】列の背景（「日」表示は土日の色分け、それ以外の粒度は縞模様）、行の背景、バー
    //   （親行は太め・中央配置、葉行は細め・行の65%位置、完了ステータスは半透明）、
    //   マイルストーンの縦線＋ひし形マーカー、今日を示す縦のハイライト線をすべて絶対配置の
    //   divとして組み立てる（UIデザイン仕様書3章の視覚仕様に準拠）。
    // 【設計判断：スケジュール0件でも列は必ずプロジェクト全期間ぶん描画する】
    //   以前は「0件なら本体を描画せずメッセージのみ」としていたため、列（背景の縞模様）自体が
    //   全く生成されない不具合があった。列の生成（periodColumnsHtml）と行の生成
    //   （rowBackgroundsHtml・barsHtml、0件なら単に空文字列になるだけ）を分離し、
    //   0件時は「空状態メッセージを上に重ねて表示するが、列は最後まで描画されている」形にする。
    // 【設計判断：グリッド背景（列の色帯）・マイルストーン線・今日マーカーの高さを
    //   実データ行数に縛られないようにする】
    //   これら3種類の縦の要素は、CSS側で`top:0;bottom:0`にして「親要素(.gantt-body)の
    //   実際の高さいっぱいに伸びる」設計にする（pxで高さを指定しない）。.gantt-body自体の
    //   高さを「実データ行数ぶん」と「画面の表示領域の高さ」のどちらか大きい方にすれば
    //   （後述のtotalHeightPx／CSS変数--gantt-body-min-heightのmax()）、この3種類は
    //   自動的にその高さまで届く。逆に、以前のようにこれらの要素へ個別にpx単位の高さを
    //   指定してしまうと、指定した値がCSSのtop/bottom挙動より優先されてしまい、
    //   実データ行数分の高さで頭打ちになる（今回の不具合の原因）。
    // 【結果】gantt-bodyのHTML文字列を返す。
    function renderGanttBodyToHtml(scheduleTreeRows, timelineDays, pixelsPerDay, milestones, timelineStartDateString, granularity, todayDateString) {
      const totalWidthPx = timelineDays.length * pixelsPerDay;
      const totalHeightPx = Math.max(scheduleTreeRows.length * GANTT_ROW_HEIGHT_PX, GANTT_ROW_HEIGHT_PX);

      const rowBackgroundsHtml = scheduleTreeRows
        .map((_, rowIndex) => {
          const evenClass = rowIndex % 2 === 1 ? " is-even-row" : "";
          return `<div class="gantt-row-background${evenClass}" style="top:${rowIndex * GANTT_ROW_HEIGHT_PX}px"></div>`;
        })
        .join("");

      const { level2Groups } = buildGanttTimelineHeaderGroups(timelineDays, granularity);
      const periodColumnsHtml = level2Groups
        .map((group, groupIndex) => {
          const firstDay = timelineDays[group.startIndex];
          let backgroundClass = "";
          if (granularity === "day") {
            backgroundClass = calculateDayTypeBackgroundClassName(firstDay.dayType);
          } else if (groupIndex % 2 === 1) {
            backgroundClass = "is-alt-period";
          }
          if (!backgroundClass) return "";
          return `<div class="gantt-day-column-bg ${backgroundClass}" style="left:${group.startIndex * pixelsPerDay}px;width:${group.dayCount * pixelsPerDay}px"></div>`;
        })
        .join("");

      // 追加実装仕様書3.1節：日ごとの区切りを示す薄い縦線。土日・祝日は上のperiodColumnsHtml
      // （背景色）で別途表現するため、ここでは平日部分も含めた全ての日境界に線を引く。
      // 【設計判断】日数ぶんのdivを1つずつ生成せず、repeating-linear-gradientで
      // pixelsPerDayごとに1pxの縦線が繰り返される背景画像として1つのdivにまとめる
      // （行数×日数のDOM要素が増えるのを避けるため）。「日」表示以外の粒度では1列が
      // 複数日をまとめた列になり日境界の概念自体が薄れるため、この線は「日」表示の
      // ときだけ描画する（背景色の土日判定と同じ条件分岐）。
      const dayGridLinesHtml =
        granularity === "day"
          ? `<div class="gantt-day-grid-lines" style="width:${totalWidthPx}px;background-size:${pixelsPerDay}px 100%"></div>`
          : "";
      // 【前提】scheduleTreeRows はbuildScheduleTreeRowsの戻り値（全行がフラットに並ぶ）。
      // 【処理】親行のバーラベルに使う「直接の子の営業日数合計」を求めるため、
      //   parentId→直接の子スケジュール配列のMapを組み立てる（追加実装仕様書1.3節：
      //   お手本1938行目と同様、直接の子のみを合計し孫以下は加算しない）。
      const childSchedulesByParentId = new Map();
      for (const { schedule } of scheduleTreeRows) {
        if (schedule.parentId === null || schedule.parentId === undefined) continue;
        if (!childSchedulesByParentId.has(schedule.parentId)) {
          childSchedulesByParentId.set(schedule.parentId, []);
        }
        childSchedulesByParentId.get(schedule.parentId).push(schedule);
      }

      const barsHtml = scheduleTreeRows
        .map(({ schedule, hasChildren }, rowIndex) => {
          const geometry = calculateBarGeometry(schedule, timelineStartDateString, pixelsPerDay);
          if (!geometry) return "";
          const rowTopPx = rowIndex * GANTT_ROW_HEIGHT_PX;
          const barHeightPx = hasChildren ? 22 : 16;
          const barTopPx = hasChildren
            ? rowTopPx + (GANTT_ROW_HEIGHT_PX - barHeightPx) / 2
            : rowTopPx + GANTT_ROW_HEIGHT_PX * 0.65 - barHeightPx / 2;
          const doneClass = schedule.taskStatus === "done" ? " is-done-status" : "";
          const parentClass = hasChildren ? " is-parent-bar" : "";
          const showLabel = hasChildren || geometry.widthPx > 60;
          // 【設計判断】親行のラベルだけは「直接の子の営業日数合計」を表示する
          //   （追加実装仕様書1.3節：親自身の日数ではなく、子タスク合計日数を表示する箇所）。
          //   葉（子なし）行のラベルはお手本と異なり従来通り暦日数のまま維持する
          //   （本書に明記されていない箇所を変更しないため）。
          const parentChildBusinessDayTotal = hasChildren
            ? (childSchedulesByParentId.get(schedule.id) || []).reduce(
                (total, childSchedule) => total + calculateBusinessDayCount(childSchedule.startDate, childSchedule.endDate),
                0
              )
            : 0;
          const labelDayCount = hasChildren ? parentChildBusinessDayTotal : geometry.durationDays;
          const labelText = showLabel ? `${escapeHtmlText(schedule.name)} (${labelDayCount}日)` : "";
          const backgroundColor = schedule.color || "#2563EB";
          // 【設計判断】掴み手（bar-lh/bar-rh）は子を持たない行（葉ノード）にしか付与しない
          // （詳細設計書3.2.4：親行は移動のみ可能でリサイズ不可。親の日付は子から自動算出される
          // ため、意図的にリサイズ不可としている）。
          const resizeHandlesHtml = hasChildren
            ? ""
            : `<div class="gantt-bar-handle bar-lh" data-drag-mode="resize-start"></div><div class="gantt-bar-handle bar-rh" data-drag-mode="resize"></div>`;
          // 【前提】お手本ganttforge.html 1936行目と同じ書式（追加実装仕様書1.3節）。
          // 【処理】営業日数・ステータス・メモ（あれば）をネイティブtitle属性用の文字列に組み立てる。
          const scheduleBusinessDayCount = calculateBusinessDayCount(schedule.startDate, schedule.endDate);
          const statusLabel = SCHEDULE_STATUS_LABELS[schedule.taskStatus] || schedule.taskStatus;
          const notesSuffix = schedule.notes ? `\n\n${schedule.notes}` : "";
          const barTitleText = `${schedule.name}\n${schedule.startDate} 〜 ${schedule.endDate}（${scheduleBusinessDayCount}営業日）\nステータス: ${statusLabel}${notesSuffix}`;
          return `<div class="gantt-bar${parentClass}${doneClass}" data-schedule-id="${escapeHtmlText(schedule.id)}" style="left:${geometry.leftPx}px;top:${barTopPx}px;width:${geometry.widthPx}px;height:${barHeightPx}px;background:${backgroundColor}" title="${escapeHtmlText(barTitleText)}">${labelText}${resizeHandlesHtml}</div>`;
        })
        .join("");

      // 【前提】マイルストーン線・今日マーカーはどちらも「left位置だけ決めて、高さは
      //   CSSのtop:0;bottom:0に任せる」ため、ここでは高さ(height)を指定しない。
      // 【設計判断】ひし形＋名前ラベルはrenderGanttTimelineHeaderToHtml側の専用帯
      //   （.gantt-milestone-band）に描画するため、ここでは縦のガイド線のみを描画する。
      const milestoneMarkersHtml = calculateMilestoneMarkerPositions(milestones, timelineStartDateString, pixelsPerDay)
        .map((marker) => `<div class="gantt-milestone-marker" style="left:${marker.leftPx}px"></div>`)
        .join("");

      const todayMarkerLeftPx = calculateTodayMarkerPosition(timelineDays, timelineStartDateString, pixelsPerDay, todayDateString);
      const todayMarkerHtml =
        todayMarkerLeftPx === null ? "" : `<div class="gantt-today-marker" style="left:${todayMarkerLeftPx}px" title="今日"></div>`;

      const emptyMessageHtml =
        scheduleTreeRows.length === 0 ? '<p class="empty-state-message gantt-empty-overlay">スケジュールがありません。</p>' : "";

      // 【設計判断：.gantt-bodyの高さは「実データ行数」と「画面の表示領域の高さ」の
      //   大きい方にする】CSSのmax()を使い、実データが画面より多ければ実データの高さ
      //   （＝縦スクロールが発生する）、少なければ画面の表示領域の下端まで
      //   （--gantt-body-min-height、:root定義）を採用する。
      return `<div class="gantt-body" style="width:${totalWidthPx}px;min-height:max(${totalHeightPx}px, var(--gantt-body-min-height))">${periodColumnsHtml}${rowBackgroundsHtml}${dayGridLinesHtml}${barsHtml}${milestoneMarkersHtml}${todayMarkerHtml}${emptyMessageHtml}</div>`;
    }

    // 【前提】scheduleTreeRows・timelineDays・milestonesは上記各関数の戻り値・入力と同じ。
    //   granularityは表示粒度。todayDateStringは基準日（呼び出し元がnew Date()から求めて渡す）。
    // 【処理】タイムラインヘッダーとガント本体を連結する（ガントパネル全体の組み立て窓口）。
    //   スケジュールが0件でも、ヘッダー・本体とも必ずプロジェクト全期間ぶんの列を描画する
    //   （0件用の早期returnは行わない。今回修正した不具合の要点）。
    // 【結果】ganttPanelBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderGanttChartToHtml(scheduleTreeRows, timelineDays, pixelsPerDay, milestones, timelineStartDateString, granularity, todayDateString) {
      return (
        renderGanttTimelineHeaderToHtml(timelineDays, pixelsPerDay, granularity, milestones, timelineStartDateString, todayDateString) +
        renderGanttBodyToHtml(scheduleTreeRows, timelineDays, pixelsPerDay, milestones, timelineStartDateString, granularity, todayDateString)
      );
    }

    // タスクのpriority（1:高〜4:なし）の日本語表示名（データモデル設計3.3節）。
    const TASK_PRIORITY_LABELS = { 1: "高", 2: "中", 3: "低", 4: "なし" };
    // タスクのstatus（backlog/doing/done）の日本語表示名。カンバン列見出しと編集モーダルの
    // ステータス選択で共有する。
    const TASK_STATUS_LABELS = { backlog: "未着手", doing: "進行中", done: "完了" };

    // 追加実装仕様書6.1節：カンバン追加フォームの開閉。お手本ganttforge.htmlの_kbAddCol
    // （どの列の追加フォームが開いているかを表す、列を跨いで1つだけの状態）を踏襲する。
    // nullなら全列とも閉じている（＝「＋追加」ボタンのみ表示）。
    let openKanbanAddFormColumnStatus = null;

    // 【前提】taskListForColumn はある1つのstatusに属するタスク配列。columnLabel はその列の
    //   日本語見出し。columnStatusValue はそのstatus文字列（追加フォームの送信先に使う）。
    //   isAddFormOpen はこの列の追加フォームを開いた状態で描画するか。
    // 【処理】1列分のカンバンカード（各カードに削除ボタンを添える。詳細設計書3.3.2：
    //   deleteTodo）を組み立てる。追加フォームは「＋追加」を押した時だけ開く単発フォーム
    //   とする（追加実装仕様書6.1節：常時表示だった埋め込みフォームを廃止し、
    //   お手本と同じ開閉方式に変更。isAddFormOpenがfalseの間は「＋追加」ボタンのみ表示し、
    //   trueになった列だけタスク名・優先度・期日の入力欄と追加／×（閉じる）ボタンを表示する）。
    //   完了列("done")のみ、完了済み一括削除ボタンを見出し横に添える（詳細設計書3.3.2：
    //   clearDoneTodos）。
    // 【結果】renderKanbanBoardToHtml から列単位で呼び出されるHTML文字列を返す。
    function renderKanbanColumnToHtml(taskListForColumn, columnLabel, columnStatusValue, isAddFormOpen) {
      const cardsHtml =
        taskListForColumn.length === 0
          ? '<p class="empty-state-message">タスクがありません。</p>'
          : taskListForColumn
              .map((task) => {
                const dueDateHtml = task.dueDate ? `<div class="panel-list-item-meta">期日：${escapeHtmlText(task.dueDate)}</div>` : "";
                const priorityLabel = TASK_PRIORITY_LABELS[task.priority] || task.priority;
                const priorityBadgeHtml = `<span class="priority-badge priority-${escapeHtmlText(String(task.priority))}">${escapeHtmlText(priorityLabel)}</span>`;
                // 追加実装仕様書11章：メモ（description）付きカードにお手本と同じ📝バッジを表示し、
                // titleにメモ本文全体を表示する（お手本ganttforge.htmlのkb-card-tag memoに相当。
                // 現状このバッジ自体が実装されていなかったため新規に追加する）。
                const memoBadgeHtml = task.description
                  ? `<span class="kanban-card-memo-badge" title="${escapeHtmlText(task.description)}">📝</span>`
                  : "";
                return `<div class="kanban-card" data-task-id="${escapeHtmlText(task.id)}" draggable="true">
                    <div class="kanban-card-main" data-action="edit-task" title="編集">
                      <div>${escapeHtmlText(task.title)} ${priorityBadgeHtml}${memoBadgeHtml}</div>
                      ${dueDateHtml}
                    </div>
                    <button type="button" class="wbs-icon-button" data-action="delete-task" title="削除">🗑</button>
                  </div>`;
              })
              .join("");

      let addFormHtml;
      if (isAddFormOpen) {
        const priorityOptionsHtml = Object.entries(TASK_PRIORITY_LABELS)
          .map(([value, label]) => `<option value="${value}"${value === "4" ? " selected" : ""}>${label}</option>`)
          .join("");
        addFormHtml = `
          <div class="kanban-add-form" data-column-status="${columnStatusValue}">
            <input type="text" class="kanban-add-title-input" placeholder="タスク名">
            <select class="kanban-add-priority-select">${priorityOptionsHtml}</select>
            <input type="date" class="kanban-add-duedate-input">
            <div class="kanban-add-form-actions">
              <button type="button" class="panel-add-button kanban-add-submit-button">＋ 追加</button>
              <button type="button" class="wbs-icon-button kanban-add-cancel-button" title="閉じる">×</button>
            </div>
          </div>
        `;
      } else {
        addFormHtml = `<button type="button" class="kanban-add-toggle-button" data-column-status="${columnStatusValue}">＋ 追加</button>`;
      }
      const clearDoneButtonHtml =
        columnStatusValue === "done" ? '<button type="button" class="toolbar-button" id="clearDoneTasksButton">完了済みを一括削除</button>' : "";
      return `<div class="kanban-column" data-column-status="${columnStatusValue}">
        <div class="kanban-column-header">
          <h3>${escapeHtmlText(columnLabel)}</h3>
          ${clearDoneButtonHtml}
        </div>
        ${cardsHtml}${addFormHtml}
      </div>`;
    }

    // 【前提】taskGroupsByStatus は groupTasksByStatus の戻り値。
    // 【処理】backlog/doing/doneの3列を横に並べたカンバンボード全体のHTML文字列を組み立てる。
    //   openKanbanAddFormColumnStatusと一致する列だけ追加フォームを開いた状態で描画する。
    // 【結果】カンバンパネルのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderKanbanBoardToHtml(taskGroupsByStatus) {
      return `<div class="kanban-board">
        ${renderKanbanColumnToHtml(taskGroupsByStatus.backlog, "未着手", "backlog", openKanbanAddFormColumnStatus === "backlog")}
        ${renderKanbanColumnToHtml(taskGroupsByStatus.doing, "進行中", "doing", openKanbanAddFormColumnStatus === "doing")}
        ${renderKanbanColumnToHtml(taskGroupsByStatus.done, "完了", "done", openKanbanAddFormColumnStatus === "done")}
      </div>`;
    }

    // 【前提】issueList は同一プロジェクト内のissue全件（折りたたみ状態に関係なく常に全件、
    //   x,y座標を持つ）。collapsedIssueIds は折りたたまれているissueidの集合。
    //   pendingInlineEditIssueId は追加実装仕様書8.1節：タイトル未確定でインライン編集中の
    //   issueid（無ければnull）。zoomLevel は追加実装仕様書8.3節：画面フィットのズーム倍率
    //   （1が等倍）。
    // 【処理】filterVisibleIssuesで実際に表示する行を絞り込んでから、issue.x/yをそのまま
    //   絶対配置の左上原点として使い、ノード（丸みを帯びたラベル）と、親子を結ぶ線
    //   （buildMindmapEdgeList・calculateEdgeGeometry。辺も絞り込み後のissueListから
    //   計算するため、隠れた子ノードへの辺は自動的に描画されない）を組み立てる。
    //   各ノードにdata-issue-idを持たせ、ドラッグ配置・右クリックメニューの対象特定に使う。
    //   子を持つノードには「▸ 」を名前の前に付け、折りたたみ中はis-collapsed-nodeクラスで
    //   見た目の目印を付ける。pendingInlineEditIssueIdに一致するノードだけは、名前の代わりに
    //   タイトル入力用の<input>を描画する。
    //   ズームは.mindmap-canvas-inner（内側の入れ物）にtransform:scaleで適用する。issue.x/yの
    //   座標系はそのままに、見た目の拡大縮小だけを行うため、他の座標計算に影響しない。
    // 【結果】マインドマップキャンバスのHTML文字列を返す。
    function renderMindmapCanvasToHtml(issueList, collapsedIssueIds, pendingInlineEditIssueId, zoomLevel) {
      const visibleIssues = filterVisibleIssues(issueList, collapsedIssueIds);
      if (visibleIssues.length === 0) {
        return '<p class="empty-state-message">マインドマップノードがありません。</p>';
      }
      const edgesHtml = buildMindmapEdgeList(visibleIssues)
        .map(({ fromIssue, toIssue }) => {
          const geometry = calculateEdgeGeometry(fromIssue.x, fromIssue.y, toIssue.x, toIssue.y);
          return `<div class="mindmap-edge" style="left:${geometry.leftPx}px;top:${geometry.topPx}px;width:${geometry.widthPx}px;transform:rotate(${geometry.angleDeg}deg)"></div>`;
        })
        .join("");
      const nodesHtml = visibleIssues
        .map((issue) => {
          const backgroundColor = issue.color || MINDMAP_NODE_COLORS[0];
          const hasChildren = issueList.some((candidateChild) => candidateChild.parentNodeId === issue.id);
          const isCollapsed = collapsedIssueIds.has(issue.id);
          const collapsedClass = isCollapsed ? " is-collapsed-node" : "";
          const collapsedIndicator = hasChildren && isCollapsed ? "▸ " : "";
          const isPendingInlineEdit = issue.id === pendingInlineEditIssueId;
          const editingClass = isPendingInlineEdit ? " is-inline-editing" : "";
          const nodeInnerHtml = isPendingInlineEdit
            ? `<input type="text" class="mindmap-inline-edit-input" data-issue-id="${escapeHtmlText(issue.id)}" value="${escapeHtmlText(issue.title)}">`
            : `${collapsedIndicator}${escapeHtmlText(issue.title)}`;
          return `<div class="mindmap-node${collapsedClass}${editingClass}" data-issue-id="${escapeHtmlText(issue.id)}" style="left:${issue.x}px;top:${issue.y}px;background:${backgroundColor}">${nodeInnerHtml}</div>`;
        })
        .join("");
      return `<div class="mindmap-canvas"><div class="mindmap-canvas-inner" style="transform:scale(${zoomLevel})">${edgesHtml}${nodesHtml}</div></div>`;
    }

