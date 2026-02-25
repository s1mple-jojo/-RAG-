// static/app.js

const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

const btnNew = document.getElementById("btnNew");
const btnClear = document.getElementById("btnClear");
const btnExport = document.getElementById("btnExport");
const fileImport = document.getElementById("fileImport");
const historyListEl = document.getElementById("historyList");

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const latencyText = document.getElementById("latencyText");

const STORAGE_KEY = "law_qa_history_v1";
const SESSION_KEY = "law_qa_current_session_v1";

function setStatus(state, text) {
  statusDot.classList.remove("busy", "err");
  if (state === "busy") statusDot.classList.add("busy");
  if (state === "err") statusDot.classList.add("err");
  statusText.textContent = text;
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function loadAllSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveAllSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function getCurrentSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function setCurrentSessionId(id) {
  localStorage.setItem(SESSION_KEY, id);
}

function getSessionById(id) {
  const sessions = loadAllSessions();
  return sessions.find((s) => s.id === id) || null;
}

function upsertSession(session) {
  const sessions = loadAllSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.unshift(session);
  saveAllSessions(sessions);
  renderHistoryList();
}

function deleteAllSessions() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function newSession() {
  const id = crypto.randomUUID();
  setCurrentSessionId(id);
  const session = {
    id,
    title: "新对话",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    messages: [],
  };
  upsertSession(session);
  renderChat(session);
}

function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "新对话";
  const t = firstUser.content.trim().slice(0, 18);
  return t || "新对话";
}

