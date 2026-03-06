const STORAGE_KEY = "beerio-kart-redemption-v3";
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 256;
const DEFAULT_PLAYERS = 16;
const DEFAULT_MODE = "single";
const SHARED_TOURNAMENT_ID = "live";
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_SYNC_DEBOUNCE_MS = 250;
const DEVICE_ID_KEY = "beerio-kart-device-id";
const JOINED_LOBBY_NAME_KEY = "beerio-kart-joined-name";
const DEFAULT_ADMIN_PASSWORD = "B33r10k@rt";
const ACTION_SOUND_SRC = "assets/wolfy_sanic-collect-ring-15982.mp3";
const ACTION_SOUND_POOL_SIZE = 4;
const BACKGROUND_MUSIC_SRC = "assets/mario-kart-background.mp3";
const BACKGROUND_MUSIC_VOLUME = 0.26;
const MOBILE_BREAKPOINT_PX = 760;
const UI_PHASE_JOIN = "join";
const UI_PHASE_LOBBY = "lobby";
const UI_PHASE_BRACKET = "bracket";

const els = {
  joinScreen: document.querySelector("#join-screen"),
  toolbar: document.querySelector("#toolbar"),
  lobbyPanel: document.querySelector("#lobby-panel"),
  adminPassword: document.querySelector("#admin-password"),
  adminLogin: document.querySelector("#admin-login"),
  adminLogout: document.querySelector("#admin-logout"),
  adminStatus: document.querySelector("#admin-status"),
  adminOnlyBlocks: Array.from(document.querySelectorAll(".admin-only")),
  settingsPanel: document.querySelector("#settings-panel"),
  eliminationMode: document.querySelector("#elimination-mode"),
  updateBracket: document.querySelector("#update-bracket"),
  resetTournament: document.querySelector("#reset-tournament"),
  startTournament: document.querySelector("#start-tournament"),
  joinName: document.querySelector("#join-name"),
  joinLobby: document.querySelector("#join-lobby"),
  joinStatus: document.querySelector("#join-status"),
  joinCount: document.querySelector("#join-count"),
  lobbyRoster: document.querySelector("#lobby-roster"),
  lobbyPlayers: document.querySelector("#lobby-players"),
  lobbyStatus: document.querySelector("#lobby-status"),
  syncStatus: document.querySelector("#sync-status"),
  meta: document.querySelector("#meta"),
  bracketShell: document.querySelector("#bracket-shell"),
  empty: document.querySelector("#empty"),
  bracketViewport: document.querySelector("#bracket-viewport"),
  mobileBracket: document.querySelector("#mobile-bracket"),
  bracketCanvas: document.querySelector("#bracket-canvas"),
  bracket: document.querySelector("#bracket"),
  leftSide: document.querySelector("#left-side"),
  rightSide: document.querySelector("#right-side"),
  finalSide: document.querySelector("#final-side"),
  losersSide: document.querySelector("#losers-side"),
  champion: document.querySelector("#champion"),
  matchTemplate: document.querySelector("#match-template")
};

let notice = "";
let pendingFitFrame = null;
let bracketResizeObserver = null;
let cloudSyncTimer = null;
let cloudApplyingRemote = false;
let cloudInitialReadComplete = false;
let cloudEnabled = false;
let cloudDatabase = null;
let cloudRef = null;
let cloudListener = null;
const deviceId = getDeviceId();
let isAdminUnlocked = false;
const actionSoundPool = createActionSoundPool();
let actionSoundIndex = 0;
let backgroundMusic = null;
let backgroundUnlockHandler = null;
let backgroundUnlockBound = false;
let wasMobileView = null;
let localJoinedName = loadJoinedLobbyName();
let joinPending = false;

let state = loadState() || createDefaultState();

boot();

function boot() {
  state.playerCount = parsePlayerCount(state.playerCount) || DEFAULT_PLAYERS;
  state.eliminationMode = normalizeMode(state.eliminationMode);
  state.bracketSize = Number.isInteger(state.bracketSize) && state.bracketSize >= 2
    ? state.bracketSize
    : nextPowerOfTwo(state.playerCount);

  initBackgroundMusic();
  els.eliminationMode.value = state.eliminationMode;
  syncLobbyTextFromState();
  bindGlobalActionSound();

  els.eliminationMode.addEventListener("change", () => {
    refreshSettingsControls();
  });

  els.updateBracket.addEventListener("click", () => {
    if (!isAdminUnlocked) {
      notice = "Admin unlock required to update bracket settings.";
      renderMeta();
      return;
    }
    applyPendingSettings();
  });

  els.resetTournament.addEventListener("click", () => {
    resetTournamentToLobby();
  });

  els.startTournament.addEventListener("click", () => {
    startTournamentFromLobby();
  });

  els.joinLobby.addEventListener("click", () => {
    joinLobbyFromInput();
  });

  els.joinName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinLobbyFromInput();
    }
  });

  els.lobbyPlayers.addEventListener("input", () => {
    if (!isAdminUnlocked || state.tournamentStarted) {
      syncLobbyTextFromState();
      return;
    }
    state.lobbyPlayers = parseLobbyPlayers(els.lobbyPlayers.value);
    notice = "Lobby updated.";
    persistState();
    render();
  });

  els.adminLogin.addEventListener("click", () => {
    unlockAdminPanel();
  });

  els.adminPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      playActionSound();
      unlockAdminPanel();
    }
  });

  els.adminLogout.addEventListener("click", () => {
    lockAdminPanel();
  });

  els.bracket.addEventListener("click", handleBracketClick);
  els.bracket.addEventListener("change", handleBracketChange);

  initCloudSync();
  lockAdminPanel();

  wasMobileView = isMobileView();
  window.addEventListener("resize", handleViewportResize);
  if (typeof window.ResizeObserver === "function") {
    bracketResizeObserver = new window.ResizeObserver(() => {
      if (!isMobileView()) {
        scheduleBracketFit();
      }
    });
    bracketResizeObserver.observe(els.bracketShell);
  }

  if (Array.isArray(state.rounds) && state.rounds.length > 0) {
    recalculateBracket();
  }

  render();
}

function createActionSoundPool() {
  const pool = [];

  if (typeof window.Audio !== "function") {
    return pool;
  }

  for (let index = 0; index < ACTION_SOUND_POOL_SIZE; index += 1) {
    const audio = new Audio(ACTION_SOUND_SRC);
    audio.preload = "auto";
    pool.push(audio);
  }

  return pool;
}

function initBackgroundMusic() {
  if (typeof window.Audio !== "function") {
    return;
  }

  const audio = new Audio(BACKGROUND_MUSIC_SRC);
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = BACKGROUND_MUSIC_VOLUME;
  backgroundMusic = audio;

  attachBackgroundUnlockListeners();
  attemptBackgroundMusicStart();

  audio.addEventListener("pause", () => {
    // Keep background music running when browsers pause media on focus/route changes.
    if (document.visibilityState === "visible") {
      window.setTimeout(() => {
        attemptBackgroundMusicStart();
      }, 100);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      attemptBackgroundMusicStart();
    }
  });
}

function attemptBackgroundMusicStart() {
  if (!backgroundMusic || !backgroundMusic.paused) {
    return;
  }

  try {
    const result = backgroundMusic.play();
    if (result && typeof result.then === "function") {
      result.then(() => {
        detachBackgroundUnlockListeners();
      }).catch(() => {
        // Ignore autoplay policy blocks; user interaction listener will retry.
      });
    }
  } catch (_error) {
    // Ignore playback errors.
  }
}

function attachBackgroundUnlockListeners() {
  if (backgroundUnlockBound) {
    return;
  }

  backgroundUnlockHandler = () => {
    attemptBackgroundMusicStart();
  };

  for (const eventName of ["pointerdown", "touchstart", "keydown"]) {
    window.addEventListener(eventName, backgroundUnlockHandler, { passive: true });
  }

  backgroundUnlockBound = true;
}

function detachBackgroundUnlockListeners() {
  if (!backgroundUnlockBound || !backgroundUnlockHandler) {
    return;
  }

  for (const eventName of ["pointerdown", "touchstart", "keydown"]) {
    window.removeEventListener(eventName, backgroundUnlockHandler);
  }

  backgroundUnlockHandler = null;
  backgroundUnlockBound = false;
}

function playActionSound() {
  if (!actionSoundPool.length) {
    return;
  }

  const audio = actionSoundPool[actionSoundIndex];
  actionSoundIndex = (actionSoundIndex + 1) % actionSoundPool.length;

  try {
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Ignore autoplay/interrupt errors.
      });
    }
  } catch (_error) {
    // Ignore playback errors.
  }
}

function bindGlobalActionSound() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      playActionSound();
    }
  });

  document.addEventListener("change", (event) => {
    const field = event.target.closest("input, select, textarea");
    if (field) {
      playActionSound();
    }
  });
}

function createDefaultState() {
  return {
    playerCount: DEFAULT_PLAYERS,
    eliminationMode: DEFAULT_MODE,
    bracketSize: nextPowerOfTwo(DEFAULT_PLAYERS),
    tournamentStarted: false,
    lobbyPlayers: [],
    rounds: [],
    losersRounds: [],
    grandFinals: []
  };
}

function loadJoinedLobbyName() {
  try {
    return normalizeName(localStorage.getItem(JOINED_LOBBY_NAME_KEY) || "");
  } catch (_error) {
    return "";
  }
}

function saveJoinedLobbyName(name) {
  const normalized = normalizeName(name);
  localJoinedName = normalized;
  try {
    if (normalized) {
      localStorage.setItem(JOINED_LOBBY_NAME_KEY, normalized);
    } else {
      localStorage.removeItem(JOINED_LOBBY_NAME_KEY);
    }
  } catch (_error) {
    // Ignore storage errors.
  }
}

function getAdminPassword() {
  const configured = String(window.BEERIO_ADMIN_PASSWORD || "").trim();
  return configured || DEFAULT_ADMIN_PASSWORD;
}

