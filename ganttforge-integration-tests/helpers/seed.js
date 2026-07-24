/**
 * seed.js
 *
 * 「前提条件」を高速かつ確実に再現するためのヘルパー。
 * index.html はモジュール化されていない古典的な<script>のため、トップレベルの
 * 関数宣言（addProject/addSchedule/generateId等）はグローバル（window）に公開されている。
 * これを直接 page.evaluate() 内で呼び出すことで、UI操作を経由せず1ストア分の
 * レコードを直接IndexedDBへ書き込む（テスト対象の操作そのものは別途UIで行うため、
 * ここでは前提条件の「データを用意する」部分だけを担当する）。
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} overrides project の一部フィールドを上書きしたい場合に指定する
 * @returns {Promise<object>} 作成したprojectオブジェクト（idを含む）
 */
async function seedProject(page, overrides = {}) {
  return page.evaluate(async (overrides) => {
    const todayDateString = new Date().toISOString().slice(0, 10);
    const oneYearLaterDate = new Date();
    oneYearLaterDate.setFullYear(oneYearLaterDate.getFullYear() + 1);
    const project = {
      id: generateId(),
      name: "結合試験プロジェクト",
      startDate: todayDateString,
      endDate: oneYearLaterDate.toISOString().slice(0, 10),
      milestones: [],
      locked: false,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    await addProject(project);
    return project;
  }, overrides);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} projectId
 * @param {object} overrides
 * @returns {Promise<object>} 作成したscheduleオブジェクト
 */
async function seedSchedule(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const todayDateString = new Date().toISOString().slice(0, 10);
      const schedule = {
        id: generateId(),
        projectId,
        parentId: null,
        name: "結合試験スケジュール",
        startDate: todayDateString,
        endDate: todayDateString,
        assignee: "",
        taskStatus: "todo",
        notes: "",
        color: "#2563EB",
        order: 0,
        ...overrides,
      };
      await addSchedule(schedule);
      return schedule;
    },
    { projectId, overrides }
  );
}

async function seedTask(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const task = {
        id: generateId(),
        projectId,
        title: "結合試験タスク",
        status: "backlog",
        done: false,
        doneAt: null,
        priority: 2,
        dueDate: "",
        description: "",
        order: 0,
        ...overrides,
      };
      await addTask(task);
      return task;
    },
    { projectId, overrides }
  );
}

async function seedIssue(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const issue = {
        id: generateId(),
        projectId,
        title: "結合試験ノード",
        parentNodeId: null,
        x: 0,
        y: 0,
        color: "#2563EB",
        order: 0,
        ...overrides,
      };
      await addIssue(issue);
      return issue;
    },
    { projectId, overrides }
  );
}

async function seedComment(page, taskId, overrides = {}) {
  return page.evaluate(
    async ({ taskId, overrides }) => {
      const comment = {
        id: generateId(),
        taskId,
        text: "結合試験コメント",
        createdAt: new Date().toISOString(),
        ...overrides,
      };
      await addComment(comment);
      return comment;
    },
    { taskId, overrides }
  );
}

async function seedMemo(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const nowIsoString = new Date().toISOString();
      const memo = {
        id: generateId(),
        projectId,
        title: "結合試験メモ",
        body: "",
        order: 0,
        createdAt: nowIsoString,
        updatedAt: nowIsoString,
        ...overrides,
      };
      await addMemo(memo);
      return memo;
    },
    { projectId, overrides }
  );
}

async function seedQuickMemo(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const quickMemo = {
        id: generateId(),
        projectId,
        text: "結合試験即時メモ",
        createdAt: new Date().toISOString(),
        ...overrides,
      };
      await addQuickMemo(quickMemo);
      return quickMemo;
    },
    { projectId, overrides }
  );
}

async function seedSnapshot(page, projectId, overrides = {}) {
  return page.evaluate(
    async ({ projectId, overrides }) => {
      const projectList = await getAllProjects();
      const project = projectList.find((candidate) => candidate.id === projectId);
      const scheduleList = await getSchedulesByProject(projectId);
      const snapshot = {
        id: generateId(),
        projectId,
        name: "結合試験スナップショット",
        createdAt: new Date().toISOString(),
        data: { project, schedules: scheduleList },
        ...overrides,
      };
      await addSnapshot(snapshot);
      return snapshot;
    },
    { projectId, overrides }
  );
}

/**
 * 【前提】projectId は seedProject 等で作成済みのプロジェクトid、またはnull（未選択に戻す）。
 * 【処理】ヘッダーのプロジェクト選択ドロップダウンを更新し、実際にそのプロジェクトを選んだ
 *   ときと同じ状態（currentSelectedProjectId・各パネルの再描画）を作る。
 *   保存モーダルの保存ボタン押下後と同じ手順（refreshProjectSelectDropdown→値セット→
 *   switchToProject）をそのままなぞることで、UI操作を経由した場合と状態を一致させる。
 * 【結果】ドロップダウンが選択状態になり、ガント・カンバン・マインドマップが再描画される。
 */
async function selectProject(page, projectId) {
  await page.evaluate(async (projectId) => {
    await refreshProjectSelectDropdown();
    document.getElementById("projectSelectDropdown").value = projectId || "";
    await switchToProject(projectId);
  }, projectId);
}

/**
 * 8ストア（schedules/tasks/issues/comments/memos/quickmemos/snapshots + そのスケジュールへの
 * コメント）すべてに1件ずつデータを持つプロジェクトを作る（01-02系「配下の8ストアすべてに
 * 何かしらデータを持つプロジェクトが存在」という前提条件を機械的に満たすため）。
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<object>} { project, schedule, task, issue, comment, memo, quickMemo, snapshot }
 */
async function seedProjectWithAllChildStores(page, overrides = {}) {
  const project = await seedProject(page, overrides);
  const schedule = await seedSchedule(page, project.id);
  const task = await seedTask(page, project.id);
  const issue = await seedIssue(page, project.id);
  const comment = await seedComment(page, schedule.id);
  const memo = await seedMemo(page, project.id);
  const quickMemo = await seedQuickMemo(page, project.id);
  const snapshot = await seedSnapshot(page, project.id);
  return { project, schedule, task, issue, comment, memo, quickMemo, snapshot };
}

module.exports = {
  seedProject,
  seedSchedule,
  seedTask,
  seedIssue,
  seedComment,
  seedMemo,
  seedQuickMemo,
  seedSnapshot,
  selectProject,
  seedProjectWithAllChildStores,
};
