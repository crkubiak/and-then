import { FileStore } from '../io/FileStore.js';
import { LiveSync } from '../io/LiveSync.js';
import { SeenStore } from '../io/SeenStore.js';
import { TaskList } from '../model/TaskList.js';
import { IdAllocator } from '../model/IdAllocator.js';
import { TaskParser } from '../model/TaskParser.js';
import { TaskSerializer } from '../model/TaskSerializer.js';
import { CompletionRules } from '../rules/CompletionRules.js';
import { ProjectPalette } from './ProjectPalette.js';
import { ProjectSection } from './ProjectSection.js';
import { EditRules } from '../rules/EditRules.js';
import { NewTaskRules } from '../rules/NewTaskRules.js';
import { SweepRules } from '../rules/SweepRules.js';
import { LineDiff } from '../rules/LineDiff.js';
import { Validator } from '../rules/Validator.js';
import { VisibilityRules } from '../rules/VisibilityRules.js';
import { ProblemsPanel } from './ProblemsPanel.js';
import { RawDrawer } from './RawDrawer.js';
import { TaskEditor } from './TaskEditor.js';
import { TaskInput } from './TaskInput.js';
import { TaskRow } from './TaskRow.js';
import { Toolbar } from './Toolbar.js';
import { Toast } from './Toast.js';

const FLASH_MS = 1500;
const MAX_SAVE_ATTEMPTS = 3; // first try plus two re-applications after a 409
const CHANGED_ON_DISK = 'That task changed on disk. Your edit was not saved.';
const RAW_CHANGED = 'The files changed on disk while you were editing. Load latest, then re-apply your edit.';