function unlockAdminPanel() {
  const entered = String(els.adminPassword.value || "");
  if (entered !== getAdminPassword()) {
    notice = "Incorrect admin password.";
    renderMeta();
    return;
  }

  isAdminUnlocked = true;
  els.adminPassword.value = "";
  els.adminPassword.disabled = true;
  els.adminLogin.classList.add("hidden");
  els.adminLogout.classList.remove("hidden");
  els.adminStatus.textContent = "Admin unlocked";
  els.adminStatus.classList.add("unlocked");
  refreshAdminControls();
  notice = "Admin controls unlocked.";
  renderMeta();
}

function lockAdminPanel() {
  isAdminUnlocked = false;
  els.adminPassword.disabled = false;
  els.adminLogin.classList.remove("hidden");
  els.adminLogout.classList.add("hidden");
  els.adminStatus.textContent = "Viewer mode";
  els.adminStatus.classList.remove("unlocked");
  refreshAdminControls();
}

function refreshAdminControls() {
  for (const node of els.adminOnlyBlocks) {
    node.classList.toggle("locked", !isAdminUnlocked);
  }

  els.eliminationMode.disabled = !isAdminUnlocked || state.tournamentStarted;
  els.updateBracket.disabled = !isAdminUnlocked;
  els.resetTournament.disabled = !isAdminUnlocked || !state.tournamentStarted;
  els.startTournament.disabled = (
    !isAdminUnlocked ||
    state.tournamentStarted ||
    normalizedLobbyPlayers(state.lobbyPlayers).length < MIN_PLAYERS
  );
  els.lobbyPlayers.disabled = !isAdminUnlocked || state.tournamentStarted;

  refreshSettingsControls();
  renderJoinDialog();
  renderLobbyStatus();
}

function parseLobbyPlayers(rawText) {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => normalizeName(line))
    .filter(Boolean);

  return dedupeNames(lines).slice(0, MAX_PLAYERS);
}

function dedupeNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const key = name.toLowerCase();
    const nextCount = (seen.get(key) || 0) + 1;
    seen.set(key, nextCount);
    if (nextCount === 1) {
      return name;
    }
    return `${name} (${nextCount})`;
  });
}

function syncLobbyTextFromState() {
  const lobbyPlayers = Array.isArray(state.lobbyPlayers) ? state.lobbyPlayers : [];
  const filled = lobbyPlayers.map((name) => normalizeName(name)).filter(Boolean);
  els.lobbyPlayers.value = filled.join("\n");
}

function renderLobbyStatus() {
  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  const filled = countFilledLobbyPlayers(lobbyPlayers);
  renderLobbyRoster(lobbyPlayers);

  if (state.tournamentStarted) {
    els.startTournament.textContent = "Tournament Started";
    els.lobbyStatus.textContent = `Tournament started with ${filled} players.`;
    return;
  }

  els.startTournament.textContent = "Seed Players and Begin Tournament";
  if (filled < MIN_PLAYERS) {
    els.lobbyStatus.textContent = `Lobby ready: ${filled} player${filled === 1 ? "" : "s"} joined. Need at least ${MIN_PLAYERS} to start.`;
    return;
  }

  els.lobbyStatus.textContent = `Lobby ready: ${filled} players joined.`;
}

function renderJoinDialog() {
  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  const filled = countFilledLobbyPlayers(lobbyPlayers);
  renderJoinControls(lobbyPlayers);
  els.joinCount.textContent = `Players joined: ${filled}`;
}

function countFilledLobbyPlayers(lobbyPlayers) {
  return lobbyPlayers.filter((name) => Boolean(normalizeName(name))).length;
}

function renderLobbyRoster(lobbyPlayers) {
  els.lobbyRoster.replaceChildren();

  if (!lobbyPlayers.length) {
    const li = document.createElement("li");
    li.textContent = "No players joined yet.";
    li.classList.add("open");
    els.lobbyRoster.appendChild(li);
    return;
  }

  for (let index = 0; index < lobbyPlayers.length; index += 1) {
    const li = document.createElement("li");
    const entry = normalizeName(lobbyPlayers[index]);

    li.textContent = entry;

    if (entry && localJoinedName && entry.toLowerCase() === localJoinedName.toLowerCase()) {
      li.classList.add("self");
      li.textContent = `${entry} (you)`;
    }

    els.lobbyRoster.appendChild(li);
  }
}

function renderJoinControls(lobbyPlayers) {
  const started = state.tournamentStarted;
  const joinedIndex = findLobbyIndexByName(lobbyPlayers, localJoinedName);

  if (localJoinedName) {
    els.joinName.value = localJoinedName;
  }

  els.joinName.disabled = started || joinPending;
  els.joinLobby.disabled = started || joinPending;

  if (started) {
    setJoinStatus("Tournament already started.", "warn");
    return;
  }

  if (joinPending) {
    setJoinStatus("Joining lobby...", "good");
    return;
  }

  if (joinedIndex >= 0) {
    setJoinStatus(`You are joined as ${lobbyPlayers[joinedIndex]}.`, "good");
    return;
  }

  setJoinStatus("Enter your name and tap Join.", "");
}

function setJoinStatus(text, mode) {
  els.joinStatus.textContent = text;
  els.joinStatus.classList.remove("good", "warn");
  if (mode) {
    els.joinStatus.classList.add(mode);
  }
}

function normalizedLobbyPlayers(rawPlayers) {
  const list = Array.isArray(rawPlayers) ? rawPlayers : [];
  const normalized = list
    .map((name) => normalizeName(name))
    .filter(Boolean);

  return dedupeNames(normalized).slice(0, MAX_PLAYERS);
}

function findLobbyIndexByName(players, name) {
  const target = normalizeName(name).toLowerCase();
  if (!target) {
    return -1;
  }

  return players.findIndex((entry) => normalizeName(entry).toLowerCase() === target);
}

function joinLobbyFromInput() {
  const desiredName = normalizeName(els.joinName.value);
  if (!desiredName) {
    setJoinStatus("Enter your name first.", "warn");
    return;
  }

  if (state.tournamentStarted) {
    setJoinStatus("Tournament already started.", "warn");
    return;
  }

  if (cloudEnabled && cloudRef) {
    joinLobbyViaCloud(desiredName);
    return;
  }

  const result = applyLobbyJoinToState(state, desiredName, localJoinedName);
  handleLocalJoinResult(result);
}

function handleLocalJoinResult(result) {
  if (!result.ok) {
    setJoinStatus(joinFailureMessage(result.reason), "warn");
    return;
  }

  saveJoinedLobbyName(result.joinedName);
  persistState();
  render();
}

function joinLobbyViaCloud(desiredName) {
  if (!cloudRef) {
    setJoinStatus("Cloud connection not ready yet.", "warn");
    return;
  }

  joinPending = true;
  renderLobbyStatus();
  let pendingResult = { ok: false, reason: "unknown" };

  cloudRef.transaction((currentValue) => {
    const currentPayload = currentValue && typeof currentValue === "object"
      ? { ...currentValue }
      : {};
    const baselineState = coerceStateObject(currentPayload.state) || coerceStateObject(state) || createDefaultState();
    pendingResult = applyLobbyJoinToState(baselineState, desiredName, localJoinedName);

    if (!pendingResult.ok) {
      return;
    }

    currentPayload.schemaVersion = CLOUD_SCHEMA_VERSION;
    currentPayload.updatedAt = Date.now();
    currentPayload.updatedBy = deviceId;
    currentPayload.state = cloneStateForCloud(baselineState);
    return currentPayload;
  }, (error, committed) => {
    joinPending = false;

    if (error) {
      setJoinStatus("Unable to join right now. Try again.", "warn");
      renderJoinDialog();
      return;
    }

    if (!committed || !pendingResult.ok) {
      setJoinStatus(joinFailureMessage(pendingResult.reason), "warn");
      renderJoinDialog();
      return;
    }

    applyLobbyJoinToState(state, pendingResult.joinedName, localJoinedName);
    saveJoinedLobbyName(pendingResult.joinedName);
    render();
  }, false);
}

function applyLobbyJoinToState(targetState, desiredName, priorName) {
  const nextName = normalizeName(desiredName);
  if (!nextName) {
    return { ok: false, reason: "invalid" };
  }

  if (targetState.tournamentStarted) {
    return { ok: false, reason: "started" };
  }

  const lobbyPlayers = normalizedLobbyPlayers(targetState.lobbyPlayers);
  const priorIndex = findLobbyIndexByName(lobbyPlayers, priorName);
  const nameIndex = findLobbyIndexByName(lobbyPlayers, nextName);

  if (nameIndex >= 0 && nameIndex !== priorIndex) {
    return { ok: false, reason: "taken" };
  }

  if (priorIndex >= 0) {
    lobbyPlayers[priorIndex] = nextName;
    targetState.lobbyPlayers = lobbyPlayers;
    return { ok: true, joinedName: nextName };
  }

  if (nameIndex >= 0) {
    targetState.lobbyPlayers = lobbyPlayers;
    return { ok: true, joinedName: nextName };
  }

  if (lobbyPlayers.length >= MAX_PLAYERS) {
    return { ok: false, reason: "full" };
  }

  lobbyPlayers.push(nextName);
  targetState.lobbyPlayers = lobbyPlayers;
  return { ok: true, joinedName: nextName };
}

function joinFailureMessage(reason) {
  if (reason === "started") {
    return "Tournament already started.";
  }
  if (reason === "taken") {
    return "That name is already in the lobby.";
  }
  if (reason === "full") {
    return `Lobby is full (${MAX_PLAYERS} max).`;
  }
  return "Unable to join lobby.";
}

