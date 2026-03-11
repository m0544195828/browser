const express = require('express');
const { execSync, spawn } = require('child_process');
const puppeteer = require('puppeteer');
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

let browser = null;
let botPage = null;
let browserPage = null;
let status = 'idle';

function startXvfb() {
  try {
    execSync('pkill Xvfb || true');
    const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24'], {
      detached: true, stdio: 'ignore'
    });
    xvfb.unref();
    process.env.DISPLAY = ':99';
    execSync('sleep 2');
    console.log('Xvfb started');
  } catch(e) {
    console.log('Xvfb error:', e.message);
  }
}

async function launchBrowser() {
  if (browser && browser.isConnected()) return;
  startXvfb();
  browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--display=:99',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--enable-usermedia-screen-capturing',
      '--auto-select-desktop-capture-source=Entire screen',
      '--allow-http-screen-capture',
      '--disable-infobars',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
}

app.post('/join', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing meet code' });
  try {
    status = 'joining';
    await launchBrowser();
    browserPage = await browser.newPage();
    await browserPage.setViewport({ width: 1280, height: 720 });
    await browserPage.goto('https://google.com');
    botPage = await browser.newPage();
    await botPage.setViewport({ width: 1280, height: 720 });
    const meetUrl = code.startsWith('http') ? code : `https://meet.google.com/${code}`;
    await botPage.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    await botPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const join = btns.find(b =>
        b.innerText.includes('Join') ||
        b.innerText.includes('הצטרף') ||
        b.innerText.includes('Ask to join')
      );
      if (join) join.click();
    });
    await new Promise(r => setTimeout(r, 3000));
    status = 'joined';
    res.json({ success: true });
  } catch(e) {
    status = 'error';
    res.status(500).json({ error: e.message });
  }
});

app.post('/navigate', async (req, res) => {
  const { url } = req.body;
  if (!browserPage) return res.status(400).json({ error: 'Not connected' });
  try {
    await browserPage.bringToFront();
    await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await browserPage.title();
    res.json({ success: true, url: browserPage.url(), title });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', (req, res) => res.json({ status }));

app.post('/close', async (req, res) => {
  try {
    if (browser) await browser.close();
    browser = null; botPage = null; browserPage = null;
    status = 'idle';
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
