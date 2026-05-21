import { StatusBar } from "expo-status-bar";
import {
  BackHandler,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useCallback, useEffect, useRef, useState } from "react";
import * as NavigationBar from "expo-navigation-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { Pusher, PusherEvent } from "@pusher/pusher-websocket-react-native";
import * as Updates from "expo-updates";
import NetInfo from "@react-native-community/netinfo";

import { sendDeviceLog, updateDeviceStatus } from "../lib/firebaseLogger";

const WEB_VERSION = "20260521-2";
const START_URL = `https://info-on.cloud/tv-login.html?v=${WEB_VERSION}&nativeHeartbeat=1`;
const PACKAGE_NAME = "com.infoon.tv";

const PUSHER_KEY = process.env.EXPO_PUBLIC_PUSHER_KEY!;
const PUSHER_CLUSTER = process.env.EXPO_PUBLIC_PUSHER_CLUSTER!;

const PLAYER_HEARTBEAT_TIMEOUT = 60_000;
const WATCHDOG_CHECK_INTERVAL = 10_000;
const MAX_RECOVERY_RELOAD_COUNT = 3;
const DEVICE_STATUS_UPDATE_INTERVAL = 120_000;

let isCheckingUpdate = false;

type QuberModuleType = {
  sendRequest?: (jsonMsg: string) => Promise<string>;
};

type WebViewMessage =
  | {
      type: "QUBER_COMMAND";
      command: string;
    }
  | {
      type: "DEVICE_ID_REGISTERED";
      deviceId: string;
    }
  | {
      type: "PLAYER_HEARTBEAT";
      deviceId?: string;
      url?: string;
      currentIndex?: number;
      contentsLength?: number;
      currentContentUrl?: string;
      currentContentType?: string;
      timestamp?: number;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

const QuberModule = NativeModules.QuberModule as QuberModuleType | undefined;

function makeRequestId() {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");

  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3)
  );
}

function serializeError(error: unknown) {
  if (!error) return "UNKNOWN_ERROR";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parseQuberResponse(response: unknown) {
  if (!response) return null;

  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch {
      return response;
    }
  }

  return response;
}

function getQuberParams(response: unknown) {
  const parsed = parseQuberResponse(response);

  if (parsed && typeof parsed === "object" && "params" in parsed) {
    return (parsed as { params?: Record<string, unknown> }).params || {};
  }

  return {};
}

function logUpdateInfo(prefix = "[EAS UPDATE]") {
  console.log(`${prefix} isEnabled:`, Updates.isEnabled);
  console.log(`${prefix} channel:`, Updates.channel);
  console.log(`${prefix} runtimeVersion:`, Updates.runtimeVersion);
  console.log(`${prefix} updateId:`, Updates.updateId);
  console.log(`${prefix} createdAt:`, Updates.createdAt);
  console.log(`${prefix} isEmbeddedLaunch:`, Updates.isEmbeddedLaunch);
}

function getUpdatePayload(extra?: Record<string, unknown>) {
  return {
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEnabled: Updates.isEnabled,
    ...extra,
  };
}

function shouldIgnoreUpdateError(errorMessage: string) {
  return (
    errorMessage.includes("ExpoUpdates.checkForUpdateAsync") &&
    errorMessage.includes("Failed to check for update")
  );
}

