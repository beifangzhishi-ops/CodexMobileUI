package dev.codexmobileui.app

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * React Native-only sink for already-sanitized diagnostics JSON. Remote chat
 * content cannot call it, and it never accepts a filesystem destination.
 */
class DiagnosticsDownloadModule(
  context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val writer = Executors.newSingleThreadExecutor()

  override fun getName() = "DiagnosticsDownload"

  @ReactMethod
  fun saveJson(fileName: String, content: String, promise: Promise) {
    if (!fileName.matches(Regex("[A-Za-z0-9._-]{1,128}")) ||
        !fileName.startsWith("CodexMobileUI-diagnostics-") || !fileName.endsWith(".json")) {
      promise.reject("E_DIAGNOSTICS_FILE_NAME", "诊断文件名无效")
      return
    }
    val bytes = content.toByteArray(Charsets.UTF_8)
    if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) {
      promise.reject("E_DIAGNOSTICS_CONTENT", "诊断文件内容无效")
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
        reactApplicationContext.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
        PackageManager.PERMISSION_GRANTED) {
      promise.reject("E_DIAGNOSTICS_PERMISSION", "未获得写入下载目录的权限")
      return
    }
    writer.execute {
      try {
        val path = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveWithMediaStore(fileName, bytes)
        } else {
          saveLegacy(fileName, bytes)
        }
        promise.resolve(path)
      } catch (_: Throwable) {
        promise.reject("E_DIAGNOSTICS_SAVE", "诊断文件保存失败")
      }
    }
  }

  private fun saveWithMediaStore(fileName: String, bytes: ByteArray): String {
    val resolver = reactApplicationContext.contentResolver
    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, fileName)
      put(MediaStore.Downloads.MIME_TYPE, "application/json")
      put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val uri = resolver.insert(collection, values)
      ?: throw IllegalStateException("MediaStore insert failed")
    var published = false
    try {
      resolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
        ?: throw IllegalStateException("MediaStore output unavailable")
      values.clear()
      values.put(MediaStore.Downloads.IS_PENDING, 0)
      if (resolver.update(uri, values, null, null) != 1) {
        throw IllegalStateException("MediaStore publish failed")
      }
      published = true
      val actualName = resolver.query(
        uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
      return if (actualName.isNullOrBlank()) Environment.DIRECTORY_DOWNLOADS
        else Environment.DIRECTORY_DOWNLOADS + "/" + actualName
    } finally {
      if (!published) resolver.delete(uri, null, null)
    }
  }

  @Suppress("DEPRECATION")
  private fun saveLegacy(fileName: String, bytes: ByteArray): String {
    val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("Download directory unavailable")
    }
    var target = File(directory, fileName)
    var suffix = 1
    while (target.exists()) {
      val stem = fileName.removeSuffix(".json")
      target = File(directory, "$stem-$suffix.json")
      suffix++
    }
    val pending = File(directory, "." + target.name + "." + UUID.randomUUID() + ".pending")
    try {
      pending.writeBytes(bytes)
      if (!pending.renameTo(target)) {
        throw IllegalStateException("Atomic rename failed")
      }
      return Environment.DIRECTORY_DOWNLOADS + "/" + target.name
    } finally {
      if (pending.exists()) pending.delete()
    }
  }
}

class DiagnosticsDownloadPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(DiagnosticsDownloadModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