function startTournamentFromLobby() {
  if (!isAdminUnlocked) {
    notice = "Admin unlock required to start the tournament.";
    renderMeta();
    return;
  }

  if (state.tournamentStarted) {
    notice = "Tournament already started.";
    renderMeta();
    return;
  }

  const seededPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  if (seededPlayers.length < MIN_PLAYERS) {
    notice = `Need at least ${MIN_PLAYERS} players in the lobby to start.`;
    renderLobbyStatus();
    renderMeta();
    return;
  }

  const randomized = shuffleCopy(seededPlayers);
  const bracket = createBracket(randomized.length, state.eliminationMode);
  state.playerCount = randomized.length;
  state.bracketSize = bracket.bracketSize;
  state.rounds = bracket.rounds;
  state.losersRounds = bracket.losersRounds;
  state.grandFinals = bracket.grandFinals;
  state.lobbyPlayers = randomized.slice();
  state.tournamentStarted = true;
  seedPlayersIntoFirstRound(randomized);
  recalculateBracket();
  persistState();
  notice = `Tournament started. ${randomized.length} players seeded randomly.`;
  render();
}

function resetTournamentToLobby() {
  if (!isAdminUnlocked) {
    notice = "Admin unlock required to reset the tournament.";
    renderMeta();
    return;
  }

  if (!state.tournamentStarted) {
    notice = "Tournament has not started.";
    renderMeta();
    return;
  }

  const confirmed = window.confirm(
    "Reset the current tournament and return to lobby? This clears all bracket results."
  );
  if (!confirmed) {
    return;
  }

  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  state.tournamentStarted = false;
  state.playerCount = clamp(Math.max(lobbyPlayers.length, DEFAULT_PLAYERS), MIN_PLAYERS, MAX_PLAYERS);
  state.bracketSize = nextPowerOfTwo(state.playerCount);
  state.rounds = [];
  state.losersRounds = [];
  state.grandFinals = [];
  notice = "Tournament reset. Back in lobby.";
  persistState();
  render();
}

function seedPlayersIntoFirstRound(randomizedPlayers) {
  const playerBySeed = new Map();
  for (let index = 0; index < randomizedPlayers.length; index += 1) {
    playerBySeed.set(index + 1, randomizedPlayers[index]);
  }

  const firstRound = state.rounds[0] || [];
  for (const match of firstRound) {
    for (let slotIndex = 0; slotIndex < 2; slotIndex += 1) {
      const seed = normalizeSeed(match.seeds[slotIndex]);
      const locked = Boolean(match.locked[slotIndex]);
      if (locked || seed === null || seed > randomizedPlayers.length) {
        match.players[slotIndex] = "";
        match.slotReady[slotIndex] = true;
      } else {
        match.players[slotIndex] = playerBySeed.get(seed) || "";
        match.slotReady[slotIndex] = Boolean(match.players[slotIndex]);
      }
    }
    match.winnerIndex = null;
    clearMatchConfirmations(match);
  }
}

function shuffleCopy(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function initCloudSync() {
  const firebaseConfig = window.BEERIO_FIREBASE_CONFIG;
  const firebaseAvailable = Boolean(window.firebase?.database);

  if (!firebaseAvailable || !hasValidFirebaseConfig(firebaseConfig)) {
    cloudEnabled = false;
    setCloudStatus("Cloud sync: local only (add Firebase config)", "offline");
    return;
  }

  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    cloudDatabase = window.firebase.database();
    cloudEnabled = true;
    setCloudStatus("Cloud sync: connecting...", "offline");
    connectToSharedTournament();
  } catch (_error) {
    cloudEnabled = false;
    setCloudStatus("Cloud sync: unavailable (Firebase init failed)", "offline");
  }
}

function connectToSharedTournament() {
  if (!cloudEnabled || !cloudDatabase) {
    return;
  }

  cloudInitialReadComplete = false;

  if (cloudRef && cloudListener) {
    cloudRef.off("value", cloudListener);
  }

  cloudRef = cloudDatabase.ref(`tournaments/${SHARED_TOURNAMENT_ID}`);

  let firstEvent = true;
  cloudListener = (snapshot) => {
    const payload = snapshot.val();
    const remoteState = payload && typeof payload === "object" ? payload.state : null;

    if (firstEvent) {
      cloudInitialReadComplete = true;
    }

    if (remoteState && typeof remoteState === "object") {
      applyRemoteState(remoteState);
      setCloudStatus("Cloud sync: live", "online");

      if (firstEvent) {
        notice = "Connected to shared bracket.";
      }
    } else if (firstEvent) {
      setCloudStatus("Cloud sync: live", "online");
      notice = "Started shared bracket.";
      queueCloudSync();
    }

    firstEvent = false;
  };

  cloudRef.on("value", cloudListener, () => {
    setCloudStatus("Cloud sync: connection issue", "offline");
  });
}

function applyRemoteState(remoteState) {
  const nextState = coerceStateObject(remoteState);
  if (!nextState) {
    return;
  }

  cloudApplyingRemote = true;
  state = nextState;
  els.eliminationMode.value = state.eliminationMode;
  syncLobbyTextFromState();
  recalculateBracket();
  persistLocalState();
  cloudApplyingRemote = false;
  render();
}

function queueCloudSync() {
  if (!cloudEnabled || !cloudRef || !cloudInitialReadComplete || cloudApplyingRemote) {
    return;
  }

  if (cloudSyncTimer !== null) {
    window.clearTimeout(cloudSyncTimer);
  }

  cloudSyncTimer = window.setTimeout(() => {
    cloudSyncTimer = null;
    pushStateToCloud();
  }, CLOUD_SYNC_DEBOUNCE_MS);
}

function pushStateToCloud() {
  if (!cloudEnabled || !cloudRef || !cloudInitialReadComplete || cloudApplyingRemote) {
    return;
  }

  const payload = {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    updatedAt: window.firebase.database.ServerValue.TIMESTAMP,
    updatedBy: deviceId,
    state: cloneStateForCloud(state)
  };

  cloudRef.set(payload).then(() => {
    setCloudStatus("Cloud sync: live", "online");
  }).catch(() => {
    setCloudStatus("Cloud sync: write failed", "offline");
  });
}

function cloneStateForCloud(sourceState) {
  return {
    playerCount: sourceState.playerCount,
    eliminationMode: sourceState.eliminationMode,
    bracketSize: sourceState.bracketSize,
    tournamentStarted: Boolean(sourceState.tournamentStarted),
    lobbyPlayers: Array.isArray(sourceState.lobbyPlayers) ? sourceState.lobbyPlayers : [],
    rounds: sourceState.rounds,
    losersRounds: sourceState.losersRounds,
    grandFinals: sourceState.grandFinals
  };
}

function hasValidFirebaseConfig(config) {
  if (!config || typeof config !== "object") {
    return false;
  }

  const requiredKeys = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  for (const key of requiredKeys) {
    const value = String(config[key] || "");
    if (!value || value.includes("REPLACE_ME")) {
      return false;
    }
  }

  return true;
}

function setCloudStatus(text, mode) {
  els.syncStatus.textContent = text;
  els.syncStatus.classList.remove("online", "offline");
  if (mode === "online") {
    els.syncStatus.classList.add("online");
  } else if (mode === "offline") {
    els.syncStatus.classList.add("offline");
  }
}

function applyPendingSettings() {
  const mode = normalizeMode(els.eliminationMode.value);
  if (mode === state.eliminationMode) {
    notice = "Format already matches current setting.";
    refreshSettingsControls();
    renderMeta();
    return;
  }

  if (state.tournamentStarted) {
    els.eliminationMode.value = state.eliminationMode;
    notice = "Format is locked after tournament start.";
    refreshSettingsControls();
    renderMeta();
    return;
  }

  if (hasEnteredPlayerNames()) {
    const confirmed = window.confirm(
      "Updating format after players join will reset any existing bracket progress. Continue?"
    );
    if (!confirmed) {
      els.eliminationMode.value = state.eliminationMode;
      refreshSettingsControls();
      return;
    }
  }

  state.eliminationMode = mode;
  notice = mode === "double" ? "Format set to double elimination." : "Format set to single elimination.";
  persistState();
  render();
}

function currentControlSettings() {
  return {
    eliminationMode: normalizeMode(els.eliminationMode.value)
  };
}

function hasPendingSettingChanges() {
  const settings = currentControlSettings();
  return settings.eliminationMode !== state.eliminationMode;
}

function hasEnteredPlayerNames() {
  return normalizedLobbyPlayers(state.lobbyPlayers).length > 0;
}

function refreshSettingsControls() {
  const hasPending = hasPendingSettingChanges();
  const namesEntered = hasEnteredPlayerNames();

  if (!isAdminUnlocked) {
    els.updateBracket.textContent = "Unlock Admin to Update";
    els.updateBracket.disabled = true;
    return;
  }

  if (state.tournamentStarted) {
    els.updateBracket.textContent = "Format Locked (Started)";
    els.updateBracket.disabled = true;
    return;
  }

  if (hasPending) {
    els.updateBracket.textContent = namesEntered
      ? "Update Format (Confirm)"
      : "Update Format";
    els.updateBracket.disabled = false;
    return;
  }

  els.updateBracket.textContent = "Format Up To Date";
  els.updateBracket.disabled = true;
}

function createBracket(playerCount, mode) {
  const bracketSize = nextPowerOfTwo(playerCount);
  const rounds = createWinnersRounds(playerCount, bracketSize);

  if (mode === "double") {
    return {
      bracketSize,
      rounds,
      losersRounds: createLosersRounds(bracketSize),
      grandFinals: [createProgressionMatch(), createProgressionMatch()]
    };
  }

  return {
    bracketSize,
    rounds,
    losersRounds: [],
    grandFinals: []
  };
}

