const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
let playwright;
try { playwright = require("playwright"); } catch { /* optional dependency */ }

function wav() {
  const frames = 16000 * 15, b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(frames * 2, 40);
  return b.toString("base64");
}

async function launch() {
  const project = resolve(__dirname, "../..");
  const directory = await mkdtemp(join(tmpdir(), "podecho-dual-"));
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const server = spawn(join(project, "backend/.venv/bin/python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port), "--no-access-log"], {
    cwd: join(project, "backend"), env: { ...process.env, DB_PATH: join(directory, "test.db"), PODECHO_PASSWORD: "", PODECHO_MODE: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "", context;
  server.stderr.on("data", (b) => { logs += b; });
  const base = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (context) await context.close();
    server.kill("SIGTERM");
    await new Promise((r) => { if (server.exitCode !== null) r(); else { server.once("exit", r); setTimeout(r, 3000).unref(); } });
    await rm(directory, { recursive: true, force: true });
  };
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + "/api/streaming")).ok) break; } catch { /* starting */ }
      if (i > 60) throw new Error(`Test backend did not start: ${logs}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    context = await playwright.chromium.launchPersistentContext(join(directory, "chrome"), {
      channel: "chromium", headless: true,
      ...(process.env.PODECHO_CHROMIUM ? { executablePath: process.env.PODECHO_CHROMIUM } : {}),
      args: [`--disable-extensions-except=${join(project, "extension")}`, `--load-extension=${join(project, "extension")}`, "--autoplay-policy=no-user-gesture-required"],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate((appUrl) => chrome.storage.sync.set({ appUrl }), base);
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    return { context, page, worker, base, directory, close, errors };
  } catch (e) { await close(); throw e; }
}
module.exports = { launch, wav, available: Boolean(playwright) };
