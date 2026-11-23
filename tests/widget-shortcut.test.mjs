import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const shortcuts = source('../native/quota-widget/quota_widget_shortcuts.xml');
const pin = source('../native/quota-widget/QuotaWidgetPinActivity.kt');
const strings = source('../native/quota-widget/quota_widget_strings.xml');
const sync = source('../scripts/sync-quota-widget-native.mjs');
const widget = source('../native/quota-widget/quota_widget_info.xml');
const layout = source('../native/quota-widget/quota_widget.xml');
const renderer = source('../native/quota-widget/QuotaWidgetProvider.kt');

test('launcher shortcut targets a dedicated native system widget-pin flow', () => {
  assert.match(shortcuts, /shortcutId="add_quota_widget"/);
  assert.match(shortcuts, /shortcutShortLabel="@string\/quota_widget_shortcut_short"/);
  assert.match(shortcuts, /targetClass="dev\.codexmobileui\.app\.QuotaWidgetPinActivity"/);
  assert.match(strings, /添加小组件/);
  assert.match(pin, /isRequestPinAppWidgetSupported/);
  assert.match(pin, /requestPinAppWidget\(/);
  assert.match(pin, /QuotaWidgetProvider::class\.java/);
  assert.match(pin, /quota_widget_pin_unsupported/);
});

test('native sync publishes shortcut metadata for the actual launcher activity', () => {
  assert.match(sync, /QuotaWidgetPinActivity\.kt/);
  assert.match(sync, /quota_widget_shortcuts\.xml/);
  assert.match(sync, /quota_widget_strings\.xml/);
  assert.match(sync, /android\.app\.shortcuts/);
  assert.match(sync, /Missing launcher MainActivity for app shortcuts/);
  assert.match(sync, /android:exported="true" android:excludeFromRecents="true"/);
  assert.match(widget, /targetCellWidth="2"/);
  assert.match(widget, /targetCellHeight="1"/);
});

test('compact 2x1 widget renders only two equal rings, each with its own label', () => {
  assert.match(layout, /@\+id\/quota_widget_five/);
  assert.match(layout, /@\+id\/quota_widget_week/);
  assert.equal((layout.match(/android:layout_weight="1"/g) ?? []).length, 2);
  assert.equal((layout.match(/<ImageView/g) ?? []).length, 2);
  assert.doesNotMatch(layout, /ic_launcher|quota_widget_host|<TextView/);
  assert.match(layout, /layout_width="48dp" android:layout_height="48dp"/);
  assert.match(renderer, /quotaRing\(five, stale, "5小时"\)/);
  assert.match(renderer, /quotaRing\(week, stale, "每周"\)/);
  assert.doesNotMatch(renderer, /R\.id\.quota_widget_host/);
});
