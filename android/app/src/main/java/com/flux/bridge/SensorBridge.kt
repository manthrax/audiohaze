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
    private val accelSensor: Sensor? = 
        sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)

    private var posX = 0f
    private var posY = 0f
    private var posZ = 0f
    private var velX = 0f
    private var velY = 0f
    private var velZ = 0f
    private var lastTimestamp: Long = 0
    private var lastQ = floatArrayOf(1f, 0f, 0f, 0f)
    private var lastJsonTime: Long = 0

    fun start() {
        rotationSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST)
        }
        accelSensor?.let {
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
            lastQ = q
            streamTelemetry()
        } else if (event.sensor.type == Sensor.TYPE_LINEAR_ACCELERATION) {
            if (lastTimestamp != 0L) {
                val dt = (event.timestamp - lastTimestamp) / 1000000000f
                
                // Extremely basic integration (will drift, but provides 6DOF demo)
                // We should ideally rotate the acceleration vector by the quaternion first, 
                // but for a simple "trail" demo, we'll keep it in local space for now.
                velX += event.values[0] * dt
                velY += event.values[1] * dt
                velZ += event.values[2] * dt
                
                posX += velX * dt
                posY += velY * dt
                posZ += velZ * dt
                
                // Add some damping to prevent infinite drift during stationary periods
                velX *= 0.95f
                velY *= 0.95f
                velZ *= 0.95f
            }
            lastTimestamp = event.timestamp
            streamTelemetry()
        }
    }

    private fun streamTelemetry() {
        // Enforce a maximum ~30Hz send rate to prevent WebRTC DataChannel OOM/Buffer exhaustion
        val now = System.currentTimeMillis()
        if (now - lastJsonTime < 33) return
        lastJsonTime = now

        // [w, x, y, z, px, py, pz]
        val json = "{\"q\":[${lastQ[0]},${lastQ[1]},${lastQ[2]},${lastQ[3]},$posX,$posY,$posZ]}"
        onUpdate(json)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
