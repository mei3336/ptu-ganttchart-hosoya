    // ===== P3：即時メモパネル =====

    // 【前提】quickMemoList は同一プロジェクト内の即時メモ全件。
    // 【処理】投稿日時の昇順（古い→新しい、チャットのタイムライン表示）に並べ、
    //   各メモに削除ボタンを持つHTML文字列を組み立てる。
    // 【結果】quickMemoPanelBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderQuickMemoTimelineToHtml(quickMemoList) {
      if (quickMemoList.length === 0) {
        return '<p class="empty-state-message">即時メモがありません。</p>';
      }
      return quickMemoList
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map(
          (quickMemo) => `<div class="panel-list-item" data-quick-memo-id="${escapeHtmlText(quickMemo.id)}">
            <div class="panel-list-item-main">
              <div>${escapeHtmlText(quickMemo.text)}</div>
              <div class="panel-list-item-meta">${escapeHtmlText(quickMemo.createdAt)}</div>
            </div>
            <div class="panel-list-item-actions">
              <button type="button" class="wbs-icon-button" data-action="delete-quick-memo" title="削除">🗑</button>
            </div>
          </div>`
        )
        .join("");
    }

    function applyQuickMemoPanel(bodyHtml) {
      document.getElementById("quickMemoPanelBody").innerHTML = bodyHtml;
    }

    async function refreshQuickMemoPanel(projectId) {
      if (!projectId) {
        applyQuickMemoPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        return;
      }
      const quickMemoList = await getQuickMemosByProject(projectId);
      applyQuickMemoPanel(renderQuickMemoTimelineToHtml(quickMemoList));
      // 投稿後・削除後も一覧の最新（末尾）が見えるよう、パネル下端までスクロールする。
      const panelBody = document.getElementById("quickMemoPanelBody");
      panelBody.scrollTop = panelBody.scrollHeight;
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。
    // 【処理】投稿欄のテキストが空でなければaddQuickMemoで保存し、入力欄を空にする。
    // 【結果】投稿後、パネルを再描画する。
    async function handlePostQuickMemoButtonClick() {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const textInput = document.getElementById("quickMemoTextInput");
      const text = textInput.value.trim();
      if (!text) return;
      await addQuickMemo({ id: generateId(), projectId: currentSelectedProjectId, text, createdAt: new Date().toISOString() });
      textInput.value = "";
      await refreshQuickMemoPanel(currentSelectedProjectId);
    }

    // 【前提】quickMemoId は削除したい即時メモのid。
    // 【処理】確認ダイアログ無しで即削除する（基本設計書10.1節：即時メモの個別削除は
    //   「書き捨てメモ」という性質上、確認なしの即削除が仕様として扱われる）。
    // 【結果】削除後、パネルを再描画する。
    async function handleDeleteQuickMemoButtonClick(quickMemoId) {
      await deleteQuickMemo(quickMemoId);
      await refreshQuickMemoPanel(currentSelectedProjectId);
    }

    // 【前提】currentSelectedProjectIdが設定済みであること。
    // 【処理】0件なら案内のみ表示して終了する。1件以上あれば件数を明示した確認ダイアログの上で
    //   clearQuickMemosByProjectする（詳細設計書3.8.2 clearQuickMemos相当。DB側の関数
    //   clearQuickMemosByProjectは既に実装済みだったが、呼び出すUIボタンが無かったため追加する）。
    // 【結果】確認OK時、このプロジェクトの即時メモがすべて削除され、パネルが再描画される。
    //   トースト「即時メモを削除しました」を表示する。0件の場合はトースト「メモがありません」。
    async function handleClearQuickMemosButtonClick() {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const quickMemoList = await getQuickMemosByProject(currentSelectedProjectId);
      if (quickMemoList.length === 0) {
        showToast("メモがありません");
        return;
      }
      if (!window.confirm(`${quickMemoList.length}件のメモを全て削除しますか？`)) return;
      await clearQuickMemosByProject(currentSelectedProjectId);
      await refreshQuickMemoPanel(currentSelectedProjectId);
      showToast("即時メモを削除しました");
    }

