const INT = document.getElementById("interval");
const AUTO = document.getElementById("autoArchive");
const SAVED = document.getElementById("saved");

function load() {
  chrome.runtime.sendMessage("GET_STATE", (cfg) => {
    INT.value = cfg?.intervalMinutes ?? 5;
    AUTO.checked = !!cfg?.autoArchiveDelivered;
  });
}

function save() {
  const minutes = Math.max(1, Number(INT.value) || 5);
  const auto = !!AUTO.checked;

  chrome.runtime.sendMessage({ type: "SET_INTERVAL", minutes }, () => {
    chrome.runtime.sendMessage({ type: "SET_AUTO_ARCHIVE", value: auto }, () => {
      SAVED.textContent = "Saved ✓";
      setTimeout(() => (SAVED.textContent = ""), 1500);
    });
  });
}

document.getElementById("save").addEventListener("click", save);
document.addEventListener("DOMContentLoaded", load);

