// The running record of everything that happened in a project, oldest first.
// New events are pushed to anyone listening (the browser windows).
export class Timeline {
  #events = [];
  #listeners = new Set();
  #nextId = 1;
  #max;

  constructor({ max = 2000 } = {}) {
    this.#max = max;
  }

  add(event) {
    const stored = { ...event, id: this.#nextId++, at: new Date().toISOString() };
    this.#events.push(stored);
    if (this.#events.length > this.#max) this.#events.shift();
    for (const listener of this.#listeners) {
      try {
        listener(stored);
      } catch {
        // One broken listener (a closed browser tab) must not stop the others.
      }
    }
    return stored;
  }

  all() {
    return [...this.#events];
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
