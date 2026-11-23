package dev.codexmobileui.app

import android.content.Context
import android.content.Intent
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/** Only a foreground task-status subscriber; conversations remain in the shared WebView. */
class NotificationBridge(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "CodexNotifications"

  @ReactMethod
  fun isEnabled(promise: Promise) {
    promise.resolve(reactApplicationContext.getSharedPreferences("codex_notifications", Context.MODE_PRIVATE)
      .getBoolean("enabled", true))
  }

  @ReactMethod
  fun start(endpoint: String) {
    if (!NotificationListenerService.validEndpoint(endpoint)) return
    val context = reactApplicationContext
    val prefs = context.getSharedPreferences("codex_notifications", Context.MODE_PRIVATE)
    if (!prefs.getBoolean("enabled", true)) return
    prefs.edit().putString("endpoint", endpoint).apply()
    val intent = Intent(context, NotificationListenerService::class.java).apply {
      action = NotificationListenerService.ACTION_START
      putExtra("endpoint", endpoint)
    }
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
    else context.startService(intent)
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean, endpoint: String) {
    val context = reactApplicationContext
    if (enabled && !NotificationListenerService.validEndpoint(endpoint)) return
    context.getSharedPreferences("codex_notifications", Context.MODE_PRIVATE)
      .edit().putBoolean("enabled", enabled).apply()
    if (enabled) start(endpoint)
    else context.stopService(Intent(context, NotificationListenerService::class.java))
  }

  @ReactMethod
  fun setActive(hostId: String?, threadId: String?, foreground: Boolean) {
    NotificationListenerService.appForeground = foreground
    NotificationListenerService.activeHost = if (hostId == "6v" || hostId == "noha") hostId else ""
    NotificationListenerService.activeThread =
      if (threadId != null && threadId.matches(Regex("[a-zA-Z0-9_-]{8,256}"))) threadId else ""
  }
}

class NotificationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(NotificationBridge(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
