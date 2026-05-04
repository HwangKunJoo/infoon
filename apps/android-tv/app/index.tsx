import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useVideoPlayer, VideoView } from "expo-video";
import { Pusher } from "@pusher/pusher-websocket-react-native";

const API_URL = "https://api.onldo.life/api";
const PUSHER_KEY = "a707a1d344893077c43d";
const PUSHER_CLUSTER = "ap3";

const KEYS = {
  TOKEN: "player_token",
  DEVICE_ID: "player_device_id",
  EMAIL: "player_email",
  PASSWORD: "player_password",
  USER: "player_user",
};

type User = {
  id?: number | string;
  organization?: string;
  organization_type?: string;
  attributes?: any;
};

type ContentItem = {
  id?: number | string;
  title?: string;
  name?: string;
  description?: string;
  desc?: string;
  type?: string;
  content_type?: string;
  mime?: string;
  file_url?: string;
  url?: string;
  path?: string;
  duration?: number;
  file?: any;
  attributes?: any;
};

async function safeGet(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeSet(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {}
}

async function safeDelete(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

async function clearStorage() {
  await safeDelete(KEYS.TOKEN);
  await safeDelete(KEYS.DEVICE_ID);
  await safeDelete(KEYS.EMAIL);
  await safeDelete(KEYS.PASSWORD);
  await safeDelete(KEYS.USER);
}

function getUserValue(user: User | null, key: string) {
  if (!user) return "";
  if ((user as any)[key]) return String((user as any)[key]);
  if (user.attributes?.[key]) return String(user.attributes[key]);
  return "";
}

function getLoginToken(res: any) {
  return res?.data?.token || res?.token || "";
}

function getLoginUser(res: any): User | null {
  return res?.data?.user || res?.user || null;
}

function getDeviceIdFromRegisterResponse(res: any) {
  return String(
    res?.data?.data?.id ||
      res?.data?.id ||
      res?.data?.device?.id ||
      ""
  );
}

function getContentUrl(content: ContentItem | null) {
  if (!content) return "";

  if (content.file_url) return content.file_url;
  if (content.url) return content.url;
  if (content.path) return content.path;
  if (content.file?.url) return content.file.url;
  if (content.file?.data?.attributes?.url) {
    return content.file.data.attributes.url;
  }
  if (content.attributes?.file?.data?.attributes?.url) {
    return content.attributes.file.data.attributes.url;
  }

  return "";
}

function getContentType(content: ContentItem | null, url: string) {
  const rawType = String(
    content?.type || content?.content_type || content?.mime || ""
  ).toLowerCase();

  const lowerUrl = String(url || "").toLowerCase();

  if (rawType.includes("video") || rawType === "movie") return "video";
  if (rawType.includes("image")) return "image";

  if (
    lowerUrl.includes(".mp4") ||
    lowerUrl.includes(".mov") ||
    lowerUrl.includes(".webm") ||
    lowerUrl.includes(".m4v")
  ) {
    return "video";
  }

  return "image";
}

function getContentText(content: ContentItem | null, key: string) {
  if (!content) return "";
  if ((content as any)[key]) return String((content as any)[key]);
  if (content.attributes?.[key]) return String(content.attributes[key]);
  return "";
}

function getDevicesArray(res: any) {
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.devices)) return res.devices;
  if (Array.isArray(res?.data?.data)) return res.data.data;
  return [];
}

function extractContents(res: any, deviceId: string) {
  const devices = getDevicesArray(res);

  const matchedDevice = devices.find((device: any) => {
    return String(device.id) === String(deviceId);
  });

  if (!matchedDevice?.playlists) return [];

  const result: ContentItem[] = [];

  matchedDevice.playlists.forEach((playlist: any) => {
    const playlistDuration = Number(playlist.duration || 5);
    const playlistContents = playlist.contents || [];

    playlistContents.forEach((originalItem: any) => {
      result.push({
        ...originalItem,
        duration: Number(originalItem.duration || playlistDuration || 5),
      });
    });
  });

  return result;
}

