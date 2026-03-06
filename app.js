const STORAGE_KEY = "beerio-kart-redemption-v3";
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 256;
const DEFAULT_PLAYERS = 16;
const DEFAULT_MODE = "single";
const DEFAULT_TOURNAMENT_ID = "live";
const CLOUD_SCHEMA_VERSION = 1;
const CLOUD_SYNC_DEBOUNCE_MS = 250;
const DEVICE_ID_KEY = "beerio-kart-device-id";
const JOINED_LOBBY_NAME_KEY = "beerio-kart-joined-name";
const DEFAULT_ADMIN_PASSWORD = "B33r10k@rt";
const ACTION_SOUND_SRC = "assets/wolfy_sanic-collect-ring-15982.mp3";
const ACTION_SOUND_POOL_SIZE = 4;
const MOBILE_BREAKPOINT_PX = 760;

const els = {
  adminPassword: document.querySelector("#admin-password"),
  adminLogin: document.querySelector("#admin-login"),
  adminLogout: document.querySelector("#admin-logout"),
  adminStatus: document.querySelector("#admin-status"),
  adminOnlyBlocks: Array.from(document.querySelectorAll(".admin-only")),
  settingsPanel: document.querySelector("#settings-panel"),
  decreaseCount: document.querySelector("#decrease-count"),
  increaseCount: document.querySelector("#increase-count"),
  playerCount: document.querySelector("#player-count"),
  eliminationMode: document.querySelector("#elimination-mode"),
  updateBracket: document.querySelector("#update-bracket"),
  startTournament: document.querySelector("#start-tournament"),
  joinName: document.querySelector("#join-name"),
  joinLobby: document.querySelector("#join-lobby"),
  joinStatus: document.querySelector("#join-status"),
  lobbyRoster: document.querySelector("#lobby-roster"),
  lobbyPlayers: document.querySelector("#lobby-players"),
  lobbyStatus: document.querySelector("#lobby-status"),
  tournamentId: document.querySelector("#tournament-id"),
  joinTournament: document.querySelector("#join-tournament"),
  copyLink: document.querySelector("#copy-link"),
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
let activeTournamentId = DEFAULT_TOURNAMENT_ID;
const deviceId = getDeviceId();
let isAdminUnlocked = false;
const actionSoundPool = createActionSoundPool();
let actionSoundIndex = 0;
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

  els.playerCount.value = String(state.playerCount);
  els.eliminationMode.value = state.eliminationMode;
  syncLobbyTextFromState();
  bindGlobalActionSound();

  els.decreaseCount.addEventListener("click", () => {
    if (!isAdminUnlocked) {
      return;
    }
    stepPlayerCount(-1);
  });

  els.increaseCount.addEventListener("click", () => {
    if (!isAdminUnlocked) {
      return;
    }
    stepPlayerCount(1);
  });

  els.playerCount.addEventListener("change", () => {
    refreshSettingsControls();
  });

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
    state.lobbyPlayers = parseLobbyPlayers(els.lobbyPlayers.value, state.playerCount);
    notice = "Lobby updated.";
    persistState();
    renderLobbyStatus();
    renderMeta();
  });

  els.joinTournament.addEventListener("click", () => {
    if (!isAdminUnlocked) {
      notice = "Admin unlock required to change tournament ID.";
      renderMeta();
      return;
    }
    applyTournamentFromInput();
  });

  els.tournamentId.addEventListener("change", () => {
    normalizeTournamentInput();
  });

  els.copyLink.addEventListener("click", () => {
    copyShareLink();
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

  if (!Array.isArray(state.rounds) || state.rounds.length === 0) {
    buildNewBracket(
      DEFAULT_PLAYERS,
      DEFAULT_MODE,
      "Loaded default 16-player bracket."
    );
    return;
  }

  recalculateBracket();
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
    lobbyPlayers: createEmptyLobbyPlayers(DEFAULT_PLAYERS),
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

  els.decreaseCount.disabled = !isAdminUnlocked;
  els.increaseCount.disabled = !isAdminUnlocked;
  els.playerCount.disabled = !isAdminUnlocked;
  els.eliminationMode.disabled = !isAdminUnlocked;
  els.updateBracket.disabled = !isAdminUnlocked;
  els.tournamentId.disabled = !isAdminUnlocked;
  els.joinTournament.disabled = !isAdminUnlocked || !cloudEnabled;
  els.startTournament.disabled = !isAdminUnlocked || state.tournamentStarted;
  els.lobbyPlayers.disabled = !isAdminUnlocked || state.tournamentStarted;

  refreshSettingsControls();
  renderLobbyStatus();
}

function createEmptyLobbyPlayers(playerCount) {
  return new Array(playerCount).fill("");
}

function parseLobbyPlayers(rawText, playerCount) {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => normalizeName(line))
    .filter(Boolean);

  const unique = dedupeNames(lines);
  const result = createEmptyLobbyPlayers(playerCount);
  for (let index = 0; index < Math.min(playerCount, unique.length); index += 1) {
    result[index] = unique[index];
  }
  return result;
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
  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers, state.playerCount);
  const filled = lobbyPlayers.filter((name) => Boolean(normalizeName(name))).length;
  const needed = state.playerCount;
  renderLobbyRoster(lobbyPlayers);
  renderJoinControls(lobbyPlayers);

  if (state.tournamentStarted) {
    els.startTournament.textContent = "Tournament Started";
    els.lobbyStatus.textContent = `Tournament started with ${filled}/${needed} seeded players.`;
    return;
  }

  els.startTournament.textContent = "Seed Players and Begin Tournament";
  els.lobbyStatus.textContent = `Lobby ready: ${filled}/${needed} players entered.`;
}

