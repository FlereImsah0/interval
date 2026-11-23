package com.fleresjourney.intervaltimer

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.window.OnBackInvokedDispatcher
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

private const val LOCAL_HOST = "appassets.androidplatform.net"
private const val LOCAL_ORIGIN = "https://$LOCAL_HOST"
private const val NOTIFICATION_PERMISSION = 1

class TimerActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private lateinit var surface: FrameLayout
    private var pageReady = false
    private var lastState: String? = null
    private var pendingWorkout: Intent? = null
    private val prefs by lazy { getSharedPreferences("interval", MODE_PRIVATE) }
    private val refresh = object : Runnable {
        override fun run() {
            sendState()
            handler.postDelayed(this, 230)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    return assets.shouldInterceptRequest(request.url)
                        ?: WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), null)
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.scheme == "https" && url.host == LOCAL_HOST && url.port == -1 &&
                        url.path == "/assets/index.html") return false
                    if (request.isForMainFrame && request.hasGesture() && url.scheme == "mailto") {
                        runCatching { startActivity(Intent(Intent.ACTION_SENDTO, url)) }
                    }
                    return true
                }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "IntervalAndroid", setOf(LOCAL_ORIGIN)) {
                _, message, origin, mainFrame, _ ->
                if (mainFrame && origin.toString().trimEnd('/') == LOCAL_ORIGIN) {
                    runCatching { JSONObject(message.data.orEmpty()) }.getOrNull()?.let(::handleMessage)
                }
            }
        }
        surface = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= 30) {
                    val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                    view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                        insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                }
                insets
            }
        }
        setContentView(surface)
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, ::goBack)
        }
        applyTheme(resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)
        web.loadUrl("$LOCAL_ORIGIN/assets/index.html")
    }

    private fun handleMessage(input: JSONObject) {
        when (input.optString("action")) {
            "ready" -> {
                pageReady = true
                lastState = null
                val saved = JSONObject().put("overlay", prefs.getBoolean(OVERLAY_SETTING, false))
                if (prefs.contains("active")) {
                    saved.put("active", prefs.getInt("active", 30))
                        .put("rest", prefs.getInt("rest", 10))
                        .put("rounds", prefs.getInt("rounds", 10))
                        .put("voice", prefs.getBoolean("voice", false))
                        .put("vibration", prefs.getBoolean("vibration", true))
                }
                web.evaluateJavascript("window.intervalAndroidPreferences?.($saved)", null)
                sendState()
            }
            "start" -> startWorkout(input)
            "pause", "resume" -> if (WorkoutService.current != null) {
                val action = if (input.optString("action") == "pause") WorkoutService.PAUSE else WorkoutService.RESUME
                startService(Intent(this, WorkoutService::class.java).setAction(action))
            }
            "stop" -> stopService(Intent(this, WorkoutService::class.java))
            "screenAwake" -> if (input.optBoolean("enabled")) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            "theme" -> applyTheme(input.optBoolean("dark"))
            "touch" -> {
                val vibrator = getSystemService(Vibrator::class.java)
                val pulses = input.optJSONArray("pattern")
                val pulse = input.optLong("pattern", 0).coerceIn(0, 30)
                when {
                    pulses?.length() == 3 -> vibrator?.vibrate(VibrationEffect.createWaveform(
                        longArrayOf(0, pulses.optLong(0).coerceIn(1, 30), pulses.optLong(1).coerceIn(1, 30),
                            pulses.optLong(2).coerceIn(1, 30)), -1))
                    pulse > 0 -> vibrator?.vibrate(VibrationEffect.createOneShot(pulse, VibrationEffect.DEFAULT_AMPLITUDE))
                    else -> vibrator?.cancel()
                }
            }
            "overlay" -> {
                val enabled = input.optBoolean("enabled")
                prefs.edit().putBoolean(OVERLAY_SETTING, enabled).apply()
                WorkoutService.current?.refreshSurfaces()
                if (enabled && !Settings.canDrawOverlays(this)) {
                    runCatching { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
                }
            }
        }
    }

    private fun startWorkout(input: JSONObject) {
        if (pendingWorkout != null) return
        val plan = runCatching {
            WorkoutPlan(input.getInt("active"), input.getInt("rest"), input.getInt("rounds"),
                input.optBoolean("voice"), input.optBoolean("vibration"), input.getInt("prep"))
        }.getOrElse {
            workoutError()
            return
        }
        val intent = Intent(this, WorkoutService::class.java).setAction(WorkoutService.START)
            .putExtra("active", plan.activeSeconds).putExtra("rest", plan.restSeconds)
            .putExtra("rounds", plan.rounds).putExtra("prep", plan.preparationSeconds)
            .putExtra("voice", plan.hasVoice).putExtra("vibration", plan.vibration)
            .putExtra("volume", input.optInt("volume", 100))
            .putExtra("finish", input.optBoolean("finish", true)).putExtra("warning", input.optString("warning", "0"))
            .putExtra("pattern", input.optString("pattern", "activity"))
            .putExtra("mode", input.optString("mode", "general"))
            .putExtra("goWord", input.optString("goWord")).putExtra("restWord", input.optString("restWord"))
        if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("asked_notifications", false) &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("asked_notifications", true).apply()
            pendingWorkout = intent
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION)
        } else launchWorkout(intent)
    }

    private fun launchWorkout(intent: Intent) {
        runCatching { startForegroundService(intent) }.onFailure { workoutError() }
    }

    private fun workoutError() {
        web.evaluateJavascript("window.intervalAndroidStartFailed?.()", null)
    }

    private fun sendState() {
        if (!pageReady) return
        val service = WorkoutService.current
        val snapshot = service?.snapshot()
        val plan = service?.activePlan
        val state = if (service != null && snapshot != null && plan != null) {
            JSONObject().put("id", service.workoutId).put("elapsed", snapshot.elapsed).put("paused", snapshot.paused)
                .put("active", plan.activeSeconds * 1000).put("rest", plan.restSeconds * 1000)
                .put("rounds", plan.rounds).put("prep", plan.preparationSeconds * 1000)
                .put("mode", service.activityMode).toString()
        } else "null"
        if (state == lastState) return
        lastState = state
        web.evaluateJavascript("window.intervalAndroidState?.($state)", null)
    }

    @Suppress("DEPRECATION")
    private fun applyTheme(dark: Boolean) {
        val color = Color.parseColor(if (dark) "#0c1018" else "#f3f5f3")
        surface.setBackgroundColor(color)
        web.setBackgroundColor(color)
        if (Build.VERSION.SDK_INT >= 30) {
            val bars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (dark) 0 else bars, bars)
        } else {
            window.statusBarColor = color
            window.navigationBarColor = color
            window.decorView.systemUiVisibility = if (dark) 0 else
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
    }

    override fun onStart() {
        super.onStart()
        WorkoutService.activityVisible = true
        WorkoutService.current?.refreshSurfaces()
        handler.post(refresh)
    }

    override fun onStop() {
        handler.removeCallbacks(refresh)
        WorkoutService.activityVisible = false
        WorkoutService.current?.refreshSurfaces()
        super.onStop()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        surface.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Uses the platform Back dispatcher on Android 13 and later")
    override fun onBackPressed() = goBack()

    private fun goBack() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == NOTIFICATION_PERMISSION) {
            pendingWorkout?.let(::launchWorkout)
            pendingWorkout = null
        }
    }
}
