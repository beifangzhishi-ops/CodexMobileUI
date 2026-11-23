import { readFileSync, writeFileSync } from 'node:fs';

// Keep WebView's file callback and URI handling. Image-only inputs go straight
// to Android's picker, which can hand off to Photo Picker on supported devices.
const file = new URL('../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewModuleImpl.java', import.meta.url);
const source = readFileSync(file, 'utf8');
const start = '        ArrayList<Parcelable> extraIntents = new ArrayList<>();';
const replacement = [
  '        // CodexMobileUI: open the system image picker without capture choices.',
  '        if (!isCaptureEnabled && acceptsImages(acceptTypes) && !acceptsVideo(acceptTypes)) {',
  '            Intent picker = getFileChooserIntent(acceptTypes, allowMultiple);',
  '            picker.setType("image/*");',
  '            if (activity != null && picker.resolveActivity(activity.getPackageManager()) != null) {',
  '                activity.startActivityForResult(picker, PICKER);',
  '                return true;',
  '            }',
  '            mFilePathCallback = null;',
  '            callback.onReceiveValue(null);',
  '            return true;',
  '        }',
  '',
  start,
].join(source.includes('\r\n') ? '\r\n' : '\n');

if (!source.includes('CodexMobileUI: open the system image picker')) {
  if (source.split(start).length !== 2) throw Error('Android WebView photo picker source changed');
  writeFileSync(file, source.replace(start, replacement));
}
