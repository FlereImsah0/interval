package com.fleresjourney.intervaltimer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews

class TimerWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        render(context, WorkoutService.current?.snapshot())
    }

    companion object {
        internal fun render(context: Context, snapshot: TimerSnapshot?) {
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, TimerWidget::class.java)
            if (manager.getAppWidgetIds(component).isEmpty()) return
            val layout = RemoteViews(context.packageName, R.layout.timer_widget)
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, TimerActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            layout.setOnClickPendingIntent(R.id.widget_base, open)
            val running = snapshot != null && !snapshot.paused && snapshot.phase.stage != Stage.COMPLETE
            layout.setTextViewText(R.id.widget_phase, if (snapshot?.paused == true) "Paused"
                else snapshot?.phase?.stage?.label ?: "Open Interval Timer")
            layout.setViewVisibility(R.id.widget_clock, if (running) View.VISIBLE else View.GONE)
            if (running) {
                layout.setChronometer(R.id.widget_clock, SystemClock.elapsedRealtime() + snapshot.remaining, null, true)
                layout.setChronometerCountDown(R.id.widget_clock, true)
            }
            manager.updateAppWidget(component, layout)
        }
    }
}
