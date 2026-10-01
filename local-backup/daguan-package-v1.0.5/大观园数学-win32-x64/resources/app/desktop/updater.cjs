const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;
const UPDATE_FEED_URL = "https://update.electronjs.org/Evan26Ma/daguan-cxy-local/win32-x64";

function createDesktopUpdater({
  app,
  autoUpdater,
  log = async () => {},
  env = process.env,
  platform = process.platform,
  onState = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timer = null;
  let stopped = false;
  let checking = false;
  let updateDownloaded = false;
  let onInstallUpdate = async () => {};

  function available() {
    return platform === "win32" && Boolean(app.isPackaged) && Boolean(autoUpdater);
  }

  function schedule(delay) {
    if (stopped || !available()) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      void checkForUpdates(false);
    }, delay);
    timer?.unref?.();
  }

  autoUpdater?.on("checking-for-update", () => {
    checking = true;
    onState("checking");
    void log("checking");
  });
  autoUpdater?.on("update-available", () => {
    checking = false;
    onState("available");
    void log("available");
    schedule(UPDATE_INTERVAL_MS);
  });
  autoUpdater?.on("update-not-available", () => {
    checking = false;
    onState("not-available");
    void log("not-available");
    schedule(UPDATE_INTERVAL_MS);
  });
  autoUpdater?.on("update-downloaded", () => {
    checking = false;
    updateDownloaded = true;
    onState("downloaded");
    void log("downloaded");
    schedule(UPDATE_INTERVAL_MS);
  });
  autoUpdater?.on("error", (error) => {
    checking = false;
    onState("error");
    void log(`error:${String(error?.code || error?.name || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)}`);
    schedule(UPDATE_INTERVAL_MS);
  });

  async function checkForUpdates() {
    if (!available() || stopped || checking) return false;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      checking = false;
      onState("error");
      void log(`error:${String(error?.code || error?.name || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)}`);
      schedule(UPDATE_INTERVAL_MS);
      return false;
    }
  }

  return {
    start({ installUpdate }) {
      if (!available() || stopped) return false;
      onInstallUpdate = installUpdate || onInstallUpdate;
      const feed = env.DAGUAN_UPDATE_FEED_URL || `${UPDATE_FEED_URL}/${app.getVersion()}`;
      try { autoUpdater.setFeedURL({ url: feed }); }
      catch (error) {
        onState("error");
        void log(`error:${String(error?.code || error?.name || "feed-config").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)}`);
        return false;
      }
      void log("started");
      schedule(STARTUP_DELAY_MS);
      return true;
    },
    checkNow() { return checkForUpdates(); },
    async installDownloadedUpdate() {
      if (!updateDownloaded || stopped) return false;
      return (await onInstallUpdate()) !== false;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeoutFn(timer);
      timer = null;
    },
    getState() { return { checking, updateDownloaded, feedConfigured: available() }; },
  };
}

module.exports = { createDesktopUpdater, UPDATE_FEED_URL, UPDATE_INTERVAL_MS, STARTUP_DELAY_MS };
