// Firebase Realtime Database проекта cpdwwest.
// databaseURL не было в сниппете консоли — это адрес уже созданной базы.
const firebaseConfig = {
  apiKey: "AIzaSyB_BiLmyHikwwKo1hfDE8d10uF0_Q_yqUY",
  authDomain: "cpdwwest.firebaseapp.com",
  databaseURL: "https://cpdwwest-default-rtdb.firebaseio.com",
  projectId: "cpdwwest",
  storageBucket: "cpdwwest.firebasestorage.app",
  messagingSenderId: "468246070516",
  appId: "1:468246070516:web:c88dd570b0168ba75b0aa1",
  measurementId: "G-EMK45503QG"
};

const STORAGE_KEY = "cpdTicketIds";
const SESSION_KEY = "cpdStaff";
const ACTIVE_KEY = "cpdActiveCase";
const STAFF_USER_HASH = "be5a07b16918e5e8960f77ede739c6734dafb5fbaeeeca5f08b84e841c2e3dd0";
const STAFF_PASS_HASH = "46ea7c29861a5cf832bd9b0b36b3b5d4de65d08aec0ab0d9c2c7fa49f236b851";

const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const caseData = new Map();
const caseMessages = new Map();
const playerUnsubs = [];
let activeCaseId = sessionStorage.getItem(ACTIVE_KEY) || "";
let staffTickets = [];
let staffMessages = [];
let staffListUnsub = null;
let staffMsgUnsub = null;
let activeStaffId = "";
let db = null;
let toastTimer = 0;
let viewSig = "";
const composerLock = new WeakSet();

function loadIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rememberTicket(id) {
  const ids = [id, ...loadIds().filter((item) => item !== id)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function stamp() {
  return Date.now();
}

function timeValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatClock(value) {
  const ms = timeValue(value);
  if (!ms) return "";
  const raw = new Date(ms).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const match = String(raw).match(/(\d{1,2})\D(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function dayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayChip(ms) {
  const date = new Date(ms);
  const now = new Date();
  const sameDay = (left, right) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  if (sameDay(date, now)) return "Сегодня";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Вчера";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function staffName(row) {
  const keys = ["senderName", "staffName", "authorName", "displayName", "name", "author"];
  for (let index = 0; index < keys.length; index += 1) {
    const value = row[keys[index]];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Сотрудник ЦПД";
}

function deliveryTicks(row) {
  const words = new Set(
    ["deliveryStatus", "delivery", "readStatus", "messageStatus", "status"]
      .map((key) => (typeof row[key] === "string" ? row[key].trim().toLowerCase() : ""))
      .filter(Boolean)
  );
  const has = (...list) => list.some((word) => words.has(word));
  if (row.read === true || row.seen === true || has("read", "seen", "прочитано", "прочитан", "прочитана")) {
    return { marks: "✓✓", read: true };
  }
  if (row.delivered === true || has("delivered", "received", "получено", "доставлено", "доставлен", "доставлена")) {
    return { marks: "✓✓", read: false };
  }
  if (row.sent === true || has("sent", "ok", "отправлено", "отправлен", "отправлена")) {
    return { marks: "✓", read: false };
  }
  return null;
}

function shortId(id) {
  return String(id || "");
}

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(message) {
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const bytes = new TextEncoder().encode(message);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function sameHex(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

const staffSession = () => sha256(`${STAFF_USER_HASH}:${STAFF_PASS_HASH}`);

function safeEvidence(value) {
  let text = String(value || "").trim();
  if (!text || text.length > 2000) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (!url.hostname || !url.hostname.includes(".")) return "";
  return url.href;
}

function showEvidence(node, value) {
  if (!node) return;
  const href = safeEvidence(value);
  if (!href) {
    node.hidden = true;
    node.removeAttribute("href");
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.href = href;
  node.textContent = href;
}

function createCaseId() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let index = 0; index < bytes.length; index += 1) body += alphabet[bytes[index] % alphabet.length];
  return `CPD-${body}`;
}

function withTimeout(promise, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error("timeout");
      error.code = "unavailable";
      reject(error);
    }, ms);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function humanError(error) {
  const code = error && error.code ? String(error.code) : "";
  const message = error && error.message ? String(error.message) : "";
  if (code === "PERMISSION_DENIED" || /permission/i.test(message)) {
    return "База закрыта правилами. Откройте Realtime Database → Rules, вставьте правила и нажмите «Опубликовать».";
  }
  return "Нет связи с базой. Проверьте интернет и обновите страницу.";
}

function setDbStatus(text, ok) {
  const node = document.querySelector("#db-status");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("is-ok", Boolean(ok));
  node.classList.toggle("is-bad", ok === false);
}

function showToast(text) {
  const toast = document.querySelector("#toast");
  const toastText = toast.querySelector(".toast__text");
  toastText.textContent = "";
  toast.classList.add("is-on");
  window.requestAnimationFrame(() => {
    toastText.textContent = text;
  });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 5600);
}

function hideToast() {
  document.querySelector("#toast").classList.remove("is-on");
  window.clearTimeout(toastTimer);
}

function bindLog(node) {
  if (node._chatBound) return;
  node._chatBound = true;
  node.addEventListener("scroll", () => {
    if (!node._chat || node._chat.pinning) return;
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    node._chat.userMoved = gap > 64;
  }, { passive: true });
  if (bindLog.listening) return;
  bindLog.listening = true;
  window.addEventListener("resize", () => {
    document.querySelectorAll(".chat-log").forEach((log) => {
      if (!log._chat || log._chat.userMoved) return;
      log._chat.pinning = true;
      log.scrollTop = log.scrollHeight;
      log._chat.pinning = false;
    });
  });
}

function fillLog(node, rows, ticketId) {
  bindLog(node);
  const ticketKey = ticketId || "";
  const state = node._chat || { ticketId: null, generation: 0, userMoved: false };
  const opened = state.ticketId !== ticketKey;
  const prevTop = node.scrollTop;
  const prevMax = Math.max(0, node.scrollHeight - node.clientHeight);
  const nearBottom = prevMax - prevTop < 64;
  const generation = state.generation + 1;
  const userMoved = opened ? false : Boolean(state.userMoved);
  const source = Array.isArray(rows) ? rows : [];
  const ordered = source
    .filter((row) => row && typeof row === "object")
    .slice()
    .sort((a, b) => timeValue(a.timestamp) - timeValue(b.timestamp));

  node.replaceChildren();
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Сообщений пока нет.";
    node.append(empty);
  } else {
    let lastDay = "";
    ordered.forEach((row, index) => {
      const ms = timeValue(row.timestamp);
      const side = row.sender === "staff" ? "staff" : "player";
      if (ms) {
        const key = dayKey(ms);
        if (key !== lastDay) {
          const chip = document.createElement("p");
          chip.className = "chat-day";
          chip.textContent = formatDayChip(ms);
          node.append(chip);
          lastDay = key;
        }
      }
      const previous = ordered[index - 1];
      const previousMs = previous ? timeValue(previous.timestamp) : 0;
      const grouped = Boolean(previous)
        && previous.sender === row.sender
        && ms
        && previousMs
        && dayKey(ms) === dayKey(previousMs);
      const item = document.createElement("article");
      item.className = `msg msg--${side}${grouped ? " is-grouped" : ""}`;
      if (side === "staff" && !grouped) {
        const name = document.createElement("p");
        name.className = "msg__name";
        name.textContent = staffName(row);
        item.append(name);
      }
      const bubble = document.createElement("p");
      bubble.className = "msg__bubble";
      bubble.textContent = row.text || "";
      item.append(bubble);
      const clock = ms ? formatClock(ms) : "";
      const ticks = deliveryTicks(row);
      if (clock || ticks) {
        const meta = document.createElement("p");
        meta.className = "msg__meta";
        if (clock) {
          const time = document.createElement("time");
          time.dateTime = new Date(ms).toISOString();
          time.textContent = clock;
          meta.append(time);
        }
        if (ticks) {
          const mark = document.createElement("span");
          mark.className = ticks.read ? "msg__ticks is-read" : "msg__ticks";
          mark.textContent = ticks.marks;
          mark.setAttribute("aria-hidden", "true");
          meta.append(mark);
        }
        item.append(meta);
      }
      node.append(item);
    });
  }

  node._chat = { ticketId: ticketKey, generation, userMoved, pinning: false };
  const nextMax = Math.max(0, node.scrollHeight - node.clientHeight);
  const pinBottom = () => {
    if (!node._chat || node._chat.generation !== generation || node._chat.userMoved) return;
    node._chat.pinning = true;
    node.scrollTop = node.scrollHeight;
    node._chat.pinning = false;
  };
  if (opened) {
    pinBottom();
    window.requestAnimationFrame(pinBottom);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(pinBottom, () => {});
    return;
  }
  if (!nearBottom) {
    node.scrollTop = Math.min(prevTop, nextMax);
    return;
  }
  const delta = Math.max(0, nextMax - prevMax);
  node.scrollTop = Math.max(0, nextMax - delta);
  if (!motionOk || delta < 2) {
    node.scrollTop = nextMax;
    return;
  }
  window.requestAnimationFrame(() => {
    if (!node._chat || node._chat.generation !== generation) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  });
}

function fitComposer(input) {
  const max = 128;
  input.style.height = "auto";
  const next = Math.min(input.scrollHeight, max);
  input.style.height = `${Math.max(next, 44)}px`;
  input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
}

function bindComposers() {
  document.querySelectorAll(".composer").forEach((form) => {
    const input = form.querySelector("textarea");
    if (!input) return;
    input.addEventListener("input", () => fitComposer(input));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (input.disabled || form.hidden) return;
      form.requestSubmit();
    });
    fitComposer(input);
  });
}

function setComposer(form, note, closed, canType) {
  const input = form.querySelector("textarea");
  const button = form.querySelector("button");
  const locked = closed || !canType || composerLock.has(form);
  form.hidden = Boolean(closed);
  note.hidden = !closed;
  input.disabled = locked;
  button.disabled = locked;
}

function ticketButton(data, active) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ticket${active ? " is-active" : ""}`;
  const title = document.createElement("strong");
  title.textContent = data.playerName || "Без имени";
  const meta = document.createElement("small");
  const status = data.status === "closed" ? "Закрыта" : "Открыта";
  meta.textContent = `${shortId(data.id)} · ${status}`;
  button.append(title, meta);
  return button;
}

function renderCaseList() {
  const list = document.querySelector("#case-list");
  const ids = loadIds();
  list.replaceChildren();
  if (!ids.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "Заявлений пока нет. Отправьте форму выше — номер дела останется в этом браузере.";
    list.append(note);
    return;
  }
  ids.forEach((id) => {
    const data = caseData.get(id) || { id, playerName: "Загрузка…", evidence: "", status: "open" };
    const button = ticketButton(data, id === activeCaseId);
    button.addEventListener("click", () => selectCase(id));
    list.append(button);
  });
}

function renderCaseChat() {
  const kicker = document.querySelector("#case-kicker");
  const title = document.querySelector("#case-title");
  const status = document.querySelector("#case-status");
  const closed = document.querySelector("#case-closed");
  const form = document.querySelector("#case-form");
  const data = activeCaseId ? caseData.get(activeCaseId) : null;

  if (!activeCaseId || !data) {
    kicker.textContent = "Дело не выбрано";
    title.textContent = loadIds().length ? "Откройте заявку слева" : "Сначала подайте заявление";
    status.hidden = true;
    showEvidence(document.querySelector("#case-evidence"), "");
    setComposer(form, closed, false, false);
    fillLog(document.querySelector("#case-log"), [], "");
    return;
  }

  const isClosed = data.status === "closed";
  kicker.textContent = `Дело ${shortId(data.id)}`;
  title.textContent = data.playerName || "Заявление";
  showEvidence(document.querySelector("#case-evidence"), data.evidence);
  status.hidden = false;
  status.textContent = isClosed ? "Закрыта" : "Открыта";
  status.className = `status-pill ${isClosed ? "is-closed" : "is-open"}`;
  setComposer(form, closed, isClosed, true);
  fillLog(document.querySelector("#case-log"), caseMessages.get(activeCaseId) || [], activeCaseId);
}

function selectCase(id) {
  activeCaseId = id;
  sessionStorage.setItem(ACTIVE_KEY, id);
  renderCaseList();
  renderCaseChat();
}

function ticketsRef() {
  return db.ref("tickets");
}

function messageList(messages) {
  if (!messages) return [];
  if (Array.isArray(messages)) return messages.slice();
  return Object.keys(messages)
    .map((id) => ({ id, ...messages[id] }))
    .sort((a, b) => timeValue(a.timestamp) - timeValue(b.timestamp));
}

function ticketRecord(id, value) {
  const data = value || {};
  return {
    id,
    playerName: data.playerName || "",
    evidence: data.evidence || "",
    description: data.description || "",
    status: data.status || "open",
    createdAt: data.createdAt || 0,
    closedAt: data.closedAt || null
  };
}

function publish() {
  const ids = loadIds();
  if (activeCaseId && !ids.includes(activeCaseId)) activeCaseId = ids[0] || "";
  if (!activeCaseId && ids[0]) activeCaseId = ids[0];

  if (activeStaffId) {
    const current = staffTickets.find((item) => item.id === activeStaffId);
    if (!current) {
      activeStaffId = "";
      staffMessages = [];
    } else {
      staffMessages = messageList(current.messages);
    }
  }

  const desk = document.querySelector("#desk");
  const deskOpen = Boolean(desk && !desk.hidden);
  const sig = JSON.stringify({
    ids: ids.map((id) => [id, caseData.get(id) || null, caseMessages.get(id) || []]),
    activeCaseId,
    activeStaffId,
    deskOpen,
    staff: staffTickets.map((item) => [item.id, item.status, item.playerName, item.evidence, item.messages])
  });
  if (sig === viewSig) return;
  viewSig = sig;

  renderCaseList();
  renderCaseChat();
  if (deskOpen) {
    renderDeskList();
    renderDeskChat();
  }
}

function stopPlayerWatch() {
  while (playerUnsubs.length) playerUnsubs.pop()();
}

function watchPlayer() {
  stopPlayerWatch();
  if (!db) return;
  const ids = loadIds();
  ids.forEach((id) => {
    const ref = ticketsRef().child(id);
    const handler = (snap) => {
      const value = snap.val();
      if (!value) {
        caseData.delete(id);
        caseMessages.delete(id);
      } else {
        caseData.set(id, ticketRecord(id, value));
        caseMessages.set(id, messageList(value.messages));
        const index = staffTickets.findIndex((item) => item.id === id);
        if (index >= 0) {
          staffTickets[index] = { ...ticketRecord(id, value), messages: value.messages || {} };
        }
      }
      publish();
      setDbStatus("База на связи. Новые сообщения появляются сами.", true);
    };
    ref.on("value", handler, (error) => setDbStatus(humanError(error), false));
    playerUnsubs.push(() => ref.off("value", handler));
  });
  publish();
}

function startStaffWatch() {
  if (staffListUnsub || !db) return;
  const ref = ticketsRef().orderByChild("createdAt");
  const handler = (snap) => {
    const next = [];
    snap.forEach((child) => {
      const value = child.val() || {};
      next.push({ ...ticketRecord(child.key, value), messages: value.messages || {} });
    });
    next.reverse();
    staffTickets = next;
    publish();
    setDbStatus("База на связи. Новые сообщения появляются сами.", true);
  };
  ref.on("value", handler, (error) => setDbStatus(humanError(error), false));
  staffListUnsub = () => ref.off("value", handler);
}

async function createTicket(playerName, evidence, description) {
  let id = createCaseId();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await ticketsRef().child(id).once("value");
    if (!existing.exists()) break;
    id = createCaseId();
  }
  const now = stamp();
  await ticketsRef().child(id).set({
    playerName,
    evidence,
    description,
    status: "open",
    createdAt: now,
    messages: {
      intro: { sender: "player", text: description, timestamp: now }
    }
  });
  return id;
}

async function addMessage(ticketId, sender, text) {
  const known = caseData.get(ticketId);
  if (known && known.status === "closed") return;
  await ticketsRef().child(ticketId).child("messages").push({
    sender,
    text,
    timestamp: stamp()
  });
}

async function closeTicket(ticketId) {
  const now = stamp();
  const updates = {};
  updates[`tickets/${ticketId}/status`] = "closed";
  updates[`tickets/${ticketId}/closedAt`] = now;
  updates[`tickets/${ticketId}/messages/closed`] = {
    sender: "staff",
    text: "Заявка закрыта дежурным.",
    timestamp: now
  };
  await db.ref().update(updates);
}

function setupForm() {
  const form = document.querySelector("#report-form");
  const alertBox = document.querySelector("#form-alert");
  const submit = form.querySelector("[type='submit']");
  const label = submit.querySelector(".btn__label");
  const fields = [
    { input: form.elements.name, message: "Укажите имя и фамилию." },
    { input: form.elements.evidence, message: "Прикрепите ссылку на доказательства." },
    { input: form.elements.message, message: "Опишите суть заявления." }
  ];

  function setInvalid(input, message) {
    const field = input.closest(".field");
    field.classList.toggle("is-invalid", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
    field.querySelector(".field__error").textContent = message || "";
  }

  fields.forEach(({ input }) => {
    input.addEventListener("input", () => {
      if (input.value.trim() !== "") setInvalid(input, "");
      if (fields.every((field) => field.input.value.trim() !== "")) alertBox.hidden = true;
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;
    fields.forEach(({ input, message }) => {
      const empty = input.value.trim() === "";
      const badLink = input.name === "evidence" && !empty && !safeEvidence(input.value);
      setInvalid(input, empty || badLink ? (badLink ? "Нужна ссылка: YouTube, Google Документы или любой сайт." : message) : "");
      if (empty || badLink) valid = false;
    });
    if (!valid) {
      alertBox.hidden = false;
      alertBox.querySelector("span").textContent = "Заполните все поля заявления.";
      form.classList.remove("is-shaking");
      window.requestAnimationFrame(() => form.classList.add("is-shaking"));
      form.querySelector(".is-invalid input, .is-invalid textarea")?.focus();
      return;
    }
    if (!db) {
      alertBox.hidden = false;
      alertBox.querySelector("span").textContent = "Firebase не загрузился. Откройте сайт с интернетом.";
      return;
    }

    alertBox.hidden = true;
    submit.disabled = true;
    label.textContent = "Отправка...";
    try {
      const evidence = safeEvidence(form.elements.evidence.value);
      const id = await createTicket(
        form.elements.name.value.trim(),
        evidence,
        form.elements.message.value.trim()
      );
      rememberTicket(id);
      activeCaseId = id;
      sessionStorage.setItem(ACTIVE_KEY, id);
      form.reset();
      fields.forEach(({ input }) => setInvalid(input, ""));
      watchPlayer();
      showToast(`Заявление принято. Номер дела ${shortId(id)}. Переписка открыта в разделе «Мои заявки».`);
      document.querySelector("#cases").scrollIntoView({ behavior: motionOk ? "smooth" : "auto", block: "start" });
    } catch (error) {
      alertBox.hidden = false;
      alertBox.querySelector("span").textContent = humanError(error);
      setDbStatus(humanError(error), false);
    } finally {
      submit.disabled = false;
      label.textContent = "Отправить";
    }
  });

  document.querySelector("#case-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.querySelector("#case-input");
    const text = input.value.trim();
    const data = caseData.get(activeCaseId);
    if (!text || !activeCaseId || !data || data.status === "closed" || !db) return;
    composerLock.add(form);
    input.disabled = true;
    try {
      await withTimeout(addMessage(activeCaseId, "player", text));
      input.value = "";
    } catch (error) {
      setDbStatus(humanError(error), false);
    } finally {
      composerLock.delete(form);
      const current = caseData.get(activeCaseId);
      const locked = !current || current.status === "closed";
      input.disabled = locked;
      fitComposer(input);
      if (!locked) input.focus();
    }
  });
}

function stopStaffMessages() {
  if (staffMsgUnsub) staffMsgUnsub();
  staffMsgUnsub = null;
}

function renderDeskList() {
  const list = document.querySelector("#desk-list");
  list.replaceChildren();
  if (!staffTickets.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "Заявок пока нет.";
    list.append(note);
    return;
  }
  staffTickets.forEach((data) => {
    const button = ticketButton(data, data.id === activeStaffId);
    button.addEventListener("click", () => selectStaff(data.id));
    list.append(button);
  });
}

function renderDeskChat() {
  const kicker = document.querySelector("#desk-kicker");
  const title = document.querySelector("#desk-title");
  const closeButton = document.querySelector("#desk-close-ticket");
  const closed = document.querySelector("#desk-closed");
  const form = document.querySelector("#desk-form");
  const data = staffTickets.find((item) => item.id === activeStaffId);

  if (!data) {
    kicker.textContent = "Заявка не выбрана";
    title.textContent = "Выберите дело из списка";
    closeButton.hidden = true;
    showEvidence(document.querySelector("#desk-evidence"), "");
    setComposer(form, closed, false, false);
    fillLog(document.querySelector("#desk-log"), [], "");
    return;
  }

  const isClosed = data.status === "closed";
  kicker.textContent = shortId(data.id);
  title.textContent = data.playerName || "Заявление";
  showEvidence(document.querySelector("#desk-evidence"), data.evidence);
  closeButton.hidden = isClosed;
  setComposer(form, closed, isClosed, true);
  fillLog(document.querySelector("#desk-log"), staffMessages, data.id);
}

function selectStaff(id) {
  activeStaffId = id;
  viewSig = "";
  publish();
}

function openDesk() {
  const desk = document.querySelector("#desk");
  desk.hidden = false;
  document.body.classList.add("desk-open");
  startStaffWatch();
  viewSig = "";
  publish();
}

function closeDesk() {
  document.querySelector("#desk").hidden = true;
  document.body.classList.remove("desk-open");
}

function setupAuth() {
  const modal = document.querySelector("#auth-modal");
  const form = document.querySelector("#auth-form");
  const alertBox = document.querySelector("#auth-alert");

  function openModal() {
    modal.hidden = false;
    alertBox.hidden = true;
    document.querySelector("#staff-login").focus();
  }

  function closeModal() {
    modal.hidden = true;
    form.reset();
    alertBox.hidden = true;
  }

  document.querySelector("#staff-entry").addEventListener("click", () => {
    if (sameHex(sessionStorage.getItem(SESSION_KEY) || "", staffSession())) openDesk();
    else openModal();
  });

  modal.querySelectorAll("[data-close-auth]").forEach((node) => {
    node.addEventListener("click", closeModal);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const login = form.elements.login.value.trim();
    const password = form.elements.password.value;
    const accepted = sameHex(sha256(login), STAFF_USER_HASH) && sameHex(sha256(password), STAFF_PASS_HASH);
    form.elements.password.value = "";
    if (!accepted) {
      alertBox.hidden = false;
      return;
    }
    sessionStorage.setItem(SESSION_KEY, staffSession());
    closeModal();
    openDesk();
  });

  document.querySelector("#desk-close").addEventListener("click", closeDesk);
  document.querySelector("#desk-logout").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    closeDesk();
  });

  document.querySelector("#desk-close-ticket").addEventListener("click", async () => {
    if (!activeStaffId || !db) return;
    const button = document.querySelector("#desk-close-ticket");
    button.disabled = true;
    try {
      await withTimeout(closeTicket(activeStaffId));
    } catch (error) {
      setDbStatus(humanError(error), false);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#desk-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.querySelector("#desk-input");
    const text = input.value.trim();
    const data = staffTickets.find((item) => item.id === activeStaffId);
    if (!text || !activeStaffId || !data || data.status === "closed" || !db) return;
    composerLock.add(form);
    input.disabled = true;
    try {
      await withTimeout(addMessage(activeStaffId, "staff", text));
      input.value = "";
    } catch (error) {
      setDbStatus(humanError(error), false);
    } finally {
      composerLock.delete(form);
      const current = staffTickets.find((item) => item.id === activeStaffId);
      const locked = !current || current.status === "closed";
      input.disabled = locked;
      fitComposer(input);
      if (!locked) input.focus();
    }
  });
}

function setupMenu() {
  const header = document.querySelector(".header");
  const toggle = document.querySelector(".nav-toggle");
  const label = toggle.querySelector(".sr-only");

  function closeMenu() {
    header.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    label.textContent = "Открыть меню";
    document.body.classList.remove("menu-open");
  }

  toggle.addEventListener("click", () => {
    const open = header.classList.contains("is-open");
    header.classList.toggle("is-open", !open);
    toggle.setAttribute("aria-expanded", String(!open));
    label.textContent = open ? "Открыть меню" : "Закрыть меню";
    document.body.classList.toggle("menu-open", !open);
  });

  return { closeMenu };
}

function setupScroll(closeMenu) {
  const headerBar = document.querySelector(".header__bar");
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      const target = id ? document.querySelector(id) : null;
      if (!target) return;
      event.preventDefault();
      const offset = headerBar.getBoundingClientRect().height + 28;
      const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
      window.scrollTo({ top, behavior: motionOk ? "smooth" : "auto" });
      closeMenu();
    });
  });

  const onScroll = () => headerBar.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const sections = [...document.querySelectorAll("main section[id]")];
  const navLinks = [...document.querySelectorAll(".nav a[href^='#']")];
  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          const active = link.getAttribute("href") === `#${entry.target.id}`;
          link.classList.toggle("is-active", active);
          if (active) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -48% 0px" });
    sections.forEach((section) => spy.observe(section));
  }
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!motionOk || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-in"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14 });
  items.forEach((item) => observer.observe(item));
  window.setTimeout(() => {
    items.forEach((item) => item.classList.add("is-in"));
  }, 1600);
}

function setupClock() {
  const clock = document.querySelector("#clock");
  if (!clock) return;
  const format = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const tick = () => {
    clock.textContent = format.format(new Date());
    clock.dateTime = new Date().toISOString();
  };
  tick();
  window.setInterval(tick, 10000);
}

function bootCloud() {
  if (typeof firebase === "undefined") {
    setDbStatus("Firebase не загрузился. Проверьте интернет и обновите страницу.", false);
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  watchPlayer();
  ticketsRef().limitToLast(1).once("value")
    .then(() => setDbStatus("База на связи. Новые сообщения появляются сами.", true))
    .catch((error) => setDbStatus(humanError(error), false));
}

const { closeMenu } = setupMenu();
setupScroll(closeMenu);
setupReveal();
setupClock();
setupForm();
setupAuth();
bindComposers();
bootCloud();
renderCaseList();
renderCaseChat();

document.querySelector("#toast .toast__close").addEventListener("click", hideToast);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeMenu();
  hideToast();
  document.querySelector("#auth-modal").hidden = true;
});
