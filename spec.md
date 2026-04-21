# Project Specification: FluxSound (AudioHaze)
**Serverless Mobile Audio Bridge**

## 1. Vision & Overview
FluxSound is a high-performance, serverless utility designed to bridge the gap between desktop media consumption and mobile system customization. It allows users to capture loopback audio from a PC browser, edit/trim it using a GPU-accelerated interface, and "beam" the result directly to an Android device.

The goal is to replace the cumbersome process of manually transferring files, navigating file systems, and manually assigning system sounds (Ringtones, Notifications, Alarms) with a single, frictionless P2P interaction.

### Core Philosophy
*   **Zero-Cloud Infrastructure:** No audio data or signaling metadata ever touches a third-party server. Privacy is guaranteed by the physical handshake.
*   **High Performance:** Leveraging WebGL for fluid waveform rendering and WebRTC for efficient peer-to-peer binary transfer.
*   **Physical-First Signaling:** QR-based handshakes replace user accounts and cloud signaling servers, ensuring that the connection is as ephemeral and secure as the room the devices are in.

---

## 2. System Architecture

### A. The Producer (Desktop Web Client)
*   **Stack:** Next.js / Vite (React/TS), Three.js (WebGL), Web Audio API, `ffmpeg.wasm`.
*   **Audio Capture:** `getDisplayMedia` with system audio hooks.
*   **Graphics:** A custom Three.js environment where the audio waveform is treated as a physical mesh that can be manipulated (cropped, faded).
*   **Responsibilities:**
    *   Real-time spectral analysis and waveform visualization.
    *   Non-destructive cropping and 50ms "zero-pop" crossfades.
    *   Transcoding to Opus/OGG in-browser.
    *   Managing the ephemeral WebRTC signaling state via QR.

### B. The Agent (Android Companion App)
*   **Stack:** Kotlin, Jetpack Compose, WebRTC Android SDK.
*   **Integration:** `MediaStore` API, `RingtoneManager`.
*   **Responsibilities:**
    *   Scanning Desktop signaling QR codes.
    *   Displaying confirmation/answer QR codes for bi-directional handshake.
    *   High-speed binary ingestion via `RTCDataChannel`.
    *   Executing system-level sound assignment through restricted OS permissions.

---

## 3. Technical Implementation Details

### 3.1 Binary Signaling (QR Handshake)
To bypass a traditional signaling server (STUN/TURN/Signaler), we must minimize the SDP size to fit within the character limits of a Version 40 QR code (approx 2.9KB).

1.  **SDP Stripping:** Remove all `a=extmap`, `a=msid`, `a=ssrc`, and redundant codec profiles (`a=fmtp:111`).
2.  **ICE Constraint:** Force "Host" candidates only. Since this is a physical-proximity tool, we assume both devices are on the same local network or use the phone as a hotspot.
3.  **Compression:**
    *   **JS:** `const compressed = fflate.zlibSync(sdpString);`
    *   **Kotlin:** `val decompressed = ZLibDecoder.decode(data)`
4.  **Transport:** Encode as URL-safe Base64 within a `flux://[base64]` payload.

### 3.2 Audio Pipeline (Desktop)
1.  **Ingestion:** `navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })` captures the loopback stream.
2.  **Processing:**
    *   Convert `MediaStream` to `AudioBuffer`.
    *   Normalize volume to -1.0 dBFS Peak.
    *   Apply 50ms linear fade-in/out to crop boundaries.
3.  **Visualization:**
    *   Transfer PCM data to a `DataTexture` in Three.js.
    *   **Fragment Shader logic:**
        ```glsl
        uniform sampler2D tAudio;
        varying vec2 vUv;
        void main() {
            float amplitude = texture2D(tAudio, vec2(vUv.x, 0.5)).r;
            float thickness = 0.5 * amplitude;
            float mask = step(abs(vUv.y - 0.5), thickness);
            gl_FragColor = vec4(vec3(0.0, 0.8, 1.0) * mask, mask);
        }
        ```
4.  **Transcoding:** Encode to `.ogg` (Opus) at 128kbps using `ffmpeg.wasm` for maximum Android compatibility.

### 3.3 Android Integration
*   **Permissions:**
    *   `android.permission.WRITE_SETTINGS`: Required to modify system Ringtone/Notification settings.
    *   `android.permission.READ_EXTERNAL_STORAGE` / `READ_MEDIA_AUDIO`: Media management.
    *   `android.permission.CAMERA`: QR scanning.
*   **Insertion Logic:**
    ```kotlin
    val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, "Flux_" + System.currentTimeMillis())
        put(MediaStore.MediaColumns.MIME_TYPE, "audio/ogg")
        put(MediaStore.Audio.Media.IS_NOTIFICATION, true)
        put(MediaStore.Audio.Media.IS_RINGTONE, true)
        put(MediaStore.Audio.Media.IS_ALARM, true)
    }
    val uri = contentResolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
    ```

---

## 4. UI/UX Design System
The visual language should be **"Atmospheric & High-Precision"**.

*   **Theme:** Deep Midnight (Base #050505) with Electric Cyan (#00CCFF) accents.
*   **Aesthetics:**
    *   Glassmosphic panels for control overlays.
    *   Raymarching or blurred bokeh backgrounds to imply "Flux" motion.
    *   Three.js waveform should respond to mouse hover with "fluid" ripples.
*   **Interactions:**
    *   Draggable "Clipping Handles" with magnetic snapping to zero-crossings.
    *   Haptic feedback in the Android app during "Ingestion" phase.

---

## 5. Security & Privacy
*   **Encryption:** Mandatory DTLS-SRTP for all P2P traffic.
*   **Volatility:** No audio is ever stored on the desktop disk. All processing happens in RAM/IndexedDB as temporary blobs.
*   **Proximity Enforcement:** The QR exchange acts as a physical Proof-of-Presence, preventing remote hijacking of the signaling channel.

---

## 6. Project Constraints & Hard Requirements
To maintain the "Zero-Cloud" and "High-Performance" mandates, the following requirements are strictly enforced:

*   **Webcam Hardware:** A functional desktop webcam is **mandatory** for the bi-directional handshake. No manual PIN entry or fallback is provided.
*   **Browser Support:** Only Chromium-based browsers (Chrome, Edge, Brave) are supported due to the requirement for `getDisplayMedia` system audio capture. Safari and Firefox (limited loopback) are explicitly unsupported.
*   **Network Environment:** Devices must be able to establish a Direct Host-to-Host connection (typically on the same LAN or via Hotspot). No STUN/TURN/Signaling servers are used.
*   **Signaling Reliability:** The system relies entirely on the high-density QR exchange. SDP compression must be robust enough to handle the character limits of standard cameras.

---

## 7. Success Metrics
*   **Frictionless Pairing:** < 10 seconds from "Start" to "Connected".
*   **Transfer Speed:** > 500KB/s on standard Wi-Fi (near-instant for audio).
*   **Visual Fidelity:** Solid 60FPS during waveform manipulation.
