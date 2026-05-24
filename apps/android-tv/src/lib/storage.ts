import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "../constants/keys";

export async function getSavedAuth() {
  const [token, deviceId, email, password, user] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
    AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID),
    AsyncStorage.getItem(STORAGE_KEYS.EMAIL),
    AsyncStorage.getItem(STORAGE_KEYS.PASSWORD),
    AsyncStorage.getItem(STORAGE_KEYS.USER),
  ]);

  return {
    token: token || "",
    deviceId: deviceId || "",
    email: email || "",
    password: password || "",
    user: user ? JSON.parse(user) : null,
  };
}

export async function saveAuth(payload: {
  token: string;
  deviceId: string;
  email: string;
  password: string;
  user: unknown;
  orientation: string;
}) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.TOKEN, payload.token),
    AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, payload.deviceId),
    AsyncStorage.setItem(STORAGE_KEYS.EMAIL, payload.email),
    AsyncStorage.setItem(STORAGE_KEYS.PASSWORD, payload.password),
    AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(payload.user || {})),
    AsyncStorage.setItem(STORAGE_KEYS.ORIENTATION, payload.orientation),
  ]);
}