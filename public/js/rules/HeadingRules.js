// PRD §5.3. A task whose whole description is the word "Backlog" is drawn as a heading.
export class HeadingRules {
  static isBacklogHeading(description) {
    return description.trim().toLowerCase() === 'backlog';
  }
}
