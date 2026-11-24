import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const file = new URL('../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java', import.meta.url);
const patched = 'if (!isMainFrame) return; // CodexMobileUI: top-frame native bridge only.';
const readyOnLoad = 'injectJavascriptObject(); // CodexMobileUI: advertise capability on every completed page.';

export function patchWebViewBridge(original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let source = original;
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
  }

  // The upstream onPageFinished always calls callInjectedJavaScript(), but the
  // upstream re-injection is conditional on a nonempty injectedJS prop. This
  // app does not need that prop; bridge creation alone can target about:blank.
  // Move the existing call outside the optional-script block, including when
  // upgrading a previously patched incremental build checkout.
  if (!source.includes(readyOnLoad)) {
    const old = [
      '            injectJavascriptObject(); // re-inject the Javascript object in case it has been overwritten.',
      '        }',
      '    }',
      '',
      '    public void callInjectedJavaScriptBeforeContentLoaded() {',
    ].join(newline);
    const replacement = [
      '        }',
      '        ' + readyOnLoad,
      '    }',
      '',
      '    public void callInjectedJavaScriptBeforeContentLoaded() {',
    ].join(newline);
    if (source.split(old).length !== 2) throw Error('Android WebView page-finish injection source changed');
    source = source.replace(old, replacement);
  }
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const original = readFileSync(file, 'utf8');
  const source = patchWebViewBridge(original);
  if (source !== original) writeFileSync(file, source);
}
