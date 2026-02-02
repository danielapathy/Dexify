const { BrowserWindow, session } = require("electron");
const fs = require("node:fs");

const { DEEZER_USER_AGENT } = require("./constants");
const { ensureDir, getSessionDir, getAppStateStoragePath } = require("./sessionStorage");

async function extractDeezerAppState(cookies) {
  return new Promise((resolve, reject) => {
    const electronSession = session.fromPartition("temp-deezer-extract");

    electronSession
      .clearStorageData()
      .then(() => {
        const cookiePromises = cookies.map((cookie) => {
          try {
            let domain = cookie.domain;

            if (!domain || domain === "") {
              console.log(`Skipping cookie without domain: ${cookie.name}`);
              return Promise.resolve();
            }

            if (domain.startsWith(".")) {
              domain = domain.substring(1);
            }

            if (!domain.includes(".")) {
              console.log(`Skipping cookie with invalid domain format: ${cookie.name} (${domain})`);
              return Promise.resolve();
            }

            const cookieData = {
              url: `https://${domain}${cookie.path || "/"}`,
              name: cookie.name,
              value: cookie.value,
              secure: cookie.secure !== false,
              httpOnly: cookie.httpOnly === true,
            };

            if (cookie.expirationDate && cookie.expirationDate > 0) {
              cookieData.expirationDate = cookie.expirationDate;
            }
            if (cookie.sameSite && ["lax", "strict", "none"].includes(cookie.sameSite.toLowerCase())) {
              cookieData.sameSite = cookie.sameSite.toLowerCase();
            }

            return electronSession.cookies.set(cookieData);
          } catch (error) {
            console.warn(`Error processing cookie ${cookie.name}: ${error.message}`);
            return Promise.resolve();
          }
        });

        Promise.all(cookiePromises)
          .then(() => {
            const win = new BrowserWindow({
              show: false,
              webPreferences: {
                session: electronSession,
                nodeIntegration: false,
                contextIsolation: true,
              },
            });

            try {
              win.webContents.setUserAgent(DEEZER_USER_AGENT);
            } catch {}

            let finished = false;
            let pollInterval = null;

            const cleanup = () => {
              if (!finished) {
                finished = true;
                try {
                  if (pollInterval) clearInterval(pollInterval);
                } catch {}
                try {
                  win.close();
                } catch {}
                try {
                  electronSession.clearStorageData();
                } catch {}
              }
            };

            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error("Timeout extracting app state"));
            }, 20000);

            win.webContents.on("did-finish-load", () => {
              if (pollInterval) return;
              const script = `
                (function() {
                  var appState = null;

                  if (typeof window.__DZR_APP_STATE__ !== 'undefined') {
                    appState = window.__DZR_APP_STATE__;
                  } else {
                    var scripts = document.querySelectorAll('script');
                    for (var i = 0; i < scripts.length; i++) {
                      var script = scripts[i];
                      var content = script.textContent || script.innerHTML;
                      if (content && content.indexOf('window.__DZR_APP_STATE__') !== -1) {
                        var regex = /window\\\\.__DZR_APP_STATE__\\\\s*=\\\\s*({[\\\\s\\\\S]*?});/;
                        var match = content.match(regex);
                        if (match && match[1]) {
                          try {
                            appState = JSON.parse(match[1]);
                            break;
                          } catch (e) {}
                        }
                      }
                    }
                  }

                  return appState;
                })()
              `;

              let pollInFlight = false;
              const pollOnce = () => {
                if (finished) return;
                if (pollInFlight) return;
                pollInFlight = true;
                win.webContents
                  .executeJavaScript(script)
                  .then((result) => {
                    pollInFlight = false;
                    if (finished) return;
                    if (!result) return;
                    clearTimeout(timeout);
                    ensureDir(getSessionDir());
                    fs.writeFileSync(getAppStateStoragePath(), JSON.stringify(result, null, 2), {
                      encoding: "utf8",
                      mode: 0o600,
                    });
                    resolve(result);
                    cleanup();
                  })
                  .catch((error) => {
                    pollInFlight = false;
                    if (finished) return;
                    clearTimeout(timeout);
                    reject(error);
                    cleanup();
                  });
              };

              pollOnce();
              pollInterval = setInterval(pollOnce, 250);
            });

            win.webContents.on("did-fail-load", (_event, _errorCode, errorDescription) => {
              clearTimeout(timeout);
              reject(new Error(`Failed to load: ${errorDescription}`));
              cleanup();
            });

            win.loadURL("https://www.deezer.com/")
              .catch((error) => {
                clearTimeout(timeout);
                reject(error);
                cleanup();
              });
          })
          .catch((error) => {
            reject(error);
          });
      })
      .catch((error) => {
        reject(error);
      });
  });
}

