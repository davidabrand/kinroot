// Live chat: send without reloading, check for new messages every few seconds.
// Without JavaScript the form still works as a normal page post.
const root = document.querySelector(".chat");
const log = document.getElementById("log");
const form = document.getElementById("chat-form");
const box = document.getElementById("body");
const cid = root.dataset.connection;
let lastId = Number(root.dataset.last) || 0;
const POLL_MS = 5000;

const timeFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function stamp(el) {
  const t = el.querySelector("time");
  if (t && t.dateTime) t.textContent = timeFormat.format(new Date(t.dateTime));
}

function addMessage(msg) {
  if (log.querySelector(`[data-id="${msg.id}"]`)) return;
  document.getElementById("chat-empty")?.remove();
  const div = document.createElement("div");
  div.className = "bubble" + (msg.mine ? " mine" : "");
  div.dataset.id = msg.id;
  div.textContent = msg.body;
  const t = document.createElement("time");
  t.dateTime = msg.at;
  div.appendChild(t);
  stamp(div);
  log.appendChild(div);
  lastId = Math.max(lastId, msg.id);
}

function scrollToEnd() {
  log.scrollTop = log.scrollHeight;
}

async function api(method, body) {
  const url = `/api/family/${cid}/messages` + (method === "GET" ? `?after=${lastId}` : "");
  const res = await fetch(url, {
    method,
    headers: { "X-Requested-With": "Kinroot", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't reach Kinroot.");
  return data;
}

async function poll() {
  if (document.hidden) return;
  try {
    const { messages } = await api("GET");
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    messages.forEach(addMessage);
    if (messages.length && nearBottom) scrollToEnd();
  } catch {
    /* offline for a moment; try again next time */
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = box.value.trim();
  if (!body) return;
  box.disabled = true;
  try {
    const { message } = await api("POST", { body });
    addMessage(message);
    box.value = "";
    box.style.height = "";
    scrollToEnd();
  } catch (err) {
    box.setCustomValidity(err.message);
    box.reportValidity();
    setTimeout(() => box.setCustomValidity(""), 3000);
  } finally {
    box.disabled = false;
    box.focus();
  }
});

// Enter sends, Shift+Enter adds a new line.
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});
box.addEventListener("input", () => {
  box.style.height = "auto";
  box.style.height = Math.min(box.scrollHeight, 160) + "px";
});

log.querySelectorAll(".bubble").forEach(stamp);
scrollToEnd();
setInterval(poll, POLL_MS);
document.addEventListener("visibilitychange", () => !document.hidden && poll());
