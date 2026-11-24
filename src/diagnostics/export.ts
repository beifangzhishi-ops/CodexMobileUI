import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppState, Dimensions, PixelRatio, Platform } from 'react-native';
import { readDiagnostics, logDiagnostic } from './journal';

export interface DiagnosticSummary {
  count: number;
  latest: string[];
  durableStorageAvailable: boolean;
}

export async function diagnosticSummary(): Promise<DiagnosticSummary> {
  const data = await readDiagnostics();
  return {
    count: data.events.length,
    latest: data.events.slice(-8).reverse().map((item) =>
      item.timestamp.slice(11, 19) + ' ' + item.event),
    durableStorageAvailable: data.durableStorageAvailable,
  };
}

export async function exportDiagnostics(): Promise<string> {
  logDiagnostic('diagnostics.exportStarted');
  const data = await readDiagnostics();
  const window = Dimensions.get('window');
  const snapshot = {
    format: 'CodexMobileUI-diagnostics-v1',
    createdAt: new Date().toISOString(),
    privacy: 'No host URLs, credentials, token values, OAuth code/state/verifier, thread identifiers, messages or request bodies.',
    runtime: {
      appVersion: 'unknown',
      buildCode: 'unknown',
      packageName: 'dev.codexmobileui.app',
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      appState: AppState.currentState,
      windowWidth: window.width,
      windowHeight: window.height,
      displayScale: PixelRatio.get(),
      fontScale: PixelRatio.getFontScale(),
    },
    durableStorageAvailable: data.durableStorageAvailable,
    eventCount: data.events.length,
    events: data.events,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File(Paths.cache, 'CodexMobileUI-diagnostics-' + stamp + '.json');
  await file.write(JSON.stringify(snapshot, null, 2));
  logDiagnostic('diagnostics.fileCreated', { count: data.events.length });
  if (!(await Sharing.isAvailableAsync())) {
    logDiagnostic('diagnostics.shareUnavailable');
    throw new Error('系统文件分享不可用，请确认 Android 文件分享服务正常');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: '导出 CodexMobileUI 诊断日志',
  });
  logDiagnostic('diagnostics.shareReturned');
  return file.uri;
}
