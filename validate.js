import fs from 'node:fs/promises';
import path from 'node:path';
import { TaskList } from './public/js/model/TaskList.js';
import { Validator } from './public/js/rules/Validator.js';

const ROOT = import.meta.dirname;

// Exit codes: 0 no errors (warnings allowed), 1 at least one error, 2 bad data directory.
class ValidateCommand {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  async run() {
    try {
      const stat = await fs.stat(this.dataDir);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch {
      console.error(`validate: data directory not found: ${this.dataDir}`);
      return 2;
    }
    const [todo, done] = [await this.read('todo.txt'), await this.read('done.txt')];
    // Neither file present almost always means the wrong folder, not an empty list.
    if (todo === null && done === null) {
      console.error(`validate: no todo.txt or done.txt in ${this.dataDir}`);
      return 2;
    }
    const taskList = new TaskList({ todo: todo ?? '', done: done ?? '' });
    const problems = Validator.validate(taskList);
    for (const line of this.format(problems)) console.log(line);
    console.log(this.summary(problems));
    return problems.some((p) => p.severity === 'error') ? 1 : 0;
  }

  // A missing file is null; one missing file counts as empty.
  async read(name) {
    try {
      return await fs.readFile(path.join(this.dataDir, name), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  format(problems) {
    const places = problems.map((p) => `${p.file}:${p.line}`);
    const width = Math.max(0, ...places.map((p) => p.length)) + 2;
    return problems.map((p, i) => `${places[i].padEnd(width)}${p.severity.padEnd(9)}${p.message}`);
  }

  summary(problems) {
    if (problems.length === 0) return 'No problems found.';
    const errors = problems.filter((p) => p.severity === 'error').length;
    const warnings = problems.length - errors;
    return `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`;
  }
}

const [, , dataDirArg] = process.argv;
// An explicit folder is relative to where the command runs; the default is the repo's data/.
const dataDir = dataDirArg ? path.resolve(dataDirArg) : path.join(ROOT, 'data');
process.exitCode = await new ValidateCommand(dataDir).run();
