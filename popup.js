const list = document.getElementById("list");
const addBtn = document.getElementById("add");
const refreshBtn = document.getElementById("refresh");
const inDesc = document.getElementById("desc");
const inTrack = document.getElementById("tracking");
const inPost = document.getElementById("postcode");

function renderTrackers(state) {
  list.innerHTML = "";
  const trackers = state.trackers || [];
  if (!trackers.length) {
    list.innerHTML = '<div class="muted">Dude with no friends has no parcels.. Fill the fields above and click +.</div>';
    return;
  }

  trackers.forEach(t => {
    const row = document.createElement("div");
    row.className = "line";

    const tooltip = t.lastError
      ? `Error: ${t.lastError}`
      : (t.history && t.history.length
          ? t.history.join("\n")
          : "No history yet");

    row.title = tooltip;

    const badge = document.createElement("span");
    badge.className = `badge ${t.archived ? "arch" : ""}`;
    badge.textContent = t.archived ? "archived" : "active";

    const title = document.createElement("span");
    title.className = "descTitle";
    title.textContent = t.description || t.tracking || "Parcel";

    const when = document.createElement("span");
    when.className = "when";
    when.textContent = t.lastWhen ? `• ${t.lastWhen}` : "• —";

    const right = document.createElement("div");
    right.className = "right";
    const toggle = document.createElement("button");
    toggle.className = "small";
    toggle.textContent = t.archived ? "Unarchive" : "Archive";
    toggle.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "TOGGLE_ARCHIVE", id: t.id }, refreshState);
    });
    const rm = document.createElement("button");
    rm.className = "small";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "REMOVE_URL", id: t.id }, refreshState);
    });
    right.append(toggle, rm);

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = t.lastError ? `⚠ ${t.lastError}` : (t.lastText || "No status yet");

    row.append(badge, title, when, right, msg);
    list.appendChild(row);
  });
}

function refreshState() {
  chrome.runtime.sendMessage("GET_STATE", renderTrackers);
}

addBtn.addEventListener("click", () => {
  const description = inDesc.value.trim();
  const tracking = inTrack.value.trim();
  const postcode = inPost.value.trim();

  if (!tracking || !postcode) {
    alert("Please dawg.. Tracking number and Post code.");
    return;
  }
  chrome.runtime.sendMessage({ type: "ADD_TRACKER", description, tracking, postcode }, (res) => {
    if (!res || res.ok !== true) {
      alert((res && res.error) || "Could not add parcel, no clue why.");
      return;
    }
    inDesc.value = "";
    inTrack.value = "";
    inPost.value = "";
    chrome.runtime.sendMessage("CHECK_NOW", refreshState); // force first refresh
  });
});

refreshBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage("CHECK_NOW", refreshState);
});

document.addEventListener("DOMContentLoaded", refreshState);