async function checkAndApplyUpdate(deviceId?: string | null) {
  if (isCheckingUpdate) {
    console.log("[EAS UPDATE] already checking. skip.");
    return;
  }

  isCheckingUpdate = true;

  try {
    if (__DEV__) {
      console.log("[EAS UPDATE] skipped in dev");
      return;
    }

    logUpdateInfo();

    if (!Updates.isEnabled) {
      console.log("[EAS UPDATE] expo-updates is not enabled");
      return;
    }

    console.log("[EAS UPDATE] checking...");

    const update = await Updates.checkForUpdateAsync();

    console.log("[EAS UPDATE] check result:", update);

    if (!update.isAvailable) {
      console.log("[EAS UPDATE] no update available");
      return;
    }

    await sendDeviceLog({
      deviceId,
      eventType: "APP_UPDATE_AVAILABLE",
      level: "info",
      message: "EAS update available",
      payload: getUpdatePayload({
        currentUpdateId: Updates.updateId,
      }),
    });

    console.log("[EAS UPDATE] update available. fetching...");

    const fetchResult = await Updates.fetchUpdateAsync();

    console.log("[EAS UPDATE] fetch result:", fetchResult);
    console.log("[EAS UPDATE] fetched. reloading app...");

    await sendDeviceLog({
      deviceId,
      eventType: "APP_UPDATE_FETCHED",
      level: "info",
      message: "EAS update fetched. reload app",
      payload: getUpdatePayload({
        currentUpdateId: Updates.updateId,
        fetchResult,
      }),
    });

    await Updates.reloadAsync();
  } catch (error) {
    console.log("[EAS UPDATE] failed:", error);

    const errorMessage = serializeError(error);

    if (shouldIgnoreUpdateError(errorMessage)) {
      console.warn("[APP_UPDATE_ERROR_IGNORED]", errorMessage);
      return;
    }

    await sendDeviceLog({
      deviceId,
      eventType: "APP_UPDATE_ERROR",
      level: "error",
      message: errorMessage,
      payload: getUpdatePayload({
        phase: "check_or_fetch",
      }),
    });
  } finally {
    isCheckingUpdate = false;
  }
}

async function sendQuberRequest(
  cmdCode: string,
  params?: Record<string, unknown> | unknown[],
) {
  try {
    if (!QuberModule || typeof QuberModule.sendRequest !== "function") {
      console.log("[QUBER] QuberModule not available");
      return null;
    }

    const payload: Record<string, unknown> = {
      requestId: makeRequestId(),
      cmdCode,
    };

    if (params) {
      payload.params = params;
    }

    const response = await QuberModule.sendRequest(JSON.stringify(payload));

    console.log("[QUBER] response:", response);

    return response;
  } catch (error) {
    console.log("[QUBER] request failed:", error);
    return null;
  }
}

async function setupAutoRun() {
  try {
    const setResult = await sendQuberRequest("213019", {
      packageName: PACKAGE_NAME,
    });

    console.log("[QUBER] AutoRun set:", setResult);

    const readResult = await sendQuberRequest("211034");

    console.log("[QUBER] AutoRun read:", readResult);

    return {
      setResult,
      readResult,
    };
  } catch (error) {
    console.log("[QUBER] AutoRun setup failed:", error);
    return {
      setResult: null,
      readResult: null,
      error: serializeError(error),
    };
  }
}

async function turnTvOnByCec() {
  return sendQuberRequest("215031", {
    status: "on",
  });
}

async function turnTvStandbyByCec() {
  return sendQuberRequest("215031", {
    status: "standby",
  });
}

async function setHdmiOutputOn() {
  return sendQuberRequest("213020", {
    onStatus: "true",
  });
}

async function rebootSetTopBox() {
  return sendQuberRequest("215001");
}

async function scheduleTvWakeupInMinutes(minutes = 3) {
  const next = new Date(Date.now() + minutes * 60_000);
  const dayOfWeek = next.getDay() === 0 ? 1 : next.getDay() + 1;
  const hh = String(next.getHours()).padStart(2, "0");
  const mm = String(next.getMinutes()).padStart(2, "0");

  return sendQuberRequest("213004", [
    {
      dayOfWeek,
      rebootTime: "-1",
      sleepTime: "-1",
      wakeupTime: `${hh}:${mm}`,
    },
  ]);
}

async function runQuberCommand(command: string) {
  console.log("[QUBER] command:", command);

  switch (command) {
    case "tv-on":
      await scheduleTvWakeupInMinutes(3);
      await setHdmiOutputOn();
      await turnTvOnByCec();
      return;

    case "power-off":
      await turnTvStandbyByCec();
      return;

    case "reboot":
      await rebootSetTopBox();
      return;

    default:
      console.log("[QUBER] unknown command:", command);
  }
}

