import { FileStore } from '../io/FileStore.js';
import { TaskList } from '../model/TaskList.js';

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
    this.#renderTasks(main);
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

  // TEMPORARY: replaced in 6.3 by ProjectSection accordions.
  #renderTasks(main) {
    const list = document.createElement('ul');
    list.className = 'temp-task-list';
    for (const task of this.#taskList.todoTasks) {
      const item = document.createElement('li');
      item.textContent = task.body;
      list.append(item);
    }
    main.append(list);
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
