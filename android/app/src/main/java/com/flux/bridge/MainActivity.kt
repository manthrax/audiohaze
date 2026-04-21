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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhoneAndroid
import android.provider.Settings
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.input.pointer.pointerInput

class MainActivity : ComponentActivity() {

    private lateinit var rtcManager: WebRTCManager
    private lateinit var sensorBridge: SensorBridge
    private var keepBackground = false



    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("HAZE_DEBUG", "Starting Full HazeBridge Logic")

        // Crash Reporting Setup
        val prefs = getSharedPreferences("haze_prefs", android.content.Context.MODE_PRIVATE)
        val lastCrash = prefs.getString("last_crash", null)
        prefs.edit().remove("last_crash").apply()

        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, exception ->
            val stackTrace = Log.getStackTraceString(exception)
            prefs.edit().putString("last_crash", stackTrace).commit()
            defaultHandler?.uncaughtException(thread, exception) ?: System.exit(1)
        }

        // Request Permissions
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 101)
        }

        setContent {
            var currentStep by remember { mutableStateOf(if (lastCrash != null) "crash" else "permission") }
            var answerSignal by remember { mutableStateOf<String?>(null) }
            var deployStatus by remember { mutableStateOf<String?>(null) }
            var bgStreaming by remember { mutableStateOf(false) }
            
            DisposableEffect(Unit) {
                rtcManager = WebRTCManager(this@MainActivity, object : WebRTCManager.WebRTCListener {
                    override fun onSignalGenerated(signal: String) {
                        this@MainActivity.runOnUiThread {
                            Log.d("HAZE_DEBUG", "Answer Signal Generated")
                            answerSignal = signal
                            currentStep = "answer"
                        }
                    }

                    override fun onConnected() {
                        this@MainActivity.runOnUiThread {
                            Log.d("HAZE_DEBUG", "P2P CONNECTED")
                            currentStep = "active"
                            sensorBridge.start()
                        }
                    }

                    override fun onDataReceived(data: String) {
                        this@MainActivity.runOnUiThread {
                            Log.d("HAZE_DEBUG", "WebRTC Data: $data")
                            if (data == "DEPLOY_SUCCESS") {
                                deployStatus = "Success"
                            } else if (data == "DEPLOY_FAILED") {
                                deployStatus = "Failed"
                            }
                        }
                    }
                    override fun onSensorStreamActive(active: Boolean) {}
                })

                sensorBridge = SensorBridge(this@MainActivity) { json ->
                    rtcManager.sendSensorData(json)
                }

                onDispose {
                    Log.d("HAZE_DEBUG", "Disposing of Android Signal Managers")
                    sensorBridge.stop()
                    rtcManager.close()
                }
            }

            HazeBridgeTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF050505)
                ) {
                    when(currentStep) {
                        "crash" -> {
                            CrashReportScreen(lastCrash!!) {
                                currentStep = "permission"
                            }
                        }
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
                            Box(Modifier.fillMaxSize()) {
                                QRScannerView { uri ->
                                    if (currentStep == "scan") {
                                        Log.d("HAZE_DEBUG", "QR Scanned: $uri")
                                        val base64 = uri.substring(7).trim()
                                        currentStep = "connecting"
                                        rtcManager.handleOffer(base64)
                                    }
                                }
                                
                                Button(
                                    onClick = { finishAffinity() },
                                    modifier = Modifier.align(Alignment.BottomCenter).padding(32.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color.Red.copy(alpha = 0.5f))
                                ) {
                                    Text("QUIT APP", color = Color.White, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                                }
                            }
                        }
                        "connecting" -> {
                            ConnectingScreen { currentStep = "scan" }
                        }
                        "answer" -> {
                            AnswerQRScreen(answerSignal ?: "INVALID") { currentStep = "scan" }
                        }
                        "active" -> {
                        ActiveBridgeScreen(
                            deployStatus = deployStatus,
                            bgStreaming = bgStreaming,
                            onBgToggle = { 
                                bgStreaming = it 
                                keepBackground = it
                            },
                            onMultiTouch = { json ->
                                rtcManager.sendData(json)
                            },
                            onDisconnect = {
                                rtcManager.close()
                                sensorBridge.stop()
                                deployStatus = null
                                answerSignal = null
                                currentStep = "scan"
                            }
                        )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AnswerQRScreen(signal: String, onRestart: () -> Unit) {
    val signalUri = "haze://$signal"
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
        val context = LocalContext.current
        Text("PERMISSIONS REQUIRED", color = Color(0xFF00CCFF), fontSize = 14.sp, fontFamily = FontFamily.Monospace)
        Spacer(Modifier.height(16.dp))
        Text(
            "HazeBridge needs permission to modify system settings to assign ringtones.",
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
        
        Spacer(Modifier.height(16.dp))
        
        TextButton(onClick = { (context as? android.app.Activity)?.finishAffinity() }) {
            Text("QUIT APP", color = Color.Gray, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
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
fun ActiveBridgeScreen(
    deployStatus: String?, 
    bgStreaming: Boolean,
    onBgToggle: (Boolean) -> Unit,
    onMultiTouch: (String) -> Unit,
    onDisconnect: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp)
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        val touches = org.json.JSONArray()
                        event.changes.forEach { change ->
                            if (change.pressed) {
                                val touch = org.json.JSONArray()
                                touch.put(change.id.value.toInt())
                                touch.put(change.position.x / size.width)
                                touch.put(change.position.y / size.height)
                                touch.put(change.pressure)
                                touches.put(touch)
                            }
                        }
                        if (touches.length() > 0) {
                            val json = org.json.JSONObject()
                            json.put("m", touches) // "m" for multi-touch
                            onMultiTouch(json.toString())
                        }
                    }
                }
            },
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
        
        Spacer(Modifier.height(32.dp))
        
        Row(
            modifier = Modifier.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Keep Streaming in Background", color = Color.Gray, fontSize = 12.sp)
            Spacer(Modifier.width(16.dp))
            Switch(
                checked = bgStreaming,
                onCheckedChange = onBgToggle,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color(0xFF00CCFF),
                    checkedTrackColor = Color(0xFF00CCFF).copy(alpha = 0.5f)
                )
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
fun HazeBridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF00CCFF),
            background = Color(0xFF050505)
        ),
        content = content
    )
}

@Composable
fun CrashReportScreen(crashLog: String, onDismiss: () -> Unit) {
    val scrollState = rememberScrollState()
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).padding(top = 24.dp),
        horizontalAlignment = Alignment.Start
    ) {
        Text("CRASH DETECTED", color = Color.Red, fontSize = 20.sp, fontFamily = FontFamily.Monospace)
        Spacer(Modifier.height(8.dp))
        Text(
            "The agent terminated unexpectedly. Diagnostics:",
            color = Color.Gray,
            fontSize = 12.sp
        )
        Spacer(Modifier.height(16.dp))
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color(0xFF111111))
                .padding(8.dp)
        ) {
            Text(
                text = crashLog, 
                color = Color.Red.copy(alpha = 0.8f), 
                fontSize = 8.sp, 
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.verticalScroll(scrollState)
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onDismiss,
            colors = ButtonDefaults.buttonColors(containerColor = Color.Red),
            modifier = Modifier.align(Alignment.CenterHorizontally)
        ) {
            Text("ACKNOWLEDGE & RESTART", color = Color.White)
        }
        Spacer(Modifier.height(16.dp))
    }
}
