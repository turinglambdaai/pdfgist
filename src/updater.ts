import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { el } from "./dom";

let currentUpdate: Update | null = null;
let installing = false;

async function renderVersion(): Promise<void> {
  el("app-version").textContent = `v${await getVersion()}`;
}

function showBanner(update: Update): void {
  currentUpdate = update;
  el("update-banner-text").textContent = `发现新版本 ${update.version}`;
  el("update-banner").classList.remove("hidden");
}

async function install(update: Update, button: HTMLButtonElement): Promise<void> {
  if (installing) return;
  installing = true;
  const original = button.textContent;
  button.disabled = true;
  const status = el("update-status");
  try {
    let received = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        button.textContent = "下载中 0%";
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        const pct = total > 0 ? Math.round((received / total) * 100) : 0;
        button.textContent = `下载中 ${pct}%`;
      } else if (event.event === "Finished") {
        button.textContent = "安装中…";
      }
    });
    await relaunch();
  } catch (err) {
    button.disabled = false;
    button.textContent = original;
    status.textContent = `更新失败：${err}`;
    status.classList.add("error");
  } finally {
    installing = false;
  }
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  const status = el("update-status");
  try {
    const update = await check();
    if (update) {
      showBanner(update);
      if (manual) {
        status.textContent = `发现新版本 ${update.version}`;
        status.classList.remove("error");
      }
    } else if (manual) {
      status.textContent = "✓ 已是最新版本";
      status.classList.remove("error");
    }
  } catch (err) {
    if (manual) {
      status.textContent = `检查失败：${err}`;
      status.classList.add("error");
    }
  }
}

export function initUpdater(): void {
  void renderVersion();
  const checkBtn = el("btn-check-update") as HTMLButtonElement;
  const installBtn = el("btn-update-install") as HTMLButtonElement;
  checkBtn.addEventListener("click", () => {
    el("update-status").textContent = "检查中…";
    void checkForUpdates(true);
  });
  installBtn.addEventListener("click", () => {
    if (currentUpdate) void install(currentUpdate, installBtn);
  });
  el("btn-update-dismiss").addEventListener("click", () =>
    el("update-banner").classList.add("hidden")
  );
  // silent check shortly after startup; dev builds have no publish endpoint
  if (import.meta.env.PROD) setTimeout(() => void checkForUpdates(false), 4000);
}