function renderLobbyRoster(lobbyPlayers) {
  els.lobbyRoster.replaceChildren();

  for (let index = 0; index < state.playerCount; index += 1) {
    const li = document.createElement("li");
    const entry = normalizeName(lobbyPlayers[index]);

    if (entry) {
      li.textContent = entry;
    } else {
      li.textContent = `Open spot ${index + 1}`;
      li.classList.add("open");
    }

    if (entry && localJoinedName && entry.toLowerCase() === localJoinedName.toLowerCase()) {
      li.classList.add("self");
      li.textContent = `${entry} (you)`;
    }

    els.lobbyRoster.appendChild(li);
  }
}

function renderJoinControls(lobbyPlayers) {
  const filled = lobbyPlayers.filter((name) => Boolean(normalizeName(name))).length;
  const full = filled >= state.playerCount;
  const started = state.tournamentStarted;
  const joinedIndex = findLobbyIndexByName(lobbyPlayers, localJoinedName);

  if (localJoinedName) {
    els.joinName.value = localJoinedName;
  }

  els.joinName.disabled = started || joinPending;
  els.joinLobby.disabled = started || full || joinPending;

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

  if (full) {
    setJoinStatus("Lobby is full.", "warn");
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

function normalizedLobbyPlayers(rawPlayers, playerCount) {
  const result = createEmptyLobbyPlayers(playerCount);
  const list = Array.isArray(rawPlayers) ? rawPlayers : [];
  for (let index = 0; index < Math.min(playerCount, list.length); index += 1) {
    result[index] = normalizeName(list[index]);
  }
  return result;
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
      renderLobbyStatus();
      return;
    }

    if (!committed || !pendingResult.ok) {
      setJoinStatus(joinFailureMessage(pendingResult.reason), "warn");
      renderLobbyStatus();
      return;
    }

    saveJoinedLobbyName(pendingResult.joinedName);
    setJoinStatus(`Joined as ${pendingResult.joinedName}.`, "good");
    renderLobbyStatus();
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

  const lobbyPlayers = normalizedLobbyPlayers(targetState.lobbyPlayers, targetState.playerCount);
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

  const emptyIndex = lobbyPlayers.findIndex((name) => !normalizeName(name));
  if (emptyIndex < 0) {
    return { ok: false, reason: "full" };
  }

  lobbyPlayers[emptyIndex] = nextName;
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
    return "Lobby is full.";
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

  const seededPlayers = normalizedLobbyPlayers(state.lobbyPlayers, state.playerCount).filter(Boolean);
  if (seededPlayers.length !== state.playerCount) {
    notice = `Enter exactly ${state.playerCount} unique player names in lobby before starting.`;
    renderLobbyStatus();
    renderMeta();
    return;
  }

  const randomized = shuffleCopy(seededPlayers);
  state.lobbyPlayers = randomized.slice();
  state.tournamentStarted = true;
  seedPlayersIntoFirstRound(randomized);
  recalculateBracket();
  persistState();
  notice = "Tournament started. Players seeded randomly.";
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
  const initialTournamentId = getInitialTournamentId();
  activeTournamentId = initialTournamentId;
  els.tournamentId.value = initialTournamentId;
  updateShareUrl(initialTournamentId);

  const firebaseConfig = window.BEERIO_FIREBASE_CONFIG;
  const firebaseAvailable = Boolean(window.firebase?.database);

  if (!firebaseAvailable || !hasValidFirebaseConfig(firebaseConfig)) {
    cloudEnabled = false;
    els.joinTournament.disabled = true;
    setCloudStatus("Cloud sync: local only (add Firebase config)", "offline");
    return;
  }

  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    cloudDatabase = window.firebase.database();
    cloudEnabled = true;
    els.joinTournament.disabled = false;
    setCloudStatus(`Cloud sync: connecting (${initialTournamentId})...`, "offline");
    connectToTournament(initialTournamentId);
  } catch (_error) {
    cloudEnabled = false;
    els.joinTournament.disabled = true;
    setCloudStatus("Cloud sync: unavailable (Firebase init failed)", "offline");
  }
}