export default function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const orientation = width >= height ? "landscape" : "portrait";

  const [mode, setMode] = useState<"boot" | "login" | "player">("boot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");

  const imageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pusherRef = useRef<any>(null);
  const currentChannelRef = useRef<string>("");

  const currentItem = contents[currentIndex] || null;
  const currentUrl = getContentUrl(currentItem);
  const currentType = getContentType(currentItem, currentUrl);

  const player = useVideoPlayer(null, (player) => {
    player.loop = false;
    player.muted = true;
    player.play();
  });

  const appendLog = (message: string) => {
    setLogs((prev) => [...prev.slice(-24), message]);
  };

  const request = async (
    path: string,
    options: RequestInit = {},
    authToken = token
  ) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });

    const text = await res.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    appendLog(`HTTP ${res.status} ${path}`);

    if (!res.ok) {
      throw new Error(`HTTP_${res.status}`);
    }

    return data;
  };

  const login = async (loginEmail: string, loginPassword: string) => {
    const res = await request(
      "/digital_board/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      },
      ""
    );

    const nextToken = getLoginToken(res);
    const user = getLoginUser(res);

    if (!nextToken || !user) {
      throw new Error("LOGIN_RESPONSE_INVALID");
    }

    await safeSet(KEYS.TOKEN, nextToken);
    await safeSet(KEYS.EMAIL, loginEmail);
    await safeSet(KEYS.PASSWORD, loginPassword);
    await safeSet(KEYS.USER, JSON.stringify(user));

    setToken(nextToken);

    return { token: nextToken, user };
  };

  const registerDeviceIfNeeded = async (authToken: string, user: User) => {
    const savedDeviceId = await safeGet(KEYS.DEVICE_ID);

    if (savedDeviceId) {
      appendLog(`saved deviceId: ${savedDeviceId}`);
      setDeviceId(savedDeviceId);
      return savedDeviceId;
    }

    appendLog("기기 등록 중...");

    const res = await request(
      "/digital_board/devices/register",
      {
        method: "POST",
        body: JSON.stringify({
          model_id: "android_tv",
          device_model_name: "android_tv_expo_native_player",
          orientation,
          user_id: Number(getUserValue(user, "id")),
          organization: getUserValue(user, "organization"),
          organization_type: getUserValue(user, "organization_type"),
        }),
      },
      authToken
    );

    const nextDeviceId = getDeviceIdFromRegisterResponse(res);

    if (!nextDeviceId) {
      throw new Error("DEVICE_ID_NOT_FOUND");
    }

    await safeSet(KEYS.DEVICE_ID, nextDeviceId);
    setDeviceId(nextDeviceId);

    appendLog(`device registered: ${nextDeviceId}`);

    return nextDeviceId;
  };

  const refreshContents = async (
    reason: string,
    targetDeviceId = deviceId,
    authToken = token
  ) => {
    if (!targetDeviceId || !authToken) return;

    try {
      setLoading(true);
      appendLog(`playlist 갱신: ${reason}`);

      const res = await request("/digital_board/devices", {}, authToken);
      const nextContents = extractContents(res, targetDeviceId);

      appendLog(`contents count: ${nextContents.length}`);

      setContents([...nextContents]);
      setCurrentIndex(0);
    } catch (e) {
      appendLog(`refresh error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const disconnectPusher = async () => {
    try {
      const pusher = pusherRef.current;
      const channelName = currentChannelRef.current;

      if (pusher && channelName) {
        await pusher.unsubscribe({ channelName });
      }

      if (pusher) {
        await pusher.disconnect();
      }

      pusherRef.current = null;
      currentChannelRef.current = "";
    } catch (e) {
      appendLog(`Pusher disconnect error: ${String(e)}`);
    }
  };

  const initPusher = async (targetDeviceId: string, authToken: string) => {
    if (!targetDeviceId) return;

    try {
      await disconnectPusher();

      appendLog("Pusher 연결 시도");

      const pusher = Pusher.getInstance();

      await pusher.init({
        apiKey: PUSHER_KEY,
        cluster: PUSHER_CLUSTER,
        onConnectionStateChange: (currentState: any, previousState: any) => {
          appendLog(`Pusher state: ${previousState} → ${currentState}`);
        },
        onEvent: (event: any) => {
          appendLog(`Pusher event: ${event.eventName}`);

          if (event.eventName === "refresh") {
            appendLog("Pusher refresh 수신");
            refreshContents("pusher", targetDeviceId, authToken);
          }
        },
      });

      const channelName = `tv-control-${targetDeviceId}`;

      await pusher.subscribe({
        channelName,
      });

      await pusher.connect();

      pusherRef.current = pusher;
      currentChannelRef.current = channelName;

      appendLog(`Pusher 채널 구독: ${channelName}`);
    } catch (e) {
      appendLog(`Pusher init error: ${String(e)}`);
    }
  };

  const startPlayer = async (authToken: string, targetDeviceId: string) => {
    setMode("player");

    await refreshContents("init", targetDeviceId, authToken);

    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
    }

    refreshTimerRef.current = setInterval(() => {
      refreshContents("interval", targetDeviceId, authToken);
    }, 60000);

    await initPusher(targetDeviceId, authToken);
  };

  const handleManualLogin = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setError("이메일을 입력해주세요.");
      return;
    }

    if (!password) {
      setError("비밀번호를 입력해주세요.");
      return;
    }

    try {
      setError("");
      setLoading(true);
      appendLog("로그인 요청 중...");

      const loginResult = await login(trimmedEmail, password);
      const nextDeviceId = await registerDeviceIfNeeded(
        loginResult.token,
        loginResult.user
      );

      await startPlayer(loginResult.token, nextDeviceId);
    } catch (e) {
      appendLog(`login error: ${String(e)}`);
      setError("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const tryAutoLogin = async () => {
    try {
      appendLog("자동 로그인 확인 중...");

      const savedEmail = await safeGet(KEYS.EMAIL);
      const savedPassword = await safeGet(KEYS.PASSWORD);

      if (!savedEmail || !savedPassword) {
        setMode("login");
        return;
      }

      appendLog("자동 로그인 시도 중...");

      const loginResult = await login(savedEmail, savedPassword);
      const nextDeviceId = await registerDeviceIfNeeded(
        loginResult.token,
        loginResult.user
      );

      await startPlayer(loginResult.token, nextDeviceId);
    } catch (e) {
      appendLog(`auto login error: ${String(e)}`);
      await clearStorage();
      setMode("login");
    }
  };

  const playNext = () => {
    setCurrentIndex((prev) => {
      if (!contents.length) return 0;
      return prev + 1 >= contents.length ? 0 : prev + 1;
    });
  };

  const resetSavedInfo = async () => {
    await disconnectPusher();
    await clearStorage();

    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }

    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    setToken("");
    setDeviceId("");
    setContents([]);
    setCurrentIndex(0);
    setMode("login");
    setError("저장된 정보를 초기화했습니다.");
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    tryAutoLogin();

    return () => {
      if (imageTimerRef.current) {
        clearTimeout(imageTimerRef.current);
      }

      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }

      disconnectPusher();
    };
  }, []);

  useEffect(() => {
    if (mode !== "player") return;
    if (!currentItem) return;

    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }

    if (currentType === "image") {
      const duration = Number(currentItem.duration || 5);

      imageTimerRef.current = setTimeout(() => {
        playNext();
      }, Math.max(1, duration) * 1000);

      return;
    }

    if (currentType === "video" && currentUrl) {
      appendLog(`play video: ${currentUrl}`);

      try {
        player.replace({
          uri: currentUrl,
          contentType: "auto",
        });

        player.play();
      } catch (e) {
        appendLog(`video play error: ${String(e)}`);
        playNext();
      }
    }
  }, [mode, currentIndex, currentUrl, currentType]);

  useEffect(() => {
    const subscription = player.addListener("playToEnd", () => {
      appendLog("video ended");
      playNext();
    });

    return () => {
      subscription.remove();
    };
  }, [player, contents.length]);

  const title = useMemo(() => {
    return (
      getContentText(currentItem, "title") ||
      getContentText(currentItem, "name")
    );
  }, [currentItem]);

  const sub = useMemo(() => {
    return (
      getContentText(currentItem, "description") ||
      getContentText(currentItem, "desc")
    );
  }, [currentItem]);

  if (mode === "boot") {
    return (
      <View style={styles.center}>
        <StatusBar hidden />
        <ActivityIndicator size="large" />
        <Text style={styles.bootText}>초기화 중...</Text>
        <Debug logs={logs} />
      </View>
    );
  }

  if (mode === "login") {
    return (
      <View
        style={
          orientation === "landscape"
            ? styles.loginRootLandscape
            : styles.loginRootPortrait
        }
      >
        <StatusBar hidden />

        <View
          style={
            orientation === "landscape"
              ? styles.loginCardLandscape
              : styles.loginCardPortrait
          }
        >
          <View style={styles.loginInfo}>
            <Text
              style={
                orientation === "landscape"
                  ? styles.loginTitleLandscape
                  : styles.loginTitlePortrait
              }
            >
              로그인
            </Text>
            <Text
              style={
                orientation === "landscape"
                  ? styles.loginSubLandscape
                  : styles.loginSubPortrait
              }
            >
              계정에 접속해 서비스를 시작하세요
            </Text>

            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>

          <View style={styles.formArea}>
            <Text style={styles.label}>이메일</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="example@domain.com"
              placeholderTextColor="#777"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />

            <Text style={styles.label}>비밀번호</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="비밀번호"
              placeholderTextColor="#777"
              secureTextEntry
              style={styles.input}
            />

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleManualLogin}
            >
              <Text style={styles.primaryButtonText}>로그인</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={resetSavedInfo}
            >
              <Text style={styles.secondaryButtonText}>저장 정보 초기화</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading && <Loading />}
        <Debug logs={logs} />
      </View>
    );
  }

  return (
    <View style={styles.playerRoot}>
      <StatusBar hidden />

      {!contents.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>재생할 콘텐츠가 없습니다.</Text>
        </View>
      ) : currentType === "video" ? (
        <VideoView
          style={styles.media}
          player={player}
          contentFit={orientation === "portrait" ? "cover" : "contain"}
          nativeControls={false}
          surfaceType="textureView"
        />
      ) : (
        <Image
          source={{ uri: currentUrl }}
          style={styles.media}
          resizeMode={orientation === "portrait" ? "cover" : "contain"}
        />
      )}

      {orientation === "portrait" && !!(title || sub) && (
        <View style={styles.overlay}>
          {!!title && <Text style={styles.overlayTitle}>{title}</Text>}
          {!!sub && <Text style={styles.overlaySub}>{sub}</Text>}
        </View>
      )}

      {loading && <Loading />}
      <Debug logs={logs} />
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingText}>갱신 중...</Text>
    </View>
  );
}

function Debug({ logs }: { logs: string[] }) {
  return (
    <View style={styles.debug}>
      {logs.map((item, index) => (
        <Text key={`${item}-${index}`} style={styles.debugText}>
          {item}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  bootText: {
    marginTop: 16,
    color: "#fff",
    fontSize: 22,
  },
  loginRootLandscape: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loginRootPortrait: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  loginCardLandscape: {
    width: "100%",
    maxWidth: 1280,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    flexDirection: "row",
    gap: 40,
  },
  loginCardPortrait: {
    width: "100%",
    maxWidth: 900,
    backgroundColor: "#fff",
    borderRadius: 36,
    padding: 48,
  },
  loginInfo: {
    flex: 1,
  },
  formArea: {
    flex: 1,
  },
  loginTitleLandscape: {
    fontSize: 40,
    fontWeight: "700",
    color: "#111827",
  },
  loginTitlePortrait: {
    fontSize: 64,
    fontWeight: "800",
    color: "#111827",
  },
  loginSubLandscape: {
    marginTop: 8,
    fontSize: 18,
    color: "#6b7280",
  },
  loginSubPortrait: {
    marginTop: 16,
    marginBottom: 30,
    fontSize: 30,
    color: "#6b7280",
  },
  label: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 18,
    fontWeight: "700",
    color: "#374151",
  },
  input: {
    height: 58,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: "#d1d5db",
    borderRadius: 14,
    fontSize: 20,
    backgroundColor: "#fff",
    color: "#111827",
  },
  primaryButton: {
    height: 62,
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: "#fb923c",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
  },
  secondaryButton: {
    height: 62,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#374151",
    fontSize: 22,
    fontWeight: "800",
  },
  error: {
    marginTop: 20,
    color: "#dc2626",
    fontSize: 18,
  },
  playerRoot: {
    flex: 1,
    backgroundColor: "#000",
  },
  media: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
  },
  emptyText: {
    color: "#fff",
    fontSize: 34,
    textAlign: "center",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 56,
    paddingTop: 80,
    paddingBottom: 56,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  overlayTitle: {
    color: "#fff",
    fontSize: 46,
    fontWeight: "800",
  },
  overlaySub: {
    marginTop: 12,
    color: "rgba(255,255,255,0.76)",
    fontSize: 28,
  },
  loading: {
    position: "absolute",
    top: 24,
    right: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  loadingText: {
    color: "#fff",
    fontSize: 18,
  },
  debug: {
    position: "absolute",
    top: "30%",
    left: 0,
    right: 0,
    maxHeight: 180,
    backgroundColor: "rgba(0,0,0,0.62)",
    padding: 10,
  },
  debugText: {
    color: "#39ff14",
    fontSize: 14,
  },
});