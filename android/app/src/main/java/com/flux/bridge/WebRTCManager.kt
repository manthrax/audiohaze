package com.flux.bridge

import android.content.Context
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.webrtc.*
import java.util.*
import android.util.Log
import org.json.JSONObject

class WebRTCManager(private val context: Context, private val listener: WebRTCListener) {
    
    companion object {
        private var isFactoryInitialized = false
    }
    
    private var peerConnectionFactory: PeerConnectionFactory
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var isWaitingForIceComplete = false
    private var isDisposed = false

    interface WebRTCListener {
        fun onSignalGenerated(signal: String)
        fun onConnected()
        fun onDataReceived(data: String)
        fun onSensorStreamActive(active: Boolean)
    }

    init {
        if (!isFactoryInitialized) {
            Log.d("HAZE_DEBUG", "WebRTCManager Init: Initializing Factory Statics")
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .createInitializationOptions()
            )
            isFactoryInitialized = true
        }

        val options = PeerConnectionFactory.Options()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .createPeerConnectionFactory()
        Log.d("HAZE_DEBUG", "WebRTCManager Init: Factory Created")
    }

    fun handleOffer(base64Offer: String) {
        Log.d("HAZE_DEBUG", "Handling New Offer (Resetting state)")
        peerConnection?.dispose()
        peerConnection = null
        isWaitingForIceComplete = false
        
        val iceServers = emptyList<PeerConnection.IceServer>()

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = peerConnectionFactory.createPeerConnection(rtcConfig, object : PeerObserver() {
            override fun onIceCandidate(p0: IceCandidate) {
                // Candidates are bundled in the SDP thanks to waiting for gathering complete
            }

            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState) {
                Log.d("FLUX_DEBUG", "ICE Gathering State: $p0")
                if (p0 == PeerConnection.IceGatheringState.COMPLETE) {
                    if (isWaitingForIceComplete) {
                        isWaitingForIceComplete = false
                        val localSdp = peerConnection?.localDescription
                        if (localSdp != null) {
                            val encoded = encodeSDP(localSdp.description, "answer")
                            listener.onSignalGenerated(encoded)
                        }
                    }
                }
            }

            override fun onDataChannel(p0: DataChannel) {
                Log.d("FLUX_DEBUG", "onDataChannel received remotely: ${p0.label()}")
                setupDataChannel(p0)
            }

            override fun onConnectionChange(p0: PeerConnection.PeerConnectionState) {
                if (p0 == PeerConnection.PeerConnectionState.CONNECTED) {
                    listener.onConnected()
                }
            }
        })

        try {
            // Decode and set remote description
            val jsonStr = decodeSDP(base64Offer)
            val json = JSONObject(jsonStr)
            val sdp = json.getString("sdp")
            
            val sessionDescription = SessionDescription(SessionDescription.Type.OFFER, sdp)
            
            peerConnection?.setRemoteDescription(SimpleSdpObserver {
                createAnswer()
            }, sessionDescription)
        } catch (e: Exception) {
            Log.e("FLUX_DEBUG", "Failed to handle offer JSON", e)
        }
    }

    private fun createAnswer() {
        val constraints = MediaConstraints()
        peerConnection?.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) {
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        // Mark as waiting for ICE to finish before we send the answer QR
                        isWaitingForIceComplete = true
                        
                        // If gathering is already complete (unlikely but possible), trigger immediately
                        if (peerConnection?.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE) {
                            isWaitingForIceComplete = false
                            val encoded = encodeSDP(sdp.description, "answer")
                            listener.onSignalGenerated(encoded)
                        } else {
                            // FALLBACK: If gathering takes too long, send what we have after 3 seconds
                            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                                if (isWaitingForIceComplete) {
                                    Log.d("FLUX_DEBUG", "ICE Gathering Timeout - Sending current SDP")
                                    isWaitingForIceComplete = false
                                    peerConnection?.localDescription?.let { localSdp ->
                                        val encoded = encodeSDP(localSdp.description, "answer")
                                        listener.onSignalGenerated(encoded)
                                    }
                                }
                            }, 3000)
                        }
                    }
                    override fun onSetFailure(p0: String?) {}
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sdp)
            }
            override fun onCreateFailure(p0: String?) {}
            override fun onSetSuccess() {}
            override fun onSetFailure(p0: String?) {}
        }, constraints)
    }

    private var tempFileBytes: java.io.ByteArrayOutputStream? = null
    private var expectedSize = 0L
    private var targetSlot = "NOTIFICATION" // Default
    private var isPreviewMode = false

    private fun sendDiscoveryInfo() {
        val discovery = "{\"type\":\"discovery\",\"slots\":[\"RINGTONE\",\"NOTIFICATION\",\"ALARM\"]}"
        sendData(discovery)
    }

    private fun setupDataChannel(channel: DataChannel) {
        this.dataChannel = channel
        Log.d("FLUX_DEBUG", "Setting up DataChannel. Initial State: ${channel.state()}")
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(p0: Long) {}
            override fun onStateChange() {
                Log.d("FLUX_DEBUG", "DataChannel State Change: ${channel.state()}")
                if (channel.state() == DataChannel.State.OPEN) {
                    Log.d("FLUX_DEBUG", "DataChannel is OPEN. Sending discovery.")
                    sendDiscoveryInfo()
                }
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (buffer.binary) {
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    tempFileBytes?.write(data)
                    
                    if (tempFileBytes?.size()?.toLong() == expectedSize) {
                        val fileData = tempFileBytes!!.toByteArray()
                        if (isPreviewMode) {
                            playDataPreview(fileData)
                        } else {
                            saveAndSetRingtone(fileData)
                        }
                        tempFileBytes = null
                    }
                } else {
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    val msg = String(data)
                    
                    if (msg.startsWith("{\"type\":\"file_meta\"")) {
                        // Very basic JSON parsing
                        expectedSize = msg.substringAfter("\"size\":").substringBefore(",").toLong()
                        targetSlot = msg.substringAfter("\"slot\":\"").substringBefore("\"")
                        isPreviewMode = msg.contains("\"is_preview\":true")
                        tempFileBytes = java.io.ByteArrayOutputStream()
                    } else if (msg.contains("\"cmd\":\"PLAY_TEST_SOUND\"")) {
                        playCurrentTestAudio()
                    } else {
                        listener.onDataReceived(msg)
                    }
                }
            }
        })
    }

    private fun saveAndSetRingtone(data: ByteArray) {
        try {
            val file = java.io.File(context.getExternalFilesDir(null), "haze_notification.wav")
            file.writeBytes(data)
            
            // Deploy via Utils
            val success = RingtoneUtils.setSystemSound(context, file, targetSlot)
            
            if (success) {
                listener.onDataReceived("DEPLOY_SUCCESS")
            } else {
                listener.onDataReceived("DEPLOY_FAILED")
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun playDataPreview(data: ByteArray) {
        try {
            val file = java.io.File(context.getExternalFilesDir(null), "haze_preview.wav")
            file.writeBytes(data)
            RingtoneUtils.playPreview(context, file)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun playCurrentTestAudio() {
        val file = java.io.File(context.getExternalFilesDir(null), "haze_notification.wav")
        if (file.exists()) {
            RingtoneUtils.playPreview(context, file)
        } else {
            RingtoneUtils.playSystemBeepFallback(context)
        }
    }

    private fun generateQrCode(text: String): Bitmap {
        val size = 512
        val hints = HashMap<EncodeHintType, Any>()
        hints[EncodeHintType.ERROR_CORRECTION] = ErrorCorrectionLevel.M
        hints[EncodeHintType.MARGIN] = 1

        val bitMatrix = QRCodeWriter().encode(
            text, BarcodeFormat.QR_CODE, size, size, hints
        )
        val width = bitMatrix.width
        val height = bitMatrix.height
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        for (x in 0 until width) {
            for (y in 0 until height) {
                bmp.setPixel(x, y, if (bitMatrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
        return bmp
    }

    private fun sendData(json: String) {
        if (dataChannel?.state() == DataChannel.State.OPEN) {
            try {
                val buffer = DataChannel.Buffer(
                    java.nio.ByteBuffer.wrap(json.toByteArray()),
                    false
                )
                dataChannel?.send(buffer)
            } catch (e: Exception) {
                Log.e("FLUX_DEBUG", "DataChannel send exception", e)
            }
        }
    }

    fun sendSensorData(json: String) {
        sendData(json)
    }

    private fun stripSDP(sdp: String): String {
        return sdp
    }

    private fun decodeSDP(base64: String): String {
        val data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        val inflater = java.util.zip.Inflater() // Standard ZLIB
        inflater.setInput(data)
        val outputStream = java.io.ByteArrayOutputStream(data.size)
        val buffer = ByteArray(1024)
        try {
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0 && inflater.needsInput()) break
                outputStream.write(buffer, 0, count)
            }
        } catch (e: Exception) {
            Log.e("FLUX_DEBUG", "Decompression failed", e)
        }
        return outputStream.toString("UTF-8")
    }

    private fun encodeSDP(sdp: String, type: String): String {
        val stripped = stripSDP(sdp)
        
        // Wrap in JSON for simple-peer compatibility
        val json = JSONObject()
        json.put("type", type)
        json.put("sdp", stripped)
        
        val input = json.toString().toByteArray(Charsets.UTF_8)
        val compressor = java.util.zip.Deflater(java.util.zip.Deflater.BEST_COMPRESSION) // Standard ZLIB
        compressor.setInput(input)
        compressor.finish()
        val outputStream = java.io.ByteArrayOutputStream(input.size)
        val buffer = ByteArray(1024)
        while (!compressor.finished()) {
            val count = compressor.deflate(buffer)
            outputStream.write(buffer, 0, count)
        }
        return android.util.Base64.encodeToString(outputStream.toByteArray(), android.util.Base64.NO_WRAP)
    }

    fun close() {
        if (isDisposed) return
        isDisposed = true
        Log.d("FLUX_DEBUG", "Cleaning up WebRTC Resources")
        dataChannel?.dispose()
        dataChannel = null
        peerConnection?.dispose()
        peerConnection = null
        peerConnectionFactory.dispose()
    }
}

/**
 * Standard Boilerplate Observers
 */
open class PeerObserver : PeerConnection.Observer {
    override fun onSignalingChange(p0: PeerConnection.SignalingState) {}
    override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState) {}
    override fun onIceConnectionReceivingChange(p0: Boolean) {}
    override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState) {}
    override fun onIceCandidate(p0: IceCandidate) {}
    override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>) {}
    override fun onAddStream(p0: MediaStream) {}
    override fun onRemoveStream(p0: MediaStream) {}
    override fun onDataChannel(p0: DataChannel) {}
    override fun onRenegotiationNeeded() {}
    override fun onAddTrack(p0: RtpReceiver, p1: Array<out MediaStream>) {}
}

open class SimpleSdpObserver(private val onDone: () -> Unit) : SdpObserver {
    override fun onCreateSuccess(p0: SessionDescription) { onDone() }
    override fun onSetSuccess() { onDone() }
    override fun onCreateFailure(p0: String?) {
        Log.e("WebRTC", "SDP Failure: $p0")
    }
    override fun onSetFailure(p0: String?) {
        Log.e("WebRTC", "SDP Failure: $p0")
    }
}
