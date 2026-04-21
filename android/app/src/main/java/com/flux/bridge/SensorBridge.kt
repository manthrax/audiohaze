package com.flux.bridge

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * Captures high-frequency 6DOF rotation data and streams it as JSON to the WebRTC manager.
 */
class SensorBridge(context: Context, private val onUpdate: (String) -> Unit) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val rotationSensor: Sensor? = 
        sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) 
        ?: sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)

    fun start() {
        rotationSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST)
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type == Sensor.TYPE_ROTATION_VECTOR || event.sensor.type == Sensor.TYPE_GAME_ROTATION_VECTOR) {
            val q = FloatArray(4)
            SensorManager.getQuaternionFromVector(q, event.values)
            
            // Format as minimal JSON for low latency
            // [w, x, y, z] order
            val json = "{\"q\":[${q[0]},${q[1]},${q[2]},${q[3]}]}"
            onUpdate(json)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