function createWinnersRounds(playerCount, bracketSize) {
  const roundCount = Math.log2(bracketSize);
  const rounds = [];
  const seedOrder = buildSeedOrder(bracketSize);

  const firstRound = [];
  for (let matchIndex = 0; matchIndex < bracketSize / 2; matchIndex += 1) {
    const seedA = seedOrder[matchIndex * 2];
    const seedB = seedOrder[matchIndex * 2 + 1];
    const lockedA = seedA > playerCount;
    const lockedB = seedB > playerCount;

    firstRound.push({
      players: ["", ""],
      winnerIndex: null,
      confirmations: {},
      seeds: [seedA, seedB],
      locked: [lockedA, lockedB],
      slotReady: [lockedA, lockedB]
    });
  }

  rounds.push(firstRound);

  for (let roundIndex = 1; roundIndex < roundCount; roundIndex += 1) {
    const matchCount = bracketSize / Math.pow(2, roundIndex + 1);
    const round = [];

    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      round.push(createProgressionMatch());
    }

    rounds.push(round);
  }

  return rounds;
}

function createLosersRounds(bracketSize) {
  const winnerRoundCount = Math.log2(bracketSize);
  const losersRoundCount = Math.max(0, (winnerRoundCount * 2) - 2);
  const rounds = [];

  for (let roundIndex = 0; roundIndex < losersRoundCount; roundIndex += 1) {
    const matchCount = bracketSize / Math.pow(2, Math.floor(roundIndex / 2) + 2);
    const round = [];

    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      round.push(createProgressionMatch());
    }

    rounds.push(round);
  }

  return rounds;
}

function createProgressionMatch() {
  return {
    players: ["", ""],
    winnerIndex: null,
    confirmations: {},
    seeds: [null, null],
    locked: [false, false],
    slotReady: [false, false]
  };
}

function handleBracketChange(event) {
  const input = event.target.closest(".name-input");
  if (!input) {
    return;
  }

  const stage = input.dataset.stage;
  const roundIndex = Number(input.dataset.round);
  const matchIndex = Number(input.dataset.match);
  const slotIndex = Number(input.dataset.slot);

  if (stage !== "winners" || roundIndex !== 0) {
    return;
  }

  const match = getMatch(stage, roundIndex, matchIndex);
  if (!match || match.locked?.[slotIndex]) {
    return;
  }

  match.players[slotIndex] = normalizeName(input.value);
  if (!match.players[slotIndex] && match.winnerIndex === slotIndex) {
    match.winnerIndex = null;
  }
  clearMatchConfirmations(match);

  notice = "Player name updated.";
  recalculateBracket();
  persistState();
  render();
}

function handleBracketClick(event) {
  const button = event.target.closest(".win-btn");
  if (!button) {
    return;
  }

  if (!state.tournamentStarted) {
    notice = "Start the tournament from lobby before recording wins.";
    renderMeta();
    return;
  }

  const stage = button.dataset.stage;
  const roundIndex = Number(button.dataset.round);
  const matchIndex = Number(button.dataset.match);
  const slotIndex = Number(button.dataset.slot);

  const match = getMatch(stage, roundIndex, matchIndex);
  if (!match || !match.players[slotIndex]) {
    return;
  }

  const actor = currentMatchSelectionActor();

  if (cloudEnabled && cloudRef) {
    submitMatchSelectionViaCloud(stage, roundIndex, matchIndex, slotIndex, actor);
    return;
  }

  const result = applyMatchSelectionToState(state, stage, roundIndex, matchIndex, slotIndex, actor);
  if (!result.ok) {
    notice = matchSelectionFailureMessage(result.reason);
    renderMeta();
    return;
  }

  notice = result.message;

  if (result.changed) {
    persistState();
    render();
    return;
  }

  renderMeta();
}

function currentMatchSelectionActor() {
  if (isAdminUnlocked) {
    return { type: "admin", name: "" };
  }

  return { type: "player", name: normalizeName(localJoinedName) };
}

function submitMatchSelectionViaCloud(stage, roundIndex, matchIndex, slotIndex, actor) {
  if (!cloudRef) {
    notice = "Cloud connection not ready yet.";
    renderMeta();
    return;
  }

  let pendingResult = { ok: false, changed: false, reason: "unknown", message: "" };

  cloudRef.transaction((currentValue) => {
    const currentPayload = currentValue && typeof currentValue === "object"
      ? { ...currentValue }
      : {};
    const baselineState = coerceStateObject(currentPayload.state) || coerceStateObject(state) || createDefaultState();

    pendingResult = applyMatchSelectionToState(
      baselineState,
      stage,
      roundIndex,
      matchIndex,
      slotIndex,
      actor
    );

    if (!pendingResult.ok || !pendingResult.changed) {
      return;
    }

    currentPayload.schemaVersion = CLOUD_SCHEMA_VERSION;
    currentPayload.updatedAt = Date.now();
    currentPayload.updatedBy = deviceId;
    currentPayload.state = cloneStateForCloud(baselineState);
    return currentPayload;
  }, (error, committed) => {
    if (error) {
      notice = "Unable to record result right now.";
      renderMeta();
      return;
    }

    if (!pendingResult.ok) {
      notice = matchSelectionFailureMessage(pendingResult.reason);
      renderMeta();
      return;
    }

    notice = pendingResult.message;

    if (!pendingResult.changed || !committed) {
      renderMeta();
      return;
    }

    renderMeta();
  }, false);
}

function applyMatchSelectionToState(targetState, stage, roundIndex, matchIndex, slotIndex, actor) {
  if (!targetState.tournamentStarted) {
    return {
      ok: false,
      changed: false,
      reason: "not_started",
      message: ""
    };
  }

  if (slotIndex !== 0 && slotIndex !== 1) {
    return {
      ok: false,
      changed: false,
      reason: "invalid_slot",
      message: ""
    };
  }

  const match = getMatchFromState(targetState, stage, roundIndex, matchIndex);
  if (!match) {
    return {
      ok: false,
      changed: false,
      reason: "invalid_match",
      message: ""
    };
  }

  const slotName = normalizeName(match.players?.[slotIndex]);
  const otherName = normalizeName(match.players?.[1 - slotIndex]);
  if (!slotName || !otherName) {
    return {
      ok: false,
      changed: false,
      reason: "incomplete",
      message: ""
    };
  }

  if (actor.type === "admin") {
    const alreadySet = match.winnerIndex === slotIndex;
    match.winnerIndex = slotIndex;
    clearMatchConfirmations(match);
    recalculateStateObject(targetState);
    return {
      ok: true,
      changed: !alreadySet,
      reason: "",
      message: `Admin set winner: ${slotName}.`
    };
  }

  const actorName = normalizeName(actor.name);
  if (!actorName) {
    return {
      ok: false,
      changed: false,
      reason: "join_required",
      message: ""
    };
  }

  const playerSlot = localPlayerSlotInMatch(match, actorName);
  if (playerSlot < 0) {
    return {
      ok: false,
      changed: false,
      reason: "not_participant",
      message: ""
    };
  }

  if (match.winnerIndex !== null) {
    return {
      ok: false,
      changed: false,
      reason: "already_decided",
      message: ""
    };
  }

  normalizeMatchConfirmations(match);
  const confirmations = ensureMatchConfirmations(match);
  const actorKey = normalizeName(actorName).toLowerCase();
  const priorVote = confirmations[actorKey];
  confirmations[actorKey] = slotIndex;
  normalizeMatchConfirmations(match);

  const outcome = confirmationOutcome(match);
  if (outcome.state === "agreed") {
    match.winnerIndex = outcome.slotIndex;
    clearMatchConfirmations(match);
    recalculateStateObject(targetState);
    return {
      ok: true,
      changed: true,
      reason: "",
      message: `Winner confirmed: ${match.players[outcome.slotIndex]}.`
    };
  }

  if (outcome.state === "conflict") {
    return {
      ok: true,
      changed: priorVote !== slotIndex || Object.keys(confirmations).length >= 2,
      reason: "",
      message: "Conflicting confirmations. Both players must agree or an admin can set the winner."
    };
  }

  return {
    ok: true,
    changed: priorVote !== slotIndex,
    reason: "",
    message: outcome.waitingFor
      ? `Result recorded. Waiting for ${outcome.waitingFor} to confirm.`
      : "Result recorded."
  };
}

function matchSelectionFailureMessage(reason) {
  if (reason === "join_required") {
    return "Join the lobby first to report match results.";
  }

  if (reason === "not_participant") {
    return "Only players in this matchup can confirm the result.";
  }

  if (reason === "already_decided") {
    return "Match result already finalized.";
  }

  if (reason === "not_started") {
    return "Tournament has not started.";
  }

  if (reason === "incomplete") {
    return "Both players must be set before reporting a result.";
  }

  return "Unable to record this result.";
}

function getMatchFromState(targetState, stage, roundIndex, matchIndex) {
  if (stage === "winners") {
    return targetState.rounds?.[roundIndex]?.[matchIndex] || null;
  }

  if (stage === "losers") {
    return targetState.losersRounds?.[roundIndex]?.[matchIndex] || null;
  }

  if (stage === "grand") {
    const grandRound = targetState.grandFinals?.[roundIndex];
    if (Array.isArray(grandRound)) {
      return grandRound[matchIndex] || null;
    }
    return grandRound || null;
  }

  return null;
}

function recalculateStateObject(targetState) {
  const currentState = state;
  state = targetState;
  try {
    recalculateBracket();
  } finally {
    state = currentState;
  }
}

function ensureMatchConfirmations(match) {
  if (!match || typeof match !== "object") {
    return {};
  }

  if (!match.confirmations || typeof match.confirmations !== "object" || Array.isArray(match.confirmations)) {
    match.confirmations = {};
  }

  return match.confirmations;
}

function clearMatchConfirmations(match) {
  if (!match || typeof match !== "object") {
    return;
  }
  match.confirmations = {};
}

