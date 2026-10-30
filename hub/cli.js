import fs from 'node:fs';
import path from 'node:path';
import { UserStore } from './auth.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(process.env.HUB_DATA ?? path.join(root, 'hub-data'));
const users = new UserStore(path.join(dataDir, 'users.json'));
const [command, name] = process.argv.slice(2);

const usage = `Manage who can log in.

  npm run hub:add-user -- <Name>       add a person (2 to 20 letters or numbers)
  npm run hub:new-password -- <Name>   give someone a new random password
  npm run hub:set-password -- <Name>   choose someone's password yourself (at least 10 characters)
  npm run hub:new-token -- <Name>      give someone a new helper token
  npm run hub:list                     show who can log in`;

// The password and token go into a private file, never onto the screen.
function saveCredentials(person, { password, helperToken }) {
  const dir = path.join(dataDir, 'credentials');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${person}.txt`);
  const lines = [`Name: ${person}`];
  if (password) lines.push(`Password: ${password}`);
  if (helperToken) lines.push(`Helper token: ${helperToken}`);
  lines.push(
    '',
    'The password is for logging in to the workspace website.',
    "The helper token is only for the helper program on this person's own computer.",
    'Keep this file private. Once the password is saved somewhere safe, delete this file.',
  );
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  return file;
}

function needName() {
  if (!name) {
    console.error('Say who, for example:  npm run hub:add-user -- Max');
    process.exit(1);
  }
}

try {
  if (command === 'add-user') {
    needName();
    const created = users.addUser(name);
    const file = saveCredentials(created.name, created);
    console.log(`Added ${created.name}.`);
    console.log(`Their password and helper token are in this private file: ${file}`);
  } else if (command === 'new-password') {
    needName();
    const file = saveCredentials(name, { password: users.resetPassword(name) });
    console.log(`${name} has a new password. It is in this private file: ${file}`);
  } else if (command === 'set-password') {
    needName();
    if (process.stdin.isTTY) console.log(`Type the new password for ${name} and press Enter (it will show on screen):`);
    const typed = fs.readFileSync(0, 'utf8').split(/\r?\n/)[0];
    users.setPassword(name, typed);
    console.log(`${name}'s password is changed. Nothing was written to a file.`);
  } else if (command === 'new-token') {
    needName();
    const file = saveCredentials(name, { helperToken: users.newHelperToken(name) });
    console.log(`${name} has a new helper token. It is in this private file: ${file}`);
  } else if (command === 'list') {
    const names = users.listNames();
    console.log(names.length ? `People who can log in: ${names.join(', ')}` : 'Nobody has been added yet.');
  } else {
    console.log(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
