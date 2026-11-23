package dev.codexmobileui.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class AppNavigationModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AppNavigation"

  @ReactMethod
  fun moveToBackground() {
    // Do not finish the activity: its WebView, draft and selected thread remain intact.
    val activity = reactApplicationContext.getCurrentActivity() ?: return
    activity.runOnUiThread {
      if (!activity.isFinishing && !activity.isDestroyed) activity.moveTaskToBack(true)
    }
  }
}

class AppNavigationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(AppNavigationModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
