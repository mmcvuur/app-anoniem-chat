const MAX_MESSAGES = 500;
const SCROLL_ON_APPEND = true;
const MAX_USERNAME_LEN = 15;

const joinScreen = document.getElementById('join-screen');
const joinForm = document.getElementById('joinForm');
const joinUsername = document.getElementById('join-username');
const joinKey = document.getElementById('join-key');
const toggleKey = document.getElementById('toggleKey');
const genKeyBtn = document.getElementById('genKeyBtn');
const joinError = document.getElementById('join-error');

const messages = document.getElementById('messages');
const form = document.getElementById('chatForm');
const input = document.getElementById('m');
const emojiToggle = document.getElementById('emojiToggle');
const emojiPanel  = document.getElementById('emojiPanel');
const notificationSound = document.getElementById('notificationSound');
const tipBtn = document.getElementById('tooltip-btn');
const tipPanel = document.getElementById('tooltip-panel');
const showRawToggle = document.getElementById('show-raw-toggle');

const originalTitle = document.title;
let unread = 0;
let showRaw = false;

showRawToggle?.addEventListener('change', (e) => {
  showRaw = e.target.checked;
  document.querySelectorAll('.raw-payload').forEach(el => {
    el.hidden = !showRaw;
  });
});

let myUsername = null;
let myRoomId = null;
let encryptionKey = null;

const storedUsername = localStorage.getItem('chatUsername');
if (storedUsername) joinUsername.value = storedUsername;

const socket = io({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  autoConnect: false
});

// Crypto Helpers
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function hashKey(password) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function encryptMessage(text, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function decryptMessage(combinedBase64, key) {
  try {
    const combined = new Uint8Array(
      atob(combinedBase64).split('').map(c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Decryption failed', e);
    return '[Decryption Failed]';
  }
}

function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
  const array = new Uint32Array(32);
  crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(array[i] % chars.length);
  }
  return result;
}

// UI Actions
const imageModal = document.getElementById('image-modal');
const modalImg = imageModal.querySelector('img');

imageModal.addEventListener('click', () => {
  imageModal.classList.remove('active');
});

function openImagePreview(src) {
  modalImg.src = src;
  imageModal.classList.add('active');
}

function imageify(text) {
  const imageRegex = /((?:https?:\/\/|www\.)[^\s<]+\.(?:jpg|jpeg|png|gif|webp))/gi;
  const match = imageRegex.exec(text);
  if (!match) return null;

  let url = match[1];
  if (url.toLowerCase().startsWith('www.')) url = 'http://' + url;

  const container = document.createElement('div');
  container.className = 'chat-image-container';

  const img = document.createElement('img');
  img.src = url;
  img.className = 'chat-thumb';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = 'Shared image';
  img.onclick = () => openImagePreview(url);
  
  img.onload = () => {
    if (SCROLL_ON_APPEND) {
      messages.scrollTop = messages.scrollHeight;
    }
  };

  container.appendChild(img);
  return container;
}

toggleKey.addEventListener('click', () => {
  const type = joinKey.type === 'password' ? 'text' : 'password';
  joinKey.type = type;
  toggleKey.innerHTML = type === 'password' ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
});

genKeyBtn.addEventListener('click', () => {
  const newKey = generateRandomKey();
  joinKey.value = newKey;
  joinKey.type = 'text';
  toggleKey.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
  
  // Try to copy to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(newKey).then(() => {
      const oldText = genKeyBtn.textContent;
      genKeyBtn.textContent = 'Copied!';
      setTimeout(() => genKeyBtn.textContent = oldText, 2000);
    }).catch(() => {});
  }
});

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = joinUsername.value.trim();
  const key = joinKey.value;
  
  if (!username) return;
  if (!key || key.length < 32) {
    joinError.textContent = 'Room Key must be at least 32 characters.';
    return;
  }
  
  joinError.textContent = 'Joining...';
  console.log('Attempting to join room...', { username });
  
  try {
    myRoomId = await hashKey(key);
    const salt = new TextEncoder().encode(myRoomId.slice(0, 16));
    encryptionKey = await deriveKey(key, salt);
    
    const performJoin = () => {
      console.log('Socket connected, emitting join room', { roomId: myRoomId });
      socket.emit('join room', { username, roomId: myRoomId });
    };

    if (socket.connected) {
      performJoin();
    } else {
      console.log('Socket not connected, calling socket.connect()');
      socket.connect();
      // Global connect listener will handle the join
    }

    // Timeout if joining takes too long
    setTimeout(() => {
      if (joinScreen.hidden === false && joinError.textContent === 'Joining...') {
        joinError.textContent = 'Connection timeout. Check your internet.';
        console.warn('Join timeout');
      }
    }, 15000);

  } catch (err) {
    joinError.textContent = 'Error initializing encryption';
    console.error('Crypto error:', err);
  }
});

