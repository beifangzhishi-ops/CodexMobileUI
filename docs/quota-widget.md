# Android 2×1 quota widget

The Android launcher widget occupies **two home-screen columns by one row**.
It contains only the five-hour quota ring and weekly quota ring; each has a
small label inside the circle. There is no app icon or host label in the widget.
Tapping anywhere launches/restores `MainActivity` (the normal unified UI).

- The existing private Codex connection remains the only source of quota data.
  `web/src/DesktopApp.tsx` mirrors the currently selected host's bounded
  percentages and snapshot timestamp to the native shell via WebView messaging.
- `src/core/quotaWidget.ts` rejects malformed host, percentage, and timestamp
  data. The native module stores only per-host percentages, host selection, and
  timestamps in private Android preferences. Nothing about chats or credentials
  is written into widget storage.
- `QuotaWidgetProvider` renders that saved snapshot without starting a WebView,
  Codex session, or background service. Missing data renders as an em dash;
  snapshots older than 30 minutes use dimmer arcs (no extra text is added to
  the compact widget).
- Android may ask the widget to redraw roughly every 30 minutes, but this is
  **not a network refresh**. New quota data is read when the app connects and
  the native Codex service emits updates. A future optional background refresh
  needs an independently reviewed private-network and battery strategy.
- The native Android directory is generated/ignored in this repository.
  `native/quota-widget` holds the tracked source. Run
  `node scripts/sync-quota-widget-native.mjs` after any Expo prebuild; the
  stable Android packaging entry point synchronizes it automatically.
- A static Android app shortcut named “添加小组件” appears on launchers that
  support long-press app shortcuts. Selecting it starts a transient native
  activity which uses `AppWidgetManager.requestPinAppWidget`, letting the
  launcher confirm placement. This requires Android 8+ and launcher support.
  When the launcher cannot handle direct pinning, a message directs users to
  its normal widget picker. The launcher may also provide its own widget
  entry; menu appearance and placement are controlled by the launcher.
- Android home screen: long-press empty space → Widgets → CodexMobileUI →
  quota widget. Exact spacing varies with launcher grid/density.

The separate phone top-bar quota strip uses the same existing `WebQuotaRing`
and detail dialog. Desktop/browser layouts are unchanged by its mobile CSS.

Release validation still requires compiling Android native Kotlin and checking
the widget on a physical launcher. TypeScript and web builds alone do not
validate widget registration, rendering, or click behavior.
