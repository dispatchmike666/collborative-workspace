import crypto from 'node:crypto';
import fs from 'node:fs';
import { readJson, writeJsonAtomic } from './fs-util.js';

const MAX_PROMPTS = 40;
const MAX_TITLE = 40;
const MAX_TEXT = 1000;

const STARTERS = [
  { emoji: '🔎', title: "What's in this project?", text: 'Look through this project and explain, in plain English, what it is and what each main file does.' },
  { emoji: '🧪', title: 'Add tests', text: 'Add tests for the most important parts of this project, run them, and tell me what you found.' },
  { emoji: '🎨', title: 'Make it prettier', text: 'Improve how this looks. Keep it simple, and tell me what you changed.' },
  { emoji: '🐛', title: 'Find bugs', text: 'Look for bugs or things that could go wrong, fix the clear ones, and list the rest.' },
  { emoji: '📝', title: 'Summarize what changed', text: 'Summarize in plain English what changed in this project recently and why it matters.' },
  { emoji: '🧹', title: 'Tidy up', text: 'Tidy the code without changing what it does. Explain what you cleaned up.' },
];

// The shared shelf of one-click prompts. A new shelf starts with a few useful ones.
export class Prompts {
  #file;
  #list;

  constructor(file) {
    this.#file = file;
    if (fs.existsSync(file)) {
      this.#list = readJson(file, { prompts: [] }).prompts;
    } else {
      this.#list = STARTERS.map((starter) => ({ id: crypto.randomBytes(4).toString('hex'), by: 'Starter set', ...starter }));
      this.#save();
    }
  }

  #save() {
    writeJsonAtomic(this.#file, { prompts: this.#list });
  }

  list() {
    return this.#list.map((prompt) => ({ ...prompt }));
  }

  add({ title, text, emoji, by }) {
    const cleanTitle = String(title ?? '').trim();
    const cleanText = String(text ?? '').trim();
    if (!cleanTitle) throw new Error('Give the prompt a title.');
    if (cleanTitle.length > MAX_TITLE) throw new Error(`Keep the title under ${MAX_TITLE} characters.`);
    if (!cleanText) throw new Error('Write what to ask.');
    if (cleanText.length > MAX_TEXT) throw new Error(`Keep it under ${MAX_TEXT} characters.`);
    if (this.#list.length >= MAX_PROMPTS) throw new Error(`The shelf is full (${MAX_PROMPTS} prompts). Remove one first.`);
    const icon = [...String(emoji ?? '').trim()].length >= 1 && [...String(emoji).trim()].length <= 3 ? String(emoji).trim() : '💬';
    const prompt = { id: crypto.randomBytes(4).toString('hex'), emoji: icon, title: cleanTitle, text: cleanText, by };
    this.#list.push(prompt);
    this.#save();
    return { ...prompt };
  }

  remove(id) {
    const prompt = this.#list.find((candidate) => candidate.id === id);
    if (!prompt) throw new Error('That prompt is no longer on the shelf.');
    this.#list = this.#list.filter((candidate) => candidate !== prompt);
    this.#save();
  }
}
