# Project Specification: FluxBridge
**The High-Precision, Serverless P2P Hardware Bridge**

## 1. Vision & Overview
FluxBridge is a low-latency, zero-cloud infrastructure layer designed to transform any modern Android device into a remote-controllable sensor hub and I/O peripheral for web applications. 

By bypassing traditional signaling servers in favor of an optical, high-density QR handshake, FluxBridge establishes a secure, encrypted P2P tunnel (WebRTC) between a browser and a mobile device in physical proximity.

### Primary Use Cases:
*   **6DOF Controller:** Streaming high-frequency rotation vector data (Quaternions) for 3D scene manipulation.
*   **Remote I/O:** Triggering system-level haptics, flashlight, or UI feedback from the browser.
*   **Asset Deployment:** Beaming binary payloads (e.g., ringtones, shaders, config) directly to the mobile OS.
*   **Telemetry Hub:** Monitoring device battery, sensor health, and connectivity state in real-time.

---

## 2. Protocol Specification

### 2.1 Optical Signaling (The Flux Handshake)
To achieve a "Zero-Cloud" experience, FluxBridge uses a dual-QR signaling flow to exchange WebRTC Session Descriptions (SDP) without a middleman.

1.  **Desktop Offer:** The browser generates a full SDP Offer, compresses via ZLIB, and encodes as a `flux://[Base64]` URI.
2.  **Mobile Answer:** The Android Agent scans the QR, generates an SDP Answer, and displays its own compressed Answer QR.
3.  **Finalization:** The desktop webcam scans the mobile Answer QR, completing the ICE negotiation.

#### Robustness Constraints
*   **High-Density QR:** Uses Version 40 (177x177) with Level M error correction to handle screen glare.
*   **Compression:** Binary ZLIB inflation/deflation ensures even full SDPs fit within optical payloads.
*   **ICE Constraint:** Host-Only candidates are prioritized to minimize signaling roundtrips.

### 2.2 Data Channel Protocol
Communication occurs over an un-ordered, un-reliable `RTCDataChannel` for sensors, and a reliable channel for file transfers.

#### A. Sensor Telemetry (JSON)
Streaming 6DOF orientation data at ~60Hz-100Hz.
```json
{
  "q": [w, x, y, z] // 4-element quaternion array
}
```

#### B. File Transfer (Hybrid)
Files are sent by first sending a metadata header followed by raw binary chunks.
```json
// Header
{
  "type": "file_meta",
  "name": "flux_notification.ogg",
  "size": 124000,
  "mime": "audio/ogg"
}
```

#### C. Command & Control
Browser-to-Agent commands for hardware interaction.
```json
{
  "cmd": "HAPTIC_PULSE",
  "intensity": "strong"
}
```

---

## 3. Architecture: The Android Agent

### 3.1 Sensor Pipeline
*   **Type:** `Sensor.TYPE_ROTATION_VECTOR` (9-Axis fusion).
*   **Latency Target:** < 20ms end-to-end.
*   **Priority:** Background-safe foreground service to ensure stream continuity even when screen is dimmed.

### 3.2 System Integration (Ringtone/Audio)
*   **Permission:** `android.permission.WRITE_SETTINGS`.
*   **Storage:** `MediaStore.Audio.Media.EXTERNAL_CONTENT_URI`.
*   **Flow:** 
    1. Receive Blob via DataChannel.
    2. Write to App Thermal Cache.
    3. Register with ContentResolver as `IS_NOTIFICATION` or `IS_RINGTONE`.
    4. Call `RingtoneManager.setActualDefaultRingtoneUri`.

---

## 4. Architecture: The Web Client

### 4.1 Implementation
*   **Library:** `simple-peer` (WebRTC wrapper) or raw `RTCPeerConnection`.
*   **Handshake UI:** Integrated `jsQR` engine for real-time webcam scanning.
*   **3D Preview:** Three.js / R3F scene to visualize 6DOF data (e.g., a "Ghost Phone" mesh).

---

## 5. Design & Aesthetics

### "The Flux Aesthetic"
The Bridge UI should feel like a high-tech "Link" or "Sync" operation.

*   **Color Palette:**
    *   **Core:** #050505 (Midnight Void)
    *   **Signal:** #00CCFF (Electric Cyan)
    *   **Alert:** #FF3366 (High-Res Magenta)
*   **Visual Elements:**
    *   **Scanlines:** Subtle horizontal overlays on QR scan windows.
    *   **Digital Noise:** Minimal grain on UI panels.
    *   **Fluid Motion:** Physics-based springs for all panel transitions.

---

## 6. Security Posture
*   **Physical Presence:** The handshake requires direct visual contact, preventing remote interception.
*   **Local Traffic:** Wherever possible, traffic stays within the LAN.
*   **Encryption:** Mandatory DTLS/SRTP as per WebRTC spec.
*   **Data Volatility:** Ringtones are persisted, but telemetry is ephemeral and never logged to disk.
