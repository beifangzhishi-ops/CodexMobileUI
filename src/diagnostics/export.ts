import {
  AppState, Dimensions, NativeModules, PermissionsAndroid, PixelRatio, Platform,
} from 'react-native';
import { readDiagnostics, logDiagnostic } from './journal';

export interface DiagnosticSummary {
  count: number;
  latest: string[];
  durableStorageAvailable: boolean;
}

type DiagnosticsDownload = {
  saveJson(fileName: string, content: string): Promise<string>;
};

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
  const fileName = 'CodexMobileUI-diagnostics-' + stamp + '.json';
  const destination = (NativeModules.DiagnosticsDownload as DiagnosticsDownload | undefined);
  if (Platform.OS !== 'android' || !destination) {
    throw new Error('当前 Android 外壳不支持直接保存诊断文件');
  }
  if (Number(Platform.Version) < 29 &&
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE) !==
        PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('未获得写入下载目录的权限');
  }
  const savedPath = await destination.saveJson(fileName, JSON.stringify(snapshot, null, 2));
  logDiagnostic('diagnostics.fileCreated', { count: data.events.length, result: 'success' });
  return savedPath;
}
