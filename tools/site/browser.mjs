// Shared Playwright launcher for the site scripts.
// Tries Playwright's default headless shell first; if that build is not downloaded,
// falls back to the full Chromium build (channel "chromium"), which is often present
// in ~/.cache/ms-playwright when the headless shell is not.
import { chromium } from 'playwright';

export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err && err.message))) throw err;
    return await chromium.launch({ channel: 'chromium' });
  }
}
