import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
} from "firebase/firestore";

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

const lastSentMap: Record<string, number> = {};

type LogLevel = "info" | "warn" | "error";

export async function sendDeviceLog(params: {
  deviceId?: string | null;
  eventType: string;
  level?: LogLevel;
  message?: string;
  url?: string;
  reloadCount?: number;
  payload?: unknown;
}) {
  try {
    const now = Date.now();
    const deviceId = params.deviceId || "unknown";
    const throttleKey = `${deviceId}:${params.eventType}`;
    const lastSentAt = lastSentMap[throttleKey] || 0;

    if (now - lastSentAt < 60_000) return;

    lastSentMap[throttleKey] = now;

    await addDoc(collection(db, "device_logs"), {
      deviceId,
      eventType: params.eventType,
      level: params.level || "info",
      message: params.message || "",
      url: params.url || "",
      reloadCount: params.reloadCount ?? null,
      payload: params.payload ?? {},
      source: "android-tv",
      createdAt: serverTimestamp(),
      clientCreatedAt: now,
    });
  } catch (error) {
    console.log("[FIREBASE_LOG_FAILED]", error);
  }
}

export async function updateDeviceStatus(params: {
  deviceId?: string | null;
  online?: boolean;
  currentUrl?: string;
  lastHeartbeatAt?: number;
  reloadCount?: number;
  app?: {
    channel?: string | null;
    runtimeVersion?: string | null;
    updateId?: string | null;
    isEmbeddedLaunch?: boolean | null;
  };
  webview?: {
    isPlayerPage?: boolean;
    lastError?: string | null;
    reason?: string;
  };
  quber?: {
    firmwareVersion?: unknown;
    hdmiConnected?: unknown;
    displayStatus?: unknown;
    autoRunStatus?: unknown;
    lastCommand?: string | null;
    lastCommandResult?: unknown;
  };
  network?: {
    connectType?: unknown;
    wifiSsid?: unknown;
  };
  payload?: unknown;
}) {
  try {
    const deviceId = params.deviceId || "unknown";

    await setDoc(
      doc(db, "device_status", deviceId),
      {
        deviceId,
        online: params.online ?? true,
        currentUrl: params.currentUrl || "",
        lastHeartbeatAt: params.lastHeartbeatAt ?? null,
        reloadCount: params.reloadCount ?? 0,
        app: params.app ?? {},
        webview: params.webview ?? {},
        quber: params.quber ?? {},
        network: params.network ?? {},
        payload: params.payload ?? {},
        updatedAt: serverTimestamp(),
        clientUpdatedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (error) {
    console.log("[FIREBASE_STATUS_FAILED]", error);
  }
}