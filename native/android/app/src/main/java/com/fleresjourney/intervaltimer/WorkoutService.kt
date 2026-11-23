package com.fleresjourney.intervaltimer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.media.MediaPlayer
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import java.util.Locale

internal const val OVERLAY_SETTING = "show_overlay"

class WorkoutService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val deadlineTick = Runnable { render() }
    private lateinit var wakeLock: PowerManager.WakeLock
    private var wakeRenewedAt = 0L
    private var plan: WorkoutPlan? = null
    private var workout: Workout? = null
    private var lastPhase: Phase? = null
    private var lastElapsed = -1L
    private var lastPaused = false
    private var player: MediaPlayer? = null
    private var overlay: TextView? = null
    private val notifications get() = checkNotNull(getSystemService(NotificationManager::class.java))
    private val windowManager get() = checkNotNull(getSystemService(WindowManager::class.java))
    private val isWatch get() = packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH)

    override fun onCreate() {
        super.onCreate()
        current = this
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Workout timer", NotificationManager.IMPORTANCE_LOW))
        wakeLock = checkNotNull(getSystemService(PowerManager::class.java)).newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK, "$packageName:WorkoutTimer"
        ).apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            START -> {
                val next = runCatching {
                    WorkoutPlan(intent.getIntExtra("active", 30), intent.getIntExtra("rest", 10),
                        intent.getIntExtra("rounds", 10), intent.getBooleanExtra("voice", false),
                        intent.getBooleanExtra("vibration", true))
                }.getOrNull()
                if (next == null) {
                    if (workout == null) stopSelf()
                    return START_NOT_STICKY
                }
                plan = next
                workout = Workout(next, SystemClock::elapsedRealtime)
                lastPhase = null
                lastElapsed = -1
                startForeground(NOTIFICATION_ID, notification(workout!!.snapshot()))
            }
            PAUSE -> {
                workout?.pause()
                stopAudioAndVibration()
            }
            RESUME -> workout?.resume()
            STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        render()
        return START_NOT_STICKY
    }

    internal fun snapshot(): TimerSnapshot? = workout?.snapshot()
    internal fun refreshSurfaces() { snapshot()?.let(::updateOverlay) }

    private fun render() {
        handler.removeCallbacks(deadlineTick)
        val state = snapshot() ?: return
        val currentPlan = plan ?: return
        val entered = state.phase != lastPhase
        if (entered || state.paused != lastPaused) {
            notifications.notify(NOTIFICATION_ID, notification(state))
            if (!isWatch) TimerWidget.render(this, state)
        }

        if (!state.paused) {
            if (entered && state.elapsed - state.phase.start <= 300L) transitionCue(state.phase.stage, currentPlan)
            if (currentPlan.hasVoice) {
                val previous = if (entered) state.phase.start - 1 else lastElapsed
                countdownAt(state, previous)?.let { playRecording(listOf("one", "two", "three")[it - 1]) }
            }
        }

        lastPhase = state.phase
        lastElapsed = state.elapsed
        lastPaused = state.paused
        updateOverlay(state)
        if (state.paused || state.phase.stage == Stage.COMPLETE) {
            if (wakeLock.isHeld) wakeLock.release()
            if (state.phase.stage == Stage.COMPLETE) {
                handler.postDelayed({ if (snapshot()?.phase?.stage == Stage.COMPLETE) stopSelf() }, 1_800)
            }
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (!wakeLock.isHeld || now - wakeRenewedAt >= 14 * 60_000L) {
            wakeLock.acquire(15 * 60_000L)
            wakeRenewedAt = now
        }
        val nextSecond = (state.remaining % 1000L).takeUnless { it == 0L } ?: 1000L
        handler.postDelayed(deadlineTick, nextSecond.coerceAtLeast(10L))
    }

    private fun transitionCue(stage: Stage, currentPlan: WorkoutPlan) {
        if (currentPlan.hasVoice) {
            if (stage == Stage.COMPLETE) playRecording("complete")
        } else {
            playRecording("cue-" + stage.name.lowercase(Locale.ROOT))
        }
        if (currentPlan.vibration) {
            val effect = if (stage == Stage.ACTIVE) VibrationEffect.createWaveform(longArrayOf(0, 130, 75, 130, 75, 130), -1)
                else VibrationEffect.createOneShot(900L, VibrationEffect.DEFAULT_AMPLITUDE)
            getSystemService(Vibrator::class.java)?.vibrate(effect)
        }
    }

    private fun playRecording(name: String) {
        player?.release()
        player = null
        val next = MediaPlayer()
        val prepared = runCatching {
            assets.openFd("$name.wav").use { next.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            next.setOnCompletionListener {
                if (player === next) {
                    player = null
                    next.release()
                }
            }
            next.prepare()
            next.start()
        }.isSuccess
        if (prepared) player = next else next.release()
    }

    private fun stopAudioAndVibration() {
        player?.release()
        player = null
        getSystemService(Vibrator::class.java)?.cancel()
    }

    private fun notification(state: TimerSnapshot): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, TimerActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val finished = state.phase.stage == Stage.COMPLETE
        val title = if (state.paused) "Paused · ${state.phase.stage.label}" else state.phase.stage.label
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(if (finished) "Interval Timer" else "Round ${state.phase.round}")
            .setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(!finished)
            .setShowWhen(!state.paused && !finished)
            .setUsesChronometer(!state.paused && !finished)
            .setChronometerCountDown(!state.paused && !finished)
            .setWhen(System.currentTimeMillis() + state.remaining)
        if (!finished) {
            val action = if (state.paused) RESUME else PAUSE
            builder.addAction(action(if (state.paused) "Resume" else "Pause", action, 1))
            builder.addAction(action("End", STOP, 2))
        }
        return builder.build()
    }

    private fun action(label: String, name: String, id: Int): Notification.Action {
        val intent = Intent(this, WorkoutService::class.java).setAction(name)
        val pending = PendingIntent.getService(this, id, intent, PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(null, label, pending).build()
    }

    private fun updateOverlay(state: TimerSnapshot) {
        if (isWatch || activityVisible || state.phase.stage == Stage.COMPLETE ||
            !getSharedPreferences("interval", Context.MODE_PRIVATE).getBoolean(OVERLAY_SETTING, false) ||
            !Settings.canDrawOverlays(this)) {
            removeOverlay()
            return
        }
        if (overlay == null) {
            val view = TextView(this).apply {
                textSize = 17f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(7, 93, 79))
                val padding = (resources.displayMetrics.density * 12).toInt()
                setPadding(padding, padding / 2, padding, padding / 2)
            }
            val bounds = WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT).apply {
                gravity = Gravity.TOP or Gravity.END
                alpha = .78f
            }
            if (runCatching { windowManager.addView(view, bounds) }.isSuccess) overlay = view
        }
        overlay?.text = if (state.paused) "Paused · ${formatRemaining(state.remaining)}"
            else "${state.phase.stage.label} · ${formatRemaining(state.remaining)}"
    }

    private fun removeOverlay() {
        overlay?.let { runCatching { windowManager.removeView(it) } }
        overlay = null
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        stopAudioAndVibration()
        if (wakeLock.isHeld) wakeLock.release()
        removeOverlay()
        current = null
        if (!isWatch) TimerWidget.render(this, null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        internal const val START = "com.fleresjourney.intervaltimer.START"
        internal const val PAUSE = "com.fleresjourney.intervaltimer.PAUSE"
        internal const val RESUME = "com.fleresjourney.intervaltimer.RESUME"
        internal const val STOP = "com.fleresjourney.intervaltimer.STOP"
        private const val CHANNEL = "interval_workout"
        private const val NOTIFICATION_ID = 10
        internal var current: WorkoutService? = null
            private set
        internal var activityVisible = false
    }
}

internal fun formatRemaining(remaining: Long): String {
    val seconds = (remaining + 999L) / 1000L
    return if (seconds >= 3600) String.format(Locale.US, "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
        else String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60)
}
