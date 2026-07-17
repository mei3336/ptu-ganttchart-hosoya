    // ===== ガントバーのドラッグによる日程変更（詳細設計書3.2.4） =====
    // 【設計判断】マインドマップノードのドラッグ（pointerdown/pointermove/pointerup、
    //   handleMindmapNodePointerDown等）と同じ実装パターンを使う。ドラッグ中は見た目
    //   （left/width）だけを更新し、DBへの保存はpointerup時の1回だけ行う。
    //   3モード（詳細設計書3.2.4）：
    //   ・move：バー本体をつかんだ場合。開始日・終了日を同じ日数だけ平行移動（期間不変）。
    //   ・resize-start：左端の掴み手（bar-lh）をつかんだ場合。開始日のみ変更。
    //   ・resize：右端の掴み手（bar-rh）をつかんだ場合。終了日のみ変更。
    //   掴み手は葉ノード（子を持たない行）にしか無いため、親行（子を持つ行）は常にmoveのみになる。
    //   【設計判断：親行をmoveした場合の子孫の扱い】親の日付は子から自動算出される仕様
    //   （3.2.3・syncAncestorDates）のため、親バーだけを動かしても次に子が変わった瞬間に
    //   syncAncestorDatesで元へ戻ってしまい操作が意味を持たない。詳細設計書はこの点を明記
    //   していないが、データの整合性を保つため、親行をmoveした場合は配下の子孫スケジュールも
    //   同じ日数だけ平行移動する（さらに上の祖先の日付はsyncAncestorDatesで再計算する）。

    // ドラッグ中のスケジュールid・モード。ドラッグしていない時はnull。
    let draggedBarScheduleId = null;
    let draggedBarMode = null; // "move" | "resize-start" | "resize"
    let barDragStartPointerX = 0;
    let barDragStartStartDate = "";
    let barDragStartEndDate = "";
    let barDragPixelsPerDay = 0;
    // これ未満の移動量は「クリック」とみなす（MINDMAP_DRAG_THRESHOLD_PXと同じ考え方）。
    // pointerup直後に発火するclickイベントで、実際にドラッグした場合だけタスクポップアップを
    // 開かせないようにするため、handleBarPointerUpが移動量を判定してこの変数に記録する。
    const BAR_CLICK_VS_DRAG_THRESHOLD_PX = 3;
    let wasBarPointerMovedSignificantly = false;

    // 【前提】rootScheduleId は起点スケジュールのid。allSchedules は同一プロジェクト内の
    //   全スケジュール。
    // 【処理】parentIdをたどり、rootScheduleIdの子孫（子・孫）を幅優先で収集する
    //   （deleteScheduleCascadeと同じ考え方。root自身は含めない）。
    // 【結果】子孫スケジュールオブジェクトの配列を返す（子孫がなければ空配列）。
    function collectScheduleDescendants(rootScheduleId, allSchedules) {
      const childSchedulesByParentId = new Map();
      for (const schedule of allSchedules) {
        if (schedule.parentId === null || schedule.parentId === undefined) continue;
        if (!childSchedulesByParentId.has(schedule.parentId)) {
          childSchedulesByParentId.set(schedule.parentId, []);
        }
        childSchedulesByParentId.get(schedule.parentId).push(schedule);
      }
      const descendants = [];
      let frontier = childSchedulesByParentId.get(rootScheduleId) || [];
      while (frontier.length > 0) {
        descendants.push(...frontier);
        const nextFrontier = [];
        for (const node of frontier) {
          nextFrontier.push(...(childSchedulesByParentId.get(node.id) || []));
        }
        frontier = nextFrontier;
      }
      return descendants;
    }

    // 【前提】event はガントバー（.gantt-bar）またはその掴み手（.gantt-bar-handle）上での
    //   pointerdownイベント。scheduleId はそのバーが表すスケジュールid。mode は
    //   "move"|"resize-start"|"resize"。barElement は実際にポインタを捕捉する要素（.gantt-bar
    //   自身。掴み手が対象でも、見た目の更新はバー本体に対して行うため）。
    // 【処理】ロック中は開始しない（詳細設計書3.1.3：個別関数側でのロックチェック）。
    //   それ以外は、ドラッグ開始時点のポインタ座標・対象スケジュールの開始日・終了日・
    //   現在の表示粒度のpixelsPerDayを記録する（以降のpointermoveで差分計算するための基準点）。
    // 【結果】ドラッグ状態が開始される（実際の見た目更新はpointermoveハンドラが行う）。
    function handleBarPointerDown(event, scheduleId, mode, barElement) {
      if (currentProjectObject?.locked) {
        showToast("ロック中のため編集できません");
        return;
      }
      const scheduleRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!scheduleRow) return;
      draggedBarScheduleId = scheduleId;
      draggedBarMode = mode;
      barDragStartPointerX = event.clientX;
      barDragStartStartDate = scheduleRow.schedule.startDate;
      barDragStartEndDate = scheduleRow.schedule.endDate;
      barDragPixelsPerDay = GRANULARITY_PIXELS_PER_DAY[currentGranularity];
      barElement.classList.add("is-bar-dragging");
      barElement.setPointerCapture(event.pointerId);
      event.stopPropagation();
    }

    // 【前提】draggedBarScheduleIdが設定済み（ドラッグ中）であること。
    // 【処理】ポインタの移動量を「移動日数」に変換し（barDragPixelsPerDayで割って四捨五入）、
    //   calculateDraggedBarDatesでモードに応じた新しい開始日・終了日（クランプ済み）を求め、
    //   バーの見た目（left/width）だけを更新する。DBへの保存はしない。
    // 【結果】バーの見た目がポインタの位置に追従する。
    function handleBarPointerMove(event) {
      if (!draggedBarScheduleId) return;
      const barElement = document.querySelector(`.gantt-bar[data-schedule-id="${draggedBarScheduleId}"]`);
      if (!barElement) return;

      const deltaDays = Math.round((event.clientX - barDragStartPointerX) / barDragPixelsPerDay);
      const { startDate, endDate } = calculateDraggedBarDates(
        draggedBarMode,
        barDragStartStartDate,
        barDragStartEndDate,
        deltaDays,
        currentProjectObject.startDate,
        currentProjectObject.endDate
      );
      const geometry = calculateBarGeometry({ startDate, endDate }, currentTimelineStartDateString, barDragPixelsPerDay);
      if (!geometry) return;
      barElement.style.left = `${geometry.leftPx}px`;
      barElement.style.width = `${geometry.widthPx}px`;
    }

    // 【前提】ドラッグ中であること。
    // 【処理】最終的な開始日・終了日を確定し、ドラッグ開始時点と変わっていなければ
    //   （＝実質クリックだった場合）何も保存せず見た目だけ元に戻す。変わっていれば
    //   addScheduleで保存する。対象が親行（子を持つ行）の場合は、実際に確定した開始日の
    //   移動量ぶん、配下の子孫スケジュールも平行移動して保存する（本セクション冒頭の設計判断）。
    //   親（parentId）を持つ場合はsyncAncestorDatesで祖先の日付を再計算する（3.2.3）。
    // 【結果】DBが更新され、ガントパネルが再描画される。実際に日付が変わった場合のみ
    //   トースト「スケジュールを更新しました」を表示する（詳細設計書3.2.4）。
    async function handleBarPointerUp(event) {
      if (!draggedBarScheduleId) return;
      const scheduleId = draggedBarScheduleId;
      const mode = draggedBarMode;
      draggedBarScheduleId = null;
      draggedBarMode = null;
      wasBarPointerMovedSignificantly =
        Math.abs(event.clientX - barDragStartPointerX) >= BAR_CLICK_VS_DRAG_THRESHOLD_PX;

      const barElement = document.querySelector(`.gantt-bar[data-schedule-id="${scheduleId}"]`);
      if (barElement) barElement.classList.remove("is-bar-dragging");

      const scheduleRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!scheduleRow) return;

      const deltaDays = Math.round((event.clientX - barDragStartPointerX) / barDragPixelsPerDay);
      const { startDate, endDate } = calculateDraggedBarDates(
        mode,
        barDragStartStartDate,
        barDragStartEndDate,
        deltaDays,
        currentProjectObject.startDate,
        currentProjectObject.endDate
      );

      if (startDate === barDragStartStartDate && endDate === barDragStartEndDate) {
        await refreshGanttPanel(currentSelectedProjectId);
        return;
      }

      const updatedSchedule = { ...scheduleRow.schedule, startDate, endDate };
      await addSchedule(updatedSchedule);

      if (scheduleRow.hasChildren && mode === "move") {
        const actualStartDeltaDays = Math.round(
          (parseDateStringToUtcTimestamp(startDate) - parseDateStringToUtcTimestamp(barDragStartStartDate)) / MILLISECONDS_PER_DAY
        );
        const allSchedules = currentScheduleTreeRows.map((row) => row.schedule);
        const descendants = collectScheduleDescendants(scheduleId, allSchedules);
        for (const descendant of descendants) {
          await addSchedule({
            ...descendant,
            startDate: shiftDateStringByDays(descendant.startDate, actualStartDeltaDays),
            endDate: shiftDateStringByDays(descendant.endDate, actualStartDeltaDays),
          });
        }
      }

      if (updatedSchedule.parentId !== null && updatedSchedule.parentId !== undefined) {
        await syncAncestorDates(updatedSchedule.parentId);
      }

      await refreshGanttPanel(currentSelectedProjectId);
      showToast("スケジュールを更新しました");
    }

    // ===== ガントバー直接クリックの軽量ポップアップ（UI差分表No.75／対応表No.17） =====
    // 【設計判断】既存のopenScheduleModal（中央モーダル・フォーム編集）とは別物。クリックした
    //   バーの近くに表示する読み取り専用の簡易ポップアップで、名前・進捗・メモを確認できる。
    //   #taskPopupという共通の入れ物1つを使い回す（#toast/#modalOverlayと同じ設計）。
    //   進捗率の算出根拠：対応表No.17の抜粋にはdur（日数）はあるが%の算出式が現れておらず、
    //   データモデルにも数値の進捗フィールドが無い。ここではステータス
    //   （未着手0%／進行中50%／完了100%）から簡易に算出する（要判断事項として明示）。
    const PROGRESS_PERCENT_BY_SCHEDULE_STATUS = { todo: 0, inprogress: 50, done: 100 };

    // 【前提】comments は対象スケジュールに紐づくコメント全件（無ければ空配列）。
    // 【処理】投稿日時の昇順に並べ、削除ボタン付きの一覧＋投稿フォームのHTML文字列を組み立てる
    //   （renderModalCommentSectionToHtmlと同じ考え方。taskPopupは編集モーダルと同時に
    //   開いている可能性があるため、id・data-actionをモーダル側とは別にして重複を避ける）。
    // 【結果】ポップアップのコメント欄に入れられるHTML文字列を返す。
    function renderTaskPopupCommentSectionToHtml(comments) {
      const sortedComments = comments.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const commentListHtml = sortedComments.length > 0
        ? sortedComments
            .map(
              (comment) => `<div class="panel-list-item" data-comment-id="${escapeHtmlText(comment.id)}">
                <div class="panel-list-item-main">
                  <div>${escapeHtmlText(comment.text)}</div>
                  <div class="panel-list-item-meta">${escapeHtmlText(comment.createdAt)}</div>
                </div>
                <div class="panel-list-item-actions">
                  <button type="button" class="wbs-icon-button" data-action="delete-task-popup-comment" title="削除">🗑</button>
                </div>
              </div>`
            )
            .join("")
        : '<p class="empty-state-message">コメントはまだありません。</p>';
      return `
        <div class="task-popup-comment-section">
          <div class="modal-comment-list">${commentListHtml}</div>
          <div class="modal-comment-post-form">
            <input type="text" id="taskPopupCommentTextInput" placeholder="コメントを入力">
            <button type="button" class="panel-add-button" id="taskPopupPostCommentButton">投稿</button>
          </div>
        </div>
      `;
    }

    // 【前提】schedule は表示対象のスケジュールオブジェクト。comments はそのスケジュールに
    //   紐づくコメント全件。
    // 【処理】名前・進捗バー・メモ（読み取り専用）＋埋め込みコメント欄のHTML文字列を組み立てる。
    // 【結果】#taskPopupのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderTaskPopupToHtml(schedule, comments) {
      const progressPercent = PROGRESS_PERCENT_BY_SCHEDULE_STATUS[schedule.taskStatus] ?? 0;
      const notesText = schedule.notes ? escapeHtmlText(schedule.notes) : "（メモはありません）";
      return `
        <div class="task-popup-header">
          <strong>${escapeHtmlText(schedule.name)}</strong>
          <button type="button" class="slide-panel-close-button" id="taskPopupCloseButton">×</button>
        </div>
        <div class="task-popup-progress-track"><div class="task-popup-progress-fill" style="width:${progressPercent}%"></div></div>
        <div class="task-popup-progress-label">進捗：${progressPercent}%</div>
        <div class="task-popup-notes">${notesText}</div>
        ${renderTaskPopupCommentSectionToHtml(comments)}
      `;
    }

    // 【前提】なし。
    // 【処理】#taskPopupを非表示にし、中身を空にする（closeModalと同じ考え方）。
    // 【結果】ポップアップが非表示になる。
    function closeTaskPopup() {
      const popupElement = document.getElementById("taskPopup");
      popupElement.hidden = true;
      popupElement.innerHTML = "";
    }

    // 【前提】scheduleId はポップアップ表示対象のスケジュールid。clientX/clientY はクリック位置
    //   （position:fixedでそのまま使えるビューポート座標）。
    // 【処理】対象スケジュールの内容・コメントでポップアップを組み立てて表示位置を設定する。
    //   投稿・削除ボタンはinnerHTML再構築を経ても動くよう、#taskPopup自体へのイベント委譲で
    //   拾う（initializeApp側で1回だけ登録）。
    // 【結果】ポップアップがクリック位置の近くに表示される。
    async function openTaskPopup(scheduleId, clientX, clientY) {
      const scheduleRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!scheduleRow) return;
      const comments = await getCommentsByTask(scheduleId);
      const popupElement = document.getElementById("taskPopup");
      popupElement.innerHTML = renderTaskPopupToHtml(scheduleRow.schedule, comments);
      popupElement.style.left = `${clientX}px`;
      popupElement.style.top = `${clientY}px`;
      popupElement.dataset.scheduleId = scheduleId;
      popupElement.hidden = false;
    }

    // 【前提】#taskPopupが表示中で、dataset.scheduleIdに対象スケジュールidが入っていること。
    // 【処理】現在のコメント欄のテキストが空でなければaddCommentで保存し、コメント欄だけを
    //   最新の内容で再構築する（ポップアップ全体は再構築しない＝進捗・メモ欄はそのまま）。
    // 【結果】投稿後、コメント一覧が更新される。
    async function handlePostTaskPopupCommentButtonClick() {
      const popupElement = document.getElementById("taskPopup");
      const scheduleId = popupElement.dataset.scheduleId;
      const textInput = document.getElementById("taskPopupCommentTextInput");
      if (!scheduleId || !textInput) return;
      const text = textInput.value.trim();
      if (!text) return;
      await addComment({ id: generateId(), taskId: scheduleId, text, createdAt: new Date().toISOString() });
      await refreshTaskPopupCommentSection(scheduleId);
    }

    // 【前提】commentId は削除したいコメントのid。#taskPopupのdataset.scheduleIdが設定済み。
    // 【処理】即時メモの個別削除と同じ方針（確認なし即削除）でdeleteCommentし、
    //   コメント欄だけを再構築する。
    // 【結果】削除後、コメント一覧が更新される。
    async function handleDeleteTaskPopupCommentButtonClick(commentId) {
      const popupElement = document.getElementById("taskPopup");
      const scheduleId = popupElement.dataset.scheduleId;
      await deleteComment(commentId);
      await refreshTaskPopupCommentSection(scheduleId);
    }

    // 【前提】scheduleId は表示中のポップアップが対象にしているスケジュールid。
    // 【処理】最新のコメント一覧を取得し、#taskPopup内のコメント欄部分だけを差し替える。
    // 【結果】コメント一覧の表示が最新の状態になる（進捗・メモ欄は再構築されない）。
    async function refreshTaskPopupCommentSection(scheduleId) {
      const comments = await getCommentsByTask(scheduleId);
      const sectionElement = document.querySelector("#taskPopup .task-popup-comment-section");
      if (sectionElement) sectionElement.outerHTML = renderTaskPopupCommentSectionToHtml(comments);
    }

    // 【前提】scheduleId は削除したいスケジュールのid。
    // 【処理】子の有無でC2（子なし）／C3（子あり・サブタスクごと削除）の確認文言を切り替えて
    //   confirm()し、OKならdeleteScheduleCascadeで削除する（連鎖削除・コメント削除・
    //   変更履歴記録・祖先日付再計算は既存の複合操作にすべて任せる）。
    // 【結果】確認OK時、対象と子孫が削除されガントパネルが再描画され、トースト「削除しました」を
    //   表示する（詳細設計書3.2.2 step4）。キャンセル時は何もしない。
    //   ロック中は確認ダイアログより前に中断する（トースト「ロック中のため編集できません」）。
    async function handleDeleteScheduleButtonClick(scheduleId) {
      if (currentProjectObject?.locked) {
        showToast("ロック中のため編集できません");
        return;
      }
      const targetRow = currentScheduleTreeRows.find((row) => row.schedule.id === scheduleId);
      if (!targetRow) return;
      const confirmMessage = targetRow.hasChildren
        ? `「${targetRow.schedule.name}」とそのサブタスクをすべて削除しますか？`
        : `「${targetRow.schedule.name}」を削除しますか？`;
      if (!window.confirm(confirmMessage)) return;
      await deleteScheduleCascade(scheduleId, currentSelectedProjectId);
      await refreshGanttPanel(currentSelectedProjectId);
      showToast("削除しました");
    }

    // 【前提】currentScheduleTreeRows・collapsedScheduleIdsが設定済みであること。
    // 【処理】areAllParentRowsCollapsedで「親行が現在すべて折りたたまれているか」を判定し、
    //   trueならcollapsedScheduleIdsを空にする（全展開）、falseなら子を持つ全スケジュールを
    //   collapsedScheduleIdsへ追加する（全折りたたみ）。対応表No.39のお手本と同じ判定方式
    //   （個々の行の実際の開閉状態を毎回チェックする。ボタン自身の状態フラグは持たない）。
    //   ラベルの更新はrerenderWbsAndGanttFromCache側が毎回行うため、ここでは行わない。
    // 【結果】WBS・ガント両パネルが再描画され、ボタンのラベルも最新の状態に更新される。
    function handleToggleAllScheduleRowsButtonClick() {
      if (areAllParentRowsCollapsed(currentScheduleTreeRows, collapsedScheduleIds)) {
        collapsedScheduleIds.clear();
      } else {
        for (const row of currentScheduleTreeRows) {
          if (row.hasChildren) collapsedScheduleIds.add(row.schedule.id);
        }
      }
      rerenderWbsAndGanttFromCache();
    }

    // 【前提】action は "toggle-collapse" | "move-up" | "move-down" | "add-child" | "edit" | "delete"。
    //   scheduleId はアイコンが乗っていたWBS行のスケジュールid。
    // 【処理】WBS行のホバーアイコン共通のディスパッチャー。開閉トグルはDB再取得不要のため
    //   rerenderWbsAndGanttFromCacheのみ、それ以外は各専用ハンドラへ委譲する。
    // 【結果】actionに応じた処理が実行される。
    async function handleWbsRowIconClick(action, scheduleId) {
      if (action === "toggle-collapse") {
        if (collapsedScheduleIds.has(scheduleId)) {
          collapsedScheduleIds.delete(scheduleId);
        } else {
          collapsedScheduleIds.add(scheduleId);
        }
        rerenderWbsAndGanttFromCache();
        return;
      }
      if (action === "move-up") {
        await handleMoveScheduleOrderClick(scheduleId, "up");
        return;
      }
      if (action === "move-down") {
        await handleMoveScheduleOrderClick(scheduleId, "down");
        return;
      }
      if (action === "add-child") {
        handleAddChildScheduleButtonClick(scheduleId);
        return;
      }
      if (action === "edit") {
        handleWbsRowClick(scheduleId);
        return;
      }
      if (action === "delete") {
        await handleDeleteScheduleButtonClick(scheduleId);
        return;
      }
    }

