import { initializeApp, getApps } from "firebase/app";
import { getFirestore, serverTimestamp, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDoKXJokKhiY5x-3zFoHFo8c4ISadFPQCE",
  authDomain: "infoon-tv-monitoring.firebaseapp.com",
  projectId: "infoon-tv-monitoring",
  storageBucket: "infoon-tv-monitoring.firebasestorage.app",
  messagingSenderId: "1029778669951",
  appId: "1:1029778669951:web:757a13e0c97d9d533bda4a",
  measurementId: "G-4VMTX8G10Z",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

const DEVICE_LOGS_COLLECTION = "infoon_tv_logs";
const DEVICE_STATUS_COLLECTION = "infoon_tv_status";

const lastSentMap: Record<string, number> = {};

type LogLevel = "info" | "warn" | "error";

const LOG_THROTTLE_MS = 60_000;

const ALLOWED_INFO_LOGS = new Set([
  "STATUS_REQUEST_RECEIVED",
  "PUSHER_REFRESH_RECEIVED",

  "QUBER_COMMAND_RECEIVED",
  "QUBER_STATUS_READ",

  "UPDATE_CHECK_REQUESTED",
  "UPDATE_NOT_AVAILABLE",
  "UPDATE_AVAILABLE",
  "UPDATE_FETCHED",
]);

const ALLOWED_WARN_LOGS = new Set([
  "PLAYLIST_EMPTY",
  "IMAGE_LOAD_ERROR",
  "VIDEO_START_TIMEOUT",
  "PUSHER_SETUP_ERROR",
  "PUSHER_CONNECTION_ERROR",

  "QUBER_COMMAND_FAILED",
  "QUBER_STATUS_READ_FAILED",

  "UPDATE_CHECK_FAILED",
]);

const ALLOWED_ERROR_LOGS = new Set([
  "LOGIN_FAILED",
  "PLAYLIST_FETCH_ERROR",
  "VIDEO_STATUS_ERROR",
  "PLAYER_FATAL_ERROR",
  "QUBER_FATAL_ERROR",
]);

function sanitizeDocIdPart(value: string) {
  return value
    .replace(/\//g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 80);
}


function normalizeForFirestore<T>(value: T): T {
  if (value === undefined) {
    return null as T;
  }

  if (value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForFirestore(item)) as T;
  }

  if (typeof value === "object") {
    const next: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      next[key] = normalizeForFirestore(item);
    });

    return next as T;
  }

  return value;
}

function shouldSendLog(eventType: string, level: LogLevel) {
  if (level === "error") {
    return ALLOWED_ERROR_LOGS.has(eventType);
  }

  if (level === "warn") {
    return ALLOWED_WARN_LOGS.has(eventType);
  }

  return ALLOWED_INFO_LOGS.has(eventType);
}

export async function sendDeviceLog(params: {
  deviceId?: string | number | null;
  eventType: string;
  level?: LogLevel;
  message?: string;
  url?: string;
  reloadCount?: number;
  payload?: unknown;
}) {
  try {
    const now = Date.now();
    const deviceId = String(params.deviceId || "unknown");
    const eventType = params.eventType || "UNKNOWN_EVENT";
    const level = params.level || "info";

    if (!shouldSendLog(eventType, level)) {
      return;
    }

    const throttleKey = `${deviceId}:${eventType}`;
    const lastSentAt = lastSentMap[throttleKey] || 0;

    if (now - lastSentAt < LOG_THROTTLE_MS) return;

    lastSentMap[throttleKey] = now;

    const safeDeviceId = sanitizeDocIdPart(deviceId);
    const safeEventType = sanitizeDocIdPart(String(eventType));
    const docId = `${safeDeviceId}_${now}_${safeEventType}`;

    const logPayload = normalizeForFirestore({
      deviceId,
      eventType,
      level,
      message: params.message || "",
      url: params.url || "",
      reloadCount: params.reloadCount ?? null,
      payload: params.payload ?? {},
      source: "android-native",
      createdAt: serverTimestamp(),
      clientCreatedAt: now,
    });

    await setDoc(doc(db, DEVICE_LOGS_COLLECTION, docId), logPayload);
  } catch (error) {
    console.log("[FIREBASE_LOG_FAILED]", error);
  }
}

export async function updateDeviceStatus(params: {
  deviceId?: string | number | null;
  online?: boolean;
  currentUrl?: string;
  lastHeartbeatAt?: number;
  reloadCount?: number;

  app?: {
    channel?: string | null;
    runtimeVersion?: string | null;
    updateId?: string | null;
    isEmbeddedLaunch?: boolean | null;
    version?: string | null;
  };

  player?: {
    mode?: "native" | "webview" | string;
    platform?: "android" | "tizen" | string;
    status?: string;
    reason?: string;

    currentIndex?: number | null;
    currentDisplayIndex?: number | null;
    contentsLength?: number | null;
    currentContentUrl?: string;
    currentContentType?: string;

    orientation?: "landscape" | "portrait" | "square" | string;
    orientationLabel?: string;
    windowWidth?: number;
    windowHeight?: number;

    pusherConnected?: boolean;
    lastError?: string | null;
    checkedAtClient?: number;
  };

  webview?: {
    isPlayerPage?: boolean;
    lastError?: string | null;
    reason?: string;
    currentIndex?: number | null;
    contentsLength?: number | null;
    currentContentUrl?: string;
    currentContentType?: string;
  };

  quber?: {
    firmwareVersion?: unknown;
    hdmiConnected?: unknown;
    displayStatus?: unknown;
    autoRunStatus?: unknown;
    lastCommand?: string | null;
    lastCommandResult?: unknown;
    lastError?: unknown;
  };

  network?: {
    connectType?: unknown;
    wifiSsid?: unknown;
    lastError?: unknown;
  };

  payload?: unknown;
}) {
  try {
    const deviceId = String(params.deviceId || "unknown");
    const now = Date.now();

    const statusPayload = normalizeForFirestore({
      deviceId,
      online: params.online ?? true,
      currentUrl: params.currentUrl || "",
      lastHeartbeatAt: params.lastHeartbeatAt ?? now,
      reloadCount: params.reloadCount ?? 0,

      app: params.app ?? {},

      player: {
        mode: "native",
        platform: "android",
        ...(params.player ?? {}),
      },

      // 기존 admin / WebView 호환용. 새 admin에서는 player를 우선 사용.
      webview: params.webview ?? {},

      quber: params.quber ?? {},
      network: params.network ?? {},
      payload: params.payload ?? {},

      updatedAt: serverTimestamp(),
      clientUpdatedAt: now,
    });

    await setDoc(
      doc(db, DEVICE_STATUS_COLLECTION, deviceId),
      statusPayload,
      { merge: true },
    );
  } catch (error) {
    console.log("[FIREBASE_STATUS_FAILED]", error);
  }
}