function renderMessage(msg) {
  const row = document.createElement("div");
  row.className = `msgRow ${msg.role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = msg.role === "user" ? "🙂" : "🤖";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = msg.content;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatEl.appendChild(row);
}

function renderAssistantWithCitations(answer, citations) {
  const row = document.createElement("div");
  row.className = "msgRow assistant";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "🤖";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = answer;

  const wrap = document.createElement("div");
  wrap.className = "citations";

  const header = document.createElement("div");
  header.className = "citHeader";

  const left = document.createElement("span");
  left.textContent = `引用依据（${citations.length}）`;

  const toggle = document.createElement("button");
  toggle.className = "btnTiny";
  toggle.textContent = "展开";

  header.appendChild(left);
  header.appendChild(toggle);

  const list = document.createElement("div");
  list.style.display = "none";

  citations.forEach((c) => {
    const item = document.createElement("div");
    item.className = "citItem";

    const src = document.createElement("div");
    src.className = "citSrc";
    src.textContent = c.source || "unknown";

    const txt = document.createElement("div");
    txt.className = "citTxt";
    txt.textContent = c.snippet || "";

    item.appendChild(src);
    item.appendChild(txt);
    list.appendChild(item);
  });

  toggle.addEventListener("click", () => {
    const open = list.style.display !== "none";
    list.style.display = open ? "none" : "block";
    toggle.textContent = open ? "展开" : "收起";
  });

  wrap.appendChild(header);
  wrap.appendChild(list);
  bubble.appendChild(wrap);

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatEl.appendChild(row);
}

function renderAssistantStreamingPlaceholder() {
  const row = document.createElement("div");
  row.className = "msgRow assistant";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "🤖";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = "";

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatEl.appendChild(row);

  return { row, bubble };
}

function renderChat(session) {
  chatEl.innerHTML = "";
  (session.messages || []).forEach((m) => {
    if (m.role === "assistant" && m.citations) {
      renderAssistantWithCitations(m.content, m.citations);
    } else {
      renderMessage(m);
    }
  });
  scrollToBottom();
}

function renderHistoryList() {
  const sessions = loadAllSessions();
  historyListEl.innerHTML = "";

  const currentId = getCurrentSessionId();

  sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "histItem";
    item.style.outline =
      s.id === currentId ? "1px solid rgba(31,111,235,.6)" : "none";

    const t = document.createElement("div");
    t.className = "histTitle";
    t.textContent = s.title || "新对话";

    const m = document.createElement("div");
    m.className = "histMeta";
    m.textContent = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString();

    item.appendChild(t);
    item.appendChild(m);

    item.addEventListener("click", () => {
      setCurrentSessionId(s.id);
      const session = getSessionById(s.id);
      if (session) renderChat(session);
      renderHistoryList();
    });

    historyListEl.appendChild(item);
  });
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  sendBtn.disabled = true;
  setStatus("busy", "生成中…");
  latencyText.textContent = "— ms";

  // 当前 session
  const sessionId = getCurrentSessionId();
  let session = getSessionById(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      title: "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
  }

  // 用户消息入库
  const userMsg = { role: "user", content: text, ts: Date.now() };
  session.messages.push(userMsg);
  session.title = deriveTitle(session.messages);
  session.updatedAt = Date.now();
  upsertSession(session);

  renderMessage({ role: "user", content: text });
  scrollToBottom();

  inputEl.value = "";
  autoResize();

  // 流式占位气泡
  const { row, bubble } = renderAssistantStreamingPlaceholder();
  scrollToBottom();

  try {
    const payload = {
      message: text,
      history: session.messages.map((m) => ({ role: m.role, content: m.content })),
      top_k: 5,
    };

    const res = await fetch("/chat_stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let answerText = "";
    let citations = [];
    let latency = null;

    // SSE 解析：按 \n\n 分隔事件块
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = chunk.split("\n").filter(Boolean);
        let eventName = "token";
        let dataLine = "";

        for (const ln of lines) {
          if (ln.startsWith("event:")) eventName = ln.slice(6).trim();
          if (ln.startsWith("data:")) dataLine += ln.slice(5).trim();
        }

        if (eventName === "token") {
          if (dataLine) {
            const token = JSON.parse(dataLine); // 后端 token 是 JSON string
            answerText += token;
            bubble.textContent = answerText;
            scrollToBottom();
          }
        } else if (eventName === "meta") {
          if (dataLine) {
            const meta = JSON.parse(dataLine);
            if (meta.citations) citations = meta.citations;
            if (meta.latency_ms != null) latency = meta.latency_ms;

            if (meta.error) {
              bubble.textContent = `请求失败：${meta.error}`;
              setStatus("err", "出错");
            }
          }
        } else if (eventName === "done") {
          // 结束事件
          break;
        }
      }
    }

    // assistant 入库
    const botMsg = {
      role: "assistant",
      content: answerText,
      citations,
      ts: Date.now(),
    };
    session.messages.push(botMsg);
    session.updatedAt = Date.now();
    upsertSession(session);

    // 替换为带 citations 的正式气泡
    try {
      chatEl.removeChild(row);
    } catch {}
    renderAssistantWithCitations(answerText, citations);
    scrollToBottom();

    setStatus("ok", "就绪");
    if (latency !== null) latencyText.textContent = `${latency} ms`;
  } catch (e) {
    console.error(e);
    setStatus("err", "出错");
    latencyText.textContent = "— ms";

    // 删除占位泡
    try {
      chatEl.removeChild(row);
    } catch {}

    const errMsg = {
      role: "assistant",
      content: `请求失败：${String(e.message || e)}`,
      ts: Date.now(),
    };
    session.messages.push(errMsg);
    session.updatedAt = Date.now();
    upsertSession(session);

    renderMessage({ role: "assistant", content: errMsg.content });
    scrollToBottom();
  } finally {
    sendBtn.disabled = false;
  }
}

// Enter 发送 / Shift+Enter 换行
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

inputEl.addEventListener("input", autoResize);
sendBtn.addEventListener("click", send);

btnNew.addEventListener("click", () => newSession());

btnClear.addEventListener("click", () => {
  if (!confirm("确认清空全部历史记录（本地）？")) return;
  deleteAllSessions();
  newSession();
});

btnExport.addEventListener("click", () => {
  const sessions = loadAllSessions();
  const blob = new Blob([JSON.stringify(sessions, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "law_qa_history.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

fileImport.addEventListener("change", async () => {
  const file = fileImport.files?.[0];
  if (!file) return;

  try {
    const txt = await file.text();
    const sessions = JSON.parse(txt);
    if (!Array.isArray(sessions)) throw new Error("导入文件格式不正确");

    saveAllSessions(sessions);

    if (sessions[0]?.id) setCurrentSessionId(sessions[0].id);
    renderHistoryList();

    const current = getSessionById(getCurrentSessionId());
    if (current) renderChat(current);
  } catch (e) {
    alert("导入失败：" + String(e.message || e));
  } finally {
    fileImport.value = "";
  }
});

// 启动：加载历史 / 若无则新建
(function boot() {
  renderHistoryList();
  let session = getSessionById(getCurrentSessionId());
  if (!session) newSession();
  else renderChat(session);

  setStatus("ok", "就绪");
  autoResize();
})();