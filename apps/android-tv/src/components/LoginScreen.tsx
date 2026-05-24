import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { login } from "../lib/authApi";
import { registerDevice } from "../lib/deviceApi";
import { updateDeviceStatus } from "../lib/firebaseLogger";
import { saveAuth } from "../lib/storage";

type LoginCompletePayload = {
  token: string;
  deviceId: string;
};

type LoginScreenProps = {
  onLoginComplete: (payload: LoginCompletePayload) => void;
};

type LoginStage = "login" | "register" | "save" | "status" | "unknown";

function getErrorMessage(error: unknown) {
  if (!error) return "UNKNOWN_ERROR";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getLoginToken(res: any) {
  if (res?.data?.token) return String(res.data.token);
  if (res?.token) return String(res.token);
  return "";
}

function getLoginUser(res: any) {
  if (res?.data?.user) return res.data.user;
  if (res?.user) return res.user;
  return null;
}

function getUserId(user: any) {
  const candidates = [user?.id, user?.userId, user?.user_id];

  const found = candidates.find(
    (value) => value !== null && value !== undefined && value !== "",
  );

  const parsed = Number(found);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  return parsed;
}

function getUserOrganization(user: any) {
  const candidates = [
    user?.organization,
    user?.organizationName,
    user?.organization_name,
    user?.school,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  return typeof found === "string" ? found : "";
}

function getUserOrganizationType(user: any) {
  const candidates = [
    user?.organizationType,
    user?.organization_type,
    user?.organizationTypeName,
    user?.organization_type_name,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  return typeof found === "string" ? found : "";
}

function getRegisterDeviceId(res: any) {
  const data = res?.data ?? res;

  const candidates = [
    data?.deviceId,
    data?.device_id,
    data?.id,
    data?.device?.deviceId,
    data?.device?.device_id,
    data?.device?.id,
    data?.deviceInfo?.deviceId,
    data?.deviceInfo?.device_id,
    data?.deviceInfo?.id,
    data?.device_info?.deviceId,
    data?.device_info?.device_id,
    data?.device_info?.id,
  ];

  const found = candidates.find(
    (value) => value !== null && value !== undefined && value !== "",
  );

  return found !== undefined ? String(found) : "";
}

function getRegisterOrientation(res: any) {
  const data = res?.data ?? res;

  const candidates = [
    data?.orientation,
    data?.device?.orientation,
    data?.deviceInfo?.orientation,
    data?.device_info?.orientation,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  return typeof found === "string" ? found : "default";
}

function getLoginErrorMessage(message: string) {
  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("UNAUTHORIZED") ||
    message.includes("INVALID_LOGIN_RESPONSE")
  ) {
    return "로그인에 실패했습니다. 이메일 또는 비밀번호를 확인해주세요.";
  }

  return "로그인 요청 중 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.";
}

function getRegisterErrorMessage(message: string) {
  if (message.includes("INVALID_USER_ID")) {
    return "로그인은 성공했지만 사용자 정보가 올바르지 않아 기기를 등록할 수 없습니다. 관리자에게 문의해주세요.";
  }

  if (message.includes("INVALID_DEVICE_REGISTER_RESPONSE")) {
    return "로그인은 성공했지만 기기 등록 응답에서 기기 ID를 확인할 수 없습니다. 관리자에게 문의해주세요.";
  }

  return "로그인은 성공했지만 기기 등록 중 오류가 발생했습니다. 네트워크 또는 관리자 페이지의 기기 등록 상태를 확인해주세요.";
}

async function updateInitialDeviceStatus(deviceId: string) {
  await updateDeviceStatus({
    deviceId,
    online: true,
    currentUrl: "",
    player: {
      mode: "native",
      platform: "android",
      status: "loading",
      reason: "LOGIN_REGISTERED",
      currentIndex: 0,
      currentDisplayIndex: null,
      contentsLength: 0,
      currentContentUrl: "",
      currentContentType: "",
      pusherConnected: false,
      lastError: null,
      checkedAtClient: Date.now(),
    },
    payload: {
      source: "LoginScreen",
      reason: "LOGIN_REGISTERED",
    },
  } as any);
}

export function LoginScreen({ onLoginComplete }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState("로그인 정보를 입력해주세요.");
  const [errorMessage, setErrorMessage] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isLoginButtonFocused, setIsLoginButtonFocused] = useState(false);

  async function handleLoginWithCredential(
    nextEmail: string,
    nextPassword: string,
  ) {
    const trimmedEmail = nextEmail.trim();

    if (!trimmedEmail) {
      setErrorMessage("이메일을 입력해주세요.");
      return;
    }

    if (!nextPassword) {
      setErrorMessage("비밀번호를 입력해주세요.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setStatus("로그인 요청 중...");

    let stage: LoginStage = "login";

    try {
      const loginRes = await login(trimmedEmail, nextPassword);

      const token = getLoginToken(loginRes);
      const user = getLoginUser(loginRes);

      if (!token || !user) {
        throw new Error("INVALID_LOGIN_RESPONSE");
      }

      stage = "register";
      setStatus("로그인 성공 · 기기 등록 중...");

      const registerRes = await registerDevice(token, {
        modelId: "quber-android-tv",
        modelName: "Quber Android TV",
        orientation: "default",
        userId: getUserId(user),
        organization: getUserOrganization(user),
        organization_type: getUserOrganizationType(user),
      });

      const deviceId = getRegisterDeviceId(registerRes);
      const orientation = getRegisterOrientation(registerRes);

      if (!deviceId) {
        console.log("[REGISTER] invalid response:", registerRes);
        throw new Error("INVALID_DEVICE_REGISTER_RESPONSE");
      }

      stage = "save";
      setStatus(`기기 ${deviceId}번 등록 완료 · 로그인 정보 저장 중...`);

      await saveAuth({
        token,
        deviceId,
        email: trimmedEmail,
        password: nextPassword,
        user,
        orientation,
      });

      /**
       * 운영 편의를 위해 설치/등록 직후 status를 1회만 올린다.
       * 실패해도 로그인 완료 자체는 막지 않는다.
       */
      stage = "status";
      setStatus(`기기 ${deviceId}번 등록 완료 · 상태 동기화 중...`);

      try {
        await updateInitialDeviceStatus(deviceId);
      } catch (statusError) {
        console.log(
          "[LOGIN] initial status update failed:",
          getErrorMessage(statusError),
        );
      }

      setStatus(`로그인 성공 · 기기 ${deviceId}번으로 실행`);

      onLoginComplete({
        token,
        deviceId,
      });
    } catch (error) {
      const message = getErrorMessage(error);

      console.log("[LOGIN] failed:", {
        stage,
        message,
      });

      setStatus("로그인 정보를 입력해주세요.");

      if (stage === "login") {
        setErrorMessage(getLoginErrorMessage(message));
      } else if (stage === "register") {
        setErrorMessage(getRegisterErrorMessage(message));
      } else if (stage === "save") {
        setErrorMessage(
          "로그인과 기기 등록은 완료됐지만 로그인 정보 저장에 실패했습니다. 앱을 다시 실행한 뒤 다시 시도해주세요.",
        );
      } else {
        setErrorMessage(
          "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <View style={styles.left}>
          <Text style={styles.title}>로그인</Text>
          <Text style={styles.subtitle}>
            InfoOn TV를 시작하려면 발급받은 계정으로 로그인해주세요.
          </Text>

          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>이메일</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="example@domain.com"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!isLoading}
            returnKeyType="next"
          />

          <Text style={[styles.label, styles.passwordLabel]}>비밀번호</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="비밀번호"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            editable={!isLoading}
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleLoginWithCredential(email, password);
            }}
          />

          <Pressable
            style={({ pressed }) => [
              styles.button,
              isLoginButtonFocused && styles.buttonFocused,
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
            disabled={isLoading}
            onFocus={() => {
              setIsLoginButtonFocused(true);
            }}
            onBlur={() => {
              setIsLoginButtonFocused(false);
            }}
            onPress={() => {
              void handleLoginWithCredential(email, password);
            }}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>로그인</Text>
            )}
          </Pressable>

          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : (
            <Text style={styles.errorText}> </Text>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 1280,
    minHeight: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 40,
  },
  left: {
    flex: 0.9,
  },
  title: {
    fontSize: 40,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#6B7280",
    lineHeight: 26,
    marginBottom: 20,
  },
  statusBox: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
  },
  statusText: {
    fontSize: 16,
    color: "#374151",
    lineHeight: 23,
  },
  form: {
    flex: 1.1,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },
  passwordLabel: {
    marginTop: 14,
  },
  input: {
    width: "100%",
    height: 56,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    fontSize: 20,
    color: "#111827",
    backgroundColor: "#FFFFFF",
  },
  button: {
    width: "100%",
    height: 58,
    marginTop: 22,
    borderRadius: 14,
    backgroundColor: "#FB923C",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonFocused: {
    borderWidth: 4,
    borderColor: "rgba(251, 146, 60, 0.35)",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  errorText: {
    minHeight: 24,
    marginTop: 10,
    fontSize: 16,
    color: "#DC2626",
  },
});
