package dev.codexmobileui.app

import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class QuotaWidgetModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "QuotaWidget"

  @ReactMethod
  fun updateQuota(host: String, fiveHour: Double?, weekly: Double?, updatedAt: Double) {
    if (host != "6v" && host != "noha") return
    if (!updatedAt.isFinite() || updatedAt < 0 || updatedAt > System.currentTimeMillis() + 60_000) return
    fun valid(value: Double?) = value == null || (value.isFinite() && value in 0.0..100.0)
    if (!valid(fiveHour) || !valid(weekly)) return
    val context = reactApplicationContext
    val prefs = context.getSharedPreferences("codex_quota_widget", Context.MODE_PRIVATE)
    val editor = prefs.edit().putString("host", host)
    // A null value means the connection has not returned a quota; keep its last snapshot.
    if (updatedAt > 0 && updatedAt >= prefs.getLong("$host.updated", 0L) &&
        (fiveHour != null || weekly != null)) {
      // An absent bucket in a new valid snapshot must not inherit an old bucket.
      editor.putInt("$host.five", fiveHour?.toInt() ?: -1)
      editor.putInt("$host.week", weekly?.toInt() ?: -1)
      editor.putLong("$host.updated", updatedAt.toLong())
    }
    editor.apply()
    QuotaWidgetProvider.refresh(context)
  }
}

class QuotaWidgetPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(QuotaWidgetModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
