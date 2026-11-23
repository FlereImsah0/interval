package com.fleresjourney.intervaltimer

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

class TimerActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var setup: LinearLayout
    private lateinit var running: LinearLayout
    private lateinit var status: TextView
    private lateinit var timer: TextView
    private lateinit var pause: Button
    private var pendingWorkout: Intent? = null
    private val refresh = object : Runnable {
        override fun run() {
            val state = WorkoutService.current?.snapshot()
            setup.visibility = if (state == null) View.VISIBLE else View.GONE
            running.visibility = if (state == null) View.GONE else View.VISIBLE
            if (state != null) {
                status.text = if (state.paused) "Paused · ${state.phase.stage.label}"
                    else "${state.phase.stage.label} · round ${state.phase.round}"
                timer.text = formatRemaining(state.remaining)
                pause.text = if (state.paused) "Resume" else "Pause"
                pause.visibility = if (state.phase.stage == Stage.COMPLETE) View.GONE else View.VISIBLE
            }
            handler.postDelayed(this, 200)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("interval", MODE_PRIVATE)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        val scroll = ScrollView(this).apply { addView(root) }
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        setContentView(scroll)
        root.addView(TextView(this).apply { text = "Interval Timer"; textSize = 23f })
        setup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(setup)
        val active = field("Active time (seconds)", prefs.getInt("active", 30))
        val rest = field("Rest time (seconds)", prefs.getInt("rest", 10))
        val rounds = field("Rounds (0 for unlimited)", prefs.getInt("rounds", 10))
        val sound = RadioButton(this).apply { id = View.generateViewId(); text = "Sound" }
        val voice = RadioButton(this).apply { id = View.generateViewId(); text = "Voice" }
        setup.addView(RadioGroup(this).apply {
            addView(sound)
            addView(voice)
            check(if (prefs.getBoolean("voice", false)) voice.id else sound.id)
        })
        val vibration = CheckBox(this).apply {
            text = "Vibration"
            isChecked = prefs.getBoolean("vibration", true)
        }
        setup.addView(vibration)
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH)) {
            setup.addView(Switch(this).apply {
                text = "Show over other apps"
                isChecked = prefs.getBoolean(OVERLAY_SETTING, false)
                setOnCheckedChangeListener { _, enabled ->
                    prefs.edit().putBoolean(OVERLAY_SETTING, enabled).apply()
                    if (enabled && !Settings.canDrawOverlays(this@TimerActivity)) {
                        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                    }
                }
            })
        }
        val error = TextView(this)
        setup.addView(error)
        setup.addView(Button(this).apply {
            text = "Start workout"
            setOnClickListener {
                val plan = runCatching {
                    WorkoutPlan(active.text.toString().toInt(), rest.text.toString().toInt(),
                        rounds.text.toString().toInt(), voice.isChecked, vibration.isChecked)
                }.getOrNull()
                if (plan == null) {
                    error.text = "Set at least one active second, up to 24 hours per round, and 0–9999 rounds."
                    return@setOnClickListener
                }
                error.text = ""
                prefs.edit().putInt("active", plan.activeSeconds).putInt("rest", plan.restSeconds)
                    .putInt("rounds", plan.rounds).putBoolean("voice", plan.hasVoice)
                    .putBoolean("vibration", plan.vibration).apply()
                val start = Intent(this@TimerActivity, WorkoutService::class.java).setAction(WorkoutService.START)
                    .putExtra("active", plan.activeSeconds).putExtra("rest", plan.restSeconds)
                    .putExtra("rounds", plan.rounds).putExtra("voice", plan.hasVoice)
                    .putExtra("vibration", plan.vibration)
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                    !prefs.getBoolean("asked_notifications", false)) {
                    prefs.edit().putBoolean("asked_notifications", true).apply()
                    pendingWorkout = start
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                } else startForegroundService(start)
            }
        })
        running = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        status = TextView(this).apply { textSize = 16f }
        timer = TextView(this).apply { textSize = 39f }
        running.addView(status)
        running.addView(timer)
        pause = Button(this).apply {
            setOnClickListener {
                val action = if (WorkoutService.current?.snapshot()?.paused == true) WorkoutService.RESUME else WorkoutService.PAUSE
                startService(Intent(this@TimerActivity, WorkoutService::class.java).setAction(action))
            }
        }
        running.addView(pause)
        running.addView(Button(this).apply {
            text = "End workout"
            setOnClickListener { stopService(Intent(this@TimerActivity, WorkoutService::class.java)) }
        })
        root.addView(running)
    }

    override fun onStart() {
        super.onStart()
        WorkoutService.activityVisible = true
        WorkoutService.current?.refreshSurfaces()
        handler.post(refresh)
    }

    override fun onStop() {
        WorkoutService.activityVisible = false
        WorkoutService.current?.refreshSurfaces()
        handler.removeCallbacks(refresh)
        super.onStop()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) {
            pendingWorkout?.let { startForegroundService(it) }
            pendingWorkout = null
        }
    }

    private fun field(label: String, value: Int): EditText {
        val input = EditText(this).apply {
            id = View.generateViewId()
            inputType = InputType.TYPE_CLASS_NUMBER
            setText(value.toString())
            setSelectAllOnFocus(true)
        }
        setup.addView(TextView(this).apply { text = label; labelFor = input.id })
        setup.addView(input)
        return input
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