export class App {
  #root;
  #store;
  #taskList = null;
  #collapsedKeys = new Set(); // collapsed task rows, session-only (see TaskRow.keyOf)
  #needsIndex = -1; // cursor for the "N need you" jump
  #needsKeys = '';
  #status = 'reconnecting';
  #dot = null;
  #toast = null;
  #taskInput = new TaskInput({ onSubmit: (text) => this.#addTask(text) });
  #toolbar = new Toolbar({
    onHideChange: () => this.setTaskList(this.#taskList),
    onExpandAll: () => this.#setAllExpanded(true),
    onCollapseAll: () => this.#setAllExpanded(false),
    onProblemsToggle: () => this.#toggleProblems(),
    onSweep: () => this.#sweep(),
    onRaw: () => this.#rawDrawer.open(this.#taskList.toText()),
  });
  #rawDrawer = new RawDrawer({ onSave: (draft) => this.#saveRaw(draft), onClose: () => this.#toolbar.focusRaw() });
  #problemsPanel = new ProblemsPanel({ onSelect: (task) => this.#revealTask(task) });
  #problems = []; // validator problems plus their todo.txt task, rebuilt each render
  #problemsOpen = false; // session-only; survives re-renders
  #problemsByTask = new Map(); // task to its validator problems, rebuilt each render
  #tail = Promise.resolve(); // commits and reloads run one at a time through this chain
  #reloadQueued = false;
  #latestVersion = null;
  #absorbed = new Set(); // versions already loaded from a 409; their live events need no reload
  // Open inline editor: { task, create, draft, start, end, focused }. `draft` and the selection are
  // synced from the live TaskEditor (#editorView) just before each re-render. With `create`, it is the
  // new-subtask input and `task` is the parent. There is only ever one.
  #editor = null;
  #editorView = null;
  #subtaskBusy = false; // an Enter in the new-subtask input is still saving
  #deferred = false; // a newer list was loaded while editing; the page shows an older one
  #seen = new SeenStore();
  #entries = new Map(); // todo.txt task key to raw line, rebuilt each render
  #newKeys = new Set(); // keys of tasks not yet seen, rebuilt each render and shrunk by #markSeen
  #editedKeys = new Map(); // keys of seen tasks whose line changed since, to a tooltip summary; same lifecycle as #newKeys
  #sections = new Map(); // project (null = Inbox) to its ProjectSection, rebuilt each render

  constructor(root, { store = new FileStore() } = {}) {
    this.#root = root;
    this.#store = store;
  }

  // Created on first use, mounted on <body> so #renderShell never removes it.
  get toast() {
    this.#toast ??= new Toast();
    return this.#toast;
  }

  // The one place the UI reads the clock. Local date, not UTC.
  static today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async start() {
    try {
      const files = await this.#store.load();
      this.setTaskList(new TaskList(files));
    } catch (err) {
      this.#renderError(err);
      return;
    }
    new LiveSync({
      onVersion: (version) => this.#onVersion(version),
      onStatus: (status) => this.#setStatus(status),
    });
  }

  #onVersion(version) {
    this.#latestVersion = version;
    if (this.#isCurrent(version) || this.#reloadQueued) return;
    this.#reloadQueued = true; // a reload that hasn't started yet will see the newest version anyway
    this.#enqueue(() => {
      this.#reloadQueued = false;
      return this.#isCurrent(this.#latestVersion) ? undefined : this.#reload();
    });
  }

  // True when `version` is already what we hold (our own save, or a list a 409 handed us).
  #isCurrent(version) {
    return version === this.#store.version || this.#absorbed.has(version);
  }

  #enqueue(job) {
    const run = this.#tail.then(job);
    this.#tail = run.catch(() => {});
    return run;
  }

  async #reload() {
    this.#absorbed.clear();
    try {
      this.#present(new TaskList(await this.#store.load()));
    } catch (err) {
      this.#showReloadError(err); // keep the current view
    }
  }

  // The one write path. `transform(taskList)` returns the new TaskList, or a string
  // (the reason it can't apply). It must find its target with taskList.locate(), never
  // hold a Task from an earlier list, so it can be re-run on fresh content after a 409.
  // `onSaved` runs just before the saved list is rendered.
  #commit(transform, { onSaved } = {}) {
    return this.#enqueue(() => this.#runCommit(transform, onSaved));
  }

  // Our own successful saves always render. A list that arrives from outside (live reload,
  // 409) is only remembered while an inline editor is open, and rendered when it closes.
  #present(list) {
    if (this.#editor === null) return this.setTaskList(list);
    this.#taskList = list;
    this.#rawDrawer.update(list.toText());
    this.#deferred = true;
  }

  // Runs the transform on the current list and saves. On a 409 the store hands back the fresh
  // files and the same transform runs again on them (up to MAX_SAVE_ATTEMPTS tries), so the
  // target is found again by id or exact text. If it no longer applies, the action is dropped.
  async #runCommit(transform, onSaved) {
    this.#absorbed.clear();
    let list = this.#taskList;
    try {
      for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
        const next = transform(list);
        if (typeof next === 'string') {
          this.toast.error(next);
          if (attempt > 1) this.#present(list); // the page still shows the older content
          return false;
        }
        const result = await this.#store.save(next.toText());
        if (result.ok) {
          this.#markOwn(list, next);
          onSaved?.();
          this.setTaskList(next);
          return true;
        }
        this.#absorbed.add(this.#store.version);
        list = new TaskList(result.current);
      }
      this.toast.error('The files keep changing on disk. Your change was not saved. Try again.');
      this.#present(list);
      return false;
    } catch (err) {
      this.toast.error(`Could not save: ${err.message}`);
      if (list !== this.#taskList) this.#present(list); // a 409 already showed us newer content
      return false;
    }
  }

  // Our own saves are never new: every task the save added or changed counts as seen.
  #markOwn(before, after) {
    const old = App.#entriesOf(before);
    const own = new Map([...App.#entriesOf(after)].filter(([key, raw]) => old.get(key) !== raw));
    this.#seen.mark(own);
  }

  static #entriesOf(list) {
    return new Map(list.todoTasks.map((task) => [TaskRow.keyOf(task), task.raw]));
  }

  // The one place a marker (new or edited) clears (click and focus now; the on-screen timer joins it
  // in 11.4). Records the current line and updates the rows in place, with no re-render.
  #markSeen(keys) {
    const fresh = [...keys].filter((key) => this.#newKeys.has(key) || this.#editedKeys.has(key));
    if (fresh.length === 0) return;
    this.#seen.mark(new Map(fresh.map((key) => [key, this.#entries.get(key)])));
    const gone = new Set(fresh);
    for (const key of fresh) {
      this.#newKeys.delete(key);
      this.#editedKeys.delete(key);
    }
    for (const row of this.#root.querySelectorAll('.task-row')) {
      if (!gone.has(row.dataset.taskKey)) continue;
      row.classList.remove('is-new', 'is-edited');
      for (const mark of row.querySelectorAll('.seen-mark')) mark.remove();
      const edit = row.querySelector('.task-text-edit');
      if (edit) edit.title = 'Edit task';
    }
    for (const pill of this.#root.querySelectorAll('.pill-rollup')) TaskRow.refreshRollup(pill, this.#newKeys, this.#editedKeys);
  }

  #complete(task) {
    const check = CompletionRules.check(this.#taskList, task);
    if (check.needsConfirm && !window.confirm(`#${task.depId} is not complete. Complete anyway?`)) return;
    return this.#commit((list) => {
      const target = list.locate(task);
      if (!target) return 'That task no longer exists.';
      if (target.complete) return 'That task is already complete.';
      if (!CompletionRules.check(list, target).allowed) return 'That task has open subtasks.';
      return CompletionRules.complete(list, target, App.today());
    });
  }

  #addTask(text) {
    return this.#commit((list) => {
      const { line, error } = NewTaskRules.prepare(list, text, App.today());
      return error ?? list.appendLine('todo', line);
    });
  }

  // Saves a subtask typed into the inline input. The parent gets a fresh id in the same commit
  // when it has none; the root project and `parent:` are added here, never typed. On an error
  // nothing is returned, so no id is written.
  #addSubtask(parentRef, text, onSaved) {
    let allocated = null;
    return this.#commit((list) => {
      const parent = list.locate(parentRef);
      if (!parent) return 'The parent task no longer exists.';
      if (parent.complete) return 'That task is already complete.';
      const typed = TaskParser.parse(text.trim(), { file: 'todo', lineNumber: 0 });
      if (typed?.parentId != null) return 'The parent is set for you. Remove parent: from the text.';
      const id = parent.id ?? IdAllocator.next(list);
      const base = parent.id === null ? list.replaceLine(parent, TaskSerializer.setTag(parent, 'id', id)) : list;
      const project = list.effectiveProject(parent);
      const addProject = project !== null && !typed?.projects.includes(project);
      const full = `${text.trim()}${addProject ? ` +${project}` : ''} parent:${id}`;
      const { line, error } = NewTaskRules.prepare(base, full, App.today());
      if (error) return error;
      allocated = parent.id === null ? id : null;
      return base.appendLine('todo', line);
    }, { onSaved: () => onSaved(allocated) });
  }

  // + Subtask: opens the inline input under the parent. Nothing is written until Enter.
  #openSubtask(task) {
    const parent = this.#taskList.locate(task);
    if (!parent || parent.file !== 'todo' || parent.complete) return;
    if (!this.#claimEditor()) return;
    this.#collapsedKeys.delete(TaskRow.keyOf(parent)); // a collapsed parent would hide the input
    this.#editor = { task: parent, create: true, draft: '', start: 0, end: 0, focused: true };
    this.setTaskList(this.#taskList);
  }

  // The one-editor rule: false (after focusing it) when an unsaved editor is open, else closes any editor.
  #claimEditor() {
    if (!this.#editor) return true;
    if (this.#isDirty()) {
      this.#editorView.focus();
      return false;
    }
    this.#closeEditor();
    return true;
  }

  #startEdit(task) {
    const target = this.#taskList.locate(task);
    if (!target || target.file !== 'todo') return;
    if (!this.#claimEditor()) return; // keeps unsaved work; focus stays there
    const raw = target.raw.replace(/\r$/, '');
    this.#editor = { task: target, draft: raw, start: raw.length, end: raw.length, focused: true };
    this.setTaskList(this.#taskList);
  }

  #isDirty() {
    const { create, task } = this.#editor;
    return create ? this.#editorView.value.trim() !== '' : this.#editorView.value.trim() !== task.raw.trim();
  }

  // Closes the editor without saving. In place when the page is current; else renders.
  #closeEditor({ focusText = false } = {}) {
    const task = this.#editor.task;
    const view = this.#editorView;
    this.#editor = null;
    this.#editorView = null;
    if (this.#deferred) this.setTaskList(this.#taskList);
    else view.unmount();
    if (focusText) this.#focusText(task);
  }

  // Enter in the new-subtask input: one commit, then the input stays open and empty for the next.
  async #saveSubtask() {
    const parent = this.#editor.task;
    const text = this.#editorView.value;
    if (text.trim() === '' || this.#subtaskBusy) return;
    this.#subtaskBusy = true;
    try {
      await this.#addSubtask(parent, text, (allocated) => {
        const open = this.#editor?.create && this.#editor.task === parent;
        if (!open) return;
        if (allocated !== null) this.#editor.parentId = allocated; // the parent line changed, so find it by its new id
        if (this.#editorView.value === text) this.#editorView.clear(); // not if typing continued meanwhile
      });
    } finally {
      this.#subtaskBusy = false;
    }
  }

  #focusText(task) {
    const key = `text:${TaskRow.keyOf(task)}`;
    [...this.#root.querySelectorAll('[data-key]')].find((e) => e.dataset.key === key)?.focus({ preventScroll: true });
  }

  #onEditorBlur() {
    if (this.#editor && !this.#isDirty()) this.#closeEditor(); // changed text stays open so a stray click loses nothing
  }

  async #saveEdit() {
    if (this.#editor.create) return this.#saveSubtask();
    const original = this.#editor.task;
    const line = this.#editorView.value.trim();
    if (line === original.raw.trim()) return this.#closeEditor({ focusText: true });
    const saved = await this.#commit(
      (list) => {
        const target = list.locate(original);
        if (!target || target.raw !== original.raw) return CHANGED_ON_DISK;
        return EditRules.check(list, target, line) ?? list.replaceLine(target, line);
      },
      { onSaved: () => this.#dropEditor() },
    );
    if (!saved) return; // the reason was toasted; the editor stays open with its draft
    const edited = this.#taskList.todoTasks.find((t) => t.raw === line);
    if (edited) this.#focusText(edited);
  }

  // Forgets the editor so the next render shows plain rows.
  #dropEditor() {
    this.#editorView?.dispose();
    this.#editor = null;
    this.#editorView = null;
  }

  #reopen(task) {
    return this.#commit((list) => {
      const target = list.locate(task);
      if (!target) return 'That task no longer exists.';
      return CompletionRules.reopen(list, target);
    });
  }

  // Locked checkbox: expand down to the open descendants, then flash them.
  #highlightOpen(task) {
    const target = this.#taskList.locate(task);
    if (!target) return;
    const open = CompletionRules.check(this.#taskList, target).openDescendants;
    this.#expandTo(open, target);
    this.#flash(open);
  }

  // "N need you": reveal the next open needs:human task in display order, wrapping at the end.
  // The cursor restarts when the set of tasks changes.
  #showNextNeedsHuman() {
    const tasks = this.#taskList.todoTasks.filter((t) => !t.complete && t.needs === 'human');
    const byKey = new Map(tasks.map((t) => [TaskRow.keyOf(t), t]));
    const ordered = this.#rowsFor(tasks).map((r) => byKey.get(r.dataset.taskKey)).filter(Boolean);
    if (ordered.length === 0) return;
    const keys = ordered.map((t) => TaskRow.keyOf(t)).sort().join('\n');
    if (keys !== this.#needsKeys) this.#needsIndex = -1;
    this.#needsKeys = keys;
    this.#needsIndex = (this.#needsIndex + 1) % ordered.length;
    this.#revealTask(ordered[this.#needsIndex]);
  }

  // Needs-human pill: after confirming, drop the token so the task is back with the agent.
  #clearNeeds(task) {
    if (!window.confirm('Mark this as handled? This removes needs:human.')) return;
    return this.#commit((list) => {
      const target = list.locate(task);
      if (!target) return 'That task no longer exists.';
      if (target.complete || target.needs !== 'human') return 'That task no longer needs you.';
      return list.replaceLine(target, TaskSerializer.removeTag(target, 'needs'));
    });
  }

  // Blocked-by pill: reveal the blocking task.
  #showTask(id) {
    const target = this.#taskList.byId(id);
    if (target?.file === 'todo' && this.#revealTask(target)) return;
    if (!target || target.file !== 'todo') this.toast.info(`#${id} is not on this page.`);
  }

  // Reveals a task: un-collapses what hides it, scrolls to it, flashes it, focuses its checkbox.
  // Returns false (after a toast) when it has no row, e.g. hidden by Hide Completed.
  #revealTask(task) {
    const target = this.#taskList.locate(task);
    if (target?.file === 'todo') {
      this.#expandTo([target]);
      const row = this.#rowsFor([target])[0];
      if (row) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        this.#flash([target]);
        const focusable = row.querySelector('.task-check') ?? row;
        if (focusable === row) row.tabIndex = -1;
        focusable.focus({ preventScroll: true });
        return true;
      }
    }
    this.toast.info(target ? 'Turn off Hide Completed to see that task.' : 'That task no longer exists.');
    return false;
  }

  // Un-collapses what hides each task: its section (unless `stopAt` is given) and its
  // collapsed ancestors, up to and including `stopAt`. Re-renders once if ancestors changed.
  #expandTo(tasks, stopAt = null) {
    const list = this.#taskList;
    let changed = false;
    for (const task of tasks) {
      const section = stopAt ? null : this.#sections.get(list.effectiveProject(task));
      if (section?.isCollapsed) section.setCollapsed(false); // updates the DOM in place
      for (let p = list.parent(task); p; p = list.parent(p)) {
        if (this.#collapsedKeys.delete(TaskRow.keyOf(p))) changed = true;
        if (p === stopAt) break;
      }
    }
    if (changed) this.setTaskList(list);
  }

  // Expand All / Collapse All: every section and every parent row, then one re-render.
  #setAllExpanded(expanded) {
    for (const section of this.#sections.values()) section.setCollapsed(!expanded);
    this.#collapsedKeys.clear();
    if (!expanded) {
      for (const task of this.#taskList.todoTasks) {
        if (this.#taskList.children(task).length > 0) this.#collapsedKeys.add(TaskRow.keyOf(task));
      }
    }
    this.setTaskList(this.#taskList);
  }

  #rowsFor(tasks) {
    const keys = new Set(tasks.map((t) => TaskRow.keyOf(t)));
    return [...this.#root.querySelectorAll('.task-row')].filter((r) => keys.has(r.dataset.taskKey));
  }

  #flash(tasks) {
    const rows = this.#rowsFor(tasks);
    for (const row of rows) row.classList.add('is-flash');
    setTimeout(() => rows.forEach((row) => row.classList.remove('is-flash')), FLASH_MS);
  }

  #showReloadError(err) {
    const main = this.#root.querySelector('.app-main');
    if (!main) return this.#renderError(err);
    main.querySelector('.error-badge')?.remove();
    main.prepend(this.#errorBadge(err));
  }

  #setStatus(status) {
    this.#status = status;
    this.#applyStatus();
  }

  #applyStatus() {
    if (!this.#dot) return;
    const label = this.#status === 'live' ? 'Live' : 'Reconnecting';
    this.#dot.className = `live-dot is-${this.#status}`;
    this.#dot.title = label;
    this.#dot.setAttribute('aria-label', label);
  }

  // All rendering goes through here (initial load, live reload, actions).
  setTaskList(taskList) {
    this.#taskList = taskList;
    this.#rawDrawer.update(taskList.toText());
    this.#deferred = false;
    const scrollY = window.scrollY;
    const focusKey = this.#focusedKey();
    const inputState = this.#taskInput.snapshot(); // the input is detached and re-attached by #render
    this.#syncEditor();
    this.#render();
    window.scrollTo(0, scrollY);
    this.#restoreFocus(focusKey);
    this.#taskInput.restore(inputState);
    if (this.#editor) this.#editorView.restore(this.#editor);
  }

  // Carries the editor's draft and selection across a re-render. If its task has
  // vanished from the list there is no row to put it on, so it is dropped.
  #syncEditor() {
    if (!this.#editor) return;
    if (this.#editorView) {
      Object.assign(this.#editor, this.#editorView.snapshot());
      this.#editorView.dispose(); // the old input is about to be detached
    }
    const target = this.#editorTarget();
    if (target) {
      if (this.#editor.create) this.#editor.task = target; // keeps the key right after the parent got its id
      this.#editorView = new TaskEditor({
        draft: this.#editor.draft,
        create: this.#editor.create,
        onSave: () => this.#saveEdit(),
        onCancel: () => this.#closeEditor({ focusText: true }),
        onBlur: () => this.#onEditorBlur(),
      });
      return;
    }
    const message = this.#editor.create ? 'The parent task no longer exists.' : CHANGED_ON_DISK;
    this.#editor = null;
    this.#editorView = null;
    this.toast.error(message);
  }

  // The editor's task in the current list. A subtask's parent may have just been given an id.
  #editorTarget() {
    const { task, create, parentId } = this.#editor;
    return this.#taskList.locate(task) ?? (create && parentId ? this.#taskList.byId(parentId) : null);
  }

  // Only section headers and row toggles carry a data-key.
  #focusedKey() {
    const active = document.activeElement;
    return active && this.#root.contains(active) ? (active.dataset?.key ?? null) : null;
  }

  #restoreFocus(key) {
    if (key === null) return;
    const el = [...this.#root.querySelectorAll('[data-key]')].find((e) => e.dataset.key === key);
    el?.focus({ preventScroll: true });
  }

  // PRD §6. The transform sweeps whatever qualifies on the list it is given, so a 409 retry
  // recomputes on the fresh files. The server writes done.txt before todo.txt, and the
  // append-then-remove order is inside SweepRules.sweep. An open editor blocks the sweep
  // rather than losing its row to it.
  #sweep() {
    let swept = 0;
    return this.#commit(
      (list) => {
        if (this.#editor) return 'Finish editing first.';
        const result = SweepRules.sweep(list, App.today());
        if (result.count === 0) return 'Nothing to sweep.';
        swept = result.count;
        return result.taskList;
      },
      { onSaved: () => this.toast.info(`Swept ${swept} ${swept === 1 ? 'task' : 'tasks'} to done.txt.`) },
    );
  }

  // Raw drawer save: whole files replace the current ones, so it cannot be re-applied to
  // newer content. The transform only runs when the list it is given still has exactly the
  // text the drafts were started from (`base`); on a 409 retry the list is the fresh files,
  // which no longer match, so it is refused and the drawer keeps its drafts. No validation:
  // the Problems panel reports whatever the new text contains.
  #saveRaw({ todo, done, eols, base }) {
    return this.#commit(
      (list) => {
        const current = list.toText();
        if (current.todo !== base.todo || current.done !== base.done) return RAW_CHANGED;
        return new TaskList({ todo, done, eols });
      },
      { onSaved: () => this.#rawDrawer.close() },
    );
  }

  #toggleProblems() {
    this.#problemsOpen = !this.#problemsOpen;
    this.#syncProblems();
  }

  // Validates once per render and hands the result to the toolbar, the panel and the rows.
  #validate() {
    const byLine = new Map();
    for (const task of [...this.#taskList.todoTasks, ...this.#taskList.doneTasks]) {
      byLine.set(`${task.file === 'todo' ? 'todo.txt' : 'done.txt'}:${task.lineNumber}`, task);
    }
    this.#problems = Validator.validate(this.#taskList).map((p) => {
      const task = byLine.get(`${p.file}:${p.line}`) ?? null;
      return { ...p, task: task?.file === 'todo' ? task : null }; // only todo.txt rows can be revealed
    });
    this.#problemsByTask = new Map();
    for (const p of this.#problems) {
      if (p.task) this.#problemsByTask.set(p.task, [...(this.#problemsByTask.get(p.task) ?? []), p]);
    }
    if (this.#problems.length === 0) this.#problemsOpen = false;
    this.#syncProblems();
  }

  #syncProblems() {
    const errors = this.#problems.filter((p) => p.severity === 'error').length;
    this.#toolbar.setProblems({ errors, warnings: this.#problems.length - errors, open: this.#problemsOpen });
    this.#problemsPanel.update(this.#problems, this.#problemsOpen);
  }

  // Hide Completed, except the task being edited and its ancestors, so its editor is never orphaned.
  #isVisible(task) {
    const hideCompleted = this.#toolbar.hideCompleted;
    if (VisibilityRules.isVisible(this.#taskList, task, { hideCompleted })) return true;
    if (!this.#editor || task.file !== 'todo') return false;
    const edited = this.#taskList.locate(this.#editor.task);
    return edited !== null && (edited === task || this.#taskList.ancestors(edited).includes(task));
  }

  #render() {
    this.#entries = App.#entriesOf(this.#taskList);
    this.#seen.sync(this.#entries);
    this.#newKeys = new Set([...this.#entries.keys()].filter((key) => this.#seen.isNew(key)));
    // Seen before but the line differs now. Only id'd tasks can get here: an id-less key is its line.
    this.#editedKeys = new Map(
      [...this.#entries].filter(([key, raw]) => !this.#newKeys.has(key) && this.#seen.raw(key) !== raw)
        .map(([key, raw]) => [key, LineDiff.summary(this.#seen.raw(key), raw)]),
    );
    this.#validate();
    this.#toolbar.setSweep(SweepRules.eligible(this.#taskList, App.today()).length);
    const empty = this.#taskList.todoTasks.length === 0;
    const main = this.#renderShell(empty ? null : this.#buildSummary());
    if (empty) main.append(this.#buildEmptyState());
    else this.#renderSections(main);
  }

  #renderShell(summary = null, { withInput = true } = {}) {
    const header = document.createElement('header');
    header.className = 'app-header';
    const titleRow = this.#el('div', 'title-row');
    const title = document.createElement('h1');
    title.textContent = 'TaskFlow';
    this.#dot = document.createElement('span');
    this.#dot.setAttribute('role', 'img');
    this.#applyStatus();
    titleRow.append(title, this.#dot);
    const strip = document.createElement('div');
    strip.className = 'accent-strip';
    strip.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) strip.append(document.createElement('span'));
    header.append(titleRow);
    if (summary) header.append(summary);
    header.append(strip);

    const main = document.createElement('main');
    main.className = 'app-main';
    const bar = withInput ? [this.#toolbar.element, this.#problemsPanel.element] : [];
    const controls = withInput ? [this.#taskInput.element, ...bar] : [];
    this.#root.replaceChildren(header, ...controls, main);
    return main;
  }

  // Open, overdue, due-soon and blocked counts across all of todo.txt.
  #buildSummary() {
    const today = App.today();
    const open = this.#taskList.todoTasks.filter((t) => !t.complete);
    const kinds = open.map((t) => TaskRow.dueKind(t.due, today));
    const overdue = kinds.filter((k) => k === 'overdue').length;
    const soon = kinds.filter((k) => k === 'soon').length;
    const blocked = open.filter((t) => this.#taskList.isBlocked(t)).length;
    const needsYou = open.filter((t) => t.needs === 'human').length;

    const summary = this.#el('p', 'summary');
    const count = this.#el('span', 'summary-open');
    count.append(this.#el('strong', '', String(open.length)), ' open');
    summary.append(count);
    if (overdue > 0) summary.append(this.#el('span', 'badge badge-due-overdue', `${overdue} overdue`));
    if (soon > 0) summary.append(this.#el('span', 'badge badge-due-soon', `${soon} due soon`));
    if (blocked > 0) summary.append(this.#el('span', 'pill-blocked', `${blocked} blocked`));
    if (needsYou > 0) {
      const button = this.#el('button', 'pill-human', `${needsYou} need you`);
      button.type = 'button';
      button.addEventListener('click', () => this.#showNextNeedsHuman());
      summary.append(button);
    }
    return summary;
  }

  #buildEmptyState() {
    const box = this.#el('div', 'empty-state');
    box.append(
      this.#el('p', 'empty-title', 'No tasks yet'),
      this.#el('p', 'empty-hint', 'Add a task above, or edit data/todo.txt (see docs/FORMAT.md).'),
    );
    return box;
  }

  #el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  #renderSections(main) {
    const palette = new ProjectPalette(this.#taskList);
    const today = App.today();
    this.#sections.clear();
    for (const [project, { roots, tasks }] of this.#groupByProject()) {
      const section = new ProjectSection({
        project,
        accent: palette.accent(project),
        roots,
        tasks,
        taskList: this.#taskList,
        palette,
        today,
        collapsedKeys: this.#collapsedKeys,
        editor: this.#editorFor(),
        hideCompleted: this.#toolbar.hideCompleted,
        isVisible: (task) => this.#isVisible(task),
        problems: this.#problemsByTask,
        newKeys: this.#newKeys,
        editedKeys: this.#editedKeys,
        actions: {
          complete: (task) => this.#complete(task),
          reopen: (task) => this.#reopen(task),
          highlightOpen: (task) => this.#highlightOpen(task),
          showTask: (id) => this.#showTask(id),
          clearNeeds: (task) => this.#clearNeeds(task),
          addSubtask: (task) => this.#openSubtask(task),
          edit: (task) => this.#startEdit(task),
          seen: (task) => this.#markSeen([TaskRow.keyOf(task)]),
        },
      });
      this.#sections.set(project, section);
      main.append(section.element);
    }
  }

  // The open editor and the key of the row it replaces, in the current list.
  #editorFor() {
    if (!this.#editor) return null;
    const task = this.#taskList.locate(this.#editor.task);
    return { key: TaskRow.keyOf(task), element: this.#editorView.element, create: this.#editor.create };
  }

  // Inbox (null) first, then projects in order of first appearance.
  // A section holds its roots and all their descendants.
  #groupByProject() {
    const groups = new Map([[null, { roots: [], tasks: [] }]]);
    for (const root of this.#taskList.roots()) {
      const project = this.#taskList.effectiveProject(root);
      if (!groups.has(project)) groups.set(project, { roots: [], tasks: [] });
      const group = groups.get(project);
      group.roots.push(root);
      group.tasks.push(root, ...this.#taskList.descendants(root));
    }
    if (groups.get(null).tasks.length === 0) groups.delete(null);
    return groups;
  }

  #renderError(err) {
    const main = this.#renderShell(null, { withInput: false });
    main.append(this.#errorBadge(err));
  }

  #errorBadge(err) {
    const badge = this.#el('p', 'error-badge', `Could not load tasks: ${err.message}`);
    badge.setAttribute('role', 'alert');
    return badge;
  }
}
