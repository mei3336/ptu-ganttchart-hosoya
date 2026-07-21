    // ===== P4：メモパネル =====
    // 【設計判断】自動保存はデバウンス方式ではなく、入力欄からフォーカスが外れた時点
    //   （blur）で保存する簡略版にする。デバウンスタイマーの管理はコードの複雑さの割に
    //   今回のスコープでの価値が低いと判断した。
    //   Markdownプレビュー（編集／プレビュー／分割の3タブ）は追加実装仕様書9章で実装済み
    //   （renderMemoMarkdownToSafeHtml・MEMO_EDITOR_TABS参照）。

    // 現在エディタで開いているメモのid。未選択時はnull。
    let currentSelectedMemoId = null;
    // 現在の編集エリアの表示タブ（追加実装仕様書9.2節：MEMO_EDITOR_TABSのkeyのいずれか）。
    // メモを切り替えてもタブ自体は保持する（お手本にあたる仕様が無いため、エディタの一般的な
    // 挙動＝タブ切替はファイルをまたいで保持されるものとして扱う）。
    let memoEditorActiveTab = "edit";

    // 【前提】memoList は同一プロジェクト内のメモ全件。selectedMemoId は現在編集中のメモid。
    // 【処理】タイトル・更新日時・削除ボタンを持つ一覧のHTML文字列を組み立てる。選択中の
    //   メモにはis-selectedクラスを付ける。
    // 【結果】memoListBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderMemoListToHtml(memoList, selectedMemoId) {
      if (memoList.length === 0) {
        return '<p class="empty-state-message">メモがありません。</p>';
      }
      const sortByOrder = (a, b) => a.order - b.order;
      return memoList
        .slice()
        .sort(sortByOrder)
        .map((memo) => {
          const selectedClass = memo.id === selectedMemoId ? " is-selected" : "";
          return `<div class="panel-list-item memo-list-item${selectedClass}" data-memo-id="${escapeHtmlText(memo.id)}" data-action="select-memo">
            <div class="panel-list-item-main">
              <div>${escapeHtmlText(memo.title)}</div>
              <div class="panel-list-item-meta">${escapeHtmlText(memo.updatedAt)}</div>
            </div>
            <div class="panel-list-item-actions">
              <button type="button" class="wbs-icon-button" data-action="delete-memo" title="削除">🗑</button>
            </div>
          </div>`;
        })
        .join("");
    }

    // 追加実装仕様書9.2節：メモ編集エリアの3タブ（基本設計書10章「編集／プレビュー／分割の
    // 3タブ、Markdown対応」）。
    const MEMO_EDITOR_TABS = [
      { key: "edit", label: "編集" },
      { key: "preview", label: "プレビュー" },
      { key: "split", label: "分割" },
    ];

    // 【前提】markdownText はメモ本文（Markdownソース）。
    // 【処理】marked.jsでHTMLに変換し、DOMPurifyでサニタイズする（追加実装仕様書9.1節：
    //   採用理由＝本アプリのJSON出力・取込機能で、エクスポートしたメモを他者がインポート・
    //   プレビューする経路が存在するため、変換後HTMLの<script>・onerror等を必ず除去してから
    //   DOMに挿入する）。CDN読み込みに失敗している場合は、お手本のesc関数と同じ水準の
    //   HTMLエスケープ済みプレーンテキストにフォールバックする（プレビューは自動描画のため、
    //   PDF出力のような明示的なエラートーストは出さない）。
    // 【結果】DOMにそのまま挿入できるサニタイズ済みHTML文字列を返す。
    function renderMemoMarkdownToSafeHtml(markdownText) {
      const isMarkdownLibraryAvailable = typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined";
      if (!isMarkdownLibraryAvailable) {
        return escapeHtmlText(markdownText || "").replaceAll("\n", "<br>");
      }
      const rawHtml = window.marked.parse(markdownText || "");
      return window.DOMPurify.sanitize(rawHtml);
    }

    // 【前提】memo はnull（未選択）または選択中のメモオブジェクト。activeTab は
    //   MEMO_EDITOR_TABSのkeyのいずれか（"edit"|"preview"|"split"）。
    // 【処理】タイトル入力欄・タブ切り替えボタン・タブに応じた本文表示（編集＝テキストエリアの
    //   み、プレビュー＝サニタイズ済みHTMLのみ、分割＝左右に両方）を組み立てる。
    // 【結果】memoEditorBodyのinnerHTMLにそのまま入れられるHTML文字列を返す。
    function renderMemoEditorToHtml(memo, activeTab) {
      if (!memo) {
        return '<p class="empty-state-message">左の一覧からメモを選択するか、新規作成してください。</p>';
      }
      const tabsHtml = MEMO_EDITOR_TABS
        .map((tab) => {
          const activeClass = tab.key === activeTab ? " is-active" : "";
          return `<button type="button" class="toolbar-button${activeClass}" data-memo-tab="${tab.key}">${tab.label}</button>`;
        })
        .join("");
      const editorTextareaHtml = `<textarea id="memoEditorBodyTextarea" placeholder="本文（Markdown）">${escapeHtmlText(memo.body)}</textarea>`;
      const previewHtml = `<div class="memo-editor-preview">${renderMemoMarkdownToSafeHtml(memo.body)}</div>`;

      let contentHtml;
      if (activeTab === "preview") {
        contentHtml = previewHtml;
      } else if (activeTab === "split") {
        contentHtml = `<div class="memo-editor-split">
          <div class="memo-editor-split-pane">${editorTextareaHtml}</div>
          <div class="memo-editor-split-pane">${previewHtml}</div>
        </div>`;
      } else {
        contentHtml = editorTextareaHtml;
      }

      return `
        <input type="text" id="memoEditorTitleInput" value="${escapeHtmlText(memo.title)}" placeholder="タイトル">
        <div class="memo-editor-tabs">${tabsHtml}</div>
        ${contentHtml}
      `;
    }

    function applyMemoListPanel(bodyHtml) {
      document.getElementById("memoListBody").innerHTML = bodyHtml;
    }

    function applyMemoEditorPanel(bodyHtml) {
      document.getElementById("memoEditorBody").innerHTML = bodyHtml;
    }

    // 【前提】projectId はnull、または実在するプロジェクトのid。
    // 【処理】getMemosByProjectで取得して一覧を再描画し、currentSelectedMemoIdが
    //   まだ存在するメモを指していれば、そのメモをエディタに再表示する
    //   （存在しなくなっていれば＝削除された場合、選択を解除する）。
    // 【結果】メモ一覧・編集エリア両方の表示が最新の状態に更新される。
    async function refreshMemoPanel(projectId) {
      if (!projectId) {
        applyMemoListPanel('<p class="empty-state-message">プロジェクトを選択してください。</p>');
        applyMemoEditorPanel(null);
        currentSelectedMemoId = null;
        return;
      }
      const memoList = await getMemosByProject(projectId);
      if (currentSelectedMemoId && !memoList.some((memo) => memo.id === currentSelectedMemoId)) {
        currentSelectedMemoId = null;
      }
      applyMemoListPanel(renderMemoListToHtml(memoList, currentSelectedMemoId));
      const selectedMemo = memoList.find((memo) => memo.id === currentSelectedMemoId) || null;
      applyMemoEditorPanel(renderMemoEditorToHtml(selectedMemo, memoEditorActiveTab));
    }

    // 【前提】tabKey は MEMO_EDITOR_TABS のkeyのいずれか。
    // 【処理】表示中のタブを切り替えて再描画する（追加実装仕様書9.2節）。
    // 【結果】編集エリアの表示が切り替わる。
    function handleMemoEditorTabButtonClick(tabKey) {
      memoEditorActiveTab = tabKey;
      refreshMemoPanel(currentSelectedProjectId);
    }

    async function handleCreateMemoButtonClick() {
      if (!currentSelectedProjectId) {
        window.alert("先にプロジェクトを選択してください。");
        return;
      }
      const memoList = await getMemosByProject(currentSelectedProjectId);
      const nowIsoString = new Date().toISOString();
      const newMemo = {
        id: generateId(),
        projectId: currentSelectedProjectId,
        title: "新規メモ",
        body: "",
        order: memoList.length,
        createdAt: nowIsoString,
        updatedAt: nowIsoString,
      };
      await addMemo(newMemo);
      currentSelectedMemoId = newMemo.id;
      await refreshMemoPanel(currentSelectedProjectId);
    }

    function handleSelectMemoButtonClick(memoId) {
      currentSelectedMemoId = memoId;
      refreshMemoPanel(currentSelectedProjectId);
    }

    // 【前提】memoId は削除したいメモのid。
    // 【処理】確認ダイアログ（モーダル・ダイアログ一覧C4）の上でdeleteMemoする。
    // 【結果】確認OK時、削除してパネルを再描画し（選択解除はrefreshMemoPanel側で判定）、
    //   トースト「メモを削除しました」を表示する（詳細設計書3.7.2）。
    async function handleDeleteMemoButtonClick(memoId) {
      const memoList = await getMemosByProject(currentSelectedProjectId);
      const targetMemo = memoList.find((memo) => memo.id === memoId);
      if (!targetMemo) return;
      if (!window.confirm(`「${targetMemo.title || "無題"}」を削除しますか？`)) return;
      await deleteMemo(memoId);
      await refreshMemoPanel(currentSelectedProjectId);
      showToast("メモを削除しました");
    }

    // 【前提】currentSelectedMemoIdが設定済み（エディタにメモが表示されている）であること。
    // 【処理】タイトル・本文入力欄からフォーカスが外れた時点で読み取り、addMemoで保存する。
    //   本文用の<textarea>は「プレビュー」タブでは描画されない（追加実装仕様書9.2節）ため、
    //   その場合はDOMから読まず既存の本文をそのまま使う（要素が無くDOM参照が失敗するのを防ぐ）。
    // 【結果】保存後、一覧側の表示（タイトル・更新日時）を最新化する。タイトル・本文の
    //   <input>/<textarea>自体はここでは再生成しない（タイトル→本文とTabキーで移動している
    //   最中にDOMを丸ごと差し替えると、フォーカス遷移が崩れるため）。プレビュー・分割タブの
    //   プレビュー領域だけは、保存直後の本文を反映するようピンポイントで更新する。
    async function handleMemoEditorFieldBlur() {
      if (!currentSelectedMemoId) return;
      const memoList = await getMemosByProject(currentSelectedProjectId);
      const existingMemo = memoList.find((memo) => memo.id === currentSelectedMemoId);
      if (!existingMemo) return;
      const titleInputElement = document.getElementById("memoEditorTitleInput");
      const bodyTextareaElement = document.getElementById("memoEditorBodyTextarea");
      const title = titleInputElement ? titleInputElement.value : existingMemo.title;
      const body = bodyTextareaElement ? bodyTextareaElement.value : existingMemo.body;
      await addMemo({ ...existingMemo, title, body, updatedAt: new Date().toISOString() });
      const memoListAfterSave = await getMemosByProject(currentSelectedProjectId);
      applyMemoListPanel(renderMemoListToHtml(memoListAfterSave, currentSelectedMemoId));
      const previewElement = document.querySelector(".memo-editor-preview");
      if (previewElement) previewElement.innerHTML = renderMemoMarkdownToSafeHtml(body);
    }

