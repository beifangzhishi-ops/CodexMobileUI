package dev.codexmobileui.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.widget.RemoteViews

/** Compact two-column launcher widget: five-hour quota and weekly quota. */
class QuotaWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    render(context, manager, appWidgetIds)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: android.os.Bundle
  ) {
    render(context, manager, intArrayOf(appWidgetId))
  }

  companion object {
    private val blue = Color.rgb(75, 156, 255)
    private val bright = Color.rgb(246, 248, 252)

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, QuotaWidgetProvider::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun quotaRing(percent: Int, stale: Boolean, label: String): Bitmap {
      // Each circle is drawn in a square bitmap and displayed with fitCenter.
      val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 9f
        strokeCap = Paint.Cap.ROUND
        color = Color.rgb(73, 77, 86)
      }
      canvas.drawCircle(64f, 64f, 53f, arc)
      if (percent in 0..100) {
        arc.color = if (stale) Color.rgb(110, 138, 174) else blue
        canvas.drawArc(RectF(11f, 11f, 117f, 117f), -90f, percent * 3.6f, false, arc)
      }
      val lettering = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = bright
        textSize = 28f
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(
          "sans-serif-medium", android.graphics.Typeface.NORMAL)
      }
      canvas.drawText(if (percent in 0..100) "$percent%" else "—", 64f,
        57f - (lettering.ascent() + lettering.descent()) / 2f, lettering)
      lettering.textSize = 20f
      lettering.color = Color.rgb(166, 170, 180)
      canvas.drawText(label, 64f, 92f, lettering)
      return bitmap
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val prefs = context.getSharedPreferences("codex_quota_widget", Context.MODE_PRIVATE)
      val host = prefs.getString("host", "6v") ?: "6v"
      val five = prefs.getInt("$host.five", -1)
      val week = prefs.getInt("$host.week", -1)
      val updated = prefs.getLong("$host.updated", 0L)
      val stale = updated <= 0L || System.currentTimeMillis() - updated > 30 * 60 * 1000L
      val fiveRing = quotaRing(five, stale, "5小时")
      val weekRing = quotaRing(week, stale, "每周")
      val launch = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val tap = PendingIntent.getActivity(context, 0, launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.quota_widget)
        views.setImageViewBitmap(R.id.quota_widget_five, fiveRing)
        views.setImageViewBitmap(R.id.quota_widget_week, weekRing)
        val description = "Codex $host，5小时额度" +
          (if (five in 0..100) "剩余$five%" else "未知") +
          "，每周额度" + (if (week in 0..100) "剩余$week%" else "未知") +
          (if (stale) "，缓存数据，点击打开应用" else "，点击打开应用")
        views.setContentDescription(R.id.quota_widget_root, description)
        views.setOnClickPendingIntent(R.id.quota_widget_root, tap)
        manager.updateAppWidget(id, views)
      }
    }
  }
}
