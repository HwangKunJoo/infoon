import { StatusBar } from 'expo-status-bar';
import { BackHandler, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useEffect } from 'react';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

const START_URL = 'https://infoon.vercel.app/tv-login.html';

export default function HomeScreen() {
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});

    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);

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
});