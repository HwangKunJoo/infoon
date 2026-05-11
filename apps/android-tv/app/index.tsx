import { StatusBar } from 'expo-status-bar';
import {
  BackHandler,
  Image,
  NativeModules,
  StyleSheet,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useCallback, useEffect, useState } from 'react';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

const START_URL = 'https://www.info-on.cloud/tv-login.html';
const PACKAGE_NAME = 'com.infoon.tv';

const SPLASH_DURATION = 1800;

const splashLogo = require('../assets/images/splash-logo.png');

type QuberModuleType = {
  sendRequest?: (jsonMsg: string) => Promise<string>;
};

type WebViewMessage =
  | {
      type: 'QUBER_COMMAND';
      command: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

const QuberModule = NativeModules.QuberModule as QuberModuleType | undefined;

function makeRequestId() {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

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
  params?: Record<string, unknown> | unknown[]
) {
  try {
    if (!QuberModule || typeof QuberModule.sendRequest !== 'function') {
      console.log('[QUBER] QuberModule not available');
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

    console.log('[QUBER] response:', response);

    return response;
  } catch (error) {
    console.log('[QUBER] request failed:', error);
    return null;
  }
}

async function setupAutoRun() {
  try {
    const setResult = await sendQuberRequest('213019', {
      packageName: PACKAGE_NAME,
    });

    console.log('[QUBER] AutoRun set:', setResult);

    const readResult = await sendQuberRequest('211034');

    console.log('[QUBER] AutoRun read:', readResult);
  } catch (error) {
    console.log('[QUBER] AutoRun setup failed:', error);
  }
}

async function readInstalledApps() {
  return sendQuberRequest('211033');
}

async function clearAutoRun() {
  return sendQuberRequest('214002');
}

async function readAutoRun() {
  return sendQuberRequest('211034');
}

async function turnTvOnByCec() {
  return sendQuberRequest('215031', {
    status: 'on',
  });
}

async function turnTvStandbyByCec() {
  return sendQuberRequest('215031', {
    status: 'standby',
  });
}

async function readTvPowerStatusByCec() {
  return sendQuberRequest('211049');
}

async function setHdmiOutputOn() {
  return sendQuberRequest('213020', {
    onStatus: 'true',
  });
}

async function setHdmiOutputOff() {
  return sendQuberRequest('213020', {
    onStatus: 'false',
  });
}

async function readDisplayStatus() {
  return sendQuberRequest('111009');
}

async function rebootSetTopBox() {
  return sendQuberRequest('215001');
}

async function scheduleTvWakeupInMinutes(minutes = 3) {
  const next = new Date(Date.now() + minutes * 60_000);
  const dayOfWeek = next.getDay() === 0 ? 1 : next.getDay() + 1;
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');

  return sendQuberRequest('213004', [
    {
      dayOfWeek,
      rebootTime: '-1',
      sleepTime: '-1',
      wakeupTime: `${hh}:${mm}`,
    },
  ]);
}

async function runQuberCommand(command: string) {
  console.log('[QUBER] command:', command);

  switch (command) {
    case 'tv-on':
      await scheduleTvWakeupInMinutes(3);
      await setHdmiOutputOn();
      await turnTvOnByCec();
      return;

    case 'power-off':
      await turnTvStandbyByCec();
      return;

    case 'reboot':
      await rebootSetTopBox();
      return;

    case 'hdmi-on':
      await setHdmiOutputOn();
      return;

    case 'hdmi-off':
      await setHdmiOutputOff();
      return;

    case 'autorun-set':
      await setupAutoRun();
      return;

    case 'autorun-clear':
      await clearAutoRun();
      return;

    case 'autorun-read':
      await readAutoRun();
      return;

    case 'installed-apps-read':
      await readInstalledApps();
      return;

    case 'display-status-read':
      await readDisplayStatus();
      return;

    case 'tv-power-status-read':
      await readTvPowerStatusByCec();
      return;

    default:
      console.log('[QUBER] unknown command:', command);
  }
}

export default function HomeScreen() {
  const [showSplash, setShowSplash] = useState(true);

  const handleWebViewMessage = useCallback(async (event: WebViewMessageEvent) => {
    try {
      const rawData = event.nativeEvent.data;
      const data = JSON.parse(rawData) as WebViewMessage;

      if (data.type === 'QUBER_COMMAND' && 'command' in data) {
        await runQuberCommand(String(data.command));
      }
    } catch (error) {
      console.log('[WEBVIEW] message parse failed:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, SPLASH_DURATION);

    return () => {
      clearTimeout(timer);
    };
  }, []);

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

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {showSplash ? (
        <View style={styles.splashContainer}>
          <Image
            source={splashLogo}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </View>
      ) : (
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
          onMessage={handleWebViewMessage}
          onError={(event) => {
            console.log('[WEBVIEW] error:', event.nativeEvent);
          }}
          onHttpError={(event) => {
            console.log('[WEBVIEW] http error:', event.nativeEvent);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  splashContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  splashLogo: {
    width: '42%',
    height: '42%',
    maxWidth: 520,
    maxHeight: 520,
  },

  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});