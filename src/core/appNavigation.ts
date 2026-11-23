import { NativeModules, Platform } from 'react-native';

type AppNavigation = { moveToBackground: () => void };

/** Keep the existing Android activity and WebView alive when back reaches root. */
export function backgroundApp(): void {
  if (Platform.OS !== 'android') return;
  (NativeModules.AppNavigation as AppNavigation | undefined)?.moveToBackground();
}