socket.on('join rejected', ({ reason }) => {
  console.warn('Join rejected:', reason);
  joinError.textContent = reason;
});

socket.on('connect', () => {
  console.log('Socket connected');
  const username = joinUsername.value.trim();
  if (username && myRoomId) {
    console.log('Already have username and roomId, performing join on connect');
    socket.emit('join room', { username, roomId: myRoomId });
  }
});

socket.on('session', ({ username, roomId }) => {
  console.log('Session received', { username, roomId });
  myUsername = username;
  myRoomId = roomId;
  joinScreen.hidden = true;
  const topText = document.getElementById('top-text');
  if (topText) topText.textContent = `${roomId.slice(0, 8)}`;
  input.focus();
  localStorage.setItem('chatUsername', username);
});

socket.on('join accepted', ({ username, roomId }) => {
  console.log('Join accepted', { username, roomId });
  myUsername = username;
  if (roomId) {
    myRoomId = roomId;
    const topText = document.getElementById('top-text');
    if (topText) topText.textContent = `${roomId.slice(0, 8)}`;
  }
  joinScreen.hidden = true;
  input.focus();
});

// Existing app logic adapted...
const setVh = () => {
  if (window.visualViewport) {
    document.documentElement.style.setProperty(
      '--vh',
      `${window.visualViewport.height}px`
    );
  }
};
setVh();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setVh);
  window.visualViewport.addEventListener('scroll', setVh);
}

socket.on('connect_error', err => {
  console.warn('connect_error', err?.message);
  joinError.textContent = 'Connection error. Try again.';
});

socket.on('server full', (msg) => {
  console.warn('Server full:', msg);
  joinError.textContent = msg || 'Server is full. Please try again later.';
});

function appendMessage(li) {
  messages.appendChild(li);
  while (messages.children.length > MAX_MESSAGES) {
    messages.removeChild(messages.firstChild);
  }
  if (SCROLL_ON_APPEND) {
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }
}

function linkify(text) {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<]+/gi;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let count = 0;
  const MAX_LINKS = 5;

  text.replace(urlRegex, (match, offset) => {
    let cleanMatch = match;
    const punctuation = [',', '.', '!', '?', ')', ']', '}'];
    while (cleanMatch.length > 0 && punctuation.includes(cleanMatch[cleanMatch.length - 1])) {
      cleanMatch = cleanMatch.substring(0, cleanMatch.length - 1);
    }

    fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
    
    count++;
    if (count <= MAX_LINKS) {
      const a = document.createElement('a');
      let href = cleanMatch;
      if (cleanMatch.toLowerCase().startsWith('www.')) href = 'http://' + cleanMatch;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = cleanMatch;
      fragment.appendChild(a);
    } else {
      fragment.appendChild(document.createTextNode(cleanMatch));
    }
    lastIndex = offset + match.length;
  });
  
  fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  return fragment;
}

