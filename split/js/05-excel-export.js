    // ===== H4：Excel出力（exportExcel） =====
    // 【設計判断】crud-implementation.md対象外（DB操作を伴わない）。基本設計書9.4・詳細設計書
    //   3.10.1に従う。日付列・サマリーの期間はいずれもプロジェクト自体のstartDate/endDateを
    //   根拠にする（質問リスト_未確認事項.md Q4：配下スケジュールの実効範囲は使わない。
    //   シート1とシート2で期間の基準が食い違わないよう、両シートともプロジェクト期間で統一する）。
    //   「日付列は稼働している日にセルの色が付く」（基本設計書9.4、推測との注記あり）は、
    //   そのスケジュール自身のcolorフィールド（ガントバーの色と同じ値）でセルを塗ることで再現する。
    //   【H3との非対称について】PDF出力（exportPDF）にはhtml2canvas/jsPDFの読込確認があるが、
    //   この関数にはxlsx-js-styleの読込確認を意図的に追加しない（基本設計書1.3の既知の非整合
    //   事項と同じ扱い。詳細設計書3.10.1：元アプリの実装漏れと推測される非対称をそのまま再現する）。

    // シート1固定列（No/WBS/スケジュール/階層/開始日/終了日/期間/担当者/ステータス）の見出し。
    // 日付列（1日1列）はこの9列の右側に続く（基本設計書9.4）。
    const EXCEL_FIXED_COLUMN_HEADERS = ["No", "WBS", "スケジュール", "階層", "開始日", "終了日", "期間", "担当者", "ステータス"];
    const EXCEL_FIXED_COLUMN_COUNT = EXCEL_FIXED_COLUMN_HEADERS.length;

    // depthLevel（0:親, 1:子, 2:孫）を基本設計書9.4の表記「親」「子」等に変換する対応表。
    const EXCEL_SCHEDULE_DEPTH_LABELS = ["親", "子", "孫"];

    const EXCEL_THIN_BORDER_ALL_SIDES = {
      top: { style: "thin", color: { rgb: "D1D5DB" } },
      bottom: { style: "thin", color: { rgb: "D1D5DB" } },
      left: { style: "thin", color: { rgb: "D1D5DB" } },
      right: { style: "thin", color: { rgb: "D1D5DB" } },
    };
    const EXCEL_TITLE_STYLE = { font: { bold: true, sz: 14 } };
    const EXCEL_MONTH_HEADER_STYLE = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: "E5E7EB" } }, alignment: { horizontal: "center" } };
    const EXCEL_HEADER_STYLE = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "F3F4F6" } }, alignment: { horizontal: "center" }, border: EXCEL_THIN_BORDER_ALL_SIDES };
    const EXCEL_BODY_STYLE = { font: { sz: 10 }, border: EXCEL_THIN_BORDER_ALL_SIDES };

    // 【前提】scheduleTreeRows は currentScheduleTreeRows（buildScheduleTreeRowsの戻り値）。
    // 【処理】Excel出力に必要な列（No・WBS番号・階層ラベル・期間(日数)）を1行ずつ付与する。
    // 【結果】[{no, wbsNumber, schedule, depthLevel, depthLabel, durationDays}, ...]（表示順は
    //   ツリーの深さ優先順のまま）を返す。
    function flattenScheduleTreeRowsForExcel(scheduleTreeRows) {
      const wbsNumberByScheduleId = calculateWbsNumbers(scheduleTreeRows);
      return scheduleTreeRows.map((row, index) => {
        const durationDays = Math.round(
          (parseDateStringToUtcTimestamp(row.schedule.endDate) - parseDateStringToUtcTimestamp(row.schedule.startDate)) / MILLISECONDS_PER_DAY
        ) + 1;
        return {
          no: index + 1,
          wbsNumber: wbsNumberByScheduleId.get(row.schedule.id),
          schedule: row.schedule,
          depthLevel: row.depthLevel,
          depthLabel: EXCEL_SCHEDULE_DEPTH_LABELS[row.depthLevel] || "孫",
          durationDays,
        };
      });
    }

    // 【前提】timelineDaysはbuildGanttTimelineDaysの戻り値（日付順で連続している）。
    // 【処理】連続する同一年月の日を1つのグループにまとめる（基本設計書9.4：1行目の
    //   月単位見出し・結合セル）。
    // 【結果】[{yearMonthLabel, startDayIndex, dayCount}, ...]（startDayIndexはtimelineDays内の
    //   0始まりの位置）を返す。
    function calculateExcelMonthGroups(timelineDays) {
      const monthGroups = [];
      timelineDays.forEach((day, dayIndex) => {
        const yearMonthLabel = `${day.year}年${day.month}月`;
        const lastGroup = monthGroups[monthGroups.length - 1];
        if (lastGroup && lastGroup.yearMonthLabel === yearMonthLabel) {
          lastGroup.dayCount++;
        } else {
          monthGroups.push({ yearMonthLabel, startDayIndex: dayIndex, dayCount: 1 });
        }
      });
      return monthGroups;
    }

    // 【前提】hexColorWithHash は"#RRGGBB"形式の文字列（スケジュールのcolorフィールド）。
    //   値が無い場合はガントバーの既定色（SCHEDULE_BAR_COLOR_PALETTEの先頭色）を使う。
    // 【処理】先頭の"#"を取り除く（xlsx-js-styleのfill.fgColor.rgbは"#"無しの6桁表記を
    //   期待するため）。
    // 【結果】"#"無しの6桁16進数文字列を返す。
    function stripHashFromHexColor(hexColorWithHash) {
      return (hexColorWithHash || SCHEDULE_BAR_COLOR_PALETTE[0]).replace("#", "").toUpperCase();
    }

    // 【前提】project は出力対象プロジェクト。flattenedRowsはflattenScheduleTreeRowsForExcelの
    //   戻り値。timelineDaysはproject.startDate〜endDateの全日（buildGanttTimelineDaysの戻り値）。
    //   generatedAtは出力日時にするDateオブジェクト。
    // 【処理】基本設計書9.4の構成（1行目：タイトル＋月見出し、2行目：列見出し、3行目以降：
    //   スケジュール行、その後：合計行、末尾：出力日時）でシート1のワークシートを組み立てる。
    //   日付列は、そのスケジュールの稼働期間に含まれる日だけ、schedule.colorでセルを塗る。
    // 【結果】xlsx-js-styleのワークシートオブジェクトを返す。
    function buildGanttSheet(project, flattenedRows, timelineDays, generatedAt) {
      const monthGroups = calculateExcelMonthGroups(timelineDays);
      const totalColumnCount = EXCEL_FIXED_COLUMN_COUNT + timelineDays.length;
      const worksheet = {};
      const merges = [];

      const setCell = (rowIndex, colIndex, value, style) => {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        worksheet[cellRef] = { v: value, t: typeof value === "number" ? "n" : "s", s: style };
      };

      setCell(0, 0, `${project.name} — ガントチャート`, EXCEL_TITLE_STYLE);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: EXCEL_FIXED_COLUMN_COUNT - 1 } });
      for (const monthGroup of monthGroups) {
        const startColumnIndex = EXCEL_FIXED_COLUMN_COUNT + monthGroup.startDayIndex;
        const endColumnIndex = startColumnIndex + monthGroup.dayCount - 1;
        setCell(0, startColumnIndex, monthGroup.yearMonthLabel, EXCEL_MONTH_HEADER_STYLE);
        if (endColumnIndex > startColumnIndex) {
          merges.push({ s: { r: 0, c: startColumnIndex }, e: { r: 0, c: endColumnIndex } });
        }
      }

      EXCEL_FIXED_COLUMN_HEADERS.forEach((header, columnIndex) => setCell(1, columnIndex, header, EXCEL_HEADER_STYLE));
      timelineDays.forEach((day, dayIndex) => setCell(1, EXCEL_FIXED_COLUMN_COUNT + dayIndex, day.dayOfMonth, EXCEL_HEADER_STYLE));

      flattenedRows.forEach((row, rowOffset) => {
        const rowIndex = 2 + rowOffset;
        setCell(rowIndex, 0, row.no, EXCEL_BODY_STYLE);
        setCell(rowIndex, 1, row.wbsNumber, EXCEL_BODY_STYLE);
        setCell(rowIndex, 2, row.schedule.name, EXCEL_BODY_STYLE);
        setCell(rowIndex, 3, row.depthLabel, EXCEL_BODY_STYLE);
        setCell(rowIndex, 4, row.schedule.startDate, EXCEL_BODY_STYLE);
        setCell(rowIndex, 5, row.schedule.endDate, EXCEL_BODY_STYLE);
        setCell(rowIndex, 6, row.durationDays, EXCEL_BODY_STYLE);
        setCell(rowIndex, 7, row.schedule.assignee || "", EXCEL_BODY_STYLE);
        setCell(rowIndex, 8, SCHEDULE_STATUS_LABELS[row.schedule.taskStatus] || row.schedule.taskStatus, EXCEL_BODY_STYLE);

        const activeDayFillStyle = { fill: { fgColor: { rgb: stripHashFromHexColor(row.schedule.color) } } };
        timelineDays.forEach((day, dayIndex) => {
          const dayDateString = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.dayOfMonth).padStart(2, "0")}`;
          const isActiveDay = dayDateString >= row.schedule.startDate && dayDateString <= row.schedule.endDate;
          if (isActiveDay) {
            setCell(rowIndex, EXCEL_FIXED_COLUMN_COUNT + dayIndex, "", activeDayFillStyle);
          }
        });
      });

      const totalRowIndex = 2 + flattenedRows.length;
      const rootDurationTotal = flattenedRows.filter((row) => row.depthLevel === 0).reduce((sum, row) => sum + row.durationDays, 0);
      setCell(totalRowIndex, 0, "合計（ルート期間合計）", EXCEL_BODY_STYLE);
      setCell(totalRowIndex, 6, rootDurationTotal, EXCEL_BODY_STYLE);
      merges.push({ s: { r: totalRowIndex, c: 0 }, e: { r: totalRowIndex, c: 5 } });

      const timestampRowIndex = totalRowIndex + 1;
      setCell(timestampRowIndex, 0, `出力日時：${formatDateToOutputTimestampString(generatedAt)}`, EXCEL_BODY_STYLE);

      worksheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: timestampRowIndex, c: totalColumnCount - 1 } });
      worksheet["!merges"] = merges;
      worksheet["!cols"] = EXCEL_FIXED_COLUMN_HEADERS.map(() => ({ wch: 12 })).concat(timelineDays.map(() => ({ wch: 3 })));
      return worksheet;
    }

    // 【前提】projectは出力対象プロジェクト。flattenedRowsはflattenScheduleTreeRowsForExcelの
    //   戻り値（総タスク数の算出に使う。基本設計書1.2用語対応表：元アプリの「タスク」＝本アプリの
    //   「スケジュール」）。generatedAtは出力日時にするDateオブジェクト。
    // 【処理】プロジェクト名・開始日・終了日・表示期間・総タスク数・出力日時を並べた
    //   シート2のワークシートを組み立てる（基本設計書9.4。質問リスト_未確認事項.md Q4：
    //   終了日・表示期間はプロジェクト自体のstartDate/endDateを根拠にする）。
    // 【結果】xlsx-js-styleのワークシートオブジェクトを返す。
    function buildSummarySheet(project, flattenedRows, generatedAt) {
      const displayDurationDays = Math.round(
        (parseDateStringToUtcTimestamp(project.endDate) - parseDateStringToUtcTimestamp(project.startDate)) / MILLISECONDS_PER_DAY
      ) + 1;
      const summaryRows = [
        ["プロジェクト名", project.name],
        ["開始日", project.startDate],
        ["終了日", project.endDate],
        ["表示期間", `${displayDurationDays}日`],
        ["総タスク数", `${flattenedRows.length}件`],
        [],
        [`出力日時：${formatDateToOutputTimestampString(generatedAt)}`],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(summaryRows);
      worksheet["!cols"] = [{ wch: 14 }, { wch: 30 }];
      return worksheet;
    }

    // 【前提】currentProjectObjectが選択済みであること（未選択時はexportExcelButton自体が
    //   disabledのため、この関数は呼ばれない想定）。
    // 【処理】現在のスケジュール一覧をフラット化し、シート1（ガントチャート）・シート2（サマリー）の
    //   2シート構成のワークブックを作ってダウンロードする（詳細設計書3.10.1 exportExcel相当）。
    // 【結果】完了後、トースト「Excelファイルを保存しました」を表示する。
    async function exportExcel() {
      const project = currentProjectObject;
      const flattenedRows = flattenScheduleTreeRowsForExcel(currentScheduleTreeRows);
      const timelineDays = buildGanttTimelineDays(project.startDate, project.endDate);
      const generatedAt = new Date();

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, buildGanttSheet(project, flattenedRows, timelineDays, generatedAt), "ガントチャート");
      XLSX.utils.book_append_sheet(workbook, buildSummarySheet(project, flattenedRows, generatedAt), "サマリー");
      XLSX.writeFile(workbook, buildReportFileName(project.name, "xlsx"));

      showToast("Excelファイルを保存しました");
    }

    // 【前提】timelineDays は buildGanttTimelineDays の戻り値。timelineStartDateString は
    //   タイムライン先頭日。todayDateString は基準日（"YYYY-MM-DD"）。呼び出し元（refreshGanttPanel）が
    //   `new Date()`から求めて渡す。この関数自体はnew Date()を呼ばない（固定値を渡してテストできる
    //   ようにするため。純粋関数として保つ設計判断）。
    // 【処理】基準日がタイムライン表示範囲内にあるかを判定し、範囲内ならx座標(px)を計算する。
    // 【結果】範囲内ならleftPx（数値）、範囲外（表示中のプロジェクト期間の外）ならnullを返す。
    function calculateTodayMarkerPosition(timelineDays, timelineStartDateString, pixelsPerDay, todayDateString) {
      const dayOffset = calculateDayOffsetFromTimelineStart(todayDateString, timelineStartDateString);
      if (dayOffset < 0 || dayOffset >= timelineDays.length) {
        return null;
      }
      return dayOffset * pixelsPerDay;
    }

    // 【前提】schedule.startDate/endDateのどちらかが未設定の場合、バーは描画できない
    //   （データモデル設計3.2節：両方とも必須ではないフィールドのため）。
    // 【処理】タイムライン先頭日・1日あたりのピクセル幅から、バーのleft/widthをpx単位で計算する。
    // 【結果】{leftPx, widthPx, durationDays} を返す。日付が無い場合はnullを返す。
    function calculateBarGeometry(schedule, timelineStartDateString, pixelsPerDay) {
      if (!schedule.startDate || !schedule.endDate) {
        return null;
      }
      const dayOffsetStart = calculateDayOffsetFromTimelineStart(schedule.startDate, timelineStartDateString);
      const dayOffsetEnd = calculateDayOffsetFromTimelineStart(schedule.endDate, timelineStartDateString);
      const durationDays = Math.max(dayOffsetEnd - dayOffsetStart + 1, 1);
      return { leftPx: dayOffsetStart * pixelsPerDay, widthPx: durationDays * pixelsPerDay, durationDays };
    }

    // 【前提】dateString は"YYYY-MM-DD"形式。days は加算したい日数（負値可）。
    // 【処理】UTC基準のタイムスタンプへ変換して日数を加算し、"YYYY-MM-DD"形式へ戻す。
    // 【結果】計算後の日付文字列を返す。
    function shiftDateStringByDays(dateString, days) {
      const shiftedTimestamp = parseDateStringToUtcTimestamp(dateString) + days * MILLISECONDS_PER_DAY;
      return new Date(shiftedTimestamp).toISOString().slice(0, 10);
    }

    // 【前提】mode は"move"|"resize-start"|"resize"。originalStartDate/originalEndDateは
    //   ドラッグ開始時点の日付。deltaDaysはポインタ移動量から換算した日数（負値可）。
    //   projectStartDate/projectEndDateはクランプ範囲（プロジェクトの期間）。
    // 【処理】詳細設計書3.2.4「境界値の丸め処理（実機確認済み・アラート無し）」をそのまま
    //   実装する：
    //   ・move：開始日・終了日を同じ日数だけ平行移動（期間不変）。新開始日がプロジェクト開始日
    //     より前になる場合は、期間を保ったままプロジェクト開始日にスナップ。新終了日が
    //     プロジェクト終了日を超える場合はプロジェクト終了日でカット（2つの判定は独立で、
    //     どちらも通知は出さず黙ってクランプする）。
    //   ・resize-start：開始日のみ移動。新開始日が終了日を超える場合は終了日と同日にクランプ。
    //     プロジェクト開始日より前にはできない。
    //   ・resize：終了日のみ移動。新終了日が開始日を下回る場合は開始日と同日にクランプ。
    //     プロジェクト終了日を超えることはできない。
    // 【結果】クランプ済みの{startDate, endDate}を返す。
    function calculateDraggedBarDates(mode, originalStartDate, originalEndDate, deltaDays, projectStartDate, projectEndDate) {
      if (mode === "move") {
        let newStartDate = shiftDateStringByDays(originalStartDate, deltaDays);
        let newEndDate = shiftDateStringByDays(originalEndDate, deltaDays);
        if (newStartDate < projectStartDate) {
          const durationDays = Math.round(
            (parseDateStringToUtcTimestamp(originalEndDate) - parseDateStringToUtcTimestamp(originalStartDate)) / MILLISECONDS_PER_DAY
          );
          newStartDate = projectStartDate;
          newEndDate = shiftDateStringByDays(newStartDate, durationDays);
        }
        if (newEndDate > projectEndDate) {
          newEndDate = projectEndDate;
        }
        return { startDate: newStartDate, endDate: newEndDate };
      }

      if (mode === "resize-start") {
        let newStartDate = shiftDateStringByDays(originalStartDate, deltaDays);
        if (newStartDate > originalEndDate) newStartDate = originalEndDate;
        if (newStartDate < projectStartDate) newStartDate = projectStartDate;
        return { startDate: newStartDate, endDate: originalEndDate };
      }

      let newEndDate = shiftDateStringByDays(originalEndDate, deltaDays);
      if (newEndDate < originalStartDate) newEndDate = originalStartDate;
      if (newEndDate > projectEndDate) newEndDate = projectEndDate;
      return { startDate: originalStartDate, endDate: newEndDate };
    }

    // 【前提】milestones は project.milestones（{name, date}の配列）。
    // 【処理】名前・日付の両方を持つマイルストーンについて、タイムライン上のx座標（px）を
    //   計算する（詳細設計書3.11.1エラーバリエーション：名前が空の行は保存自体は成功するが
    //   ガントチャート上には表示されない仕様のため、name不在の行を除外する）。
    // 【結果】{leftPx, name}[] を返す。
    function calculateMilestoneMarkerPositions(milestones, timelineStartDateString, pixelsPerDay) {
      return milestones
        .filter((milestone) => Boolean(milestone.date) && Boolean(milestone.name))
        .map((milestone) => ({
          leftPx: calculateDayOffsetFromTimelineStart(milestone.date, timelineStartDateString) * pixelsPerDay,
          name: milestone.name,
        }));
    }

    // 【前提】issueList は同一プロジェクト内のissue全件。rootIssueId は起点ノードのid。
    // 【処理】parentNodeIdをたどり、rootIssueId自身を含む子孫issueのidを幅優先で収集する
    //   （issuesにはparentNodeIdのインデックスが無いため、getIssuesByProjectで読み切った
    //   全件をアプリ層で辿る。deleteIssueCascade・折りたたみ機能の両方で使う共通ロジック）。
    // 【結果】[rootIssueId, ...子孫id...] の配列を返す。
    function collectIssueSubtreeIds(issueList, rootIssueId) {
      const childIssuesByParentNodeId = new Map();
      for (const issue of issueList) {
        if (issue.parentNodeId === null || issue.parentNodeId === undefined) continue;
        if (!childIssuesByParentNodeId.has(issue.parentNodeId)) {
          childIssuesByParentNodeId.set(issue.parentNodeId, []);
        }
        childIssuesByParentNodeId.get(issue.parentNodeId).push(issue);
      }

      const collectedIds = [];
      let frontier = [rootIssueId];
      while (frontier.length > 0) {
        const nextFrontier = [];
        for (const id of frontier) {
          collectedIds.push(id);
          const childIssues = childIssuesByParentNodeId.get(id) || [];
          nextFrontier.push(...childIssues.map((childIssue) => childIssue.id));
        }
        frontier = nextFrontier;
      }
      return collectedIds;
    }

    // 【前提】issueList は同一プロジェクト内のissue全件。collapsedIssueIds は
    //   折りたたまれているissueidの集合（Set）。
    // 【処理】折りたたまれた各ノードについて、collectIssueSubtreeIdsで子孫id（自身は除く）を
    //   集めて非表示集合にまとめ、issueListからそれらを除外する。
    // 【結果】実際に画面へ表示すべきissueだけの配列を返す。
    function filterVisibleIssues(issueList, collapsedIssueIds) {
      if (collapsedIssueIds.size === 0) return issueList;
      const hiddenIssueIds = new Set();
      for (const collapsedIssueId of collapsedIssueIds) {
        for (const descendantId of collectIssueSubtreeIds(issueList, collapsedIssueId)) {
          if (descendantId !== collapsedIssueId) {
            hiddenIssueIds.add(descendantId);
          }
        }
      }
      return issueList.filter((issue) => !hiddenIssueIds.has(issue.id));
    }

    // 【前提】issueList は同一プロジェクト内のissue全件（親子関係はparentNodeIdで表現）。
    // 【処理】parentNodeIdが実在する行同士を「親→子」のペアとして列挙する
    //   （マインドマップの線描画はx,y座標を結ぶ形のため、depthLevelではなくペア単位で扱う）。
    // 【結果】{fromIssue, toIssue}[] を返す。
    function buildMindmapEdgeList(issueList) {
      const issueById = new Map(issueList.map((issue) => [issue.id, issue]));
      const edges = [];
      for (const issue of issueList) {
        if (issue.parentNodeId === null || issue.parentNodeId === undefined) continue;
        const parentIssue = issueById.get(issue.parentNodeId);
        if (parentIssue) {
          edges.push({ fromIssue: parentIssue, toIssue: issue });
        }
      }
      return edges;
    }

    // 【前提】2点の座標(fromX,fromY)→(toX,toY)。
    // 【処理】2点間を結ぶ「幅lengthPx・高さ1pxの線」をCSSのtransform:rotateで描画するための
    //   left/top/width/角度を計算する（線の要素自体はfrom側を起点に、toの向きへ回転させる）。
    // 【結果】{leftPx, topPx, widthPx, angleDeg} を返す。
    function calculateEdgeGeometry(fromX, fromY, toX, toY) {
      const deltaX = toX - fromX;
      const deltaY = toY - fromY;
      const lengthPx = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const angleDeg = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
      return { leftPx: fromX, topPx: fromY, widthPx: lengthPx, angleDeg };
    }