function normalizeMatchConfirmations(match) {
  const confirmations = ensureMatchConfirmations(match);
  const allowedKeys = new Set();

  const nameA = normalizeName(match.players?.[0]);
  const nameB = normalizeName(match.players?.[1]);
  if (nameA) {
    allowedKeys.add(nameA.toLowerCase());
  }
  if (nameB) {
    allowedKeys.add(nameB.toLowerCase());
  }

  const cleaned = {};
  for (const [key, selectedSlot] of Object.entries(confirmations)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    if (selectedSlot !== 0 && selectedSlot !== 1) {
      continue;
    }
    cleaned[key] = selectedSlot;
  }

  match.confirmations = cleaned;
}

function confirmationOutcome(match) {
  normalizeMatchConfirmations(match);
  const confirmations = ensureMatchConfirmations(match);
  const nameA = normalizeName(match.players?.[0]);
  const nameB = normalizeName(match.players?.[1]);
  const keyA = nameA ? nameA.toLowerCase() : "";
  const keyB = nameB ? nameB.toLowerCase() : "";
  const voteA = keyA ? confirmations[keyA] : null;
  const voteB = keyB ? confirmations[keyB] : null;
  const hasVoteA = voteA === 0 || voteA === 1;
  const hasVoteB = voteB === 0 || voteB === 1;

  if (hasVoteA && hasVoteB) {
    if (voteA === voteB) {
      return { state: "agreed", slotIndex: voteA };
    }
    return { state: "conflict", slotIndex: null, waitingFor: "" };
  }

  if (hasVoteA || hasVoteB) {
    return {
      state: "pending",
      slotIndex: null,
      waitingFor: hasVoteA ? nameB : nameA
    };
  }

  return { state: "none", slotIndex: null, waitingFor: "" };
}

function localPlayerSlotInMatch(match, playerName) {
  const target = normalizeName(playerName).toLowerCase();
  if (!target) {
    return -1;
  }

  const slotA = normalizeName(match.players?.[0]).toLowerCase();
  const slotB = normalizeName(match.players?.[1]).toLowerCase();
  if (slotA === target) {
    return 0;
  }
  if (slotB === target) {
    return 1;
  }
  return -1;
}

function canLocalPlayerVoteMatch(match) {
  if (!state.tournamentStarted || !match || match.winnerIndex !== null) {
    return false;
  }

  const hasTwoPlayers = Boolean(
    normalizeName(match.players?.[0]) &&
    normalizeName(match.players?.[1])
  );

  if (!hasTwoPlayers) {
    return false;
  }

  return localPlayerSlotInMatch(match, localJoinedName) >= 0;
}

function localPlayerVoteForMatch(match) {
  const name = normalizeName(localJoinedName);
  if (!name) {
    return null;
  }

  normalizeMatchConfirmations(match);
  const vote = ensureMatchConfirmations(match)[name.toLowerCase()];
  return vote === 0 || vote === 1 ? vote : null;
}

function getMatch(stage, roundIndex, matchIndex) {
  if (stage === "winners") {
    return state.rounds?.[roundIndex]?.[matchIndex] || null;
  }

  if (stage === "losers") {
    return state.losersRounds?.[roundIndex]?.[matchIndex] || null;
  }

  if (stage === "grand") {
    const grandRound = state.grandFinals?.[roundIndex];
    if (Array.isArray(grandRound)) {
      return grandRound[matchIndex] || null;
    }
    return grandRound || null;
  }

  return null;
}

function recalculateBracket() {
  if (!Array.isArray(state.rounds) || state.rounds.length === 0) {
    return;
  }

  recalculateWinnersRounds();

  if (state.eliminationMode === "double") {
    recalculateLosersAndFinals();
  } else {
    state.losersRounds = [];
    state.grandFinals = [];
  }
}

function recalculateWinnersRounds() {
  for (const match of state.rounds[0]) {
    sanitizeMatch(match, true);
    applyAutoAdvance(match, true);
  }

  for (let roundIndex = 1; roundIndex < state.rounds.length; roundIndex += 1) {
    const previous = state.rounds[roundIndex - 1];
    const round = state.rounds[roundIndex];

    for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
      if (!round[matchIndex] || typeof round[matchIndex] !== "object") {
        round[matchIndex] = createProgressionMatch();
      }

      const match = round[matchIndex];
      const feedA = winnerFeed(previous[matchIndex * 2]);
      const feedB = winnerFeed(previous[matchIndex * 2 + 1]);

      applyMatchFromFeeds(match, feedA, feedB);
      sanitizeMatch(match, false);
      applyAutoAdvance(match, false);
    }
  }
}

function recalculateLosersAndFinals() {
  const expectedLoserRounds = createLosersRounds(state.bracketSize);
  if (!Array.isArray(state.losersRounds) || state.losersRounds.length !== expectedLoserRounds.length) {
    state.losersRounds = expectedLoserRounds;
  }

  if (!Array.isArray(state.grandFinals) || state.grandFinals.length !== 2) {
    state.grandFinals = [createProgressionMatch(), createProgressionMatch()];
  }

  for (let loserRoundIndex = 0; loserRoundIndex < state.losersRounds.length; loserRoundIndex += 1) {
    const loserRound = state.losersRounds[loserRoundIndex];

    for (let matchIndex = 0; matchIndex < loserRound.length; matchIndex += 1) {
      if (!loserRound[matchIndex] || typeof loserRound[matchIndex] !== "object") {
        loserRound[matchIndex] = createProgressionMatch();
      }

      const match = loserRound[matchIndex];
      let feedA = { name: "", ready: false };
      let feedB = { name: "", ready: false };

      if (loserRoundIndex === 0) {
        feedA = loserFeed(state.rounds[0][matchIndex * 2]);
        feedB = loserFeed(state.rounds[0][matchIndex * 2 + 1]);
      } else if (loserRoundIndex % 2 === 1) {
        const winnerRoundIndex = (loserRoundIndex + 1) / 2;
        feedA = winnerFeed(state.losersRounds[loserRoundIndex - 1][matchIndex]);
        feedB = loserFeed(state.rounds[winnerRoundIndex][matchIndex]);
      } else {
        feedA = winnerFeed(state.losersRounds[loserRoundIndex - 1][matchIndex * 2]);
        feedB = winnerFeed(state.losersRounds[loserRoundIndex - 1][matchIndex * 2 + 1]);
      }

      applyMatchFromFeeds(match, feedA, feedB);
      sanitizeMatch(match, false);
      applyAutoAdvance(match, false);
    }
  }

  const winnersFinal = state.rounds[state.rounds.length - 1][0];
  const losersChampionFeed = state.losersRounds.length
    ? winnerFeed(state.losersRounds[state.losersRounds.length - 1][0])
    : loserFeed(winnersFinal);

  const grandFinalOne = state.grandFinals[0];
  const grandFinalTwo = state.grandFinals[1];

  applyMatchFromFeeds(grandFinalOne, winnerFeed(winnersFinal), losersChampionFeed);
  sanitizeMatch(grandFinalOne, false);
  applyAutoAdvance(grandFinalOne, false);

  if (shouldShowResetFinal(grandFinalOne)) {
    applyMatchFromFeeds(
      grandFinalTwo,
      { name: grandFinalOne.players[0], ready: true },
      { name: grandFinalOne.players[1], ready: true }
    );
    sanitizeMatch(grandFinalTwo, false);
    applyAutoAdvance(grandFinalTwo, false);
  } else {
    Object.assign(grandFinalTwo, createProgressionMatch());
  }
}

function applyMatchFromFeeds(match, feedA, feedB) {
  const nextPlayers = [feedA.name, feedB.name];
  const nextReady = [feedA.ready, feedB.ready];

  const playersChanged = match.players?.[0] !== nextPlayers[0] || match.players?.[1] !== nextPlayers[1];
  const readyChanged = match.slotReady?.[0] !== nextReady[0] || match.slotReady?.[1] !== nextReady[1];

  if (playersChanged || readyChanged) {
    match.players = nextPlayers;
    match.slotReady = nextReady;
    match.winnerIndex = null;
    clearMatchConfirmations(match);
  } else {
    match.slotReady = nextReady;
    normalizeMatchConfirmations(match);
  }

  match.seeds = [null, null];
  match.locked = [false, false];
}

function sanitizeMatch(match, isFirstRound) {
  if (!Array.isArray(match.players) || match.players.length !== 2) {
    match.players = ["", ""];
  }

  if (!Array.isArray(match.seeds) || match.seeds.length !== 2) {
    match.seeds = [null, null];
  }

  if (!Array.isArray(match.locked) || match.locked.length !== 2) {
    match.locked = [false, false];
  }

  if (!Array.isArray(match.slotReady) || match.slotReady.length !== 2) {
    match.slotReady = [false, false];
  }

  for (let slotIndex = 0; slotIndex < 2; slotIndex += 1) {
    const lockedSlot = isFirstRound && Boolean(match.locked[slotIndex]);

    if (lockedSlot) {
      match.players[slotIndex] = "";
      match.slotReady[slotIndex] = true;
      continue;
    }

    match.players[slotIndex] = normalizeName(match.players[slotIndex]);

    if (isFirstRound) {
      match.slotReady[slotIndex] = Boolean(match.players[slotIndex]);
      continue;
    }

    if (typeof match.slotReady[slotIndex] !== "boolean") {
      match.slotReady[slotIndex] = Boolean(match.players[slotIndex]);
      continue;
    }

    if (match.players[slotIndex]) {
      match.slotReady[slotIndex] = true;
    }
  }

  normalizeMatchConfirmations(match);

  const hasTwoNamedPlayers = Boolean(match.players[0] && match.players[1]);
  if (!hasTwoNamedPlayers) {
    clearMatchConfirmations(match);
  }

  if (match.winnerIndex !== 0 && match.winnerIndex !== 1) {
    match.winnerIndex = null;
  }

  if (
    match.winnerIndex !== null &&
    (!match.slotReady[match.winnerIndex] || !match.players[match.winnerIndex])
  ) {
    match.winnerIndex = null;
  }

  if (match.winnerIndex !== null) {
    clearMatchConfirmations(match);
  }
}

