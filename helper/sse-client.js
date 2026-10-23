// Reads a "live feed" (Server-Sent Events) from the hub and reconnects if it drops.

// Turns pieces of text from the feed into whole messages { event, id, data }.
export function createSseParser(onMessage) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();
      for (const block of blocks) {
        let event = 'message';
        let id = null;
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') event = value;
          else if (field === 'id') id = value;
          else if (field === 'data') data.push(value);
        }
        if (data.length) onMessage({ event, id, data: data.join('\n') });
      }
    },
  };
}

// Connects and keeps reconnecting (waiting a little longer each time) until stop() is called.
// A refused token (401) is not retried: onFatal explains, and the connection stays closed.
export function connectSse({
  url,
  headers = {},
  onMessage,
  onOpen = () => {},
  onClose = () => {},
  onFatal = () => {},
  fetchImpl = fetch,
  minDelayMs = 1000,
  maxDelayMs = 30_000,
  staleMs = 60_000,
  checkMs = 10_000,
}) {
  let stopped = false;
  let controller = null;
  let wake = null;

  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

  async function loop() {
    let delay = minDelayMs;
    while (!stopped) {
      controller = new AbortController();
      let lastActivity = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > staleMs) controller.abort();
      }, checkMs);
      try {
        const res = await fetchImpl(url, { headers, signal: controller.signal });
        if (res.status === 401) {
          onFatal('The hub did not accept this helper token. Ask for a new one.');
          stopped = true;
          break;
        }
        if (!res.ok) throw new Error(`The hub answered with error ${res.status}`);
        delay = minDelayMs;
        lastActivity = Date.now();
        onOpen();
        const parser = createSseParser(onMessage);
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          lastActivity = Date.now();
          parser.push(decoder.decode(chunk, { stream: true }));
        }
        onClose(new Error('The hub closed the connection'));
      } catch (error) {
        if (stopped) break;
        onClose(error);
      } finally {
        clearInterval(watchdog);
      }
      if (stopped) break;
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  loop();
  return {
    stop() {
      stopped = true;
      controller?.abort();
      wake?.();
    },
  };
}