function colorize(text, depth = 0) {
  const fragment = document.createDocumentFragment();
  const MAX_DEPTH = 5;
  
  if (depth > MAX_DEPTH) {
    fragment.appendChild(linkify(text));
    return fragment;
  }

  const regex = /\[(red|green|blue|yellow|purple|cyan|orange|pink|white|b)\]([\s\S]*?)\[\/\1\]/gi;
  
  let lastIndex = 0;
  let match;
  let hasMatches = false;
  
  while ((match = regex.exec(text)) !== null) {
    hasMatches = true;
    // Plain text before match
    if (match.index > lastIndex) {
      fragment.appendChild(colorize(text.substring(lastIndex, match.index), depth + 1));
    }
    
    const tag = match[1].toLowerCase();
    const content = match[2];
    
    if (tag === 'b') {
      const b = document.createElement('b');
      b.appendChild(colorize(content, depth + 1));
      fragment.appendChild(b);
    } else {
      const span = document.createElement('span');
      span.className = `irc-` + tag;
      span.appendChild(colorize(content, depth + 1));
      fragment.appendChild(span);
    }
    
    lastIndex = regex.lastIndex;
  }
  
  // If no tags were found at this level, just linkify the text
  if (!hasMatches) {
    fragment.appendChild(linkify(text));
    return fragment;
  }
  
  // Remaining text after last match
  if (lastIndex < text.length) {
    fragment.appendChild(colorize(text.substring(lastIndex), depth + 1));
  }
  
  return fragment;
}

function systemLi(text, className) {
  const li = document.createElement('li');
  
  if (className === 'motd') {
    li.appendChild(colorize(text));
  } else {
    li.appendChild(linkify(text));
  }
  
  const img = imageify(text);
  if (img) li.appendChild(img);

  if (className) li.classList.add(className);
  return li;
}