function applyAutoAdvance(match, isFirstRound) {
  const [a, b] = match.players;
  const readyA = Boolean(match.slotReady[0]);
  const readyB = Boolean(match.slotReady[1]);
  const byeA = isFirstRound && Boolean(match.locked?.[0]);
  const byeB = isFirstRound && Boolean(match.locked?.[1]);

  if (byeA && readyB && b) {
    match.winnerIndex = 1;
    clearMatchConfirmations(match);
    return;
  }

  if (byeB && readyA && a) {
    match.winnerIndex = 0;
    clearMatchConfirmations(match);
    return;
  }

  if (!readyA || !readyB) {
    if (!a || !b) {
      match.winnerIndex = null;
      clearMatchConfirmations(match);
    }
    return;
  }

  if (a && !b) {
    match.winnerIndex = 0;
    clearMatchConfirmations(match);
    return;
  }

  if (!a && b) {
    match.winnerIndex = 1;
    clearMatchConfirmations(match);
    return;
  }

  if (!a && !b) {
    match.winnerIndex = null;
    clearMatchConfirmations(match);
  }
}

function winnerFeed(match) {
  if (!match || match.winnerIndex === null) {
    return { name: "", ready: false };
  }

  return {
    name: match.players[match.winnerIndex] || "",
    ready: true
  };
}

function loserFeed(match) {
  if (!match || match.winnerIndex === null) {
    return { name: "", ready: false };
  }

  const loserIndex = match.winnerIndex === 0 ? 1 : 0;
  return {
    name: match.players[loserIndex] || "",
    ready: true
  };
}

function render() {
  reconcileLocalJoinedName();
  const phase = currentUiPhase();
  renderPhaseVisibility(phase);
  syncLobbyTextFromState();
  renderJoinDialog();
  renderLobbyStatus();
  renderMeta();

  if (phase === UI_PHASE_BRACKET) {
    renderBracket();
    renderChampion();
  }

  refreshAdminControls();
}

function reconcileLocalJoinedName() {
  if (!localJoinedName) {
    return;
  }

  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  if (findLobbyIndexByName(lobbyPlayers, localJoinedName) < 0) {
    saveJoinedLobbyName("");
  }
}

function currentUiPhase() {
  if (!isLocalPlayerInLobby()) {
    return UI_PHASE_JOIN;
  }

  if (!state.tournamentStarted) {
    return UI_PHASE_LOBBY;
  }

  return UI_PHASE_BRACKET;
}

function isLocalPlayerInLobby() {
  if (!localJoinedName) {
    return false;
  }

  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers);
  return findLobbyIndexByName(lobbyPlayers, localJoinedName) >= 0;
}

function renderPhaseVisibility(phase) {
  els.joinScreen.classList.toggle("hidden", phase !== UI_PHASE_JOIN);
  els.toolbar.classList.toggle("hidden", phase === UI_PHASE_JOIN);
  els.lobbyPanel.classList.toggle("hidden", phase !== UI_PHASE_LOBBY);
  els.bracketShell.classList.toggle("hidden", phase !== UI_PHASE_BRACKET);
}

function renderMeta() {
  const joinedCount = normalizedLobbyPlayers(state.lobbyPlayers).length;

  if (!state.rounds.length) {
    const formatLabel = state.eliminationMode === "double" ? "Double" : "Single";
    const summary = `Lobby | ${joinedCount} joined | ${formatLabel} elimination`;
    const note = notice ? ` | ${notice}` : "";
    els.meta.textContent = `${summary}${note}`;
    return;
  }

  const byes = Math.max(state.bracketSize - state.playerCount, 0);
  const formatLabel = state.eliminationMode === "double" ? "Double" : "Single";
  const phaseLabel = state.tournamentStarted ? "In Progress" : "Lobby";
  const unresolved = countUnresolvedMatches();
  const summary = `${phaseLabel} | ${state.playerCount} players | ${formatLabel} elimination | ${state.bracketSize}-slot bracket | ${byes} bye${byes === 1 ? "" : "s"} | ${state.rounds.length} winner rounds | ${unresolved} undecided matches`;
  const note = notice ? ` | ${notice}` : "";
  els.meta.textContent = `${summary}${note}`;
}

function renderBracket() {
  const hasBracket = state.rounds.length > 0;
  const mobileView = isMobileView();
  wasMobileView = mobileView;

  els.empty.classList.toggle("hidden", hasBracket);
  els.bracketViewport.classList.toggle("hidden", !hasBracket || mobileView);
  els.mobileBracket.classList.toggle("hidden", !hasBracket || !mobileView);

  els.leftSide.replaceChildren();
  els.rightSide.replaceChildren();
  els.finalSide.replaceChildren();
  els.losersSide.replaceChildren();
  els.mobileBracket.replaceChildren();

  if (!hasBracket) {
    els.bracketCanvas.style.width = "100%";
    els.bracketCanvas.style.height = "100%";
    els.bracket.style.transform = "none";
    els.bracket.style.width = "max-content";
    els.bracket.style.height = "auto";
    return;
  }

  if (mobileView) {
    renderMobilePlayerView();
    return;
  }

  syncBracketDensity();

  if (state.eliminationMode === "double") {
    renderDoubleEliminationLayout();
  } else {
    renderSingleEliminationLayout();
  }

  scheduleBracketFit();
}

function renderMobilePlayerView() {
  const panel = document.createElement("section");
  panel.className = "mobile-player-panel";

  const heading = document.createElement("h3");
  heading.className = "mobile-player-title";
  heading.textContent = "Your Match";
  panel.appendChild(heading);

  const playerName = normalizeName(localJoinedName);
  if (!playerName) {
    panel.appendChild(buildMobilePlayerNote("Join the lobby to see your matchup.", "warn"));
    els.mobileBracket.appendChild(panel);
    return;
  }

  const timeline = buildMatchTimeline();
  const upcoming = findUpcomingMatchForPlayer(playerName, timeline);

  if (!upcoming) {
    const champion = normalizeName(
      state.eliminationMode === "double"
        ? doubleEliminationChampion()
        : winnerName(state.rounds[state.rounds.length - 1]?.[0])
    );
    if (champion && champion.toLowerCase() === playerName.toLowerCase()) {
      panel.appendChild(buildMobilePlayerNote("You won the tournament.", "good"));
    } else if (isPlayerEliminated(playerName, timeline)) {
      panel.appendChild(buildMobilePlayerNote("You are eliminated.", "warn"));
    } else {
      panel.appendChild(buildMobilePlayerNote("No matchup assigned yet.", ""));
    }
    els.mobileBracket.appendChild(panel);
    return;
  }

  const playable = isMatchPlayable(upcoming.match);
  const gamesAhead = countPlayableMatchesAhead(timeline, upcoming);
  const queueLabel = document.createElement("p");
  queueLabel.className = "mobile-player-queue";
  queueLabel.textContent = playable
    ? (gamesAhead === 0 ? "You are up next." : `${gamesAhead} game${gamesAhead === 1 ? "" : "s"} ahead of yours.`)
    : `${gamesAhead} game${gamesAhead === 1 ? "" : "s"} currently ahead of your next matchup.`;
  panel.appendChild(queueLabel);

  const typeLabel = document.createElement("p");
  typeLabel.className = "mobile-player-type";
  typeLabel.textContent = playable ? "Current matchup" : "Next matchup";
  panel.appendChild(typeLabel);

  panel.appendChild(
    renderMatch(
      upcoming.stage,
      upcoming.roundIndex,
      upcoming.matchIndex,
      timelineMatchLabel(upcoming),
      false
    )
  );

  els.mobileBracket.appendChild(panel);
}

function buildMobilePlayerNote(text, mode) {
  const note = document.createElement("p");
  note.className = "mobile-player-note";
  if (mode) {
    note.classList.add(mode);
  }
  note.textContent = text;
  return note;
}

function buildMatchTimeline() {
  const timeline = [];
  let order = 0;

  for (let roundIndex = 0; roundIndex < state.rounds.length; roundIndex += 1) {
    const round = state.rounds[roundIndex] || [];
    for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
      timeline.push({
        stage: "winners",
        roundIndex,
        matchIndex,
        match: round[matchIndex],
        order: order++
      });
    }
  }

  if (state.eliminationMode === "double") {
    for (let roundIndex = 0; roundIndex < state.losersRounds.length; roundIndex += 1) {
      const round = state.losersRounds[roundIndex] || [];
      for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
        timeline.push({
          stage: "losers",
          roundIndex,
          matchIndex,
          match: round[matchIndex],
          order: order++
        });
      }
    }

    const grandFinalOne = state.grandFinals?.[0];
    if (grandFinalOne) {
      timeline.push({
        stage: "grand",
        roundIndex: 0,
        matchIndex: 0,
        match: grandFinalOne,
        order: order++
      });
    }

    const grandFinalTwo = state.grandFinals?.[1];
    if (grandFinalTwo && (shouldShowResetFinal(grandFinalOne) || hasAnyPlayer(grandFinalTwo))) {
      timeline.push({
        stage: "grand",
        roundIndex: 1,
        matchIndex: 0,
        match: grandFinalTwo,
        order: order++
      });
    }
  }

  return timeline;
}

function hasAnyPlayer(match) {
  if (!match || !Array.isArray(match.players)) {
    return false;
  }

  return Boolean(normalizeName(match.players[0]) || normalizeName(match.players[1]));
}

function findUpcomingMatchForPlayer(playerName, timeline) {
  const target = normalizeName(playerName).toLowerCase();
  if (!target) {
    return null;
  }

  return timeline.find((entry) => {
    if (!entry.match || entry.match.winnerIndex !== null) {
      return false;
    }
    const a = normalizeName(entry.match.players?.[0]).toLowerCase();
    const b = normalizeName(entry.match.players?.[1]).toLowerCase();
    return a === target || b === target;
  }) || null;
}

