import { FileStore } from '../io/FileStore.js';
import { TaskList } from '../model/TaskList.js';
import { ProjectPalette } from './ProjectPalette.js';
import { ProjectSection } from './ProjectSection.js';

export class App {
  #root;
  #store;
  #taskList = null;

  constructor(root, { store = new FileStore() } = {}) {
    this.#root = root;
    this.#store = store;
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
    }
  }

  // All rendering goes through here (initial load, live reload, actions).
  setTaskList(taskList) {
    this.#taskList = taskList;
    this.#render();
  }

  #render() {
    const main = this.#renderShell();
    this.#renderSections(main);
  }

  #renderShell() {
    const header = document.createElement('header');
    header.className = 'app-header';
    const title = document.createElement('h1');
    title.textContent = 'TaskFlow';
    const strip = document.createElement('div');
    strip.className = 'accent-strip';
    strip.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) strip.append(document.createElement('span'));
    header.append(title, strip);

    const main = document.createElement('main');
    main.className = 'app-main';
    this.#root.replaceChildren(header, main);
    return main;
  }

  #renderSections(main) {
    const palette = new ProjectPalette(this.#taskList);
    const today = App.today();
    for (const [project, { roots, tasks }] of this.#groupByProject()) {
      const section = new ProjectSection({
        project,
        accent: palette.accent(project),
        roots,
        tasks,
        taskList: this.#taskList,
        palette,
        today,
      });
      main.append(section.element);
    }
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
    const main = this.#renderShell();
    const badge = document.createElement('p');
    badge.className = 'error-badge';
    badge.setAttribute('role', 'alert');
    badge.textContent = `Could not load tasks: ${err.message}`;
    main.append(badge);
  }
}
