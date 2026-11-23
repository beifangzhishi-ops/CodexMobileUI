package dev.codexmobileui.app

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import android.widget.Toast

/** Launcher shortcut target: request the system's normal widget placement flow. */
class QuotaWidgetPinActivity : Activity() {
  private var handled = false

  override fun onResume() {
    super.onResume()
    if (handled) return
    handled = true

    val supported = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val manager = AppWidgetManager.getInstance(this)
        manager.isRequestPinAppWidgetSupported && manager.requestPinAppWidget(
          ComponentName(this, QuotaWidgetProvider::class.java), null, null
        )
      } catch (_: RuntimeException) {
        false
      }
    } else {
      false
    }
    if (!supported) {
      Toast.makeText(this, R.string.quota_widget_pin_unsupported, Toast.LENGTH_LONG).show()
    }
    // The launcher owns the confirmation and placement UI; we never pin silently.
    finish()
  }
}
