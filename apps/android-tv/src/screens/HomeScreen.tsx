import React, { useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  PACKAGE_NAME,
  deleteAutoRun,
  prettyJson,
  readAutoRun,
  readPackageList,
  setAutoRun,
} from '../modules/quber';

type LogState = {
  title: string;
  body: string;
};

export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<LogState>({
    title: 'Ready',
    body: 'QUBER 테스트 준비 완료',
  });

  const run = async (title: string, fn: () => Promise<unknown>) => {
    try {
      setLoading(true);
      setLog({
        title,
        body: '요청 중...',
      });

      const result = await fn();

      setLog({
        title: `${title} 성공`,
        body: prettyJson(result),
      });
    } catch (error: any) {
      setLog({
        title: `${title} 실패`,
        body: error?.message ?? String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>QUBER AutoRun Test</Text>
        <Text style={styles.subtitle}>Package: {PACKAGE_NAME}</Text>
      </View>

      <View style={styles.buttonRow}>
        <TestButton
          label="패키지 목록 읽기"
          disabled={loading}
          onPress={() => run('패키지 목록 읽기', readPackageList)}
        />

        <TestButton
          label="AutoRun 읽기"
          disabled={loading}
          onPress={() => run('AutoRun 읽기', readAutoRun)}
        />

        <TestButton
          label="AutoRun 등록"
          primary
          disabled={loading}
          onPress={() => run('AutoRun 등록', () => setAutoRun(PACKAGE_NAME))}
        />

        <TestButton
          label="AutoRun 삭제"
          danger
          disabled={loading}
          onPress={() => run('AutoRun 삭제', deleteAutoRun)}
        />
      </View>

      <View style={styles.statusBox}>
        {loading && <ActivityIndicator />}
        <Text style={styles.statusTitle}>{log.title}</Text>
      </View>

      <ScrollView style={styles.logBox} contentContainerStyle={styles.logContent}>
        <Text style={styles.logText}>{log.body}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TestButton({
  label,
  onPress,
  disabled,
  primary,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.primaryButton,
        danger && styles.dangerButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
    padding: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#BDBDBD',
    fontSize: 18,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  button: {
    backgroundColor: '#333333',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: '#2563EB',
  },
  dangerButton: {
    backgroundColor: '#B91C1C',
  },
  disabledButton: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  statusBox: {
    minHeight: 54,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  logBox: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 12,
  },
  logContent: {
    padding: 18,
  },
  logText: {
    color: '#00FF88',
    fontSize: 16,
    lineHeight: 24,
  },
});