package dev.codexmobileui.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.TimeUnit

class NotificationListenerService : Service() {
  companion object {
    const val ACTION_START = "dev.codexmobileui.notifications.START"
    private const val CHANNEL_STATUS = "codex_private_listener"
    private const val CHANNEL_EVENTS = "codex_task_completed"
    private const val STATUS_ID = 4101
    private val HOST_ID = Regex("[a-z0-9][a-z0-9-]{0,31}")
    private val RUN_ID = Regex("[a-f0-9-]{36}")
    private val THREAD_ID = Regex("[a-zA-Z0-9_-]{8,256}")
    @Volatile var appForeground = false
    @Volatile var activeHost = ""
    @Volatile var activeThread = ""

    // The current approved 6v Tailnet Coordinator, not an arbitrary public endpoint.
    fun validEndpoint(value: String): Boolean =
      Regex("wss://[a-z0-9-]+[.][a-z0-9-]+[.]ts[.]net:4190/api/notifications").matches(value)

    private fun validHostId(value: String): Boolean =
      HOST_ID.matches(value) && value != "all" && value != "constructor" && value != "prototype"
  }

  private val handler = Handler(Looper.getMainLooper())
  private val preferences by lazy { getSharedPreferences("codex_notifications", Context.MODE_PRIVATE) }
  private val manager by lazy { getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager }
  private val network by lazy {
    OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS)
      .pingInterval(45, TimeUnit.SECONDS).build()
  }
  private var socket: WebSocket? = null
  private var endpoint = ""
  private var generation = 0
  private var failures = 0
  private var shuttingDown = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    manager.createNotificationChannel(NotificationChannel(CHANNEL_STATUS,
      "Codex 内网监听", NotificationManager.IMPORTANCE_LOW).apply {
      description = "保持与电脑的私网任务通知连接"
      setSound(null, null)
      enableVibration(false)
    })
    manager.createNotificationChannel(NotificationChannel(CHANNEL_EVENTS,
      "Codex 任务通知", NotificationManager.IMPORTANCE_DEFAULT))
  }

  private fun status(text: String): Notification =
    Notification.Builder(this, CHANNEL_STATUS)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Codex 内网监听")
      .setContentText(text)
      .setContentIntent(PendingIntent.getActivity(this, 4101,
        Intent(this, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .setOngoing(true).setOnlyAlertOnce(true).build()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!preferences.getBoolean("enabled", true)) {
      stopSelf()
      return START_NOT_STICKY
    }
    val value = intent?.getStringExtra("endpoint") ?: preferences.getString("endpoint", "")
    if (value == null || !validEndpoint(value)) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(STATUS_ID, status("正在连接 6v"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(STATUS_ID, status("正在连接 6v"))
    }
    if (endpoint != value || socket == null) {
      endpoint = value
      shuttingDown = false
      connect()
    }
    return START_STICKY
  }

  private fun connect() {
    if (shuttingDown || !preferences.getBoolean("enabled", true)) return
    val previous = socket
    val epoch = ++generation
    previous?.cancel()
    val request = Request.Builder().url(endpoint)
      .header("Origin", endpoint.removeSuffix("/api/notifications").replaceFirst("wss:", "https:")).build()
    socket = network.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (epoch != generation || shuttingDown) { webSocket.close(1000, null); return }
        failures = 0
        handler.post { manager.notify(STATUS_ID, status("已连接私网通知")) }
        val cursor: Any = if (preferences.contains("lastSeq")) preferences.getLong("lastSeq", 0L)
          else JSONObject.NULL
        webSocket.send(JSONObject().put("type", "subscribe").put("after", cursor).toString())
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        if (epoch != generation || shuttingDown || text.length > 512_000) return
        try {
          val payload = JSONObject(text)
          when (payload.optString("type")) {
            "event" -> {
              val event = payload.optJSONObject("event") ?: return
              val seq = consume(event)
              if (seq != null) notifyEvent(event)
            }
            "replay" -> {
              val events = payload.optJSONArray("events") ?: JSONArray()
              var missed = 0
              val notify = mutableListOf<JSONObject>()
              for (index in 0 until minOf(events.length(), 300)) {
                val event = events.optJSONObject(index) ?: continue
                if (consume(event) != null && !isCurrentlyVisible(event)) {
                  missed++
                  notify.add(event)
                }
              }
              val latest = payload.optLong("latest", -1L)
              if (latest >= 0L && !preferences.contains("lastSeq"))
                preferences.edit().putLong("lastSeq", latest).apply()
              if (missed > 3) {
                notifySummary(missed)
              } else {
                notify.forEach(::notifyEvent)
              }
            }
          }
        } catch (_: Exception) { /* Ignore malformed or stale network frames. */ }
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = reconnect(epoch)
      override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) = reconnect(epoch)
    })
  }

  private fun reconnect(epoch: Int) {
    if (epoch != generation || shuttingDown) return
    handler.post {
      if (epoch != generation || shuttingDown) return@post
      socket = null
      manager.notify(STATUS_ID, status("连接中断 · 等待重连"))
      val delay = minOf(30_000L, 3000L * (1L shl minOf(failures++, 4)))
      handler.postDelayed({ if (epoch == generation) connect() }, delay)
    }
  }

  private fun consume(event: JSONObject): Long? {
    val seq = event.optLong("seq", -1L)
    if (seq < 0 || seq <= preferences.getLong("lastSeq", -1L)) return null
    val host = event.optString("hostId")
    if (event.optString("kind") == "reminder") {
      if (!validHostId(host) || !event.optString("taskId").matches(RUN_ID) ||
          !event.optString("runId").matches(RUN_ID)) return null
    } else if ((host != "6v" && host != "noha") || !event.optString("threadId").matches(THREAD_ID)) return null
    preferences.edit().putLong("lastSeq", seq).apply()
    return seq
  }

  private fun isCurrentlyVisible(event: JSONObject): Boolean =
    event.optString("kind") != "reminder" && appForeground && activeHost == event.optString("hostId") &&
      activeThread == event.optString("threadId")

  private fun notifyEvent(event: JSONObject) {
    if (isCurrentlyVisible(event)) return
    val seq = event.optLong("seq", 0L)
    val host = event.optString("hostId")
    val reminder = event.optString("kind") == "reminder"
    val title = if (reminder) event.optString("title").take(160).ifBlank { "定时提醒" }
      else event.optString("title").replace(Regex("\\s+"), " ").take(80).ifBlank { "新对话" }
    val preview = if (reminder) event.optString("preview").take(720)
      else event.optString("preview").replace(Regex("\\s+"), " ").take(360).trim()
    val result = if (reminder) "定时提醒" else when (event.optString("status")) {
      "failed" -> "执行失败"
      "interrupted" -> "已中断"
      else -> "本轮已完成"
    }
    val uri = Uri.Builder().scheme("codexmobileui").authority(if (reminder) "reminder" else "thread")
      .appendQueryParameter("host", host).apply {
        if (reminder) {
          appendQueryParameter("task", event.optString("taskId"))
          appendQueryParameter("run", event.optString("runId"))
        } else appendQueryParameter("thread", event.optString("threadId"))
      }.build()
    val destination = PendingIntent.getActivity(this, (seq % Int.MAX_VALUE).toInt(),
      Intent(Intent.ACTION_VIEW, uri, this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val body = preview.ifBlank { result }
    manager.notify((seq % (Int.MAX_VALUE - 10000)).toInt() + 10000,
      Notification.Builder(this, CHANNEL_EVENTS)
        .setSmallIcon(android.R.drawable.stat_notify_chat)
        .setContentTitle(title)
        .setContentText(body)
        .setSubText("$host · $result")
        .setStyle(Notification.BigTextStyle().bigText(body)
          .setBigContentTitle(title).setSummaryText("$host · $result"))
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setContentIntent(destination)
        .setAutoCancel(true).build())
  }

  private fun notifySummary(count: Int) {
    manager.notify(4102, Notification.Builder(this, CHANNEL_EVENTS)
      .setSmallIcon(android.R.drawable.stat_notify_chat)
      .setContentTitle("CodexMobileUI")
      .setContentText("离线期间有 $count 条任务消息，打开 App 查看")
      .setContentIntent(PendingIntent.getActivity(this, 4102, Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .setAutoCancel(true).build())
  }

  override fun onDestroy() {
    shuttingDown = true
    ++generation
    handler.removeCallbacksAndMessages(null)
    socket?.cancel()
    socket = null
    super.onDestroy()
  }
}
