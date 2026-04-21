package com.flux.bridge

import android.content.ContentValues
import android.content.Context
import android.media.RingtoneManager
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import java.io.File

/**
 * Helper to register audio files with the Android MediaStore and
 * assign them as system-wide sounds.
 */
object RingtoneUtils {

    fun setSystemSound(context: Context, file: File, slot: String): Boolean {
        try {
            val contentValues = ContentValues().apply {
                put(MediaStore.MediaColumns.DATA, file.absolutePath)
                put(MediaStore.MediaColumns.TITLE, "Flux_" + file.nameWithoutExtension)
                put(MediaStore.MediaColumns.MIME_TYPE, "audio/ogg")
                
                // Assign based on slot type
                when (slot.uppercase()) {
                    "RINGTONE" -> put(MediaStore.Audio.Media.IS_RINGTONE, true)
                    "NOTIFICATION" -> put(MediaStore.Audio.Media.IS_NOTIFICATION, true)
                    "ALARM" -> put(MediaStore.Audio.Media.IS_ALARM, true)
                }
            }

            // Delete old entry if it exists to avoid duplicates
            context.contentResolver.delete(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                MediaStore.MediaColumns.DATA + "=?",
                arrayOf(file.absolutePath)
            )

            val newUri = context.contentResolver.insert(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, 
                contentValues
            )

            if (newUri != null) {
                val ringtoneType = when (slot.uppercase()) {
                    "RINGTONE" -> RingtoneManager.TYPE_RINGTONE
                    "NOTIFICATION" -> RingtoneManager.TYPE_NOTIFICATION
                    "ALARM" -> RingtoneManager.TYPE_ALARM
                    else -> RingtoneManager.TYPE_RINGTONE
                }

                RingtoneManager.setActualDefaultRingtoneUri(context, ringtoneType, newUri)
                Log.d("FluxBridge", "Successfully set system sound ($slot): $newUri")
                return true
            }
        } catch (e: Exception) {
            Log.e("FluxBridge", "Failed to set system sound", e)
        }
        return false
    }

    /**
     * Plays the audio file for testing purposes.
     */
    fun playPreview(context: Context, file: File) {
        try {
            val ringtoneUri = Uri.fromFile(file)
            val ringtone = RingtoneManager.getRingtone(context, ringtoneUri)
            ringtone.play()
        } catch (e: Exception) {
            Log.e("FluxBridge", "Preview playback failed", e)
        }
    }

    /**
     * Plays a fallback beep if no custom ringtone has been transferred yet.
     */
    fun playSystemBeepFallback(context: Context) {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val ringtone = RingtoneManager.getRingtone(context, uri)
            ringtone.play()
        } catch (e: Exception) {
            // Ignore
        }
    }
}
