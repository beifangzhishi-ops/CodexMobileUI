import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java', import.meta.url);
let source = readFileSync(file, 'utf8');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const patched = 'if (!isMainFrame) return; // CodexMobileUI: top-frame native bridge only.';

if (!source.includes(patched)) {
  const forwarding = '                RNCWebView.this.onMessage(message.getData(), sourceOrigin.toString());';
  const injection = '    private void injectJavascriptObject() {' + newline +
    '      if (getSettings().getJavaScriptEnabled()) {';
  if (source.split(forwarding).length !== 2 || source.split(injection).length !== 2) {
    throw Error('Android WebView bridge source changed');
  }
  source = source.replace(forwarding, '                ' + patched + newline + forwarding);
  source = source.replace(injection, injection + newline + [
    '        // Only the frame-aware native bridge can coexist with active HTML.',
    '        if (messagingEnabled && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {',
    '          evaluateJavascriptWithFallback("window.codexMobileVisualizeReady=true;"',
    '            + "window.dispatchEvent(new Event(\'codexmobileui:visualize-ready\'));");',
    '        }',
  ].join(newline));
  writeFileSync(file, source);
}
