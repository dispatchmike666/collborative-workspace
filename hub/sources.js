import { readJson, writeJsonAtomic } from './fs-util.js';
import { isSafeRelativePath } from './paths.js';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;

// The text of a project's small files, so they can be read in the page without opening a folder.
export class Sources {
  #file;
  #files;

  constructor(file) {
    this.#file = file;
    this.#files = readJson(file, { files: [] }).files;
  }

  paths() {
    return this.#files.map((file) => file.path).sort();
  }

  get(path) {
    const found = this.#files.find((file) => file.path === path);
    return found ? { path: found.path, text: found.text } : null;
  }

  // Replaces everything with the files a helper uploaded: [{ path, text }].
  set(files) {
    if (!Array.isArray(files)) throw new Error('Send a list of files.');
    if (files.length > MAX_FILES) throw new Error(`Too many files to show (limit ${MAX_FILES}).`);
    let total = 0;
    const clean = files.map((file) => {
      if (!isSafeRelativePath(file?.path)) throw new Error(`Bad file path: ${file?.path}`);
      if (typeof file.text !== 'string' || file.text.includes('\u0000')) throw new Error(`${file.path} is not text.`);
      const bytes = Buffer.byteLength(file.text);
      if (bytes > MAX_FILE_BYTES) throw new Error(`${file.path} is too large to show.`);
      total += bytes;
      return { path: file.path, text: file.text };
    });
    if (total > MAX_TOTAL_BYTES) throw new Error('The files are too large overall to show.');
    this.#files = clean;
    writeJsonAtomic(this.#file, { files: clean });
    return { count: clean.length, bytes: total };
  }
}
