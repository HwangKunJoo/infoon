import { StatusBar } from "expo-status-bar";
import { BackHandler, NativeModules, StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useCallback, useEffect, useRef, useState } from "react";
import * as NavigationBar from "expo-navigation-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { Pusher, PusherEvent } from "@pusher/pusher-websocket-react-native";
import * as Updates from "expo-updates";

const WEB_VERSION = "20260514-1";
const START_URL = `https://info-on.cloud/tv-login.html?v=${WEB_VERSION}`;
const PACKAGE_NAME = "com.infoon.tv";

const PUSHER_KEY = process.env.EXPO_PUBLIC_PUSHER_KEY!;
const PUSHER_CLUSTER = process.env.EXPO_PUBLIC_PUSHER_CLUSTER!;

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

function logUpdateInfo(prefix = "[EAS UPDATE]") {
  console.log(`${prefix} isEnabled:`, Updates.isEnabled);
  console.log(`${prefix} channel:`, Updates.channel);
  console.log(`${prefix} runtimeVersion:`, Updates.runtimeVersion);
  console.log(`${prefix} updateId:`, Updates.updateId);
  console.log(`${prefix} createdAt:`, Updates.createdAt);
  console.log(`${prefix} isEmbeddedLaunch:`, Updates.isEmbeddedLaunch);
}

async function checkAndApplyUpdate() {
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

    console.log("[EAS UPDATE] update available. fetching...");

    const fetchResult = await Updates.fetchUpdateAsync();

    console.log("[EAS UPDATE] fetch result:", fetchResult);
    console.log("[EAS UPDATE] fetched. reloading app...");

    await Updates.reloadAsync();
  } catch (error) {
    console.log("[EAS UPDATE] failed:", error);
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
  } catch (error) {
    console.log("[QUBER] AutoRun setup failed:", error);
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

export default function HomeScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const nativeChannelRef = useRef<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const handleNativeCommand = useCallback(async (command: string) => {
    console.log("[NATIVE COMMAND] command:", command);

    switch (command) {
      case "reload-player":
        console.log("[NATIVE COMMAND] reload WebView");
        webViewRef.current?.reload();
        return;

      case "reload-app":
        console.log("[NATIVE COMMAND] reload app");
        await Updates.reloadAsync();
        return;

      case "tv-on":
        await scheduleTvWakeupInMinutes(3);
        await setHdmiOutputOn();
        await turnTvOnByCec();
        return;

      case "power-off":
        await turnTvStandbyByCec();
        return;

      case "reboot":
        console.log("[NATIVE COMMAND] reboot set-top box");
        await rebootSetTopBox();
        return;

      default:
        console.log("[NATIVE COMMAND] unknown command:", command);
    }
  }, []);

  const handleWebViewMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const rawData = event.nativeEvent.data;
        const data = JSON.parse(rawData) as WebViewMessage;

        if (data.type === "DEVICE_ID_REGISTERED" && "deviceId" in data) {
          const nextDeviceId = String(data.deviceId);

          console.log("[DEVICE] registered:", nextDeviceId);
          setDeviceId(nextDeviceId);
          return;
        }

        if (data.type === "QUBER_COMMAND" && "command" in data) {
          await runQuberCommand(String(data.command));
        }
      } catch (error) {
        console.log("[WEBVIEW] message parse failed:", error);
      }
    },
    [],
  );

  useEffect(() => {
    if (!deviceId) return;

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
      } catch (error) {
        console.log("[NATIVE PUSHER] setup failed:", error);
      }
    }

    setupNativePusher();

    return () => {
      isActive = false;
    };
  }, [deviceId, handleNativeCommand]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});

    NavigationBar.setVisibilityAsync("hidden").catch(() => {});
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});

    setupAutoRun();

    const initialUpdateTimer = setTimeout(() => {
      checkAndApplyUpdate();
    }, 3000);

    const updateInterval = setInterval(
      () => {
        console.log("[EAS UPDATE] periodic check...");
        checkAndApplyUpdate();
      },
      1000 * 60 * 5,
    );

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );

    return () => {
      clearTimeout(initialUpdateTimer);
      clearInterval(updateInterval);
      subscription.remove();
    };
  }, []);

  console.log("[START_URL]", START_URL);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <WebView
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
        onError={(event) => {
          console.log("[WEBVIEW] error:", event.nativeEvent);
        }}
        onHttpError={(event) => {
          console.log("[WEBVIEW] http error:", event.nativeEvent);
        }}
      />
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
});
