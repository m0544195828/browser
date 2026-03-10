const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botBrowser = null;
let botPage = null;
let browserPage = null; // הדפדפן שמגלש
let meetCode = null;
let status = 'idle';

// ── פותח דפדפן ───────────────────────────────────────────────────────────────
async function launchBrowser() {
  if (botBrowser && botBrowser.isConnected()) return;

  botBrowser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--use-fake-ui-for-media-stream',  // מאפשר מצלמה/מיק בלי popup
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--enable-usermedia-screen-capturing',
      '--allow-http-screen-capture',
    ],
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(),
    headless: false, // חייב false כדי לשתף מסך
  });
}

// ── מצטרף ל-Meet ─────────────────────────────────────────────────────────────
app.post('/join', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing meet code' });

  try {
    meetCode = code;
    status = 'joining';
    await launchBrowser();

    // פתח טאב לדפדפן הגלישה
    browserPage = await botBrowser.newPage();
    await browserPage.setViewport({ width: 1280, height: 720 });
    await browserPage.goto('https://google.com');

    // פתח טאב ל-Meet
    botPage = await botBrowser.newPage();
    await botPage.setViewport({ width: 1280, height: 720 });

    const meetUrl = code.startsWith('http') ? code : `https://meet.google.com/${code}`;
    await botPage.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // המתן לטעינת Meet
    await new Promise(r => setTimeout(r, 3000));

    // נסה ללחוץ "הצטרף"
    try {
      await botPage.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const join = btns.find(b => b.innerText.includes('Join') || b.innerText.includes('הצטרף') || b.innerText.includes('Ask'));
        if (join) join.click();
      });
    } catch(e) {}

    await new Promise(r => setTimeout(r, 3000));

    // שתף את טאב הגלישה
    try {
      await botPage.evaluate(() => {
        const btns = [...document.querySelectorAll('button, [data-tooltip]')];
        const share = btns.find(b =>
          (b.innerText || b.getAttribute('data-tooltip') || '').toLowerCase().includes('present') ||
          (b.innerText || b.getAttribute('data-tooltip') || '').includes('שתף')
        );
        if (share) share.click();
      });
    } catch(e) {}

    status = 'joined';
    res.json({ success: true, status });

  } catch(err) {
    status = 'error';
    res.status(500).json({ error: err.message });
  }
});

// ── ניווט בדפדפן ─────────────────────────────────────────────────────────────
app.post('/navigate', async (req, res) => {
  const { url } = req.body;
  if (!browserPage) return res.status(400).json({ error: 'Not connected' });

  try {
    await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await browserPage.title();
    res.json({ success: true, url: browserPage.url(), title });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── סטטוס ────────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ status, meetCode });
});

// ── סגור ─────────────────────────────────────────────────────────────────────
app.post('/close', async (req, res) => {
  try {
    if (botBrowser) await botBrowser.close();
    botBrowser = null; botPage = null; browserPage = null;
    status = 'idle';
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