async function readQuberDeviceStatus() {
  const firmwareResponse = await sendQuberRequest("211006");
  const hdmiResponse = await sendQuberRequest("211024");
  const displayResponse = await sendQuberRequest("111009");
  const networkTypeResponse = await sendQuberRequest("211022");
  const wifiSsidResponse = await sendQuberRequest("211015");
  const autoRunResponse = await sendQuberRequest("211034");

  const firmwareParams = getQuberParams(firmwareResponse);
  const hdmiParams = getQuberParams(hdmiResponse);
  const displayParams = getQuberParams(displayResponse);
  const networkTypeParams = getQuberParams(networkTypeResponse);
  const wifiSsidParams = getQuberParams(wifiSsidResponse);

  return {
    raw: {
      firmwareResponse: parseQuberResponse(firmwareResponse),
      hdmiResponse: parseQuberResponse(hdmiResponse),
      displayResponse: parseQuberResponse(displayResponse),
      networkTypeResponse: parseQuberResponse(networkTypeResponse),
      wifiSsidResponse: parseQuberResponse(wifiSsidResponse),
      autoRunResponse: parseQuberResponse(autoRunResponse),
    },
    quber: {
      firmwareVersion: firmwareParams.firmwareVersion ?? null,
      hdmiConnected: hdmiParams.connectStatus ?? null,
      displayStatus: displayParams.readDisplayStatus ?? null,
      autoRunStatus: parseQuberResponse(autoRunResponse),
      lastCommand: "READ_STATUS",
      lastCommandResult: null,
    },
    network: {
      connectType: networkTypeParams.connectType ?? null,
      wifiSsid: wifiSsidParams.SSID ?? null,
    },
  };
}

