import { StatusBar } from 'expo-status-bar';
import {
  BackHandler,
  NativeModules,
  StyleSheet,
  View,
  Text,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useEffect, useState } from 'react';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

const START_URL = 'https://infoon.vercel.app/tv-login.html';
const PACKAGE_NAME = 'com.infoon.tv';

const { QuberModule } = NativeModules;

export default function HomeScreen() {
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  function addLog(message: string) {
    console.log(message);

    setDebugLogs((prev) => [
      ...prev.slice(-10),
      `${new Date().toLocaleTimeString()} ${message}`,
    ]);
  }

  function makeRequestId() {
    const now = new Date();

    const pad = (n: number, len = 2) =>
      String(n).padStart(len, '0');

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

  async function sendQuberRequest(
    cmdCode: string,
    params?: Record<string, unknown>
  ) {
    try {
      if (!QuberModule?.sendRequest) {
        addLog('[QUBER] QuberModule not available');
        return null;
      }

      const payload: Record<string, unknown> = {
        requestId: makeRequestId(),
        cmdCode,
      };

      if (params) {
        payload.params = params;
      }

      addLog('[QUBER] request: ' + JSON.stringify(payload));

      const res = await QuberModule.sendRequest(
        JSON.stringify(payload)
      );

      addLog('[QUBER] response: ' + String(res));

      return res;
    } catch (error) {
      addLog('[QUBER] sendRequest error: ' + String(error));
      return null;
    }
  }

  async function setupAutoRun() {
    try {
      addLog('[QUBER] AutoRun setup start');

      const setResult = await sendQuberRequest('213019', {
        packageName: PACKAGE_NAME,
      });

      addLog('[QUBER] setResult: ' + String(setResult));

      const readResult = await sendQuberRequest('211034');

      addLog('[QUBER] readResult: ' + String(readResult));

      addLog('[QUBER] AutoRun setup done');
    } catch (error) {
      addLog('[QUBER] AutoRun setup error: ' + String(error));
    }
  }

  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch(() => {});

    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});

    setupAutoRun();

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true
    );

    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <WebView
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
        originWhitelist={['*']}
      />

      <View style={styles.debugBox}>
        {debugLogs.map((log, index) => (
          <Text key={index} style={styles.debugText}>
            {log}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  webview: {
    flex: 1,
    backgroundColor: '#000',
  },

  debugBox: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 10,
    borderRadius: 8,
    zIndex: 9999,
  },

  debugText: {
    color: '#00ff00',
    fontSize: 12,
    marginBottom: 4,
  },
});