async function extractDeezerAppStateWithArl(arl) {
  return new Promise((resolve, reject) => {
    const electronSession = session.fromPartition("temp-deezer-extract-arl");

    electronSession
      .clearStorageData()
      .then(() => {
        electronSession.cookies
          .set({
            url: "https://www.deezer.com",
            name: "arl",
            value: arl,
            secure: true,
            httpOnly: true,
          })
          .then(() => {
            const win = new BrowserWindow({
              show: false,
              webPreferences: {
                session: electronSession,
                nodeIntegration: false,
                contextIsolation: true,
              },
            });

            try {
              win.webContents.setUserAgent(DEEZER_USER_AGENT);
            } catch {}

            let finished = false;
            let pollInterval = null;

            const cleanup = () => {
              if (!finished) {
                finished = true;
                try {
                  if (pollInterval) clearInterval(pollInterval);
                } catch {}
                try {
                  win.close();
                } catch {}
                try {
                  electronSession.clearStorageData();
                } catch {}
              }
            };

            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error("Timeout extracting app state"));
            }, 20000);

            win.webContents.on("did-finish-load", () => {
              if (pollInterval) return;
              const script = `
                (function() {
                  var appState = null;

                  if (typeof window.__DZR_APP_STATE__ !== 'undefined') {
                    appState = window.__DZR_APP_STATE__;
                  } else {
                    var scripts = document.querySelectorAll('script');
                    for (var i = 0; i < scripts.length; i++) {
                      var script = scripts[i];
                      var content = script.textContent || script.innerHTML;
                      if (content && content.indexOf('window.__DZR_APP_STATE__') !== -1) {
                        var regex = /window\\\\.__DZR_APP_STATE__\\\\s*=\\\\s*({[\\\\s\\\\S]*?});/;
                        var match = content.match(regex);
                        if (match && match[1]) {
                          try {
                            appState = JSON.parse(match[1]);
                            break;
                          } catch (e) {}
                        }
                      }
                    }
                  }

                  return appState;
                })()
              `;

              let pollInFlight = false;
              const pollOnce = () => {
                if (finished) return;
                if (pollInFlight) return;
                pollInFlight = true;
                win.webContents
                  .executeJavaScript(script)
                  .then((result) => {
                    pollInFlight = false;
                    if (finished) return;
                    if (!result) return;
                    clearTimeout(timeout);
                    ensureDir(getSessionDir());
                    fs.writeFileSync(getAppStateStoragePath(), JSON.stringify(result, null, 2), {
                      encoding: "utf8",
                      mode: 0o600,
                    });
                    resolve(result);
                    cleanup();
                  })
                  .catch((error) => {
                    pollInFlight = false;
                    if (finished) return;
                    clearTimeout(timeout);
                    reject(error);
                    cleanup();
                  });
              };

              pollOnce();
              pollInterval = setInterval(pollOnce, 250);
            });

            win.webContents.on("did-fail-load", (_event, _errorCode, errorDescription) => {
              clearTimeout(timeout);
              reject(new Error(`Failed to load: ${errorDescription}`));
              cleanup();
            });

            win.loadURL("https://www.deezer.com/")
              .catch((error) => {
                clearTimeout(timeout);
                reject(error);
                cleanup();
              });
          })
          .catch((error) => {
            reject(error);
          });
      })
      .catch((error) => {
        reject(error);
      });
  });
}

module.exports = { extractDeezerAppState, extractDeezerAppStateWithArl };