export default function HomeScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [isNetworkReady, setIsNetworkReady] = useState(false);

  const nativeChannelRef = useRef<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const deviceIdRef = useRef<string | null>(null);
  const currentUrlRef = useRef(START_URL);
  const lastHeartbeatRef = useRef(Date.now());
  const reloadCountRef = useRef(0);
  const isPlayerPageRef = useRef(false);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusSentAtRef = useRef(0);
  const networkReadyRef = useRef(false);
  const currentContentRef = useRef({
    currentIndex: null as number | null,
    contentsLength: null as number | null,
    currentContentUrl: "",
    currentContentType: "",
  });

  const updateCurrentDeviceStatus = useCallback(
    async (reason: string, force = false) => {
      const now = Date.now();

      if (
        !force &&
        now - lastStatusSentAtRef.current < DEVICE_STATUS_UPDATE_INTERVAL
      ) {
        return;
      }

      lastStatusSentAtRef.current = now;

      try {
        const quberStatus = await readQuberDeviceStatus();

        await updateDeviceStatus({
          deviceId: deviceIdRef.current,
          online: networkReadyRef.current,
          currentUrl: currentUrlRef.current,
          lastHeartbeatAt: lastHeartbeatRef.current,
          reloadCount: reloadCountRef.current,
          app: {
            channel: Updates.channel,
            runtimeVersion: Updates.runtimeVersion,
            updateId: Updates.updateId,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          },
          webview: {
            isPlayerPage: isPlayerPageRef.current,
            reason,
            currentIndex: currentContentRef.current.currentIndex,
            contentsLength: currentContentRef.current.contentsLength,
            currentContentUrl: currentContentRef.current.currentContentUrl,
            currentContentType: currentContentRef.current.currentContentType,
          },
          quber: quberStatus.quber,
          network: quberStatus.network,
          payload: {
            rawQuberStatus: quberStatus.raw,
          },
        });
      } catch (error) {
        await sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "QUBER_STATUS_READ_ERROR",
          level: "warn",
          message: serializeError(error),
          url: currentUrlRef.current,
        });
      }
    },
    [],
  );

  const resetToStartUrl = useCallback((reason: string) => {
    console.log("[WEBVIEW RECOVERY] reset to START_URL:", reason);

    const previousReloadCount = reloadCountRef.current;

    reloadCountRef.current = 0;
    lastHeartbeatRef.current = Date.now();
    isPlayerPageRef.current = false;
    currentUrlRef.current = START_URL;

    sendDeviceLog({
      deviceId: deviceIdRef.current,
      eventType: "WATCHDOG_RESET_TO_START_URL",
      level: "warn",
      message: reason,
      url: currentUrlRef.current,
      reloadCount: previousReloadCount,
      payload: {
        startUrl: START_URL,
      },
    });

    updateDeviceStatus({
      deviceId: deviceIdRef.current,
      online: networkReadyRef.current,
      currentUrl: START_URL,
      lastHeartbeatAt: lastHeartbeatRef.current,
      reloadCount: 0,
      webview: {
        isPlayerPage: false,
        lastError: reason,
        currentIndex: currentContentRef.current.currentIndex,
        contentsLength: currentContentRef.current.contentsLength,
        currentContentUrl: currentContentRef.current.currentContentUrl,
        currentContentType: currentContentRef.current.currentContentType,
      },
    });

    setWebViewKey((prev) => prev + 1);
  }, []);

  const reloadWebView = useCallback(
    (reason: string) => {
      if (!networkReadyRef.current) {
        console.log(
          "[WEBVIEW RECOVERY] network not ready. skip reload:",
          reason,
        );

        sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "WEBVIEW_RELOAD_SKIPPED_NETWORK_NOT_READY",
          level: "warn",
          message: reason,
          url: currentUrlRef.current,
          reloadCount: reloadCountRef.current,
        });

        return;
      }

      reloadCountRef.current += 1;

      console.log("[WEBVIEW RECOVERY] reload:", reason, reloadCountRef.current);

      sendDeviceLog({
        deviceId: deviceIdRef.current,
        eventType: "WATCHDOG_RELOAD",
        level: "warn",
        message: reason,
        url: currentUrlRef.current,
        reloadCount: reloadCountRef.current,
      });

      updateDeviceStatus({
        deviceId: deviceIdRef.current,
        online: networkReadyRef.current,
        currentUrl: currentUrlRef.current,
        lastHeartbeatAt: lastHeartbeatRef.current,
        reloadCount: reloadCountRef.current,
        webview: {
          isPlayerPage: isPlayerPageRef.current,
          lastError: reason,
          currentIndex: currentContentRef.current.currentIndex,
          contentsLength: currentContentRef.current.contentsLength,
          currentContentUrl: currentContentRef.current.currentContentUrl,
          currentContentType: currentContentRef.current.currentContentType,
        },
      });

      if (reloadCountRef.current >= MAX_RECOVERY_RELOAD_COUNT) {
        resetToStartUrl(reason);
        return;
      }

      webViewRef.current?.reload();
    },
    [resetToStartUrl],
  );

  const scheduleRecovery = useCallback(
    (reason: string) => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
      }

      recoveryTimerRef.current = setTimeout(() => {
        reloadWebView(reason);
      }, 5000);
    },
    [reloadWebView],
  );

  const handleNativeCommand = useCallback(
    async (command: string) => {
      console.log("[NATIVE COMMAND] command:", command);

      await sendDeviceLog({
        deviceId: deviceIdRef.current,
        eventType: "NATIVE_COMMAND_RECEIVED",
        level: "info",
        message: command,
        url: currentUrlRef.current,
      });

      switch (command) {
        case "reload-player":
          console.log("[NATIVE COMMAND] reload WebView");
          reloadWebView("NATIVE_COMMAND_RELOAD_PLAYER");
          return;

        case "reset-player":
        case "go-start-url":
          console.log("[NATIVE COMMAND] reset to START_URL");
          resetToStartUrl("NATIVE_COMMAND_RESET_TO_START_URL");
          return;

        case "reload-app":
          console.log("[NATIVE COMMAND] reload app");
          await Updates.reloadAsync();
          return;

        case "tv-on":
          await scheduleTvWakeupInMinutes(3);
          await setHdmiOutputOn();
          await turnTvOnByCec();
          updateCurrentDeviceStatus("NATIVE_COMMAND_TV_ON", true);
          return;

        case "power-off":
          await turnTvStandbyByCec();
          updateCurrentDeviceStatus("NATIVE_COMMAND_POWER_OFF", true);
          return;

        case "reboot":
          console.log("[NATIVE COMMAND] reboot set-top box");
          await rebootSetTopBox();
          return;

        case "read-status":
          await updateCurrentDeviceStatus("NATIVE_COMMAND_READ_STATUS", true);
          return;

        default:
          console.log("[NATIVE COMMAND] unknown command:", command);
      }
    },
    [reloadWebView, resetToStartUrl, updateCurrentDeviceStatus],
  );

  const handleWebViewMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const rawData = event.nativeEvent.data;
        const data = JSON.parse(rawData) as WebViewMessage;

        if (data.type === "PLAYER_HEARTBEAT") {
          lastHeartbeatRef.current = Date.now();
          isPlayerPageRef.current = true;

          if (typeof data.url === "string") {
            currentUrlRef.current = data.url;
          }

          currentContentRef.current = {
            currentIndex:
              typeof data.currentIndex === "number" ? data.currentIndex : null,
            contentsLength:
              typeof data.contentsLength === "number"
                ? data.contentsLength
                : null,
            currentContentUrl:
              typeof data.currentContentUrl === "string"
                ? data.currentContentUrl
                : "",
            currentContentType:
              typeof data.currentContentType === "string"
                ? data.currentContentType
                : "",
          };

          if (data.deviceId) {
            const nextDeviceId = String(data.deviceId);

            deviceIdRef.current = nextDeviceId;
            setDeviceId(nextDeviceId);
          }

          updateCurrentDeviceStatus("PLAYER_HEARTBEAT");

          return;
        }

        if (data.type === "DEVICE_ID_REGISTERED" && "deviceId" in data) {
          const nextDeviceId = String(data.deviceId);

          console.log("[DEVICE] registered:", nextDeviceId);

          deviceIdRef.current = nextDeviceId;
          setDeviceId(nextDeviceId);

          await sendDeviceLog({
            deviceId: nextDeviceId,
            eventType: "DEVICE_ID_REGISTERED_NATIVE",
            level: "info",
            message: "deviceId registered from WebView",
            url: currentUrlRef.current,
          });

          updateCurrentDeviceStatus("DEVICE_ID_REGISTERED", true);

          return;
        }

        if (data.type === "QUBER_COMMAND" && "command" in data) {
          await runQuberCommand(String(data.command));
          updateCurrentDeviceStatus("QUBER_COMMAND", true);
        }
      } catch (error) {
        console.log("[WEBVIEW] message parse failed:", error);

        await sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "WEBVIEW_MESSAGE_PARSE_ERROR",
          level: "warn",
          message: serializeError(error),
          url: currentUrlRef.current,
          payload: {
            rawData: event.nativeEvent.data,
          },
        });
      }
    },
    [updateCurrentDeviceStatus],
  );

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        Boolean(state.isConnected) && state.isInternetReachable !== false;

      const wasReady = networkReadyRef.current;

      networkReadyRef.current = connected;
      setIsNetworkReady(connected);

      if (connected && !wasReady) {
        console.log("[NETWORK] connected:", state.type);

        lastHeartbeatRef.current = Date.now();

        sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "NETWORK_CONNECTED",
          level: "info",
          message: "Network connected",
          url: currentUrlRef.current,
          payload: {
            type: state.type,
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
          },
        });

        updateDeviceStatus({
          deviceId: deviceIdRef.current,
          online: true,
          currentUrl: currentUrlRef.current,
          lastHeartbeatAt: lastHeartbeatRef.current,
          reloadCount: reloadCountRef.current,
          webview: {
            isPlayerPage: isPlayerPageRef.current,
            reason: "NETWORK_CONNECTED",
            currentIndex: currentContentRef.current.currentIndex,
            contentsLength: currentContentRef.current.contentsLength,
            currentContentUrl: currentContentRef.current.currentContentUrl,
            currentContentType: currentContentRef.current.currentContentType,
          },
          network: {
            connectType: state.type,
          },
        });

        if (webViewRef.current) {
          setTimeout(() => {
            webViewRef.current?.reload();
          }, 1000);
        }

        return;
      }

      if (!connected && wasReady) {
        console.log("[NETWORK] disconnected:", state.type);

        sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "NETWORK_DISCONNECTED",
          level: "warn",
          message: "Network disconnected",
          url: currentUrlRef.current,
          payload: {
            type: state.type,
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
          },
        });

        updateDeviceStatus({
          deviceId: deviceIdRef.current,
          online: false,
          currentUrl: currentUrlRef.current,
          lastHeartbeatAt: lastHeartbeatRef.current,
          reloadCount: reloadCountRef.current,
          webview: {
            isPlayerPage: isPlayerPageRef.current,
            lastError: "NETWORK_DISCONNECTED",
            currentIndex: currentContentRef.current.currentIndex,
            contentsLength: currentContentRef.current.contentsLength,
            currentContentUrl: currentContentRef.current.currentContentUrl,
            currentContentType: currentContentRef.current.currentContentType,
          },
          network: {
            connectType: state.type,
          },
        });
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!deviceId) return;

    deviceIdRef.current = deviceId;

    let isActive = true;

    async function setupNativePusher() {
      try {
        const channelName = `tv-native-status-${deviceId}`;

        if (nativeChannelRef.current === channelName) {
          return;
        }

        const pusher = Pusher.getInstance();

        await pusher.init({
          apiKey: PUSHER_KEY,
          cluster: PUSHER_CLUSTER,
          useTLS: true,
          onConnectionStateChange: (currentState, previousState) => {
            console.log(
              "[NATIVE PUSHER] state:",
              previousState,
              "->",
              currentState,
            );
          },
          onError: (message, code, error) => {
            console.log("[NATIVE PUSHER] error:", message, code, error);

            sendDeviceLog({
              deviceId: deviceIdRef.current,
              eventType: "NATIVE_PUSHER_ERROR",
              level: "warn",
              message: String(message || "NATIVE_PUSHER_ERROR"),
              url: currentUrlRef.current,
              payload: {
                code,
                error,
              },
            });
          },
        });

        await pusher.connect();

        await pusher.subscribe({
          channelName,
          onEvent: async (event: PusherEvent) => {
            if (!isActive) return;

            console.log("[NATIVE PUSHER] event:", event.eventName, event.data);

            await handleNativeCommand(event.eventName);
          },
        });

        nativeChannelRef.current = channelName;

        console.log("[NATIVE PUSHER] subscribed:", channelName);

        await sendDeviceLog({
          deviceId,
          eventType: "NATIVE_PUSHER_SUBSCRIBED",
          level: "info",
          message: channelName,
          url: currentUrlRef.current,
        });
      } catch (error) {
        console.log("[NATIVE PUSHER] setup failed:", error);

        await sendDeviceLog({
          deviceId: deviceIdRef.current,
          eventType: "NATIVE_PUSHER_SETUP_FAILED",
          level: "error",
          message: serializeError(error),
          url: currentUrlRef.current,
        });
      }
    }

    setupNativePusher();

    return () => {
      isActive = false;
    };
  }, [deviceId, handleNativeCommand]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!networkReadyRef.current) return;
      if (!isPlayerPageRef.current) return;

      const now = Date.now();
      const diff = now - lastHeartbeatRef.current;

      if (diff > PLAYER_HEARTBEAT_TIMEOUT) {
        reloadWebView(`PLAYER_HEARTBEAT_TIMEOUT_${diff}`);
      }
    }, WATCHDOG_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [reloadWebView]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});

    NavigationBar.setVisibilityAsync("hidden").catch(() => {});
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});

    setupAutoRun().then((autoRunResult) => {
      sendDeviceLog({
        deviceId: deviceIdRef.current,
        eventType: "QUBER_AUTORUN_SETUP",
        level: "info",
        message: "Quber AutoRun setup completed",
        url: currentUrlRef.current,
        payload: autoRunResult,
      });
    });

    sendDeviceLog({
      deviceId: deviceIdRef.current,
      eventType: "APP_STARTED",
      level: "info",
      message: "Info On TV app started",
      url: START_URL,
      payload: {
        startUrl: START_URL,
        channel: Updates.channel,
        runtimeVersion: Updates.runtimeVersion,
        updateId: Updates.updateId,
        isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      },
    });

    setTimeout(() => {
      updateCurrentDeviceStatus("APP_STARTED", true);
    }, 5000);

    const initialUpdateTimer = setTimeout(() => {
      if (networkReadyRef.current) {
        checkAndApplyUpdate(deviceIdRef.current);
      }
    }, 3000);

    const updateInterval = setInterval(
      () => {
        if (!networkReadyRef.current) return;

        console.log("[EAS UPDATE] periodic check...");
        checkAndApplyUpdate(deviceIdRef.current);
      },
      1000 * 60 * 5,
    );

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );

    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
      }

      clearTimeout(initialUpdateTimer);
      clearInterval(updateInterval);
      subscription.remove();
    };
  }, [updateCurrentDeviceStatus]);

  console.log("[START_URL]", START_URL);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {isNetworkReady ? (
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={{ uri: START_URL }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mixedContentMode="always"
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          originWhitelist={["*"]}
          onMessage={handleWebViewMessage}
          onNavigationStateChange={(navState) => {
            currentUrlRef.current = navState.url;

            if (navState.url.includes("tv-play.html")) {
              isPlayerPageRef.current = true;
            }

            if (navState.url.includes("tv-login.html")) {
              isPlayerPageRef.current = false;
              reloadCountRef.current = 0;
              lastHeartbeatRef.current = Date.now();
            }
          }}
          onLoadEnd={() => {
            console.log("[WEBVIEW] load end:", currentUrlRef.current);

            if (recoveryTimerRef.current) {
              clearTimeout(recoveryTimerRef.current);
              recoveryTimerRef.current = null;
            }
          }}
          onError={(event) => {
            console.log("[WEBVIEW] error:", event.nativeEvent);

            const message = String(
              event.nativeEvent.description || "WEBVIEW_ERROR",
            );

            sendDeviceLog({
              deviceId: deviceIdRef.current,
              eventType: "WEBVIEW_ERROR",
              level: "error",
              message,
              url: currentUrlRef.current,
              payload: event.nativeEvent,
            });

            updateDeviceStatus({
              deviceId: deviceIdRef.current,
              online: networkReadyRef.current,
              currentUrl: currentUrlRef.current,
              reloadCount: reloadCountRef.current,
              webview: {
                isPlayerPage: isPlayerPageRef.current,
                lastError: message,
                currentIndex: currentContentRef.current.currentIndex,
                contentsLength: currentContentRef.current.contentsLength,
                currentContentUrl: currentContentRef.current.currentContentUrl,
                currentContentType:
                  currentContentRef.current.currentContentType,
              },
            });

            scheduleRecovery("WEBVIEW_ERROR");
          }}
          onHttpError={(event) => {
            console.log("[WEBVIEW] http error:", event.nativeEvent);

            const message = `HTTP_${event.nativeEvent.statusCode}`;

            sendDeviceLog({
              deviceId: deviceIdRef.current,
              eventType: "WEBVIEW_HTTP_ERROR",
              level: "error",
              message,
              url: event.nativeEvent.url || currentUrlRef.current,
              payload: event.nativeEvent,
            });

            updateDeviceStatus({
              deviceId: deviceIdRef.current,
              online: networkReadyRef.current,
              currentUrl: currentUrlRef.current,
              reloadCount: reloadCountRef.current,
              webview: {
                isPlayerPage: isPlayerPageRef.current,
                lastError: message,
                currentIndex: currentContentRef.current.currentIndex,
                contentsLength: currentContentRef.current.contentsLength,
                currentContentUrl: currentContentRef.current.currentContentUrl,
                currentContentType:
                  currentContentRef.current.currentContentType,
              },
            });

            scheduleRecovery("WEBVIEW_HTTP_ERROR");
          }}
          onRenderProcessGone={(event) => {
            console.log("[WEBVIEW] render process gone:", event.nativeEvent);

            sendDeviceLog({
              deviceId: deviceIdRef.current,
              eventType: "WEBVIEW_RENDER_PROCESS_GONE",
              level: "error",
              message: "Android WebView render process gone",
              url: currentUrlRef.current,
              payload: event.nativeEvent,
            });

            updateDeviceStatus({
              deviceId: deviceIdRef.current,
              online: networkReadyRef.current,
              currentUrl: currentUrlRef.current,
              reloadCount: reloadCountRef.current,
              webview: {
                isPlayerPage: isPlayerPageRef.current,
                lastError: "WEBVIEW_RENDER_PROCESS_GONE",
                currentIndex: currentContentRef.current.currentIndex,
                contentsLength: currentContentRef.current.contentsLength,
                currentContentUrl: currentContentRef.current.currentContentUrl,
                currentContentType:
                  currentContentRef.current.currentContentType,
              },
            });

            resetToStartUrl("WEBVIEW_RENDER_PROCESS_GONE");
          }}
        />
      ) : (
        <View style={styles.networkWaiting}>
          <Text style={styles.networkTitle}>네트워크 연결 대기 중</Text>
          <Text style={styles.networkDescription}>
            Wi-Fi 또는 유선 네트워크가 연결되면 자동으로 재생을 시작합니다.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },

  webview: {
    flex: 1,
    backgroundColor: "#000",
  },

  networkWaiting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    backgroundColor: "#000",
  },

  networkTitle: {
    color: "#fff",
    fontSize: 34,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },

  networkDescription: {
    color: "#aaa",
    fontSize: 20,
    lineHeight: 30,
    textAlign: "center",
  },
});
