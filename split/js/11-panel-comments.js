    // ===== P5：コメント一覧パネル =====
    // 【設計判断】commentsはprojectIdを持たないため（データモデル設計3.5節）、
    //   getSchedulesByProjectで対象スケジュールid集合を先に取得し、各idについて
    //   getCommentsByTaskで束ねる（複数ストアをまたぐ合成処理）。
    //   コメントの追加導線は本来M4（スケジュール編集モーダル）に埋め込む仕様だが、
    //   M4への埋め込みは別工程のため、今回はこのパネル内に「スケジュールを選んで投稿」する
    //   簡易フォームを暫定的に置く（スコープの妥協点）。

    // 【前提】commentGroups は [{schedule, comments}] の配列（コメントが1件以上ある
    //   スケジュールのみ）。collapsedScheduleIds は見出しクリックで折りたたまれている
    //   スケジュールidの集合。
    // 【処理】スケジュール名を見出しに、コメント本文・投稿日時・削除ボタンを並べたHTML文字列を
    //   組み立てる。折りたたまれているグループはコメント本文一覧を省略し、見出しにis-collapsed
    //   クラスを付ける（UI差分表No.68：グリフ切り替えではなく、固定の矢印1文字をCSSで
    //   回転させて開閉状態を示す。中身は非表示だが件数はグルーピング自体には影響しない）。
    // 【結果】commentPanelBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderCommentGroupsToHtml(commentGroups, collapsedScheduleIds) {
      if (commentGroups.length === 0) {
        // 追加実装仕様書7章：お手本の空状態表示（💬アイコン＋「コメントはまだありません」）に揃える。
        return '<div class="empty-state-message"><div class="comment-empty-state-icon">💬</div>コメントはまだありません</div>';
      }
      return commentGroups
        .map(({ schedule, comments }) => {
          const isGroupCollapsed = collapsedScheduleIds.has(schedule.id);
          const commentsHtml = isGroupCollapsed
            ? ""
            : comments
                .slice()
                .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
                .map(
                  (comment) => `<div class="panel-list-item" data-comment-id="${escapeHtmlText(comment.id)}">
                <div class="panel-list-item-main">
                  <div>${escapeHtmlText(comment.text)}</div>
                  <div class="panel-list-item-meta">${escapeHtmlText(comment.createdAt)}</div>
                </div>
                <div class="panel-list-item-actions">
                  <button type="button" class="wbs-icon-button" data-action="delete-comment" title="削除">🗑</button>
                </div>
              </div>`
                )
                .join("");
          const collapsedHeadingClass = isGroupCollapsed ? " is-collapsed" : "";
          return `<div class="comment-group-heading${collapsedHeadingClass}" data-action="toggle-comment-group" data-schedule-id="${escapeHtmlText(schedule.id)}"><span class="cml-chevron">▾</span> ${escapeHtmlText(schedule.name)}</div>${commentsHtml}`;
        })
        .join("");
    }

    // 【前提】scheduleList は同一プロジェクト内のスケジュール全件。
    // 【処理】投稿先スケジュールを選ぶ<select>・テキスト欄・投稿ボタンを持つ簡易フォームの
    //   HTML文字列を組み立てる。
    // 【結果】コメント投稿フォームのHTML文字列を返す。
    function renderCommentPostFormToHtml(scheduleList) {
      const optionsHtml = scheduleList.map((schedule) => `<option value="${escapeHtmlText(schedule.id)}">${escapeHtmlText(schedule.name)}</option>`).join("");
      return `<div class="kanban-add-form" style="margin:8px 16px;">
        <select id="commentTargetScheduleSelect">${optionsHtml}</select>
        <input type="text" id="commentTextInput" placeholder="コメントを入力">
        <button type="button" class="panel-add-button" id="postCommentButton">投稿</button>
      </div>`;
    }

    function applyCommentPanel(bodyHtml) {
      document.getElementById("commentPanelBody").innerHTML = bodyHtml;
    }

    // 【前提】なし。
    // 【処理】見出し右の件数バッジ（追加実装仕様書7章：「N件」）と、本文上の内訳
    //   （「N件のスケジュールにM件のコメント」）を更新する。プロジェクト未選択・コメント0件の
    //   場合はどちらも空文字にする（:emptyセレクタで内訳の帯自体を非表示にする）。
    // 【結果】#commentCountBadge・#commentPanelSummaryの表示が更新される。
    function updateCommentCountDisplays(scheduleGroupCount, totalCommentCount) {
      document.getElementById("commentCountBadge").textContent = totalCommentCount === null ? "" : `${totalCommentCount}件`;
      document.getElementById("commentPanelSummary").textContent =
        totalCommentCount ? `${scheduleGroupCount}件のスケジュールに${totalCommentCount}件のコメント` : "";
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。
    // 【処理】getSchedulesByProjectでスケジュールid集合を取得し、各idについて
    //   getCommentsByTaskで束ねてcommentGroupsを作る。投稿フォーム＋グルーピング一覧を
    //   両方描画する。
    // 【結果】コメントパネルの表示・件数表示が最新の状態に更新される。
    async function refreshCommentPanel(projectId) {
      if (!projectId) {
        applyCommentPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        updateCommentCountDisplays(0, null);
        return;
      }
      const scheduleList = await getSchedulesByProject(projectId);
      const commentGroups = [];
      for (const schedule of scheduleList) {
        const comments = await getCommentsByTask(schedule.id);
        if (comments.length > 0) {
          commentGroups.push({ schedule, comments });
        }
      }
      const formHtml = scheduleList.length > 0 ? renderCommentPostFormToHtml(scheduleList) : "";
      applyCommentPanel(formHtml + renderCommentGroupsToHtml(commentGroups, collapsedCommentGroupScheduleIds));
      const totalCommentCount = commentGroups.reduce((sum, group) => sum + group.comments.length, 0);
      updateCommentCountDisplays(commentGroups.length, totalCommentCount);
    }

    // 【前提】scheduleId は見出しをクリックされたスケジュールのid。
    // 【処理】collapsedCommentGroupScheduleIdsへの追加/削除だけを行い、パネルを再描画する
    //   （折りたたみ状態はDB非保存の画面上だけの一時状態。collapsedScheduleIdsと同じ設計）。
    // 【結果】対象グループのコメント本文一覧が表示/非表示になる。
    function handleToggleCommentGroupButtonClick(scheduleId) {
      if (collapsedCommentGroupScheduleIds.has(scheduleId)) {
        collapsedCommentGroupScheduleIds.delete(scheduleId);
      } else {
        collapsedCommentGroupScheduleIds.add(scheduleId);
      }
      refreshCommentPanel(currentSelectedProjectId);
    }

    // 【前提】commentId は削除したいコメントのid。
    // 【処理】即時メモの個別削除と同じ方針（確認なし即削除）でdeleteCommentする。
    // 【結果】削除後、パネルを再描画する。
    async function handleDeleteCommentButtonClick(commentId) {
      await deleteComment(commentId);
      await refreshCommentPanel(currentSelectedProjectId);
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。
    // 【処理】投稿フォームの選択スケジュールid・テキストを読み取り、空でなければ
    //   addCommentで保存する。
    // 【結果】投稿後、パネルを再描画する。
    async function handlePostCommentButtonClick() {
      const scheduleSelect = document.getElementById("commentTargetScheduleSelect");
      const textInput = document.getElementById("commentTextInput");
      if (!scheduleSelect || !textInput) return;
      const text = textInput.value.trim();
      if (!text) return;
      await addComment({ id: generateId(), taskId: scheduleSelect.value, text, createdAt: new Date().toISOString() });
      await refreshCommentPanel(currentSelectedProjectId);
    }

