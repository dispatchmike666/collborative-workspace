import crypto from 'node:crypto';
import { readJson, writeJsonAtomic } from './fs-util.js';

const MAX_BRIEF = 4000;
const MAX_DECISION = 300;
const MAX_DECISIONS = 100;

const emptyKnowledge = () => ({
  brief: { text: '', version: 0, updatedBy: null, updatedAt: null },
  decisions: [],
  shareNotes: true,
});

// What every Claude run on a project should always know: the brief (standing instructions),
// the decisions the team has settled, and whether the shared notes are included too.
export class Knowledge {
  #file;
  #now;
  #data;

  constructor(file, { now = () => new Date() } = {}) {
    this.#file = file;
    this.#now = now;
    this.#data = { ...emptyKnowledge(), ...readJson(file, {}) };
  }

  get() {
    return structuredClone(this.#data);
  }

  #save() {
    writeJsonAtomic(this.#file, this.#data);
  }

  // Saves only if `baseVersion` is still the latest, so nobody's edit is silently overwritten.
  saveBrief({ text, baseVersion, user }) {
    if (typeof text !== 'string') throw new Error('The brief must be text.');
    if (text.length > MAX_BRIEF) throw new Error(`Keep the brief under ${MAX_BRIEF} characters.`);
    if (baseVersion !== this.#data.brief.version) return { ok: false, conflict: true, brief: structuredClone(this.#data.brief) };
    this.#data.brief = { text, version: this.#data.brief.version + 1, updatedBy: user, updatedAt: this.#now().toISOString() };
    this.#save();
    return { ok: true, brief: structuredClone(this.#data.brief) };
  }

  setShareNotes(value) {
    if (typeof value !== 'boolean') throw new Error('Say true or false.');
    this.#data.shareNotes = value;
    this.#save();
  }

  addDecision({ text, by }) {
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('Write the decision first.');
    if (clean.length > MAX_DECISION) throw new Error(`Keep a decision under ${MAX_DECISION} characters.`);
    if (this.#data.decisions.length >= MAX_DECISIONS) throw new Error('There are too many decisions on the list. Remove old ones first.');
    const decision = { id: crypto.randomBytes(4).toString('hex'), text: clean, by, at: this.#now().toISOString() };
    this.#data.decisions.push(decision);
    this.#save();
    return { ...decision };
  }

  removeDecision(id, by) {
    const decision = this.#data.decisions.find((candidate) => candidate.id === id);
    if (!decision) throw new Error('That decision is no longer there.');
    if (String(decision.by).toLowerCase() !== String(by).toLowerCase()) {
      throw new Error(`Only ${decision.by} can remove this decision.`);
    }
    this.#data.decisions = this.#data.decisions.filter((candidate) => candidate !== decision);
    this.#save();
  }
}