function applyTournamentFromInput() {
  const nextTournamentId = sanitizeTournamentId(els.tournamentId.value) || DEFAULT_TOURNAMENT_ID;
  els.tournamentId.value = nextTournamentId;

  if (!cloudEnabled) {
    notice = "Cloud sync is disabled until Firebase is configured.";
    renderMeta();
    return;
  }

  if (nextTournamentId === activeTournamentId) {
    notice = "Already connected to this tournament.";
    renderMeta();
    return;
  }

  if (hasEnteredPlayerNames()) {
    const confirmed = window.confirm(
      "Switching tournament ID will replace this view with shared bracket data. Continue?"
    );
    if (!confirmed) {
      els.tournamentId.value = activeTournamentId;
      return;
    }
  }

  connectToTournament(nextTournamentId);
}

function normalizeTournamentInput() {
  const normalized = sanitizeTournamentId(els.tournamentId.value) || DEFAULT_TOURNAMENT_ID;
  els.tournamentId.value = normalized;
}

function connectToTournament(tournamentId) {
  if (!cloudEnabled || !cloudDatabase) {
    return;
  }

  const normalizedId = sanitizeTournamentId(tournamentId) || DEFAULT_TOURNAMENT_ID;
  activeTournamentId = normalizedId;
  els.tournamentId.value = normalizedId;
  updateShareUrl(normalizedId);

  cloudInitialReadComplete = false;

  if (cloudRef && cloudListener) {
    cloudRef.off("value", cloudListener);
  }

  cloudRef = cloudDatabase.ref(`tournaments/${normalizedId}`);

  let firstEvent = true;
  cloudListener = (snapshot) => {
    const payload = snapshot.val();
    const remoteState = payload && typeof payload === "object" ? payload.state : null;

    if (firstEvent) {
      cloudInitialReadComplete = true;
    }

    if (remoteState && typeof remoteState === "object") {
      applyRemoteState(remoteState);
      setCloudStatus(`Cloud sync: live (${normalizedId})`, "online");

      if (firstEvent) {
        notice = `Connected to shared bracket "${normalizedId}".`;
      }
    } else if (firstEvent) {
      setCloudStatus(`Cloud sync: live (${normalizedId})`, "online");
      notice = `Started shared bracket "${normalizedId}".`;

      if (!hasBracketData(state)) {
        buildNewBracket(
          DEFAULT_PLAYERS,
          DEFAULT_MODE,
          "Loaded default 16-player bracket."
        );
      } else {
        queueCloudSync();
      }
    }

    firstEvent = false;
  };

  cloudRef.on("value", cloudListener, () => {
    setCloudStatus(`Cloud sync: connection issue (${normalizedId})`, "offline");
  });
}

