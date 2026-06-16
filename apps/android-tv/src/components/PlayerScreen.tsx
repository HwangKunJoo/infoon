import { Pusher, PusherEvent } from "@pusher/pusher-websocket-react-native";
import { useEventListener } from "expo";
import * as Updates from "expo-updates";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchDevices } from "../lib/deviceApi";
import { sendDeviceLog, updateDeviceStatus } from "../lib/firebaseLogger";
import { extractContentsForDevice } from "../lib/playlist";

type PlayerScreenProps = {
  token: string;
  deviceId: string;
  onLogout: () => void;
};

type ContentItem = {
  url: string;
  type: "image" | "video";
  duration?: number;
  title?: string;
  [key: string]: unknown;
};

type PlayerStatus = "loading" | "playing" | "empty" | "error";

type DeviceOrientation = "landscape" | "portrait" | "square" | "unknown";

type QuberModuleType = {
  sendRequest?: (jsonMsg: string) => Promise<string>;
};

type QuberStatusResult = {
  raw: Record<string, unknown>;
  quber: {
    firmwareVersion: unknown;
    hdmiConnected: unknown;
    displayStatus: unknown;
    autoRunStatus: unknown;
    lastCommand: string | null;
    lastCommandResult: unknown;
  };
  network: {
    connectType: unknown;
    wifiSsid: unknown;
    lastError?: string | null;
  };
};

type CurrentStatusPayload = {
  deviceId: string;
  online: boolean;
  currentUrl: string;
  app: {
    channel: string | null;
    runtimeVersion: string | null;
    updateId: string | null;
    isEmbeddedLaunch: boolean | null;
  };
  player: {
    mode: "native";
    platform: "android";
    status: PlayerStatus;
    reason: string;
    currentIndex: number;
    currentDisplayIndex: number | null;
    contentsLength: number;
    currentContentUrl: string;
    currentContentType: string;
    pusherConnected: boolean;
    orientation: DeviceOrientation;
    orientationLabel: string;
    windowWidth: number;
    windowHeight: number;
    lastError: string | null;
    checkedAtClient: number;
  };
};

const IMAGE_DURATION_SECONDS = 15;
const IMAGE_PREFETCH_TIMEOUT = 4000;
const VIDEO_START_TIMEOUT = 10000;
const TRANSITION_LOCK_TIMEOUT = 12000;
const IMAGE_STUCK_TIMEOUT = 45000;
const DISPLAY_WATCHDOG_INTERVAL = 10000;
const ERROR_RETRY_DELAY = 30000;
const NEXT_DELAY = 300;

const PACKAGE_NAME = "com.infoon.tv";

const PUSHER_KEY =
  process.env.EXPO_PUBLIC_PUSHER_KEY || "a707a1d344893077c43d";
const PUSHER_CLUSTER = process.env.EXPO_PUBLIC_PUSHER_CLUSTER || "ap3";

const PUSHER_REFRESH_EVENT = "refresh";
const PUSHER_STATUS_REQUEST_EVENT = "status_request";
const PUSHER_CHECK_UPDATE_EVENT = "check-update";

const CONTROL_CHANNEL_PREFIX = "tv-control";
const NATIVE_CHANNEL_PREFIX = "tv-native";

const QuberModule = NativeModules.QuberModule as QuberModuleType | undefined;

function getCurrentDeviceOrientation() {
  try {
    const { width, height } = Dimensions.get("window");

    let orientation: DeviceOrientation = "unknown";

    if (width > height) {
      orientation = "landscape";
    } else if (height > width) {
      orientation = "portrait";
    } else if (width === height && width > 0) {
      orientation = "square";
    }

    return {
      orientation,
      orientationLabel:
        orientation === "landscape"
          ? "가로"
          : orientation === "portrait"
            ? "세로"
            : orientation === "square"
              ? "정방형"
              : "알 수 없음",
      windowWidth: width,
      windowHeight: height,
    };
  } catch {
    return {
      orientation: "unknown" as DeviceOrientation,
      orientationLabel: "알 수 없음",
      windowWidth: 0,
      windowHeight: 0,
    };
  }
}

