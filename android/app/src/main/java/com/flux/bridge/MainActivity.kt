package com.flux.bridge

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhoneAndroid
import android.provider.Settings
import android.content.Intent
import android.net.Uri

class MainActivity : ComponentActivity() {

    private lateinit var rtcManager: WebRTCManager
    private lateinit var sensorBridge: SensorBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("FLUX_DEBUG", "Starting Full FluxBridge Logic")

        // Request Permissions
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 101)
        }

        setContent {
            var currentStep by remember { mutableStateOf("permission") }
            var answerSignal by remember { mutableStateOf<String?>(null) }
            var deployStatus by remember { mutableStateOf<String?>(null) }
            
            // Initialize managers once
            remember {
                rtcManager = WebRTCManager(this, object : WebRTCManager.WebRTCListener {
                    override fun onSignalGenerated(signal: String) {
                        Log.d("FLUX_DEBUG", "Answer Signal Generated")
                        answerSignal = signal
                        currentStep = "answer"
                    }

                    override fun onConnected() {
                        Log.d("FLUX_DEBUG", "P2P CONNECTED")
                        currentStep = "active"
                        sensorBridge.start()
                    }

                    override fun onDataReceived(data: String) {
                        Log.d("FLUX_DEBUG", "WebRTC Data: $data")
                        if (data == "DEPLOY_SUCCESS") {
                            deployStatus = "Success"
                        } else if (data == "DEPLOY_FAILED") {
                            deployStatus = "Failed"
                        }
                    }
                    override fun onSensorStreamActive(active: Boolean) {}
                })

                sensorBridge = SensorBridge(this) { json ->
                    rtcManager.sendSensorData(json)
                }
                true
            }

            FluxBridgeTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF050505)
                ) {
                    when(currentStep) {
                        "permission" -> {
                            PermissionScreen {
                                if (Settings.System.canWrite(this@MainActivity)) {
                                    currentStep = "scan"
                                } else {
                                    val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS).apply {
                                        data = Uri.parse("package:$packageName")
                                    }
                                    startActivity(intent)
                                }
                            }
                        }
                        "scan" -> {
                            QRScannerView { uri ->
                                Log.d("FLUX_DEBUG", "QR Scanned: $uri")
                                val base64 = uri.substringAfter("flux://")
                                rtcManager.handleOffer(base64)
                                currentStep = "connecting"
                            }
                        }
                        "connecting" -> {
                            ConnectingScreen { currentStep = "scan" }
                        }
                        "answer" -> {
                            AnswerQRScreen(answerSignal ?: "INVALID") { currentStep = "scan" }
                        }
                        "active" -> {
                            ActiveBridgeScreen(deployStatus) {
                                rtcManager.close()
                                sensorBridge.stop()
                                deployStatus = null
                                answerSignal = null
                                currentStep = "scan"
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AnswerQRScreen(signal: String, onRestart: () -> Unit) {
    val signalUri = "flux://$signal"
    val qrBitmap = remember(signal) { generateQrBitmap(signalUri) }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("SCAN ON DESKTOP", color = Color(0xFF00CCFF), fontSize = 14.sp, fontFamily = FontFamily.Monospace)
        Spacer(Modifier.height(24.dp))
        
        Box(
            Modifier
                .size(260.dp)
                .background(Color.White)
                .padding(8.dp), 
            contentAlignment = Alignment.Center
        ) {
            if (qrBitmap != null) {
                androidx.compose.foundation.Image(
                    bitmap = qrBitmap.asImageBitmap(),
                    contentDescription = "Answer QR",
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        
        Spacer(Modifier.height(24.dp))
        Text("Show this to your webcam to finalize connection", color = Color.Gray, fontSize = 10.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        
        Spacer(Modifier.height(48.dp))
        androidx.compose.material3.TextButton(
            onClick = { 
                onRestart()
            }
        ) {
            Text("RESTART SESSION", color = Color.Red.copy(alpha = 0.5f), fontSize = 10.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

fun generateQrBitmap(content: String): android.graphics.Bitmap? {
    return try {
        val writer = com.google.zxing.qrcode.QRCodeWriter()
        val bitMatrix = writer.encode(content, com.google.zxing.BarcodeFormat.QR_CODE, 512, 512)
        val width = bitMatrix.width
        val height = bitMatrix.height
        val bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.RGB_565)
        for (x in 0 until width) {
            for (y in 0 until height) {
                bitmap.setPixel(x, y, if (bitMatrix.get(x, y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
        bitmap
    } catch (e: Exception) {
        null
    }
}

@Composable
fun PermissionScreen(onCheck: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("PERMISSIONS REQUIRED", color = Color(0xFF00CCFF), fontSize = 14.sp, fontFamily = FontFamily.Monospace)
        Spacer(Modifier.height(16.dp))
        Text(
            "FluxBridge needs permission to modify system settings to assign ringtones.",
            color = Color.Gray,
            fontSize = 12.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onCheck,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00CCFF))
        ) {
            Text("GRANT & CONTINUE", color = Color.Black)
        }
    }
}

@Composable
fun ConnectingScreen(onRestart: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Color(0xFF00CCFF))
            Spacer(Modifier.height(16.dp))
            Text("NEGOTIATING P2P FLOW", color = Color.Gray, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            
            Spacer(Modifier.height(32.dp))
            androidx.compose.material3.TextButton(onClick = onRestart) {
                Text("RESTART", color = Color.Gray, fontSize = 10.sp)
            }
        }
    }
}

@Composable
fun ActiveBridgeScreen(deployStatus: String?, onDisconnect: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "BRIDGE ACTIVE",
            fontSize = 24.sp,
            color = Color(0xFF00CCFF),
            fontFamily = FontFamily.Monospace
        )
        Spacer(Modifier.height(8.dp))
        Text("STREAMING 6DOF TELEMETRY", color = Color.Gray, fontSize = 12.sp)
        
        Spacer(Modifier.height(48.dp))

        if (deployStatus != null) {
            Text(
                text = "DEPLOY: $deployStatus",
                color = if (deployStatus == "Success") Color.Green else Color.Red,
                fontSize = 14.sp,
                fontFamily = FontFamily.Monospace
            )
            Spacer(Modifier.height(24.dp))
        }
        
        Box(
            modifier = Modifier
                .size(120.dp)
                .background(Color(0xFF00CCFF).copy(alpha = 0.1f))
        ) {
            Icon(
                Icons.Filled.PhoneAndroid, 
                contentDescription = null, 
                tint = Color(0xFF00CCFF), 
                modifier = Modifier.size(64.dp).align(Alignment.Center)
            )
        }
        
        Spacer(Modifier.height(48.dp))
        
        androidx.compose.material3.Button(
            onClick = onDisconnect,
            colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = Color.Red.copy(alpha = 0.2f),
                contentColor = Color.Red
            )
        ) {
            Text("DISCONNECT BRIDGE", fontFamily = FontFamily.Monospace, fontSize = 12.sp)
        }
    }
}

@Composable
fun FluxBridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF00CCFF),
            background = Color(0xFF050505)
        ),
        content = content
    )
}