function applyRemoteState(remoteState) {
  const nextState = coerceStateObject(remoteState);
  if (!nextState) {
    return;
  }

  cloudApplyingRemote = true;
  state = nextState;
  els.playerCount.value = String(state.playerCount);
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
    setCloudStatus(`Cloud sync: live (${activeTournamentId})`, "online");
  }).catch(() => {
    setCloudStatus(`Cloud sync: write failed (${activeTournamentId})`, "offline");
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

function copyShareLink() {
  const link = shareLinkForTournament(activeTournamentId);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      notice = "Share link copied.";
      renderMeta();
    }).catch(() => {
      notice = "Copy failed. Share link is in the address bar.";
      renderMeta();
    });
    return;
  }

  notice = "Clipboard unavailable. Copy link from address bar.";
  renderMeta();
}

function shareLinkForTournament(tournamentId) {
  const url = new URL(window.location.href);
  url.searchParams.set("t", tournamentId);
  return url.toString();
}

function updateShareUrl(tournamentId) {
  const url = new URL(window.location.href);
  url.searchParams.set("t", tournamentId);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getInitialTournamentId() {
  const url = new URL(window.location.href);
  return sanitizeTournamentId(url.searchParams.get("t")) || DEFAULT_TOURNAMENT_ID;
}

function sanitizeTournamentId(rawValue) {
  const normalized = String(rawValue || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 40);
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

function hasBracketData(stateValue) {
  return Boolean(Array.isArray(stateValue?.rounds) && stateValue.rounds.length);
}

function applyPendingSettings() {
  const playerCount = parsePlayerCount(els.playerCount.value);
  if (playerCount === null) {
    notice = `Enter a whole number of players (${MIN_PLAYERS}-${MAX_PLAYERS}).`;
    refreshSettingsControls();
    renderMeta();
    return;
  }

  const mode = normalizeMode(els.eliminationMode.value);
  const settingsChanged = (
    playerCount !== state.playerCount ||
    mode !== state.eliminationMode ||
    !Array.isArray(state.rounds) ||
    state.rounds.length === 0
  );

  if (!settingsChanged) {
    notice = "Bracket settings already match current values.";
    refreshSettingsControls();
    renderMeta();
    return;
  }

  if (hasEnteredPlayerNames()) {
    const confirmed = window.confirm(
      "Updating bracket settings will reset entered player names and results. Continue?"
    );
    if (!confirmed) {
      return;
    }
  }

  buildNewBracket(playerCount, mode);
}

function stepPlayerCount(delta) {
  const current = parsePlayerCount(els.playerCount.value) || state.playerCount;
  const next = clamp(current + delta, MIN_PLAYERS, MAX_PLAYERS);

  els.playerCount.value = String(next);
  refreshSettingsControls();
}

function currentControlSettings() {
  return {
    playerCount: parsePlayerCount(els.playerCount.value),
    eliminationMode: normalizeMode(els.eliminationMode.value)
  };
}

function hasPendingSettingChanges() {
  const settings = currentControlSettings();
  if (settings.playerCount === null) {
    return false;
  }

  if (!Array.isArray(state.rounds) || state.rounds.length === 0) {
    return true;
  }

  return (
    settings.playerCount !== state.playerCount ||
    settings.eliminationMode !== state.eliminationMode
  );
}

function hasEnteredPlayerNames() {
  const lobbyPlayers = Array.isArray(state.lobbyPlayers) ? state.lobbyPlayers : [];
  return lobbyPlayers.some((name) => Boolean(normalizeName(name)));
}

function refreshSettingsControls() {
  const settings = currentControlSettings();
  const hasBracket = Array.isArray(state.rounds) && state.rounds.length > 0;
  const hasPending = hasPendingSettingChanges();
  const namesEntered = hasEnteredPlayerNames();

  if (!isAdminUnlocked) {
    els.updateBracket.textContent = "Unlock Admin to Update";
    els.updateBracket.disabled = true;
    return;
  }

  if (settings.playerCount === null) {
    els.updateBracket.textContent = "Enter Valid Player Count";
    els.updateBracket.disabled = true;
    return;
  }

  if (!hasBracket) {
    els.updateBracket.textContent = "Create Bracket";
    els.updateBracket.disabled = false;
    return;
  }

  if (hasPending) {
    els.updateBracket.textContent = namesEntered
      ? "Update Bracket (Confirm)"
      : "Update Bracket";
    els.updateBracket.disabled = false;
    return;
  }

  els.updateBracket.textContent = "Bracket Up To Date";
  els.updateBracket.disabled = true;
}

function buildNewBracket(playerCount, mode, customNotice = "") {
  const bracket = createBracket(playerCount, mode);

  state.playerCount = playerCount;
  state.eliminationMode = mode;
  state.bracketSize = bracket.bracketSize;
  state.tournamentStarted = false;
  state.lobbyPlayers = createEmptyLobbyPlayers(playerCount);
  state.rounds = bracket.rounds;
  state.losersRounds = bracket.losersRounds;
  state.grandFinals = bracket.grandFinals;

  els.playerCount.value = String(playerCount);
  els.eliminationMode.value = mode;
  syncLobbyTextFromState();

  const byes = state.bracketSize - state.playerCount;
  const formatLabel = mode === "double" ? "double elimination" : "single elimination";
  notice = customNotice || `Created ${playerCount}-player ${formatLabel} bracket (${byes} bye${byes === 1 ? "" : "s"}). Fill lobby and start tournament.`;

  recalculateBracket();
  persistState();
  render();
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

  if (!isAdminUnlocked) {
    notice = "Admin unlock required to record match results.";
    renderMeta();
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

  match.winnerIndex = slotIndex;
  notice = "Winner advanced.";

  recalculateBracket();
  persistState();
  render();
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
  } else {
    match.slotReady = nextReady;
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

  if (match.winnerIndex !== 0 && match.winnerIndex !== 1) {
    match.winnerIndex = null;
    return;
  }

  if (!match.slotReady[match.winnerIndex] || !match.players[match.winnerIndex]) {
    match.winnerIndex = null;
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
    return;
  }

  if (byeB && readyA && a) {
    match.winnerIndex = 0;
    return;
  }

  if (!readyA || !readyB) {
    if (!a || !b) {
      match.winnerIndex = null;
    }
    return;
  }

  if (a && !b) {
    match.winnerIndex = 0;
    return;
  }

  if (!a && b) {
    match.winnerIndex = 1;
    return;
  }

  if (!a && !b) {
    match.winnerIndex = null;
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
  renderMeta();
  renderBracket();
  renderChampion();
  syncLobbyTextFromState();
  renderLobbyStatus();
  refreshAdminControls();
}

function reconcileLocalJoinedName() {
  if (!localJoinedName) {
    return;
  }

  if (state.tournamentStarted) {
    return;
  }

  const lobbyPlayers = normalizedLobbyPlayers(state.lobbyPlayers, state.playerCount);
  if (findLobbyIndexByName(lobbyPlayers, localJoinedName) < 0) {
    saveJoinedLobbyName("");
  }
}

function renderMeta() {
  if (!state.rounds.length) {
    const note = notice ? ` ${notice}` : "";
    els.meta.textContent = `No bracket created yet.${note}`.trim();
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
    renderMobileBracket();
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

function renderMobileBracket() {
  if (state.eliminationMode === "double") {
    renderMobileDoubleElimination();
    return;
  }

  renderMobileSingleElimination();
}

function renderMobileSingleElimination() {
  const stage = createMobileStage("Winners Bracket");

  for (let roundIndex = 0; roundIndex < state.rounds.length; roundIndex += 1) {
    stage.appendChild(buildMobileWinnersRound(roundIndex));
  }

  els.mobileBracket.appendChild(stage);
}

function renderMobileDoubleElimination() {
  const winnersStage = createMobileStage("Winners Bracket");
  for (let roundIndex = 0; roundIndex < state.rounds.length; roundIndex += 1) {
    winnersStage.appendChild(buildMobileWinnersRound(roundIndex));
  }
  els.mobileBracket.appendChild(winnersStage);

  const losersStage = createMobileStage("Losers Bracket");
  if (state.losersRounds.length === 0) {
    const note = document.createElement("p");
    note.className = "losers-note";
    note.textContent = "Losers finalist comes from the winners final loser.";
    losersStage.appendChild(note);
  } else {
    for (let roundIndex = 0; roundIndex < state.losersRounds.length; roundIndex += 1) {
      losersStage.appendChild(buildMobileLosersRound(roundIndex));
    }
  }
  els.mobileBracket.appendChild(losersStage);

  const finalsStage = createMobileStage("Finals");
  finalsStage.appendChild(buildMobileGrandFinalRound());
  els.mobileBracket.appendChild(finalsStage);
}

function createMobileStage(titleText) {
  const stage = document.createElement("section");
  stage.className = "mobile-stage";

  const title = document.createElement("h3");
  title.className = "mobile-stage-title";
  title.textContent = titleText;
  stage.appendChild(title);

  return stage;
}

function buildMobileWinnersRound(roundIndex) {
  const roundNode = document.createElement("section");
  roundNode.className = "mobile-round";

  const heading = document.createElement("h4");
  heading.className = "mobile-round-title";
  heading.textContent = winnersRoundLabel(roundIndex);
  roundNode.appendChild(heading);

  const matches = state.rounds[roundIndex] || [];
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const title = `${winnersRoundLabel(roundIndex)} ${matchIndex + 1}`;
    roundNode.appendChild(renderMatch("winners", roundIndex, matchIndex, title, false));
  }

  return roundNode;
}

function buildMobileLosersRound(roundIndex) {
  const roundNode = document.createElement("section");
  roundNode.className = "mobile-round";

  const heading = document.createElement("h4");
  heading.className = "mobile-round-title";
  heading.textContent = losersRoundLabel(roundIndex);
  roundNode.appendChild(heading);

  const matches = state.losersRounds[roundIndex] || [];
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const title = `${losersRoundLabel(roundIndex)} ${matchIndex + 1}`;
    roundNode.appendChild(renderMatch("losers", roundIndex, matchIndex, title, false));
  }

  return roundNode;
}

function buildMobileGrandFinalRound() {
  const roundNode = document.createElement("section");
  roundNode.className = "mobile-round";

  const heading = document.createElement("h4");
  heading.className = "mobile-round-title";
  heading.textContent = "Grand Final";
  roundNode.appendChild(heading);
  roundNode.appendChild(renderMatch("grand", 0, 0, "Grand Final", false));

  if (shouldShowResetFinal(state.grandFinals[0])) {
    const resetHeading = document.createElement("h4");
    resetHeading.className = "mobile-round-title";
    resetHeading.textContent = "Grand Final Reset";
    roundNode.appendChild(resetHeading);
    roundNode.appendChild(renderMatch("grand", 1, 0, "Reset Final", false));
  }

  return roundNode;
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
    winBtn.disabled = !slotName || !otherName || !state.tournamentStarted || !isAdminUnlocked;
    winBtn.textContent = isWinner ? "Won" : "Win";

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
    return "Pick the winner.";
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

  const playerCount = parsePlayerCount(
    parsed.playerCount ?? parsed.teamCount ?? parsed.entrantCount ?? DEFAULT_PLAYERS
  );
  if (playerCount === null) {
    return null;
  }

  const eliminationMode = normalizeMode(parsed.eliminationMode ?? parsed.format ?? DEFAULT_MODE);
  const bracketSize = Number.isInteger(parsed.bracketSize) && parsed.bracketSize >= 2
    ? parsed.bracketSize
    : nextPowerOfTwo(playerCount);

  const lobbyPlayers = Array.isArray(parsed.lobbyPlayers)
    ? parsed.lobbyPlayers.map((name) => normalizeName(name))
    : createEmptyLobbyPlayers(playerCount);

  while (lobbyPlayers.length < playerCount) {
    lobbyPlayers.push("");
  }

  return {
    playerCount,
    eliminationMode,
    bracketSize,
    tournamentStarted: Boolean(parsed.tournamentStarted),
    lobbyPlayers: lobbyPlayers.slice(0, playerCount),
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