function getErrorMessage(error: unknown) {
  if (!error) return "UNKNOWN_ERROR";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

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

function parsePusherData(data: unknown) {
  if (!data) return null;

  if (typeof data === "object") {
    return data;
  }

  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  return data;
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

function getAppStatusPayload() {
  return {
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
  };
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

    console.log("[QUBER] response:", {
      cmdCode,
      response,
    });

    return response;
  } catch (error) {
    console.log("[QUBER] request failed:", {
      cmdCode,
      error,
    });

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
      setResult: parseQuberResponse(setResult),
      readResult: parseQuberResponse(readResult),
    };
  } catch (error) {
    console.log("[QUBER] AutoRun setup failed:", error);

    return {
      setResult: null,
      readResult: null,
      error: getErrorMessage(error),
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

async function readQuberDeviceStatus(): Promise<QuberStatusResult> {
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

function normalizeNativeCommand(eventName: string, eventData: unknown) {
  let command = eventName;

  if (eventName === "quber_command" && eventData && typeof eventData === "object") {
    const data = eventData as Record<string, unknown>;

    if (typeof data.command === "string") {
      command = data.command;
    } else if (typeof data.event === "string") {
      command = data.event;
    }
  }

  switch (command) {
    case "reload-app":
    case "app-reload":
    case "restart-app":
    case "app-restart":
      return "reload-app";

    case "reboot":
    case "reboot-device":
    case "restart-device":
    case "settop-reboot":
      return "reboot";

    case "tv-on":
    case "display-on":
    case "hdmi-on":
      return "tv-on";

    case "tv-off":
    case "power-off":
    case "display-off":
    case "hdmi-off":
      return "tv-off";

    case "check-update":
    case "update-check":
    case "apply-update":
    case "app-update-apply":
      return "check-update";

    default:
      return command;
  }
}

export function PlayerScreen({ token, deviceId, onLogout }: PlayerScreenProps) {
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [, setContents] = useState<ContentItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [, setCurrentImageUrl] = useState("");
  const [backImageUrl, setBackImageUrl] = useState("");
  const [frontImageUrl, setFrontImageUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pusherConnected, setPusherConnected] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);

  const contentsRef = useRef<ContentItem[]>([]);
  const currentIndexRef = useRef(0);
  const imageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playSeqRef = useRef(0);
  const currentImageUrlRef = useRef("");
  const frontImageOpacityRef = useRef(new Animated.Value(0));
  const pendingImageRef = useRef<{
    seq: number;
    url: string;
    durationMs: number;
  } | null>(null);
  const pendingImageFallbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const videoVisibleRef = useRef(false);
  const activeContentTypeRef = useRef<"image" | "video" | null>(null);
  const isPreparingVideoRef = useRef(false);
  const activeVideoSeqRef = useRef(0);
  const preparingVideoSeqRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const transitionLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastDisplayChangedAtRef = useRef(Date.now());
  const currentImageDurationMsRef = useRef(IMAGE_DURATION_SECONDS * 1000);

  const pusherRef = useRef<Pusher | null>(null);
  const pusherChannelNamesRef = useRef<string[]>([]);
  const isPusherSetupRef = useRef(false);
  const pusherSetupKeyRef = useRef<string | null>(null);

  const loadPlaylistRef = useRef<(reason?: string) => Promise<void>>(
    async () => {},
  );

  const handleNativeCommandRef = useRef<
    (eventName: string, eventData: unknown, channelName: string) => Promise<void>
  >(async () => {});

  const handleStatusRequestRef = useRef<(eventData?: unknown) => Promise<void>>(
    async () => {},
  );

  const checkAndApplyUpdateRef = useRef<
    (reason: string, eventData?: unknown) => Promise<void>
  >(async () => {});

  const isCheckingUpdateRef = useRef(false);

  const statusSnapshotRef = useRef({
    status: "loading" as PlayerStatus,
    errorMessage: "",
    pusherConnected: false,
  });

  const getCurrentStatusPayloadRef = useRef<
    (reason: string) => CurrentStatusPayload
  >(() => ({
    deviceId,
    online: true,
    currentUrl: "",
    app: getAppStatusPayload(),
    player: {
      mode: "native",
      platform: "android",
      status: "loading",
      reason: "UNKNOWN",
      currentIndex: 0,
      currentDisplayIndex: null,
      contentsLength: 0,
      currentContentUrl: "",
      currentContentType: "",
      pusherConnected: false,
      ...getCurrentDeviceOrientation(),
      lastError: null,
      checkedAtClient: Date.now(),
    },
  }));

  const player = useVideoPlayer(null, (player) => {
    player.loop = false;
    player.muted = true;
    player.timeUpdateEventInterval = 1;
  });

  const markDisplayChanged = useCallback(() => {
    lastDisplayChangedAtRef.current = Date.now();
  }, []);

  const unlockTransition = useCallback(() => {
    isTransitioningRef.current = false;

    if (transitionLockTimerRef.current) {
      clearTimeout(transitionLockTimerRef.current);
      transitionLockTimerRef.current = null;
    }
  }, []);

  const lockTransition = useCallback(
    (reason?: string) => {
      if (isTransitioningRef.current) {
        console.log("[PLAYER] transition already in progress. skip:", reason);
        return false;
      }

      isTransitioningRef.current = true;

      if (transitionLockTimerRef.current) {
        clearTimeout(transitionLockTimerRef.current);
      }

      transitionLockTimerRef.current = setTimeout(() => {
        console.log("[PLAYER] transition lock timeout. force unlock:", reason);
        unlockTransition();
      }, TRANSITION_LOCK_TIMEOUT);

      return true;
    },
    [unlockTransition],
  );

  const clearTimers = useCallback(() => {
    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }

    if (videoStartTimerRef.current) {
      clearTimeout(videoStartTimerRef.current);
      videoStartTimerRef.current = null;
    }

    if (nextTimerRef.current) {
      clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }

    if (pendingImageFallbackTimerRef.current) {
      clearTimeout(pendingImageFallbackTimerRef.current);
      pendingImageFallbackTimerRef.current = null;
    }
  }, []);

  const setImageUrlSafely = useCallback(
    (url: string) => {
      currentImageUrlRef.current = url;
      setCurrentImageUrl(url);

      if (!url) {
        pendingImageRef.current = null;

        if (pendingImageFallbackTimerRef.current) {
          clearTimeout(pendingImageFallbackTimerRef.current);
          pendingImageFallbackTimerRef.current = null;
        }

        frontImageOpacityRef.current.stopAnimation();
        frontImageOpacityRef.current.setValue(0);
        setBackImageUrl("");
        setFrontImageUrl("");
      }

      if (url) {
        markDisplayChanged();
      }
    },
    [markDisplayChanged],
  );

  const setVideoVisibleSafely = useCallback(
    (visible: boolean) => {
      videoVisibleRef.current = visible;
      setVideoVisible(visible);

      if (visible) {
        markDisplayChanged();
      }
    },
    [markDisplayChanged],
  );

  const clearVideo = useCallback(() => {
    isPreparingVideoRef.current = false;
    preparingVideoSeqRef.current = 0;
    activeVideoSeqRef.current = 0;
    videoVisibleRef.current = false;
    setVideoVisible(false);

    try {
      player.pause();
    } catch (error) {
      console.log("[PLAYER] video pause failed:", error);
    }

    try {
      player.replace(null);
    } catch (error) {
      console.log("[PLAYER] video clear failed:", error);
    }
  }, [player]);

  const findNextImageIndex = useCallback((fromIndex: number) => {
    const list = contentsRef.current;

    if (!list.length) return null;

    let nextIndex = (fromIndex + 1) % list.length;

    for (let i = 0; i < list.length; i += 1) {
      const item = list[nextIndex];

      if (item?.type === "image" && item.url) {
        return nextIndex;
      }

      nextIndex = (nextIndex + 1) % list.length;
    }

    return null;
  }, []);

  const scheduleIndexChange = useCallback(
    (nextIndex: number, reason?: string) => {
      const list = contentsRef.current;

      if (!list.length) {
        setImageUrlSafely("");
        setVideoVisibleSafely(false);
        setStatus("empty");
        unlockTransition();
        return;
      }

      let safeNextIndex = nextIndex % list.length;

      if (
        list.length > 1 &&
        safeNextIndex === currentIndexRef.current &&
        reason !== "single_content_loop"
      ) {
        safeNextIndex = (safeNextIndex + 1) % list.length;
      }

      nextTimerRef.current = setTimeout(() => {
        currentIndexRef.current = safeNextIndex;
        setCurrentIndex(safeNextIndex);
      }, NEXT_DELAY);
    },
    [setImageUrlSafely, setVideoVisibleSafely, unlockTransition],
  );

  const goNext = useCallback(
    (reason?: string) => {
      const list = contentsRef.current;

      console.log("[PLAYER] next:", reason);

      if (!lockTransition(reason)) return;

      clearTimers();

      if (!list.length) {
        setImageUrlSafely("");
        setVideoVisibleSafely(false);
        setStatus("empty");
        unlockTransition();
        return;
      }

      const nextIndex = (currentIndexRef.current + 1) % list.length;
      scheduleIndexChange(nextIndex, reason);
    },
    [
      clearTimers,
      lockTransition,
      scheduleIndexChange,
      setImageUrlSafely,
      setVideoVisibleSafely,
      unlockTransition,
    ],
  );

  const goNextImage = useCallback(
    (reason?: string) => {
      const list = contentsRef.current;

      console.log("[PLAYER] next image:", reason);

      if (!lockTransition(reason)) return;

      clearTimers();

      if (!list.length) {
        setImageUrlSafely("");
        setVideoVisibleSafely(false);
        setStatus("empty");
        unlockTransition();
        return;
      }

      const nextImageIndex = findNextImageIndex(currentIndexRef.current);

      if (nextImageIndex === null) {
        console.log("[PLAYER] next image not found. fallback to next:", reason);
        scheduleIndexChange((currentIndexRef.current + 1) % list.length, reason);
        return;
      }

      scheduleIndexChange(nextImageIndex, reason);
    },
    [
      clearTimers,
      findNextImageIndex,
      lockTransition,
      scheduleIndexChange,
      setImageUrlSafely,
      setVideoVisibleSafely,
      unlockTransition,
    ],
  );

  const prefetchImage = useCallback(
    async (url: string, seq: number, reason: string) => {
      try {
        await withTimeout(
          Image.prefetch(url),
          IMAGE_PREFETCH_TIMEOUT,
          "IMAGE_PREFETCH_TIMEOUT",
        );

        if (playSeqRef.current !== seq) return false;

        return true;
      } catch (error) {
        if (playSeqRef.current !== seq) return false;

        const message = getErrorMessage(error);

        console.log("[PLAYER] image prefetch failed:", {
          reason,
          url,
          message,
        });

        void sendDeviceLog({
          deviceId,
          eventType: "IMAGE_PREFETCH_FAILED",
          level: "warn",
          message,
          url,
          payload: {
            reason,
            currentIndex: currentIndexRef.current,
            contentsLength: contentsRef.current.length,
          },
        });

        return false;
      }
    },
    [deviceId],
  );

  const prefetchNextImage = useCallback(
    (fromIndex: number, seq: number, reason: string) => {
      const list = contentsRef.current;

      if (list.length <= 1) return;

      const nextImageIndex = findNextImageIndex(fromIndex);

      if (nextImageIndex === null) return;

      const nextImage = list[nextImageIndex];

      if (!nextImage?.url) return;

      void prefetchImage(nextImage.url, seq, reason);
    },
    [findNextImageIndex, prefetchImage],
  );

  const startImageDurationTimer = useCallback(
    (durationMs: number, seq: number) => {
      if (imageTimerRef.current) {
        clearTimeout(imageTimerRef.current);
        imageTimerRef.current = null;
      }

      imageTimerRef.current = setTimeout(() => {
        if (playSeqRef.current !== seq) return;
        goNext("image_duration_end");
      }, durationMs);
    },
    [goNext],
  );

  const completeImageTransition = useCallback(
    (url: string, durationMs: number, seq: number) => {
      currentImageUrlRef.current = url;
      setCurrentImageUrl(url);
      markDisplayChanged();

      setBackImageUrl(url);
      setFrontImageUrl("");
      frontImageOpacityRef.current.setValue(0);

      activeContentTypeRef.current = "image";
      isPreparingVideoRef.current = false;
      preparingVideoSeqRef.current = 0;
      activeVideoSeqRef.current = 0;

      setStatus("playing");

      // 영상 → 이미지 전환에서는 VideoView를 먼저 내리면 이미지가 화면에 붙기 전
      // 한 프레임 검정 화면이 보일 수 있다. 이미지를 먼저 반영하고 다음 프레임에 영상 레이어를 내린다.
      if (videoVisibleRef.current) {
        requestAnimationFrame(() => {
          if (playSeqRef.current !== seq) return;

          setVideoVisibleSafely(false);

          setTimeout(() => {
            if (playSeqRef.current !== seq) return;
            clearVideo();
          }, 120);
        });
      } else {
        setVideoVisibleSafely(false);
        clearVideo();
      }

      unlockTransition();

      startImageDurationTimer(durationMs, seq);

      // 현재 이미지가 화면에 올라간 직후, 다음 이미지 1장만 미리 캐시에 올린다.
      // 전환 시점에 네트워크/디코딩 작업이 몰리는 것을 줄이기 위한 lookahead prefetch다.
      requestAnimationFrame(() => {
        if (playSeqRef.current !== seq) return;
        prefetchNextImage(
          currentIndexRef.current,
          seq,
          "lookahead_after_image_commit",
        );
      });
    },
    [
      clearVideo,
      markDisplayChanged,
      prefetchNextImage,
      setVideoVisibleSafely,
      startImageDurationTimer,
      unlockTransition,
    ],
  );

  const commitPendingImage = useCallback(
    (reason: string) => {
      const pending = pendingImageRef.current;

      if (!pending) return;
      if (playSeqRef.current !== pending.seq) return;

      console.log("[PLAYER] commit front image:", {
        reason,
        url: pending.url,
      });

      if (pendingImageFallbackTimerRef.current) {
        clearTimeout(pendingImageFallbackTimerRef.current);
        pendingImageFallbackTimerRef.current = null;
      }

      pendingImageRef.current = null;
      frontImageOpacityRef.current.stopAnimation();

      const hadPreviousImage = !!currentImageUrlRef.current;

      if (!hadPreviousImage) {
        completeImageTransition(pending.url, pending.durationMs, pending.seq);
        return;
      }

      frontImageOpacityRef.current.setValue(0);

      Animated.timing(frontImageOpacityRef.current, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        if (playSeqRef.current !== pending.seq) return;

        completeImageTransition(pending.url, pending.durationMs, pending.seq);
      });
    },
    [completeImageTransition],
  );

  const handleFrontImageLoaded = useCallback(() => {
    // onLoadEnd 직후 바로 교체하면 일부 Android TV에서 한 프레임 튈 수 있어서
    // 다음 프레임에 100ms micro fade를 시작한다.
    requestAnimationFrame(() => {
      commitPendingImage("on_load_end");
    });
  }, [commitPendingImage]);

  const handleImageError = useCallback(
    (url: string, event: unknown, layer: "back" | "front") => {
      console.log("[PLAYER] image error:", {
        layer,
        url,
        event,
      });

      void sendDeviceLog({
        deviceId,
        eventType: "IMAGE_LOAD_ERROR",
        level: "warn",
        message: "image load failed",
        url,
        payload: {
          layer,
          currentIndex: currentIndexRef.current,
          contentsLength: contentsRef.current.length,
          currentContentType: "image",
        },
      });

      if (layer === "front") {
        pendingImageRef.current = null;

        if (pendingImageFallbackTimerRef.current) {
          clearTimeout(pendingImageFallbackTimerRef.current);
          pendingImageFallbackTimerRef.current = null;
        }

        frontImageOpacityRef.current.stopAnimation();
        frontImageOpacityRef.current.setValue(0);
        setFrontImageUrl("");
        unlockTransition();
      }

      goNext("image_error");
    },
    [deviceId, goNext, unlockTransition],
  );

  const playImage = useCallback(
    async (item: ContentItem, seq: number) => {
      clearTimers();

      const url = item.url;
      const duration = Number(item.duration || IMAGE_DURATION_SECONDS);
      const durationMs = Math.max(1, duration) * 1000;

      currentImageDurationMsRef.current = durationMs;

      console.log("[PLAYER] play image:", {
        url,
        duration,
      });

      await prefetchImage(url, seq, "play_image");

      if (playSeqRef.current !== seq) return;

      setStatus("playing");

      pendingImageRef.current = {
        seq,
        url,
        durationMs,
      };

      if (pendingImageFallbackTimerRef.current) {
        clearTimeout(pendingImageFallbackTimerRef.current);
      }

      // 같은 URL이 반복되거나 특정 Android TV에서 onLoadEnd가 누락되는 경우를 대비한다.
      // 기존 back image는 유지되므로 fallback이 동작해도 검정 화면으로 비우지는 않는다.
      pendingImageFallbackTimerRef.current = setTimeout(() => {
        commitPendingImage("fallback_timeout");
      }, 1500);

      frontImageOpacityRef.current.stopAnimation();
      frontImageOpacityRef.current.setValue(0);
      setFrontImageUrl(url);
    },
    [clearTimers, commitPendingImage, prefetchImage],
  );

  const playVideo = useCallback(
    async (item: ContentItem, seq: number) => {
      clearTimers();

      const url = item.url;

      console.log("[PLAYER] play video:", url);

      activeContentTypeRef.current = "video";
      isPreparingVideoRef.current = true;
      preparingVideoSeqRef.current = seq;
      activeVideoSeqRef.current = 0;

      setStatus("playing");
      setVideoVisibleSafely(false);

      try {
        try {
          player.pause();
        } catch (error) {
          console.log("[PLAYER] video pause before replace failed:", error);
        }

        videoStartTimerRef.current = setTimeout(() => {
          if (playSeqRef.current !== seq) return;
          if (!isPreparingVideoRef.current) return;

          console.log("[PLAYER] video start timeout:", url);

          isPreparingVideoRef.current = false;
          preparingVideoSeqRef.current = 0;
          setVideoVisibleSafely(false);

          void sendDeviceLog({
            deviceId,
            eventType: "VIDEO_START_TIMEOUT",
            level: "warn",
            message: "video did not start within timeout",
            url,
            payload: {
              currentIndex: currentIndexRef.current,
              contentsLength: contentsRef.current.length,
              currentContentType: "video",
            },
          });

          unlockTransition();
          goNextImage("video_start_timeout");
        }, VIDEO_START_TIMEOUT);

        await player.replaceAsync({
          uri: url,
        });

        if (playSeqRef.current !== seq) return;

        player.muted = true;
        player.loop = false;
        player.play();

        prefetchNextImage(currentIndexRef.current, seq, "video_next_image");

        console.log("[PLAYER] video play called:", url);
      } catch (error) {
        if (playSeqRef.current !== seq) return;

        isPreparingVideoRef.current = false;
        preparingVideoSeqRef.current = 0;
        setVideoVisibleSafely(false);

        const message = getErrorMessage(error);

        console.log("[PLAYER] video error:", message);

        void sendDeviceLog({
          deviceId,
          eventType: "VIDEO_STATUS_ERROR",
          level: "error",
          message,
          url,
          payload: {
            currentIndex: currentIndexRef.current,
            contentsLength: contentsRef.current.length,
            currentContentType: "video",
          },
        });

        unlockTransition();
        goNextImage("video_error");
      }
    },
    [
      clearTimers,
      deviceId,
      goNextImage,
      player,
      prefetchNextImage,
      setVideoVisibleSafely,
      unlockTransition,
    ],
  );

  const playCurrent = useCallback(() => {
    const list = contentsRef.current;

    clearTimers();

    if (!list.length) {
      setImageUrlSafely("");
      setVideoVisibleSafely(false);
      setStatus("empty");
      unlockTransition();
      return;
    }

    const safeIndex =
      currentIndexRef.current >= list.length ? 0 : currentIndexRef.current;

    currentIndexRef.current = safeIndex;
    setCurrentIndex(safeIndex);

    const item = list[safeIndex];

    if (!item || !item.url) {
      goNext("empty_url");
      return;
    }

    const seq = playSeqRef.current + 1;
    playSeqRef.current = seq;

    if (item.type === "video") {
      void playVideo(item, seq);
      return;
    }

    void playImage(item, seq);
  }, [
    clearTimers,
    goNext,
    playImage,
    playVideo,
    setImageUrlSafely,
    setVideoVisibleSafely,
    unlockTransition,
  ]);

  const loadPlaylist = useCallback(
    async (reason?: string) => {
      const isInitialLoad = reason === "mount";
      const hasExistingContents = contentsRef.current.length > 0;

      console.log("[PLAYER] load playlist:", {
        reason,
        isInitialLoad,
        hasExistingContents,
      });

      if (isInitialLoad || !hasExistingContents) {
        playSeqRef.current += 1;

        clearTimers();
        clearVideo();

        setVideoVisibleSafely(false);
        setImageUrlSafely("");
        setStatus("loading");
      }

      setErrorMessage("");

      try {
        const response = await fetchDevices(token);
        const nextContents = extractContentsForDevice(response, deviceId);

        if (!nextContents.length) {
          void sendDeviceLog({
            deviceId,
            eventType: "PLAYLIST_EMPTY",
            level: "warn",
            message: "playlist is empty",
            payload: {
              reason,
            },
          });

          if (isInitialLoad || !hasExistingContents) {
            contentsRef.current = [];
            setContents([]);
            setStatus("empty");
          }

          return;
        }

        contentsRef.current = nextContents;
        setContents(nextContents);

        if (isInitialLoad || !hasExistingContents) {
          currentIndexRef.current = 0;
          setCurrentIndex(0);
          setStatus("playing");
          return;
        }

        if (currentIndexRef.current >= nextContents.length) {
          currentIndexRef.current = 0;
          setCurrentIndex(0);
        }

        setStatus("playing");

        void sendDeviceLog({
          deviceId,
          eventType: "PLAYLIST_REFRESH_APPLIED",
          level: "info",
          message: "playlist refreshed while keeping current playback",
          payload: {
            reason,
            contentsLength: nextContents.length,
            currentIndex: currentIndexRef.current,
          },
        });
      } catch (error) {
        const message = getErrorMessage(error);

        console.log("[PLAYER] load playlist failed:", message);

        setErrorMessage(message);

        if (isInitialLoad || !hasExistingContents) {
          setStatus("error");
        } else {
          setStatus("playing");
        }

        void sendDeviceLog({
          deviceId,
          eventType: "PLAYLIST_FETCH_ERROR",
          level: "error",
          message,
          payload: {
            reason,
            keptExistingPlayback: hasExistingContents && !isInitialLoad,
          },
        });
      }
    },
    [
      clearTimers,
      clearVideo,
      deviceId,
      setImageUrlSafely,
      setVideoVisibleSafely,
      token,
    ],
  );

  const updateQuberStatus = useCallback(
    async (
      reason: string,
      options?: {
        eventData?: unknown;
        commandResult?: unknown;
        lastCommand?: string;
      },
    ) => {
      const baseStatus = getCurrentStatusPayloadRef.current(reason);

      try {
        const quberStatus = await readQuberDeviceStatus();

        await updateDeviceStatus({
          ...baseStatus,
          quber: {
            ...quberStatus.quber,
            lastCommand: options?.lastCommand || quberStatus.quber.lastCommand,
            lastCommandResult:
              options && "commandResult" in options
                ? options.commandResult
                : quberStatus.quber.lastCommandResult,
          },
          network: quberStatus.network,
          payload: {
            eventData: options?.eventData,
            rawQuberStatus: quberStatus.raw,
            commandResult: options?.commandResult,
          },
        });

        void sendDeviceLog({
          deviceId,
          eventType: "QUBER_STATUS_READ",
          level: "info",
          message: "Quber status updated",
          payload: {
            reason,
            eventData: options?.eventData,
            quber: quberStatus.quber,
            network: quberStatus.network,
          },
        });
      } catch (error) {
        const message = getErrorMessage(error);

        console.log("[QUBER] status update failed:", message);

        await updateDeviceStatus({
          ...baseStatus,
          quber: {
            lastCommand: options?.lastCommand || "READ_STATUS",
            lastCommandResult:
              options && "commandResult" in options
                ? options.commandResult
                : null,
            lastError: message,
          },
          network: {
            connectType: null,
            wifiSsid: null,
            lastError: message,
          },
          payload: {
            eventData: options?.eventData,
            commandResult: options?.commandResult,
            quberError: message,
          },
        });

        void sendDeviceLog({
          deviceId,
          eventType: "QUBER_STATUS_READ_FAILED",
          level: "warn",
          message,
          payload: {
            reason,
            eventData: options?.eventData,
          },
        });
      }
    },
    [deviceId],
  );

  const handleStatusRequest = useCallback(
    async (eventData?: unknown) => {
      console.log("[PUSHER] status_request received:", eventData);

      void sendDeviceLog({
        deviceId,
        eventType: "STATUS_REQUEST_RECEIVED",
        level: "info",
        message: "status request received from admin",
        payload: {
          eventData,
        },
      });

      await updateQuberStatus("STATUS_REQUEST_RECEIVED", {
        eventData,
        lastCommand: "READ_STATUS",
      });
    },
    [deviceId, updateQuberStatus],
  );

  const checkAndApplyUpdate = useCallback(
    async (reason: string, eventData?: unknown) => {
      console.log("[UPDATES] check requested:", {
        reason,
        eventData,
      });

      if (isCheckingUpdateRef.current) {
        console.log("[UPDATES] already checking. skip");
        return;
      }

      isCheckingUpdateRef.current = true;

      try {
        if (__DEV__) {
          console.log("[UPDATES] skip in dev");
          return;
        }

        if (!Updates.isEnabled) {
          console.log("[UPDATES] disabled");

          await sendDeviceLog({
            deviceId,
            eventType: "UPDATE_CHECK_FAILED",
            level: "warn",
            message: "expo updates disabled",
            payload: {
              reason,
              eventData,
              channel: Updates.channel,
              runtimeVersion: Updates.runtimeVersion,
              updateId: Updates.updateId,
              isEmbeddedLaunch: Updates.isEmbeddedLaunch,
            },
          });

          return;
        }

        await sendDeviceLog({
          deviceId,
          eventType: "UPDATE_CHECK_REQUESTED",
          level: "info",
          message: "update check requested",
          payload: {
            reason,
            eventData,
            channel: Updates.channel,
            runtimeVersion: Updates.runtimeVersion,
            updateId: Updates.updateId,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          },
        });

        const update = await Updates.checkForUpdateAsync();

        if (!update.isAvailable) {
          await sendDeviceLog({
            deviceId,
            eventType: "UPDATE_NOT_AVAILABLE",
            level: "info",
            message: "no update available",
            payload: {
              reason,
              eventData,
              channel: Updates.channel,
              runtimeVersion: Updates.runtimeVersion,
              updateId: Updates.updateId,
              isEmbeddedLaunch: Updates.isEmbeddedLaunch,
            },
          });

          return;
        }

        await sendDeviceLog({
          deviceId,
          eventType: "UPDATE_AVAILABLE",
          level: "info",
          message: "update available. fetching update",
          payload: {
            reason,
            eventData,
            channel: Updates.channel,
            runtimeVersion: Updates.runtimeVersion,
            currentUpdateId: Updates.updateId,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          },
        });

        const fetchResult = await Updates.fetchUpdateAsync();

        await sendDeviceLog({
          deviceId,
          eventType: "UPDATE_FETCHED",
          level: "info",
          message: fetchResult.isNew
            ? "update fetched. reloading app"
            : "update fetch completed. no new update to apply",
          payload: {
            reason,
            eventData,
            isNew: fetchResult.isNew,
            channel: Updates.channel,
            runtimeVersion: Updates.runtimeVersion,
            previousUpdateId: Updates.updateId,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          },
        });

        if (fetchResult.isNew) {
          await Updates.reloadAsync();
        }
      } catch (error) {
        const message = getErrorMessage(error);

        console.log("[UPDATES] check/apply failed:", message);

        await sendDeviceLog({
          deviceId,
          eventType: "UPDATE_CHECK_FAILED",
          level: "warn",
          message,
          payload: {
            reason,
            eventData,
            channel: Updates.channel,
            runtimeVersion: Updates.runtimeVersion,
            updateId: Updates.updateId,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          },
        });
      } finally {
        isCheckingUpdateRef.current = false;
      }
    },
    [deviceId],
  );

  const reloadAppSafely = useCallback(
    async (eventData: unknown) => {
      await sendDeviceLog({
        deviceId,
        eventType: "QUBER_COMMAND_RECEIVED",
        level: "info",
        message: "app reload requested from admin",
        payload: {
          eventData,
          updatesEnabled: Updates.isEnabled,
          channel: Updates.channel,
          runtimeVersion: Updates.runtimeVersion,
          updateId: Updates.updateId,
          isEmbeddedLaunch: Updates.isEmbeddedLaunch,
        },
      });

      try {
        if (Updates.isEnabled) {
          console.log("[NATIVE COMMAND] reload-app: Updates.reloadAsync");
          await Updates.reloadAsync();
          return;
        }

        console.log("[NATIVE COMMAND] reload-app skipped: updates disabled");
      } catch (error) {
        console.log("[NATIVE COMMAND] reload-app failed:", getErrorMessage(error));
      }

      console.log("[NATIVE COMMAND] reload-app fallback: load playlist");
      await loadPlaylistRef.current("native_reload_app_fallback");
    },
    [deviceId],
  );

  const handleNativeCommand = useCallback(
    async (eventName: string, eventData: unknown, channelName: string) => {
      const command = normalizeNativeCommand(eventName, eventData);

      console.log("[NATIVE COMMAND] received:", {
        command,
        eventName,
        channelName,
        eventData,
      });

      void sendDeviceLog({
        deviceId,
        eventType: "QUBER_COMMAND_RECEIVED",
        level: "info",
        message: command,
        payload: {
          eventName,
          channelName,
          eventData,
        },
      });

      try {
        switch (command) {
          case "tv-on": {
            const wakeupResult = await scheduleTvWakeupInMinutes(3);
            const hdmiResult = await setHdmiOutputOn();
            const tvOnResult = await turnTvOnByCec();

            await updateQuberStatus("NATIVE_COMMAND_TV_ON", {
              eventData,
              lastCommand: "TV_ON",
              commandResult: {
                wakeupResult: parseQuberResponse(wakeupResult),
                hdmiResult: parseQuberResponse(hdmiResult),
                tvOnResult: parseQuberResponse(tvOnResult),
              },
            });

            return;
          }

          case "tv-off": {
            const powerOffResult = await turnTvStandbyByCec();

            await updateQuberStatus("NATIVE_COMMAND_POWER_OFF", {
              eventData,
              lastCommand: "POWER_OFF",
              commandResult: parseQuberResponse(powerOffResult),
            });

            return;
          }

          case "reboot": {
            const rebootResult = await rebootSetTopBox();

            await sendDeviceLog({
              deviceId,
              eventType: "QUBER_COMMAND_RECEIVED",
              level: "info",
              message: "set-top reboot requested",
              payload: {
                eventData,
                rebootResult: parseQuberResponse(rebootResult),
              },
            });

            return;
          }

          case "reload-app": {
            await reloadAppSafely(eventData);
            return;
          }

          case "check-update": {
            await checkAndApplyUpdateRef.current("native_check_update", eventData);
            return;
          }

          default:
            console.log("[NATIVE COMMAND] unknown command:", command);

            await sendDeviceLog({
              deviceId,
              eventType: "QUBER_COMMAND_FAILED",
              level: "warn",
              message: command,
              payload: {
                eventName,
                channelName,
                eventData,
              },
            });
        }
      } catch (error) {
        const message = getErrorMessage(error);

        console.log("[NATIVE COMMAND] failed:", {
          command,
          message,
        });

        await sendDeviceLog({
          deviceId,
          eventType: "QUBER_COMMAND_FAILED",
          level: "warn",
          message,
          payload: {
            command,
            eventName,
            channelName,
            eventData,
          },
        });

        await updateDeviceStatus({
          ...getCurrentStatusPayloadRef.current("NATIVE_COMMAND_ERROR"),
          quber: {
            lastCommand: command,
            lastCommandResult: {
              error: message,
            },
          },
          payload: {
            eventData,
            command,
            error: message,
          },
        });
      }
    },
    [deviceId, reloadAppSafely, updateQuberStatus],
  );

  useEffect(() => {
    loadPlaylistRef.current = loadPlaylist;
  }, [loadPlaylist]);

  useEffect(() => {
    handleNativeCommandRef.current = handleNativeCommand;
  }, [handleNativeCommand]);

  useEffect(() => {
    handleStatusRequestRef.current = handleStatusRequest;
  }, [handleStatusRequest]);

  useEffect(() => {
    checkAndApplyUpdateRef.current = checkAndApplyUpdate;
  }, [checkAndApplyUpdate]);

  useEffect(() => {
    statusSnapshotRef.current = {
      status,
      errorMessage,
      pusherConnected,
    };
  }, [status, errorMessage, pusherConnected]);

  useEffect(() => {
    getCurrentStatusPayloadRef.current = (reason: string) => {
      const current = contentsRef.current[currentIndexRef.current];
      const snapshot = statusSnapshotRef.current;

      return {
        deviceId,
        online: true,
        currentUrl: current?.url || "",
        app: getAppStatusPayload(),
        player: {
          mode: "native",
          platform: "android",
          status: snapshot.status,
          reason,

          currentIndex: currentIndexRef.current,
          currentDisplayIndex: contentsRef.current.length
            ? currentIndexRef.current + 1
            : null,
          contentsLength: contentsRef.current.length,
          currentContentUrl: current?.url || "",
          currentContentType: current?.type || "",

          pusherConnected: snapshot.pusherConnected,
          ...getCurrentDeviceOrientation(),
          lastError: snapshot.errorMessage || null,
          checkedAtClient: Date.now(),
        },
      };
    };
  }, [deviceId]);

  useEffect(() => {
    void loadPlaylist("mount");

    return () => {
      playSeqRef.current += 1;
      clearTimers();
      unlockTransition();
      clearVideo();
    };
  }, [clearTimers, clearVideo, loadPlaylist]);

  useEffect(() => {
    if (status !== "playing") return;
    playCurrent();
  }, [currentIndex, playCurrent, status]);

  useEffect(() => {
    if (status !== "error") return;

    const timer = setTimeout(() => {
      void loadPlaylist("error_auto_retry");
    }, ERROR_RETRY_DELAY);

    return () => {
      clearTimeout(timer);
    };
  }, [status, loadPlaylist]);

  useEffect(() => {
    if (!deviceId) return;

    setupAutoRun().then((autoRunResult) => {
      void sendDeviceLog({
        deviceId,
        eventType: "QUBER_AUTORUN_SETUP",
        level: "info",
        message: "Quber AutoRun setup completed",
        payload: autoRunResult,
      });
    });
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      console.log("[PUSHER] setup skipped: missing deviceId");
      return;
    }

    if (!PUSHER_KEY || !PUSHER_CLUSTER) {
      console.log("[PUSHER] setup skipped: missing config", {
        hasKey: !!PUSHER_KEY,
        cluster: PUSHER_CLUSTER,
      });

      void sendDeviceLog({
        deviceId,
        eventType: "PUSHER_SETUP_ERROR",
        level: "warn",
        message: "missing pusher config",
        payload: {
          hasKey: !!PUSHER_KEY,
          cluster: PUSHER_CLUSTER,
        },
      });

      return;
    }

    const normalizedDeviceId = String(deviceId);
    const setupKey = `${normalizedDeviceId}:${PUSHER_KEY}:${PUSHER_CLUSTER}`;

    if (isPusherSetupRef.current && pusherSetupKeyRef.current === setupKey) {
      console.log("[PUSHER] duplicate setup prevented:", {
        setupKey,
        channelNames: pusherChannelNamesRef.current,
      });

      return;
    }

    let isMounted = true;

    const controlChannelName = `${CONTROL_CHANNEL_PREFIX}-${normalizedDeviceId}`;
    const nativeChannelName = `${NATIVE_CHANNEL_PREFIX}-${normalizedDeviceId}`;
    const channelNames = [controlChannelName, nativeChannelName];

    isPusherSetupRef.current = true;
    pusherSetupKeyRef.current = setupKey;
    pusherChannelNamesRef.current = channelNames;

    const routePusherEvent = (event: PusherEvent) => {
      console.log("[PUSHER] event:", {
        channelName: event.channelName,
        eventName: event.eventName,
        data: event.data,
        expectedChannels: channelNames,
      });

      if (!isMounted) return;

      if (!channelNames.includes(event.channelName)) {
        console.log("[PUSHER] ignored event from other channel:", {
          channelName: event.channelName,
          eventName: event.eventName,
        });

        return;
      }

      const eventData = parsePusherData(event.data);

      if (event.channelName === controlChannelName) {
        if (event.eventName === PUSHER_STATUS_REQUEST_EVENT) {
          void handleStatusRequestRef.current(eventData);
          return;
        }

        if (event.eventName === PUSHER_CHECK_UPDATE_EVENT) {
          void checkAndApplyUpdateRef.current("pusher_check_update", eventData);
          return;
        }

        if (event.eventName === PUSHER_REFRESH_EVENT) {
          console.log("[PUSHER] refresh received:", event.channelName);

          void sendDeviceLog({
            deviceId: normalizedDeviceId,
            eventType: "PUSHER_REFRESH_RECEIVED",
            level: "info",
            message: "refresh received from admin",
            payload: {
              eventData,
            },
          });

          void loadPlaylistRef.current("pusher_refresh");
          return;
        }

        console.log("[PUSHER] unknown control event:", {
          eventName: event.eventName,
          eventData,
        });

        return;
      }

      void handleNativeCommandRef.current(
        event.eventName,
        eventData,
        event.channelName,
      );
    };

    async function setupPusher() {
      try {
        console.log("[PUSHER] setup start:", {
          setupKey,
          deviceId: normalizedDeviceId,
          controlChannelName,
          nativeChannelName,
          channelNames,
          hasKey: !!PUSHER_KEY,
          cluster: PUSHER_CLUSTER,
        });

        const pusher = Pusher.getInstance();

        pusherRef.current = pusher;

        await pusher.init({
          apiKey: PUSHER_KEY,
          cluster: PUSHER_CLUSTER,

          onConnectionStateChange: (currentState, previousState) => {
            console.log("[PUSHER] state:", {
              previousState,
              currentState,
              channelNames,
            });

            if (!isMounted) return;

            setPusherConnected(currentState === "CONNECTED");
          },

          onError: (message, code, error) => {
            console.log("[PUSHER] error:", {
              message,
              code,
              error,
              channelNames,
            });

            if (!isMounted) return;

            setPusherConnected(false);

            void sendDeviceLog({
              deviceId: normalizedDeviceId,
              eventType: "PUSHER_CONNECTION_ERROR",
              level: "warn",
              message: String(message || "pusher connection error"),
              payload: {
                code,
                error,
                channelNames,
              },
            });
          },

          onEvent: (event: PusherEvent) => {
            routePusherEvent(event);
          },
        });

        console.log("[PUSHER] connect requested");

        await pusher.connect();

        console.log("[PUSHER] connect completed. subscribing:", channelNames);

        for (const channelName of channelNames) {
          await pusher.subscribe({
            channelName,

            onSubscriptionSucceeded: (...args: unknown[]) => {
              console.log("[PUSHER] subscription succeeded:", {
                channelName,
                args,
              });
            },

            onSubscriptionError: (...args: unknown[]) => {
              console.log("[PUSHER] subscription error:", {
                channelName,
                args,
              });

              void sendDeviceLog({
                deviceId: normalizedDeviceId,
                eventType: "PUSHER_CONNECTION_ERROR",
                level: "warn",
                message: "pusher subscription error",
                payload: {
                  channelName,
                  args,
                },
              });
            },
          });
        }

        console.log("[PUSHER] setup completed:", channelNames);
      } catch (error) {
        const message = getErrorMessage(error);

        console.log("[PUSHER] setup failed:", message);

        if (!isMounted) return;

        setPusherConnected(false);

        isPusherSetupRef.current = false;
        pusherSetupKeyRef.current = null;

        void sendDeviceLog({
          deviceId: normalizedDeviceId,
          eventType: "PUSHER_SETUP_ERROR",
          level: "warn",
          message,
          payload: {
            channelNames,
          },
        });
      }
    }

    void setupPusher();

    return () => {
      isMounted = false;

      console.log("[PUSHER] cleanup:", {
        setupKey,
        channelNames,
      });

      setPusherConnected(false);

      const pusher = pusherRef.current;

      if (pusher) {
        for (const channelName of pusherChannelNamesRef.current) {
          try {
            void pusher.unsubscribe({
              channelName,
            });
          } catch (error) {
            console.log("[PUSHER] unsubscribe failed:", {
              channelName,
              error,
            });
          }
        }

        try {
          void pusher.disconnect();
        } catch (error) {
          console.log("[PUSHER] disconnect failed:", error);
        }
      }

      pusherRef.current = null;
      pusherChannelNamesRef.current = [];
      isPusherSetupRef.current = false;
      pusherSetupKeyRef.current = null;
    };
  }, [deviceId]);

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (!isPlaying) return;

    const seq = preparingVideoSeqRef.current || activeVideoSeqRef.current;

    if (!seq || playSeqRef.current !== seq) {
      console.log("[PLAYER] ignored stale playingChange");
      return;
    }

    if (activeContentTypeRef.current !== "video") {
      console.log("[PLAYER] ignored playingChange while active content is not video");
      return;
    }

    if (videoStartTimerRef.current) {
      clearTimeout(videoStartTimerRef.current);
      videoStartTimerRef.current = null;
    }

    console.log("[PLAYER] video playing");

    isPreparingVideoRef.current = false;
    activeVideoSeqRef.current = seq;
    preparingVideoSeqRef.current = 0;

    setVideoVisibleSafely(true);
    setImageUrlSafely("");
    unlockTransition();
  });

  useEventListener(player, "playToEnd", () => {
    if (activeContentTypeRef.current !== "video") {
      console.log("[PLAYER] ignored stale video ended event");
      return;
    }

    if (!videoVisibleRef.current) {
      console.log("[PLAYER] ignored video ended while video is not visible");
      return;
    }

    const seq = activeVideoSeqRef.current;

    if (!seq || playSeqRef.current !== seq) {
      console.log("[PLAYER] ignored stale video ended seq");
      return;
    }

    console.log("[PLAYER] video ended");

    // 다음 이미지가 준비되기 전까지 VideoView를 유지한다.
    // 여기서 먼저 숨기면 영상 → 이미지 전환 사이에 검정 깜빡임이 생긴다.
    goNext("video_ended");
  });

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (status !== "error") return;

    if (
      activeContentTypeRef.current !== "video" &&
      !isPreparingVideoRef.current &&
      !videoVisibleRef.current
    ) {
      console.log("[PLAYER] ignored stale video status error");
      return;
    }

    const seq = preparingVideoSeqRef.current || activeVideoSeqRef.current;

    if (seq && playSeqRef.current !== seq) {
      console.log("[PLAYER] ignored stale video status error seq");
      return;
    }

    const message = getErrorMessage(error);

    console.log("[PLAYER] video status error:", message);

    isPreparingVideoRef.current = false;
    preparingVideoSeqRef.current = 0;
    setVideoVisibleSafely(false);

    void sendDeviceLog({
      deviceId,
      eventType: "VIDEO_STATUS_ERROR",
      level: "error",
      message,
      payload: {
        currentIndex: currentIndexRef.current,
        contentsLength: contentsRef.current.length,
        currentContentUrl:
          contentsRef.current[currentIndexRef.current]?.url || "",
        currentContentType:
          contentsRef.current[currentIndexRef.current]?.type || "",
      },
    });

    unlockTransition();
    goNextImage("video_status_error");
  });

  useEffect(() => {
    if (status !== "playing") return;

    const timer = setInterval(() => {
      if (activeContentTypeRef.current !== "image") return;
      if (isTransitioningRef.current) return;
      if (!contentsRef.current.length) return;

      const elapsed = Date.now() - lastDisplayChangedAtRef.current;
      const allowedMs = Math.max(
        currentImageDurationMsRef.current + 15000,
        IMAGE_STUCK_TIMEOUT,
      );

      if (elapsed <= allowedMs) return;

      console.log("[PLAYER] image stuck watchdog triggered:", {
        elapsed,
        allowedMs,
        currentIndex: currentIndexRef.current,
        currentImageUrl: currentImageUrlRef.current,
      });

      void sendDeviceLog({
        deviceId,
        eventType: "IMAGE_STUCK_WATCHDOG",
        level: "warn",
        message: "same image displayed too long. moving to next content",
        url: currentImageUrlRef.current,
        payload: {
          elapsed,
          allowedMs,
          currentIndex: currentIndexRef.current,
          contentsLength: contentsRef.current.length,
        },
      });

      goNext("image_stuck_watchdog");
    }, DISPLAY_WATCHDOG_INTERVAL);

    return () => {
      clearInterval(timer);
    };
  }, [deviceId, goNext, status]);

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>콘텐츠를 불러오는 중...</Text>
      </View>
    );
  }

  if (status === "empty") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>재생할 콘텐츠가 없습니다.</Text>
        <Text style={styles.message}>
          관리자 페이지에서 플레이리스트를 연결해주세요.
        </Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>콘텐츠 조회 오류</Text>
        <Text style={styles.message}>{errorMessage}</Text>
        <Text style={styles.subMessage}>
          30초 후 자동으로 다시 조회합니다.
        </Text>

        <Pressable style={styles.secondaryButton} onPress={onLogout}>
          <Text style={styles.secondaryButtonText}>로그인으로 돌아가기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {backImageUrl ? (
        <Image
          source={{ uri: backImageUrl }}
          style={[styles.media, styles.backgroundImage]}
          resizeMode="contain"
          fadeDuration={0}
          onError={(event) =>
            handleImageError(backImageUrl, event.nativeEvent, "back")
          }
        />
      ) : null}

      {frontImageUrl ? (
        <Animated.Image
          source={{ uri: frontImageUrl }}
          style={[
            styles.media,
            styles.frontImage,
            { opacity: frontImageOpacityRef.current },
          ]}
          resizeMode="contain"
          fadeDuration={0}
          onLoadEnd={handleFrontImageLoaded}
          onError={(event) =>
            handleImageError(frontImageUrl, event.nativeEvent, "front")
          }
        />
      ) : null}

      <VideoView
        style={[
          styles.media,
          videoVisible ? styles.visibleMedia : styles.hiddenMedia,
        ]}
        player={player}
        nativeControls={false}
        contentFit="contain"
        surfaceType="textureView"
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  backgroundImage: {
    opacity: 1,
    zIndex: 1,
  },
  frontImage: {
    zIndex: 2,
  },
  visibleMedia: {
    opacity: 1,
    zIndex: 3,
  },
  hiddenMedia: {
    opacity: 0,
    zIndex: 0,
  },
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  errorTitle: {
    color: "#FF6B6B",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  message: {
    color: "#FFFFFF",
    fontSize: 18,
    textAlign: "center",
    lineHeight: 26,
  },
  subMessage: {
    marginTop: 10,
    color: "#BBBBBB",
    fontSize: 15,
    textAlign: "center",
  },
  secondaryButton: {
    marginTop: 24,
    height: 50,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
});