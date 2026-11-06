/*
 * Workspace Oracle — chat client for ai.html.
 *
 * Security hardening compared with the previous version:
 *  - Model output (Markdown) is converted with marked and then sanitised with
 *    DOMPurify straight into a DocumentFragment — no innerHTML anywhere.
 *    Images/media (data-exfiltration vector), forms, buttons, styles, SVG/MathML,
 *    ids, classes (except code `language-*`) and data-* attributes are stripped;
 *    links are limited to http(s)/mailto and get rel="noopener noreferrer nofollow".
 *  - User text, backend error messages and history titles use textContent.
 *  - Code-block copy buttons are wired with event listeners (no inline onclick),
 *    which the page CSP (script-src 'self' + Trusted Types) requires.
 *  - localStorage holds chat history only — never credentials — and is validated
 *    on load. If marked/DOMPurify fail to load, the page fails closed.
 */
(function () {
  'use strict';

  var BACKEND_URL = 'https://workspace-ai-backend.onrender.com/api/chat';
  var STORAGE_KEY = 'workspace_oracle_sessions'; // unchanged so existing history still loads
  var DEFAULT_TITLE = 'New Workspace Query';
  var MAX_SESSIONS = 50;
  var MAX_INPUT = 4000;
  var RENDER_INTERVAL_MS = 150;
  var SLOW_HINT_MS = 10000;
  var REQUEST_TIMEOUT_MS = 120000;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var ICON = {
    sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4', 'M4 17v2', 'M5 18H3'],
    message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'],
    copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
    check: ['M20 6 9 17l-5-5'],
    cpu: ['M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z', 'M15 2v2', 'M15 20v2', 'M2 15h2', 'M2 9h2', 'M20 15h2', 'M20 9h2', 'M9 2v2', 'M9 20v2'],
    chevron: ['m9 18 6-6-6-6'],
    alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01']
  };

  /* ---------- DOM ---------- */
  var chatWindow = document.getElementById('chat-window');
  var composer = document.getElementById('composer');
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('send-btn');
  var stopBtn = document.getElementById('stop-btn');
  var micBtn = document.getElementById('mic-btn');
  var newChatBtn = document.getElementById('new-chat-btn');
  var historyList = document.getElementById('chat-history-list');
  var sidebar = document.getElementById('chat-sidebar');
  var sidebarOpenBtn = document.querySelector('[data-sidebar-open]');
  var backdrop = document.querySelector('.chat-backdrop');
  var emptyTemplate = document.getElementById('empty-state-template');
  if (!chatWindow || !composer || !input) {
    return;
  }
  var defaultPlaceholder = window.matchMedia('(max-width: 560px)').matches
    ? 'Ask a GAM or Workspace question…'
    : (input.getAttribute('placeholder') || '');
  input.setAttribute('placeholder', defaultPlaceholder);

  /* ---------- Helpers ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function svgIcon(paths, extraClass) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function copyText(value) {
    if (window.AM && window.AM.copyText) {
      return window.AM.copyText(value);
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return Promise.reject(new Error('clipboard unavailable'));
  }

  function errorBox(message) {
    var box = el('div', 'msg-error');
    box.setAttribute('role', 'alert');
    box.appendChild(svgIcon(ICON.alert));
    box.appendChild(el('p', '', message));
    return box;
  }

  /* ---------- Fail closed if the renderer/sanitiser is missing ---------- */
  if (!window.marked || typeof window.marked.parse !== 'function' || !window.DOMPurify || !window.DOMPurify.isSupported) {
    chatWindow.replaceChildren(errorBox('The assistant could not load safely. Please refresh the page.'));
    input.disabled = true;
    sendBtn.disabled = true;
    return;
  }

  /* ---------- Markdown rendering + sanitisation ---------- */
  var PURIFY_CONFIG = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'frame', 'frameset', 'object', 'embed',
      'form', 'input', 'button', 'textarea', 'select', 'option', 'label', 'style', 'link', 'meta', 'base', 'svg', 'math',
      'dialog', 'template', 'details', 'summary'],
    FORBID_ATTR: ['style', 'id', 'name', 'srcset', 'action', 'formaction', 'target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  };
  var LANG_RE = /(?:^|\s)language-([\w+#.-]{1,30})(?:\s|$)/;

  window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    if (node.nodeType !== 1) {
      return;
    }
    // Classes could target site CSS (e.g. fixed-position UI) — keep only code languages.
    if (node.hasAttribute('class')) {
      var match = node.nodeName === 'CODE' ? LANG_RE.exec(node.getAttribute('class')) : null;
      if (match) {
        node.setAttribute('class', 'language-' + match[1]);
      } else {
        node.removeAttribute('class');
      }
    }
    if (node.nodeName === 'A') {
      var href = (node.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      } else {
        node.removeAttribute('href');
      }
    }
  });

  function enhanceCodeBlocks(root) {
    Array.prototype.forEach.call(root.querySelectorAll('pre'), function (pre) {
      var code = pre.querySelector('code');
      var match = code ? LANG_RE.exec(code.getAttribute('class') || '') : null;
      var wrap = el('div', 'code-block');
      var head = el('div', 'code-head');
      head.appendChild(el('span', '', match ? match[1] : 'snippet'));
      var copyBtn = el('button', 'code-copy');
      copyBtn.type = 'button';
      copyBtn.setAttribute('data-code-copy', '');
      copyBtn.appendChild(svgIcon(ICON.copy));
      copyBtn.appendChild(el('span', '', 'Copy'));
      head.appendChild(copyBtn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head);
      wrap.appendChild(pre);
    });
  }

  function renderMarkdown(container, markdown) {
    var html = window.marked.parse(String(markdown), { async: false, gfm: true });
    var fragment = window.DOMPurify.sanitize(html, PURIFY_CONFIG);
    enhanceCodeBlocks(fragment);
    container.replaceChildren(fragment);
  }

  /* ---------- Session storage (chat history only, validated) ---------- */
  function isValidMessage(m) {
    return !!m && (m.role === 'user' || m.role === 'model') && Array.isArray(m.parts) &&
      !!m.parts[0] && typeof m.parts[0].text === 'string';
  }

  function normaliseSession(s) {
    return {
      id: String(s.id).slice(0, 64),
      title: typeof s.title === 'string' && s.title ? s.title.slice(0, 120) : DEFAULT_TITLE,
      history: s.history.filter(isValidMessage).map(function (m) {
        var msg = { role: m.role, parts: [{ text: m.parts[0].text }] };
        if (m.role === 'model' && typeof m.thought === 'string' && m.thought) {
          msg.thought = m.thought;
        }
        return msg;
      })
    };
  }

  function loadSessions() {
    var data;
    try {
      data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
    if (!Array.isArray(data)) {
      return [];
    }
    return data.filter(function (s) {
      return !!s && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.history);
    }).slice(0, MAX_SESSIONS).map(normaliseSession);
  }

  function saveSessions() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.warn('Chat history could not be saved (storage unavailable or full).');
    }
  }

  var sessions = loadSessions();
  var currentId = null;
  var isStreaming = false;
  var abortController = null;

  function currentSession() {
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === currentId) {
        return sessions[i];
      }
    }
    return null;
  }

  /* ---------- Sidebar ---------- */
  function renderSidebar() {
    var items = sessions.map(function (s) {
      var isActive = s.id === currentId;
      var li = el('li', 'history-item' + (isActive ? ' is-active' : ''));

      var open = el('button', 'history-open');
      open.type = 'button';
      if (isActive) {
        open.setAttribute('aria-current', 'true');
      }
      open.appendChild(svgIcon(ICON.message));
      open.appendChild(el('span', '', s.title));
      open.addEventListener('click', function () {
        loadSession(s.id);
      });

      var del = el('button', 'history-delete');
      del.type = 'button';
      del.title = 'Delete chat';
      del.setAttribute('aria-label', 'Delete chat: ' + s.title);
      del.appendChild(svgIcon(ICON.trash));
      del.addEventListener('click', function () {
        deleteSession(s.id);
      });

      li.appendChild(open);
      li.appendChild(del);
      return li;
    });
    historyList.replaceChildren.apply(historyList, items);
  }

  function openSidebar() {
    sidebar.classList.add('is-open');
    backdrop.hidden = false;
    sidebarOpenBtn.setAttribute('aria-expanded', 'true');
    newChatBtn.focus();
  }

  function closeSidebar() {
    if (!sidebar.classList.contains('is-open')) {
      return;
    }
    var hadFocus = sidebar.contains(document.activeElement);
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
    sidebarOpenBtn.setAttribute('aria-expanded', 'false');
    if (hadFocus) {
      sidebarOpenBtn.focus();
    }
  }

  if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', openSidebar);
  }
  document.querySelectorAll('[data-sidebar-close]').forEach(function (btn) {
    btn.addEventListener('click', closeSidebar);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeSidebar();
    }
  });

  /* ---------- Conversation rendering ---------- */
  function nearBottom() {
    return chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight < 140;
  }

  function scrollToBottom(force) {
    if (force || nearBottom()) {
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }
  }

  function showEmptyState() {
    chatWindow.replaceChildren(emptyTemplate.content.cloneNode(true));
  }

  function removeEmptyState() {
    var empty = chatWindow.querySelector('.empty-state');
    if (empty) {
      empty.remove();
    }
  }

  function appendUserMessage(text) {
    removeEmptyState();
    var msg = el('div', 'msg msg-user');
    msg.appendChild(el('span', 'msg-avatar', 'You'));
    msg.appendChild(el('div', 'msg-bubble', text));
    chatWindow.appendChild(msg);
  }

  function createAIMessage() {
    removeEmptyState();
    var msg = el('div', 'msg msg-ai');
    var avatar = el('span', 'msg-avatar');
    avatar.appendChild(svgIcon(ICON.sparkles));

    var bubble = el('div', 'msg-bubble');
    var thoughts = el('details', 'thoughts');
    thoughts.hidden = true;
    var summary = el('summary');
    summary.appendChild(svgIcon(ICON.cpu));
    summary.appendChild(el('span', '', 'Thought process'));
    summary.appendChild(svgIcon(ICON.chevron, 'chev'));
    var thoughtBody = el('div', 'thoughts-body md');
    thoughts.appendChild(summary);
    thoughts.appendChild(thoughtBody);

    var body = el('div', 'md');
    bubble.appendChild(thoughts);
    bubble.appendChild(body);
    msg.appendChild(avatar);
    msg.appendChild(bubble);
    chatWindow.appendChild(msg);
    return { thoughts: thoughts, thoughtBody: thoughtBody, body: body };
  }

  function appendAIMessage(text, thought) {
    var ai = createAIMessage();
    if (thought) {
      ai.thoughts.hidden = false;
      renderMarkdown(ai.thoughtBody, thought);
    }
    renderMarkdown(ai.body, text);
  }

  function showTyping(container) {
    var wrap = el('div', 'typing-wrap');
    var dots = el('span', 'typing');
    dots.setAttribute('aria-hidden', 'true');
    dots.appendChild(el('span'));
    dots.appendChild(el('span'));
    dots.appendChild(el('span'));
    wrap.appendChild(dots);
    wrap.appendChild(el('span', 'typing-note', ''));
    container.replaceChildren(wrap);
  }

  function setTypingNote(container, message) {
    var note = container.querySelector('.typing-note');
    if (note) {
      note.textContent = message;
    }
  }

  /* ---------- Sessions ---------- */
  function newChat() {
    if (isStreaming) {
      return;
    }
    var cur = currentSession();
    if (!cur || cur.history.length > 0) {
      currentId = 'session_' + Date.now();
      sessions.unshift({ id: currentId, title: DEFAULT_TITLE, history: [] });
      if (sessions.length > MAX_SESSIONS) {
        sessions.length = MAX_SESSIONS;
      }
      saveSessions();
    }
    renderSidebar();
    showEmptyState();
    resetInput();
    closeSidebar();
    input.focus();
  }

  function loadSession(id) {
    if (isStreaming) {
      return;
    }
    var found = null;
    sessions.forEach(function (s) {
      if (s.id === id) {
        found = s;
      }
    });
    if (!found) {
      return;
    }
    currentId = id;
    chatWindow.replaceChildren();
    if (!found.history.length) {
      showEmptyState();
    } else {
      found.history.forEach(function (m) {
        if (m.role === 'user') {
          appendUserMessage(m.parts[0].text);
        } else {
          appendAIMessage(m.parts[0].text, m.thought);
        }
      });
    }
    renderSidebar();
    scrollToBottom(true);
    closeSidebar();
  }

  function deleteSession(id) {
    if (isStreaming && id === currentId) {
      return;
    }
    sessions = sessions.filter(function (s) {
      return s.id !== id;
    });
    saveSessions();
    if (id === currentId) {
      currentId = null;
      if (sessions.length) {
        loadSession(sessions[0].id);
      } else {
        newChat();
      }
    } else {
      renderSidebar();
    }
  }

  function persistExchange(session, userText, aiText, aiThought) {
    if (!session.history.length) {
      var words = userText.split(/\s+/).slice(0, 5).join(' ');
      session.title = (words.length < userText.length ? words + '…' : words).slice(0, 120);
    }
    session.history.push({ role: 'user', parts: [{ text: userText }] });
    var modelMsg = { role: 'model', parts: [{ text: aiText }] };
    if (aiThought) {
      modelMsg.thought = aiThought;
    }
    session.history.push(modelMsg);
    sessions = [session].concat(sessions.filter(function (s) {
      return s !== session;
    }));
    saveSessions();
    renderSidebar();
  }

  /* ---------- Composer ---------- */
  function autoresize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  function updateSendState() {
    sendBtn.disabled = isStreaming || !input.value.trim();
  }

  function resetInput() {
    input.value = '';
    autoresize();
    updateSendState();
  }

  function setStreaming(on) {
    isStreaming = on;
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
    newChatBtn.disabled = on;
    chatWindow.setAttribute('aria-busy', String(on));
    updateSendState();
  }

  /* ---------- Streaming request ---------- */
  async function sendMessage(rawText) {
    var text = String(rawText || '').trim().slice(0, MAX_INPUT);
    if (!text || isStreaming) {
      return;
    }
    if (!currentSession()) {
      newChat();
    }
    var session = currentSession();
    var apiHistory = session.history.map(function (m) {
      return { role: m.role, parts: [{ text: m.parts[0].text }] };
    });

    resetInput();
    appendUserMessage(text);
    var ai = createAIMessage();
    showTyping(ai.body);
    scrollToBottom(true);
    setStreaming(true);

    var accText = '';
    var accThought = '';
    var lastRender = 0;
    var finished = false;
    var failed = false;
    var controller = new AbortController();
    abortController = controller;
    var timeoutId = window.setTimeout(function () {
      controller.abort('timeout');
    }, REQUEST_TIMEOUT_MS);
    var slowId = window.setTimeout(function () {
      if (!accText && !accThought) {
        setTypingNote(ai.body, 'Still thinking — the server may be waking up…');
      }
    }, SLOW_HINT_MS);

    var flush = function () {
      if (accThought) {
        ai.thoughts.hidden = false;
        ai.thoughts.open = true;
        renderMarkdown(ai.thoughtBody, accThought);
      }
      if (accText) {
        renderMarkdown(ai.body, accText);
      }
      scrollToBottom(false);
    };

    try {
      var response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: apiHistory }),
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        referrerPolicy: 'strict-origin-when-cross-origin',
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error('Unexpected response status');
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';

      while (!finished) {
        var chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\n\n');
        buffer = events.pop();

        for (var i = 0; i < events.length; i++) {
          var line = events[i];
          if (line.indexOf('data: ') !== 0) {
            continue;
          }
          var payload = line.slice(6);
          if (payload === '[DONE]') {
            finished = true;
            break;
          }
          var parsed;
          try {
            parsed = JSON.parse(payload);
          } catch (e) {
            continue; // skip malformed chunk
          }
          if (!parsed || typeof parsed !== 'object') {
            continue;
          }
          if (parsed.error) {
            failed = true;
            finished = true;
            ai.body.replaceChildren(errorBox('The assistant returned an error: ' + String(parsed.error).slice(0, 300)));
            break;
          }
          if (typeof parsed.thought === 'string') {
            accThought += parsed.thought;
          }
          if (typeof parsed.text === 'string') {
            accText += parsed.text;
          }
        }

        var now = Date.now();
        if (!failed && now - lastRender > RENDER_INTERVAL_MS) {
          flush();
          lastRender = now;
        }
      }
      if (finished) {
        reader.cancel().catch(function () { /* stream already closed */ });
      }

      if (!failed) {
        if (!accText && !accThought) {
          ai.body.replaceChildren(errorBox('No response was received. Please try again.'));
        } else {
          flush();
          ai.thoughts.open = false;
          persistExchange(session, text, accText, accThought);
        }
      }
    } catch (err) {
      var reason = controller.signal.aborted ? controller.signal.reason : null;
      if (reason === 'user') {
        if (accText || accThought) {
          flush();
          ai.thoughts.open = false;
          persistExchange(session, text, accText, accThought);
        } else {
          ai.body.replaceChildren(errorBox('Stopped.'));
        }
      } else if (reason === 'timeout') {
        ai.body.replaceChildren(errorBox('The assistant took too long to respond. Please try again.'));
      } else {
        console.error('Chat request failed.');
        ai.body.replaceChildren(errorBox('Unable to connect to the assistant. Please try again in a moment.'));
      }
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(slowId);
      abortController = null;
      setStreaming(false);
      scrollToBottom(false);
    }
  }

  /* ---------- Events ---------- */
  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener('input', function () {
    autoresize();
    updateSendState();
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(input.value);
    }
  });

  stopBtn.addEventListener('click', function () {
    if (abortController) {
      abortController.abort('user');
    }
  });

  newChatBtn.addEventListener('click', newChat);

  chatWindow.addEventListener('click', function (event) {
    var suggestion = event.target.closest('[data-prompt]');
    if (suggestion && chatWindow.contains(suggestion)) {
      sendMessage(suggestion.getAttribute('data-prompt'));
      return;
    }
    var copyBtn = event.target.closest('[data-code-copy]');
    if (copyBtn) {
      var pre = copyBtn.closest('.code-block').querySelector('pre');
      var label = copyBtn.querySelector('span');
      copyText(pre ? pre.textContent : '').then(function () {
        copyBtn.classList.add('is-copied');
        label.textContent = 'Copied!';
      }, function () {
        label.textContent = 'Copy failed';
      }).then(function () {
        window.setTimeout(function () {
          copyBtn.classList.remove('is-copied');
          label.textContent = 'Copy';
        }, 2000);
      });
    }
  });

  /* ---------- Voice typing (Web Speech API) ---------- */
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && micBtn) {
    var recognition = new SpeechRecognition();
    var recording = false;
    var baseText = '';
    recognition.continuous = true;
    recognition.interimResults = true;
    micBtn.hidden = false;

    micBtn.addEventListener('click', function () {
      if (recording) {
        recognition.stop();
        return;
      }
      baseText = input.value ? input.value + ' ' : '';
      try {
        recognition.start();
      } catch (e) {
        /* already started */
      }
    });

    // Stop listening as soon as the user types manually.
    input.addEventListener('input', function () {
      if (recording) {
        recognition.stop();
      }
    });

    recognition.onstart = function () {
      recording = true;
      micBtn.classList.add('is-recording');
      micBtn.setAttribute('aria-pressed', 'true');
      micBtn.setAttribute('aria-label', 'Stop voice typing');
      input.placeholder = 'Listening… type or tap the mic to stop';
    };

    recognition.onresult = function (event) {
      var transcript = '';
      for (var i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = (baseText + transcript).slice(0, MAX_INPUT);
      autoresize();
      updateSendState();
    };

    recognition.onend = function () {
      recording = false;
      micBtn.classList.remove('is-recording');
      micBtn.setAttribute('aria-pressed', 'false');
      micBtn.setAttribute('aria-label', 'Start voice typing');
      input.placeholder = defaultPlaceholder;
    };

    recognition.onerror = function () {
      input.placeholder = 'Microphone unavailable or permission denied.';
      window.setTimeout(function () {
        if (!recording) {
          input.placeholder = defaultPlaceholder;
        }
      }, 3000);
    };
  }

  /* ---------- Init ---------- */
  if (sessions.length) {
    loadSession(sessions[0].id);
  } else {
    newChat();
  }
  updateSendState();
})();
