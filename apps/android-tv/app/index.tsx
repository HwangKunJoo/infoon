import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, StatusBar, StyleSheet, Text, View } from "react-native";

import { LoginScreen } from "../src/components/LoginScreen";
import { PlayerScreen } from "../src/components/PlayerScreen";
import { getSavedAuth } from "../src/lib/storage";

type AppMode = "boot" | "login" | "player" | "error";

export default function IndexScreen() {
  const [mode, setMode] = useState<AppMode>("boot");
  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    StatusBar.setHidden(true);

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );

    return () => {
      backHandler.remove();
    };
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const saved = await getSavedAuth();

        if (saved.token && saved.deviceId) {
          setToken(saved.token);
          setDeviceId(saved.deviceId);
          setMode("player");
          return;
        }

        setMode("login");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setMode("error");
      }
    }

    void boot();
  }, []);

  if (mode === "boot") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.message}>초기화 중...</Text>
      </View>
    );
  }

  if (mode === "login") {
    return (
      <LoginScreen
        onLoginComplete={({ token, deviceId }) => {
          setToken(token);
          setDeviceId(deviceId);
          setMode("player");
        }}
      />
    );
  }

  if (mode === "player") {
    return (
      <PlayerScreen
        token={token}
        deviceId={deviceId}
        onLogout={() => {
          setToken("");
          setDeviceId("");
          setMode("login");
        }}
      />
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.error}>오류가 발생했습니다.</Text>
      <Text style={styles.message}>{errorMessage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  message: {
    marginTop: 12,
    color: "#fff",
    fontSize: 18,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 22,
    fontWeight: "700",
  },
});