function isMatchPlayable(match) {
  if (!match || match.winnerIndex !== null) {
    return false;
  }
  return Boolean(normalizeName(match.players?.[0]) && normalizeName(match.players?.[1]));
}

function countPlayableMatchesAhead(timeline, targetEntry) {
  return timeline.filter((entry) => (
    entry.order < targetEntry.order &&
    isMatchPlayable(entry.match)
  )).length;
}

function timelineMatchLabel(entry) {
  if (entry.stage === "winners") {
    return `${winnersRoundLabel(entry.roundIndex)} ${entry.matchIndex + 1}`;
  }

  if (entry.stage === "losers") {
    return `${losersRoundLabel(entry.roundIndex)} ${entry.matchIndex + 1}`;
  }

  if (entry.roundIndex === 1) {
    return "Grand Final Reset";
  }

  return "Grand Final";
}

function isPlayerEliminated(playerName, timeline) {
  const target = normalizeName(playerName).toLowerCase();
  if (!target) {
    return false;
  }

  let losses = 0;
  for (const entry of timeline) {
    const match = entry.match;
    if (!match || (match.winnerIndex !== 0 && match.winnerIndex !== 1)) {
      continue;
    }
    const winner = normalizeName(match.players?.[match.winnerIndex]).toLowerCase();
    const loserIndex = match.winnerIndex === 0 ? 1 : 0;
    const loser = normalizeName(match.players?.[loserIndex]).toLowerCase();
    if (loser === target && winner !== target) {
      losses += 1;
    }
  }

  return losses >= (state.eliminationMode === "double" ? 2 : 1);
}

function renderSingleEliminationLayout() {
  els.losersSide.classList.add("hidden");

  const totalRounds = state.rounds.length;
  const finalRoundIndex = totalRounds - 1;

  if (totalRounds === 1) {
    const title = document.createElement("h3");
    title.className = "final-title";
    title.textContent = "Final";

    els.finalSide.appendChild(title);
    els.finalSide.appendChild(renderMatch("winners", 0, 0, "Final", false));
    return;
  }

  for (let roundIndex = 0; roundIndex < finalRoundIndex; roundIndex += 1) {
    els.leftSide.appendChild(buildWinnersRoundColumn(roundIndex, "left"));
  }

  for (let roundIndex = finalRoundIndex - 1; roundIndex >= 0; roundIndex -= 1) {
    els.rightSide.appendChild(buildWinnersRoundColumn(roundIndex, "right"));
  }

  const finalTitle = document.createElement("h3");
  finalTitle.className = "final-title";
  finalTitle.textContent = "Final";
  els.finalSide.appendChild(finalTitle);
  els.finalSide.appendChild(renderMatch("winners", finalRoundIndex, 0, "Championship", false));
}

function renderDoubleEliminationLayout() {
  els.losersSide.classList.remove("hidden");

  const winnerRounds = state.rounds;
  const totalWinnerRounds = winnerRounds.length;
  const winnersFinalIndex = totalWinnerRounds - 1;

  if (totalWinnerRounds === 1) {
    const title = document.createElement("h3");
    title.className = "final-title";
    title.textContent = "Winners Final";
    els.finalSide.appendChild(title);
    els.finalSide.appendChild(renderMatch("winners", 0, 0, "Winners Final", false));
  } else {
    for (let roundIndex = 0; roundIndex < winnersFinalIndex; roundIndex += 1) {
      els.leftSide.appendChild(buildWinnersRoundColumn(roundIndex, "left"));
    }

    for (let roundIndex = winnersFinalIndex - 1; roundIndex >= 0; roundIndex -= 1) {
      els.rightSide.appendChild(buildWinnersRoundColumn(roundIndex, "right"));
    }

    const winnersFinalTitle = document.createElement("h3");
    winnersFinalTitle.className = "final-title";
    winnersFinalTitle.textContent = "Winners Final";
    els.finalSide.appendChild(winnersFinalTitle);
    els.finalSide.appendChild(renderMatch("winners", winnersFinalIndex, 0, "Winners Final", false));
  }

  const grandFinalTitle = document.createElement("h3");
  grandFinalTitle.className = "final-title";
  grandFinalTitle.textContent = "Grand Final";
  els.finalSide.appendChild(grandFinalTitle);
  els.finalSide.appendChild(renderMatch("grand", 0, 0, "Grand Final", false));

  if (shouldShowResetFinal(state.grandFinals[0])) {
    const resetTitle = document.createElement("h3");
    resetTitle.className = "final-title";
    resetTitle.textContent = "Grand Final Reset";
    els.finalSide.appendChild(resetTitle);
    els.finalSide.appendChild(renderMatch("grand", 1, 0, "Reset Final", false));
  }

  if (state.losersRounds.length === 0) {
    const note = document.createElement("p");
    note.className = "losers-note";
    note.textContent = "Losers finalist comes from the winners final loser.";
    els.losersSide.appendChild(note);
    return;
  }

  for (let roundIndex = 0; roundIndex < state.losersRounds.length; roundIndex += 1) {
    els.losersSide.appendChild(buildLosersRoundColumn(roundIndex));
  }
}

function buildWinnersRoundColumn(roundIndex, side) {
  const roundNode = document.createElement("section");
  roundNode.className = "round";

  const heading = document.createElement("h3");
  heading.textContent = winnersRoundLabel(roundIndex);
  roundNode.appendChild(heading);

  const matches = state.rounds[roundIndex];
  const halfway = matches.length / 2;

  let start = 0;
  let end = halfway;
  if (side === "right") {
    start = halfway;
    end = matches.length;
  }

  for (let matchIndex = start; matchIndex < end; matchIndex += 1) {
    const title = `${winnersRoundLabel(roundIndex)} ${matchIndex - start + 1}`;
    const editableNames = false;
    roundNode.appendChild(renderMatch("winners", roundIndex, matchIndex, title, editableNames));
  }

  return roundNode;
}

function buildLosersRoundColumn(roundIndex) {
  const roundNode = document.createElement("section");
  roundNode.className = "round losers-round";

  const heading = document.createElement("h3");
  heading.textContent = losersRoundLabel(roundIndex);
  roundNode.appendChild(heading);

  const matches = state.losersRounds[roundIndex];
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const title = `${losersRoundLabel(roundIndex)} ${matchIndex + 1}`;
    roundNode.appendChild(renderMatch("losers", roundIndex, matchIndex, title, false));
  }

  return roundNode;
}

function renderMatch(stage, roundIndex, matchIndex, title, editableNames) {
  const match = getMatch(stage, roundIndex, matchIndex);
  const node = els.matchTemplate.content.firstElementChild.cloneNode(true);

  if (!match) {
    return node;
  }

  const head = node.querySelector(".match-head");
  head.textContent = title;

  const isEntryRound = stage === "winners" && roundIndex === 0;
  const localPlayerVote = localPlayerVoteForMatch(match);
  const localCanVote = canLocalPlayerVoteMatch(match);
  const rows = Array.from(node.querySelectorAll(".competitor"));

  for (let slotIndex = 0; slotIndex < 2; slotIndex += 1) {
    const row = rows[slotIndex];
    const slotName = match.players[slotIndex] || "";
    const otherName = match.players[1 - slotIndex] || "";
    const slotReady = Boolean(match.slotReady?.[slotIndex]);
    const slotSeed = normalizeSeed(match.seeds?.[slotIndex]);
    const slotLocked = isEntryRound && Boolean(match.locked?.[slotIndex]);
    const isWinner = match.winnerIndex === slotIndex;

    const winBtn = row.querySelector(".win-btn");
    winBtn.dataset.stage = stage;
    winBtn.dataset.round = String(roundIndex);
    winBtn.dataset.match = String(matchIndex);
    winBtn.dataset.slot = String(slotIndex);
    const canAdminSet = isAdminUnlocked && state.tournamentStarted && Boolean(slotName && otherName);
    const canPlayerConfirm = !isAdminUnlocked && localCanVote;
    winBtn.disabled = !(canAdminSet || canPlayerConfirm);

    if (isWinner) {
      winBtn.textContent = "Won";
    } else if (canAdminSet) {
      winBtn.textContent = "Set Win";
    } else if (canPlayerConfirm) {
      winBtn.textContent = localPlayerVote === slotIndex ? "Voted" : "Confirm";
    } else {
      winBtn.textContent = "Win";
    }

    const seedTag = row.querySelector(".seed-tag");
    if (isEntryRound && slotSeed !== null) {
      seedTag.classList.remove("hidden");
      seedTag.textContent = `#${slotSeed}`;
    } else {
      seedTag.classList.add("hidden");
      seedTag.textContent = "";
    }

    const input = row.querySelector(".name-input");
    const label = row.querySelector(".name-label");

    if (editableNames && !slotLocked && stage === "winners") {
      input.classList.remove("hidden");
      label.classList.add("hidden");
      input.disabled = false;
      input.dataset.stage = stage;
      input.dataset.round = String(roundIndex);
      input.dataset.match = String(matchIndex);
      input.dataset.slot = String(slotIndex);
      input.placeholder = slotSeed !== null ? `Seed ${slotSeed} name` : "Enter name";
      input.value = slotName;
    } else {
      input.classList.add("hidden");
      input.disabled = true;
      input.value = "";
      label.classList.remove("hidden");
      if (slotLocked) {
        label.textContent = "BYE";
      } else if (slotName) {
        label.textContent = slotName;
      } else {
        label.textContent = slotReady ? "BYE" : "TBD";
      }
    }

    row.classList.toggle("winner", isWinner);
    row.classList.toggle("empty", !slotName && !isWinner);
  }

  const status = node.querySelector(".status");
  status.textContent = matchStatus(match, isEntryRound);

  return node;
}