function userLi(msg, decryptedText) {
  const li = document.createElement('li');
  const isAction = decryptedText.startsWith('/me ');
  const displayContent = isAction ? decryptedText.slice(4) : decryptedText;
  
  const content = document.createElement('div');
  const header = document.createElement('span');

  if (msg.time) {
    const date = new Date(msg.time);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const displayTime = `${hh}:${mm}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `${displayTime} `;
    header.appendChild(timeSpan);
  }

  const name = msg.username || 'anon';
  if (isAction) {
    header.appendChild(document.createTextNode(`* ${name} `));
    content.style.fontStyle = 'italic';
    li.classList.add('irc-yellow');
  } else {
    header.appendChild(document.createTextNode(`<${name}> `));
  }
  
  content.appendChild(header);
  content.appendChild(linkify(displayContent));
  li.appendChild(content);

  const img = imageify(decryptedText);
  if (img) li.appendChild(img);

  const raw = document.createElement('div');
  raw.className = 'raw-payload';
  raw.innerText = `Raw: ${msg.text}`;
  raw.hidden = !showRaw;
  li.appendChild(raw);

  if (isAction) {
    li.classList.add('irc-yellow');
  } else {
    li.classList.add('user-message');
    if (msg.username === myUsername) li.classList.add('my-message');
  }
  return li;
}

const COMMANDS = [
  { match: v => v === '/who' || v === '/w', run: () => socket.emit('who') },
  { match: v => v === '/help' || v === '/h', run: () => socket.emit('help') },
  { match: v => v === '/id', run: () => socket.emit('id') },
  { match: v => v === '/motd', run: () => socket.emit('motd') },
  { match: v => v === '/clear' || v === '/c', run: () => {
      messages.textContent = '';
      appendMessage(systemLi('Chat cleared', 'system-message'));
    }
  },
  {
    match: v => v.startsWith('/nick '),
    run: (v) => {
      const newNick = v.slice(6).trim();
      if (newNick) {
        socket.emit('change nickname', newNick);
      }
    }
  },
  {
    match: v => v === '/nick',
    run: () => {
      appendMessage(systemLi('Usage: /nick <name>', 'info-message'));
    }
  },
  {
    match: v => v.startsWith('/me '),
    run: async (v) => {
      const action = v.slice(4).trim();
      if (action && encryptionKey) {
        try {
          const encrypted = await encryptMessage(`/me ${action}`, encryptionKey);
          socket.emit('chat message', { text: encrypted });
          input.value = '';
        } catch (err) {
          console.error('Encryption failed', err);
        }
      }
    }
  },
  {
    match: v => v === '/me',
    run: () => {
      appendMessage(systemLi('Usage: /me <action>', 'info-message'));
    }
  },
  {
    match: v => v === '/exit',
    run: () => {
      location.reload();
    }
  }
];

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = (input.value || '').trim();
  if (!raw) return;

  for (const cmd of COMMANDS) {
    if (cmd.match(raw)) {
      cmd.run(raw);
      input.value = '';
      return;
    }
  }

  if (!encryptionKey) return;
  
  try {
    const encrypted = await encryptMessage(raw, encryptionKey);
    socket.emit('chat message', { text: encrypted });
    input.value = '';
  } catch (err) {
    console.error('Encryption failed', err);
  }
});

socket.on('nickname updated', (newNick) => {
  myUsername = newNick;
});

socket.on('chat message', async (msg) => {
  if (msg.type === 'system' || msg.type === 'info' || msg.type === 'motd') {
    const cls =
      msg.type === 'system' ? 'system-message' :
      msg.type === 'info'   ? 'info-message'   :
                              'motd';
    appendMessage(systemLi(msg.text, cls));
  } else {
    const decryptedText = await decryptMessage(msg.text, encryptionKey);
    if (msg.username !== myUsername) {
      if (!document.hidden) notificationSound?.play?.().catch(() => {});
    }
    appendMessage(userLi(msg, decryptedText));
  }

  if (document.hidden) {
    unread++;
    document.title = `(${unread}) New activity!`;
  }
});

function setEmojiExpanded(open) {
  emojiToggle.setAttribute('aria-expanded', String(open));
  emojiPanel.hidden = !open;
}

function insertAtCursor(emoji) {
  input.focus();
  const start = input.selectionStart ?? input.value.length;
  const end   = input.selectionEnd ?? input.value.length;
  input.value =
    input.value.slice(0, start) +
    emoji +
    input.value.slice(end);
  const pos = start + emoji.length;
  input.setSelectionRange(pos, pos);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unread = 0;
    document.title = originalTitle;
  }
});

emojiToggle?.addEventListener('click', (e) => {
  e.preventDefault();
  setEmojiExpanded(emojiPanel.hidden);
  if (!emojiPanel.hidden) emojiPanel.querySelector('.emoji-item')?.focus();
});

emojiPanel?.addEventListener('click', (e) => {
  const btn = e.target.closest('.emoji-item');
  if (!btn) return;
  insertAtCursor(btn.textContent.trim());
  setEmojiExpanded(false);
});

document.addEventListener('click', (e) => {
  if (!emojiPanel.hidden && !e.target.closest('.emoji-wrap')) {
    setEmojiExpanded(false);
  }
  
  // Close tooltip if clicking outside button and panel
  if (tipPanel && tipPanel.getAttribute('aria-hidden') === 'false' && !e.target.closest('#tooltip-btn') && !e.target.closest('#tooltip-panel')) {
    hideTooltip();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!emojiPanel.hidden) setEmojiExpanded(false);
    if (tipPanel && tipPanel.getAttribute('aria-hidden') === 'false') {
      hideTooltip();
    }
  }
});

const showTooltip = () => {
  tipBtn.setAttribute('aria-expanded', 'true');
  tipPanel.setAttribute('aria-hidden', 'false');
};

const hideTooltip = () => {
  tipBtn.setAttribute('aria-expanded', 'false');
  tipPanel.setAttribute('aria-hidden', 'true');
};

if (tipBtn && tipPanel) {
  tipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = tipPanel.getAttribute('aria-hidden') === 'true';
    if (isHidden) showTooltip();
    else hideTooltip();
  });
}
