// What the whole page knows about the crew: who is online, whose Claude is working, who just
// finished something. The top bar, the home page and the project page all listen to this.

const listeners = new Set();
const happyTimers = new Map();

export const crewState = {
  users: [],
  presence: {},
  working: null,
  happy: {},
};

export function onCrewChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  for (const listener of listeners) listener(crewState);
}

export function setUsers(users) {
  crewState.users = users;
  announce();
}

export function setPresence(presence) {
  crewState.presence = { ...presence };
  announce();
}

export function setWorking(name) {
  crewState.working = name;
  announce();
}

// Makes someone's creature cheer for a few seconds.
export function cheer(name, ms = 3200) {
  crewState.happy = { ...crewState.happy, [name]: true };
  clearTimeout(happyTimers.get(name));
  happyTimers.set(name, setTimeout(() => {
    crewState.happy = { ...crewState.happy, [name]: false };
    announce();
  }, ms));
  announce();
}

export function memberState(name) {
  return {
    online: Boolean(crewState.presence[name]),
    working: crewState.working !== null && crewState.working.toLowerCase() === name.toLowerCase(),
    happy: Boolean(crewState.happy[name]),
  };
}