function renderChampion() {
  let championName = "";

  if (state.eliminationMode === "double") {
    championName = doubleEliminationChampion();
  } else {
    championName = winnerName(state.rounds[state.rounds.length - 1][0]);
  }

  if (!championName) {
    els.champion.classList.add("hidden");
    els.champion.textContent = "";
    return;
  }

  els.champion.classList.remove("hidden");
  els.champion.textContent = `Champion: ${championName}`;
}

function doubleEliminationChampion() {
  if (!Array.isArray(state.grandFinals) || state.grandFinals.length < 2) {
    return "";
  }

  const grandFinalOne = state.grandFinals[0];
  const grandFinalTwo = state.grandFinals[1];

  if (shouldShowResetFinal(grandFinalOne)) {
    return winnerName(grandFinalTwo);
  }

  return winnerName(grandFinalOne);
}

function shouldShowResetFinal(grandFinalOne) {
  if (!grandFinalOne) {
    return false;
  }

  const hasTwoPlayers = Boolean(grandFinalOne.players?.[0] && grandFinalOne.players?.[1]);
  return hasTwoPlayers && grandFinalOne.winnerIndex === 1;
}

function matchStatus(match, isEntryRound) {
  const [a, b] = match.players;
  const readyA = Boolean(match.slotReady[0]);
  const readyB = Boolean(match.slotReady[1]);
  const lockedA = isEntryRound && Boolean(match.locked[0]);
  const lockedB = isEntryRound && Boolean(match.locked[1]);

  if (lockedA || lockedB) {
    if (a && readyA && (!b || !readyB)) {
      return `Auto-advance: ${a}`;
    }

    if (b && readyB && (!a || !readyA)) {
      return `Auto-advance: ${b}`;
    }

    const openSeed = lockedA ? seedText(match.seeds[1]) : seedText(match.seeds[0]);
    return openSeed ? `${openSeed} waiting for name.` : "Waiting for player name.";
  }

  if (!readyA && !readyB) {
    if (isEntryRound) {
      const seedA = seedText(match.seeds[0]) || "top slot";
      const seedB = seedText(match.seeds[1]) || "bottom slot";
      return `Enter ${seedA} and ${seedB} names.`;
    }
    return "Waiting for players.";
  }

  if (!readyA || !readyB) {
    return "Waiting for opponent.";
  }

  if (a && !b) {
    return `Auto-advance: ${a}`;
  }

  if (!a && b) {
    return `Auto-advance: ${b}`;
  }

  if (!a && !b) {
    return "Waiting for players.";
  }

  if (match.winnerIndex === null) {
    const outcome = confirmationOutcome(match);
    if (outcome.state === "conflict") {
      return "Conflicting confirmations. Both players must agree or admin sets winner.";
    }
    if (outcome.state === "pending") {
      return outcome.waitingFor
        ? `Waiting for ${outcome.waitingFor} confirmation.`
        : "Waiting for player confirmation.";
    }
    if (isAdminUnlocked) {
      return "Admin can set winner, or both players can confirm.";
    }
    return "Both players must confirm the winner.";
  }

  return `Advances: ${match.players[match.winnerIndex]}`;
}

function countUnresolvedMatches() {
  let count = 0;

  for (const round of state.rounds) {
    for (const match of round) {
      if (match.players[0] && match.players[1] && match.winnerIndex === null) {
        count += 1;
      }
    }
  }

  if (state.eliminationMode === "double") {
    for (const round of state.losersRounds) {
      for (const match of round) {
        if (match.players[0] && match.players[1] && match.winnerIndex === null) {
          count += 1;
        }
      }
    }

    const grandFinalOne = state.grandFinals[0];
    if (grandFinalOne && grandFinalOne.players[0] && grandFinalOne.players[1] && grandFinalOne.winnerIndex === null) {
      count += 1;
    }

    const grandFinalTwo = state.grandFinals[1];
    if (shouldShowResetFinal(grandFinalOne) && grandFinalTwo && grandFinalTwo.players[0] && grandFinalTwo.players[1] && grandFinalTwo.winnerIndex === null) {
      count += 1;
    }
  }

  return count;
}

function winnerName(match) {
  if (!match || match.winnerIndex === null) {
    return "";
  }

  return match.players[match.winnerIndex] || "";
}

function winnersRoundLabel(roundIndex) {
  const playersInRound = state.bracketSize / Math.pow(2, roundIndex);

  if (playersInRound === 2) {
    return "Final";
  }

  if (playersInRound === 4) {
    return "Semifinal";
  }

  if (playersInRound === 8) {
    return "Quarterfinal";
  }

  if (playersInRound >= 16) {
    return `Round of ${playersInRound}`;
  }

  return `Round ${roundIndex + 1}`;
}

function losersRoundLabel(roundIndex) {
  if (roundIndex === state.losersRounds.length - 1) {
    return "Losers Final";
  }

  return `Losers R${roundIndex + 1}`;
}

function syncBracketDensity() {
  const matchScale = preferredMatchScale(state.bracketSize, state.eliminationMode);
  els.bracket.style.setProperty("--match-scale", String(matchScale));
}

function preferredMatchScale(bracketSize, mode) {
  let scale = 1;

  if (bracketSize >= 256) {
    scale = 0.32;
  } else if (bracketSize >= 128) {
    scale = 0.4;
  } else if (bracketSize >= 64) {
    scale = 0.5;
  } else if (bracketSize >= 32) {
    scale = 0.62;
  } else if (bracketSize >= 16) {
    scale = 0.78;
  }

  if (mode === "double") {
    scale *= 0.9;
  }

  return Math.max(scale, 0.28);
}

function isMobileView() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

function handleViewportResize() {
  const mobileView = isMobileView();
  if (wasMobileView === null || mobileView !== wasMobileView) {
    wasMobileView = mobileView;
    render();
    return;
  }

  if (!mobileView) {
    scheduleBracketFit();
  }
}

function scheduleBracketFit() {
  if (pendingFitFrame !== null) {
    window.cancelAnimationFrame(pendingFitFrame);
  }

  pendingFitFrame = window.requestAnimationFrame(() => {
    pendingFitFrame = null;
    fitBracketToViewport();
  });
}

function fitBracketToViewport() {
  if (!state.rounds.length || els.bracketViewport.classList.contains("hidden")) {
    return;
  }

  els.bracket.style.transform = "none";
  els.bracket.style.width = "max-content";
  els.bracket.style.height = "auto";

  const naturalWidth = els.bracket.scrollWidth;
  const naturalHeight = els.bracket.scrollHeight;
  const availableWidth = Math.max(els.bracketViewport.clientWidth - 8, 0);
  const availableHeight = Math.max(els.bracketViewport.clientHeight - 8, 0);

  if (!naturalWidth || !naturalHeight || !availableWidth || !availableHeight) {
    return;
  }

  const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1);
  const scaledWidth = Math.max(1, Math.floor(naturalWidth * scale));
  const scaledHeight = Math.max(1, Math.floor(naturalHeight * scale));

  els.bracketCanvas.style.width = `${scaledWidth}px`;
  els.bracketCanvas.style.height = `${scaledHeight}px`;
  els.bracket.style.width = `${naturalWidth}px`;
  els.bracket.style.height = `${naturalHeight}px`;
  els.bracket.style.transform = `scale(${scale})`;
}

function normalizeMode(mode) {
  return mode === "double" ? "double" : "single";
}

function parsePlayerCount(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const integer = Math.floor(parsed);
  if (integer < MIN_PLAYERS || integer > MAX_PLAYERS) {
    return null;
  }

  return integer;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nextPowerOfTwo(value) {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

function buildSeedOrder(size) {
  if (size <= 2) {
    return [1, 2];
  }

  let order = [1, 2];

  while (order.length < size) {
    const nextSize = order.length * 2;
    const expanded = [];

    for (let index = 0; index < order.length; index += 1) {
      const seed = order[index];
      const mirror = nextSize + 1 - seed;

      if (index % 2 === 0) {
        expanded.push(seed, mirror);
      } else {
        expanded.push(mirror, seed);
      }
    }

    order = expanded;
  }

  return order;
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeSeed(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function seedText(value) {
  const seed = normalizeSeed(value);
  if (seed === null) {
    return "";
  }
  return `Seed ${seed}`;
}

function persistState() {
  persistLocalState();
  queueCloudSync();
}

function persistLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Keep app functional even if storage is unavailable.
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return coerceStateObject(parsed);
  } catch (_error) {
    return null;
  }
}

function coerceStateObject(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const lobbyPlayers = normalizedLobbyPlayers(
    Array.isArray(parsed.lobbyPlayers) ? parsed.lobbyPlayers : []
  );

  const explicitPlayerCount = parsePlayerCount(
    parsed.playerCount ?? parsed.teamCount ?? parsed.entrantCount
  );
  let playerCount = explicitPlayerCount;

  if (playerCount === null) {
    const derivedCount = Math.max(lobbyPlayers.length, DEFAULT_PLAYERS);
    playerCount = clamp(derivedCount, MIN_PLAYERS, MAX_PLAYERS);
  }

  const eliminationMode = normalizeMode(parsed.eliminationMode ?? parsed.format ?? DEFAULT_MODE);
  const tournamentStarted = Boolean(parsed.tournamentStarted);

  if (tournamentStarted && lobbyPlayers.length >= MIN_PLAYERS) {
    playerCount = clamp(lobbyPlayers.length, MIN_PLAYERS, MAX_PLAYERS);
  }

  const bracketSize = Number.isInteger(parsed.bracketSize) && parsed.bracketSize >= 2
    ? parsed.bracketSize
    : nextPowerOfTwo(playerCount);

  return {
    playerCount,
    eliminationMode,
    bracketSize,
    tournamentStarted,
    lobbyPlayers: lobbyPlayers.slice(0, MAX_PLAYERS),
    rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
    losersRounds: Array.isArray(parsed.losersRounds) ? parsed.losersRounds : [],
    grandFinals: Array.isArray(parsed.grandFinals) ? parsed.grandFinals : []
  };
}

function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }

    const generated = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch (_error) {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }
}
