import { useState, useRef, useEffect } from 'react'
import jsQR from "jsqr"
import { Mic, Zap, Smartphone, CheckCircle, Shield, Camera, Play, Pause } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import WaveformVisualizer from './components/WaveformVisualizer'
import Scene3D from './components/Scene3D'
import { audioEngine } from './utils/AudioEngine'
import { encodeSignal, decodeSignal, toHazeUri } from './utils/signaling'
import { transcoder } from './utils/Transcoder'
import { FileTransfer } from './utils/FileTransfer'
import Peer from 'simple-peer'

type Step = 'welcome' | 'record' | 'pair' | 'sync' | 'beaming' | 'success'

interface Orientation { w: number, x: number, y: number, z: number }

declare global {
  interface Window {
    lastHazeUpdate?: number;
  }
}

export default function App() {
  const [step, setStep] = useState<Step>('welcome')
  const [offerQr, setOfferQr] = useState<string>('')
  const [peer, setPeer] = useState<Peer.Instance | null>(null)
  const [orientation, setOrientation] = useState<Orientation | null>(null)
  const [transferProgress, setTransferProgress] = useState(0)
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [targetSlot, setTargetSlot] = useState<string>('NOTIFICATION')
  const [isPaused, setIsPaused] = useState(false);
  const [gain, setGain] = useState(1.0);
  const [range, setRange] = useState<[number, number]>([0.2, 0.8]);
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const telemetryRef = useRef<number[] | null>(null)

  const togglePause = () => {
    const newState = !isPaused;
    setIsPaused(newState);
    audioEngine.isRecording = !newState;
  };

  const updateGain = (val: number) => {
    setGain(val);
    audioEngine.setGain(val);
  };

  const startFlow = async () => {
    console.log("startFlow triggered");
    try {
      console.log("Attempting to capture stream...");
      const stream = await audioEngine.startCapture()
      console.log("Stream captured successfully:", stream.id);
      setStep('record')
      console.log("setStep('record') called");
      audioEngine.setupAnalysis(stream)
    } catch (err: any) {
      console.error(err)
      const isSsl = window.location.protocol === 'https:'
      alert(
        `Capture failed. ${!isSsl ? 'You MUST use HTTPS for streaming (currently in early access SSL mode).' : ''} \n\n` +
        "Ensure you check the 'Share system audio' box at the bottom-left of the selection window."
      )
    }
  }

  const prepareSync = () => {
    setStep('pair')
    // Initialize WebRTC Offer with DataChannel
    const p = new Peer({
      initiator: true,
      trickle: false, 
      config: { iceServers: [] } // No ICE servers = only Host candidates (smallest SDP)
    })

    p.on('signal', data => {
      // Signal contains the SDP
      const encoded = encodeSignal(data)
      setOfferQr(toHazeUri(encoded))
    })

    p.on('connect', () => {
      console.log("P2P Connected")
      setStep('sync')
    })

    p.on('data', data => {
      try {
          const raw = new TextDecoder().decode(data)
          const json = JSON.parse(raw)
          if (json.q) {
              // Direct memory write for WebGL loop
              telemetryRef.current = json.q;
              
              // Throttle React state visually to ~10hz
              const now = Date.now();
              if (!window.lastHazeUpdate || now - window.lastHazeUpdate > 100) {
                  window.lastHazeUpdate = now;
                  setOrientation({
                      w: json.q[0],
                      x: json.q[1],
                      y: json.q[2],
                      z: json.q[3],
                  })
              }
          }
          if (json.type === 'discovery') {
              setAvailableSlots(json.slots)
              setTargetSlot(json.slots[0])
          }
      } catch (e) {}
    })

    setPeer(p)
  }

  const handleFinalize = async () => {
    if (!peer || !targetSlot) return;
    setStep('beaming');
    setTransferProgress(0);

    try {
        const audioBlob = await audioEngine.getTrimmedBlob(range[0], range[1]);
        const transfer = new FileTransfer(peer, (progress) => {
            setTransferProgress(progress);
        });

        await transfer.sendFile(audioBlob, 'haze_notification.wav', targetSlot, false);
        setStep('success');
    } catch (e) {
        console.error("Transfer failed", e);
        setStep('sync');
    }
  }

  const handlePreview = async () => {
    if (!peer) return;
    // We don't change step for preview to keep the UI interactive
    try {
        const audioBlob = await audioEngine.getTrimmedBlob(range[0], range[1]);
        const transfer = new FileTransfer(peer, (p) => setTransferProgress(p));
        await transfer.sendFile(audioBlob, 'haze_preview.wav', 'PREVIEW', true);
    } catch (e) {
        console.error("Preview failed", e);
    }
  }


  // Webcam & QR Scanning Logic
  useEffect(() => {
    let stream: MediaStream | null = null;
    let animId: number;

    const startWebcam = async () => {
      if (step === 'pair' && videoRef.current) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: 1280, height: 720 } 
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
          }
        } catch (err) {
          console.error("Webcam Access Failed", err);
        }
      }
    };

    const stopWebcam = () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
    };

    if (step === 'pair') {
      startWebcam();
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      let answered = false;

      const scan = () => {
        if (!videoRef.current || !ctx || step !== 'pair') return;
        
        if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
            canvas.height = videoRef.current.videoHeight;
            canvas.width = videoRef.current.videoWidth;
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth",
            });

            if (code && code.data.toLowerCase().startsWith("haze://") && !answered) {
                const encoded = code.data.substring(7);
                answered = true;
                simulateAnswer(encoded);
                // Stop scanning locally
                return;
            }
        }
        animId = requestAnimationFrame(scan);
      };
      
      animId = requestAnimationFrame(scan);
    } else {
      stopWebcam();
    }

    return () => {
      stopWebcam();
      if (animId) cancelAnimationFrame(animId);
    };
  }, [step]);

  const simulateAnswer = (answerEncoded: string) => {
    if(!peer) return;
    try {
        const signal = decodeSignal(answerEncoded)
        peer.signal(signal)
    } catch (e) {
        console.error("Invalid Answer", e)
    }
  }

  const triggerTestSound = () => {
    if (!peer) return;
    peer.send(JSON.stringify({ cmd: 'PLAY_TEST_SOUND' }));
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] text-white overflow-hidden relative">
      
      {/* Background Decorative Element */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#00CCFF]/5 rounded-full blur-[150px] pointer-events-none -z-0" />
      
      <header className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-3 w-full justify-center">
        <div className="p-2 border border-[#00CCFF] rounded-lg shadow-[0_0_15px_rgba(0,204,255,0.3)]">
          <Zap className="w-6 h-6 text-[#00CCFF]" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">HazeBridge <span className="text-[#00CCFF] font-light">Framework</span></h1>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-4xl glass-panel p-10 flex flex-col items-center min-h-[500px]">
        
        {step === 'welcome' && (
          <div className="text-center space-y-8 animate-in fade-in duration-700">
            <div className="space-y-4">
              <h2 className="text-4xl font-bold">HazeBridge <span className="neon-text">Client</span></h2>
              <p className="text-secondary max-w-xl mx-auto">
                Connect your Android device as a remote sensor and I/O platform via local P2P WebRTC.
              </p>
            </div>
            
            <div className="grid grid-cols-4 gap-4 py-6">
              <div className="flex flex-col items-center gap-2">
                <Zap className="w-8 h-8 text-secondary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">6DOF Motion</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Shield className="w-8 h-8 text-secondary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">Secured P2P</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Smartphone className="w-8 h-8 text-secondary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">Remote I/O</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Mic className="w-8 h-8 text-secondary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">System Audio</span>
              </div>
            </div>

            <button onClick={startFlow} className="electric-button px-12 py-4 text-lg">
                Initialize Bridge
            </button>
          </div>
        )}

        {step === 'record' && (
          <div className="w-full h-full flex flex-col items-center space-y-6 animate-in fade-in">
             <div className="w-full min-h-[300px] bg-black/40 rounded-2xl border border-white/5 relative z-10 overflow-hidden group">
                <WaveformVisualizer isStatic={isPaused} rangeStart={range[0]} rangeEnd={range[1]} />
                
                <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none">
                    <div className={isPaused ? "w-2 h-2 rounded-full bg-zinc-600" : "recording-indicator"} />
                    <span className="text-xs font-mono text-secondary uppercase tracking-widest">
                        {isPaused ? "Buffer Paused (10s)" : "Direct Loopback"}
                    </span>
                </div>

                {isPaused && (
                    <div className="absolute inset-x-0 bottom-0 h-12 bg-black/60 backdrop-blur-md flex items-center px-8 border-t border-white/10">
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={range[0]} onChange={e => setRange([parseFloat(e.target.value), range[1]])}
                            className="flex-1 accent-[#00CCFF] opacity-50 hover:opacity-100 transition-opacity"
                        />
                        <div className="w-px h-4 bg-white/20 mx-4" />
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={range[1]} onChange={e => setRange([range[0], parseFloat(e.target.value)])}
                            className="flex-1 accent-[#00CCFF] opacity-50 hover:opacity-100 transition-opacity"
                        />
                    </div>
                )}
             </div>

             <div className="flex items-center gap-8 w-full max-w-md bg-zinc-900/50 p-4 rounded-xl border border-white/5">
                <button onClick={togglePause} className="p-3 bg-[#00CCFF]/10 text-[#00CCFF] rounded-full hover:bg-[#00CCFF]/20 transition-colors">
                    {isPaused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
                </button>
                
                <div className="flex-1 space-y-2">
                    <div className="flex justify-between text-[10px] font-mono text-secondary uppercase">
                        <span>Output Gain</span>
                        <span>{Math.round(gain * 100)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="2" step="0.1" 
                        value={gain} onChange={e => updateGain(parseFloat(e.target.value))}
                        className="w-full accent-[#00CCFF]"
                    />
                </div>
             </div>

             <div className="text-center space-y-2">
                <h3 className="text-xl font-medium text-secondary">Capture Engine Active</h3>
                <p className="text-sm text-zinc-500">Isolate your sample in the 10s buffer, then sync to agent.</p>
             </div>

             <div className="flex gap-4">
                <button onClick={handlePreview} className="px-6 py-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-all text-xs font-mono uppercase tracking-widest text-zinc-400">
                    Preview on Device
                </button>
                <button onClick={prepareSync} className="electric-button">
                    Finalize Sample
                </button>
             </div>
          </div>
        )}

        {step === 'pair' && (
          <div className="flex flex-col items-center space-y-8 w-full animate-in fade-in zoom-in duration-500 text-center">
            <div className="flex flex-col items-center space-y-6">
               <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-mono text-[#00CCFF] uppercase tracking-widest bg-[#00CCFF]/10 px-4 py-1 rounded-full">Signaling Phase: Offer</span>
                  <h2 className="text-2xl font-bold">Establish P2P Link</h2>
               </div>

               <div className="p-6 bg-white rounded-3xl overflow-hidden shadow-[0_0_80px_rgba(0,204,255,0.3)] border-4 border-[#00CCFF]/30 mx-auto">
                  {offerQr ? (
                    <QRCodeCanvas 
                      value={offerQr} 
                      size={400} 
                      level="M" 
                      includeMargin={false}
                    />
                  ) : (
                    <div className="w-[400px] h-[400px] flex items-center justify-center text-black font-mono text-xs">
                      <div className="animate-pulse">GENERATING_OFFER...</div>
                    </div>
                  )}
               </div>

               <div className="max-w-sm space-y-3">
                 <p className="text-sm text-zinc-400 leading-relaxed px-4">
                   Scan this QR code with the HazeBridge Agent. 
                 </p>
                 <div className="flex items-center justify-center gap-4 text-[10px] uppercase font-mono text-zinc-500">
                    <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" /> Host Only</span>
                    <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" /> ZLIB Compressed</span>
                 </div>
               </div>
            </div>

            <div className="h-[1px] w-64 bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

            <div className="flex flex-col items-center space-y-4 w-full max-w-md mx-auto">
                <div className="w-full glass-panel flex flex-col items-center justify-center p-4 text-center border-dashed border-zinc-700/50">
                    <div className="flex items-center gap-3 mb-2 justify-center">
                        <Camera className="w-4 h-4 text-zinc-500" />
                        <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest">Handshake Monitor (Webcam)</p>
                    </div>
                    <div className="w-full h-48 bg-black rounded-xl overflow-hidden relative border border-[#00CCFF]/20 mx-auto group">
                        <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-cover transition-opacity duration-500 opacity-80 group-hover:opacity-100" />
                        
                        {/* Scanning Reticle overlay */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                           <div className="w-32 h-32 border-2 border-[#00CCFF]/30 rounded-lg animate-pulse relative overflow-hidden">
                              <div className="scanline absolute top-0 left-0" />
                           </div>
                           <div className="absolute top-2 right-2 bg-black/80 px-2 py-1 rounded text-[8px] font-mono text-[#00CCFF]">
                              LIVE_FEED_SCANNING...
                           </div>
                        </div>
                    </div>
                </div>
            </div>
          </div>
        )}

        {step === 'sync' && (
           <div className="text-center space-y-8 animate-in zoom-in duration-500 w-full flex flex-col items-center">
                <div className="w-full h-64 bg-black/50 rounded-2xl border border-white/5 relative overflow-hidden">
                    <Scene3D telemetryRef={telemetryRef} />
                    <div className="absolute top-4 left-4 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#00CCFF] animate-pulse" />
                        <span className="text-[10px] font-mono text-secondary uppercase tracking-widest">6DOF Telemetry Active</span>
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-2xl font-bold">Device Synced</h2>
                    <div className="flex gap-4 font-mono text-[10px] text-[#00CCFF] justify-center bg-[#00CCFF]/10 px-4 py-2 rounded-lg">
                        <span>X: {orientation?.x.toFixed(3) ?? '0.000'}</span>
                        <span>Y: {orientation?.y.toFixed(3) ?? '0.000'}</span>
                        <span>Z: {orientation?.z.toFixed(3) ?? '0.000'}</span>
                        <span>W: {orientation?.w.toFixed(3) ?? '0.000'}</span>
                    </div>
                </div>
                
                <div className="bg-black/40 p-6 rounded-xl border border-white/5 space-y-6 text-left w-full max-w-sm">
                    <div className="space-y-3">
                        <label className="text-[10px] uppercase font-mono text-zinc-500 tracking-widest">Active System Binding</label>
                        <div className="flex flex-wrap gap-2">
                            {availableSlots.length > 0 ? availableSlots.map(s => (
                                <button 
                                    key={s}
                                    onClick={() => setTargetSlot(s)}
                                    className={`px-3 py-1 text-[10px] rounded-full border transition-all ${targetSlot === s ? 'bg-[#00CCFF] border-[#00CCFF] text-black' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}
                                >
                                    {s}
                                </button>
                            )) : <span className="text-xs text-zinc-600 italic">Finding slots...</span>}
                        </div>
                    </div>
                    
                    <div className="h-[1px] bg-white/5 w-full" />

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Remote Audio Testing</span>
                        <button 
                            onClick={triggerTestSound}
                            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded transition-colors"
                        >
                            Play Beep
                        </button>
                    </div>
                </div>

                <button onClick={handleFinalize} className="electric-button w-full py-4">
                    Beam & Deploy to {targetSlot}
                </button>
           </div>
        )}

        {step === 'beaming' && (
           <div className="text-center space-y-12 animate-in fade-in duration-500 w-full flex flex-col items-center justify-center h-[300px]">
                <div className="relative">
                    <div className="absolute inset-0 bg-[#00CCFF]/20 blur-2xl animate-pulse rounded-full" />
                    <Zap className="w-16 h-16 text-[#00CCFF] relative" />
                </div>
                <div className="space-y-6 w-full max-w-sm">
                    <div className="flex flex-col items-center gap-2">
                        <h2 className="text-2xl font-bold">Beaming To Agent</h2>
                        <p className="text-xs text-secondary font-mono">ENCRYPTED BINARY FLOW: {Math.round(transferProgress * 100)}%</p>
                    </div>

                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-[#00CCFF] transition-all duration-300 shadow-[0_0_10px_#00CCFF]" 
                            style={{ width: `${transferProgress * 100}%` }}
                        />
                    </div>
                </div>
           </div>
        )}

        {step === 'success' && (
            <div className="text-center space-y-8 animate-in slide-in-from-bottom duration-700">
                <div className="p-6 bg-green-500/10 rounded-full inline-block">
                    <CheckCircle className="w-16 h-16 text-green-500" />
                </div>
                <div className="space-y-4">
                    <h2 className="text-3xl font-bold">Transmission Complete</h2>
                    <p className="text-secondary pb-4">Your audio has been deployed as the system {targetSlot} on your Android device.</p>
                    
                    <button 
                        onClick={triggerTestSound}
                        className="flex items-center gap-2 mx-auto px-6 py-2 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-all text-xs font-mono uppercase tracking-widest"
                    >
                        <Zap className="w-4 h-4 text-[#00CCFF]" />
                        Test Sound on Device
                    </button>
                </div>
                <button onClick={() => setStep('welcome')} className="text-sm text-zinc-500 hover:text-[#00CCFF] transition-colors underline underline-offset-4">
                    Start New Capture
                </button>
            </div>
        )}

        {/* Footer Info (Now part of main flow to avoid overlap) */}
        <footer className="mt-12 flex gap-8 opacity-40 hover:opacity-100 transition-opacity">
           <div className="flex items-center gap-2 text-[9px] uppercase font-mono text-zinc-500 tracking-tighter">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              Signal: DTLS-SRTP Encrypted
           </div>
           <div className="flex items-center gap-2 text-[9px] uppercase font-mono text-zinc-500 tracking-tighter">
              <Zap className="w-3 h-3" />
              Latency: ~12ms P2P
           </div>
        </footer>
      </main>

      {/* Background Decorative Element */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#00CCFF]/5 rounded-full blur-[120px] pointer-events-none -z-10" />
    </div>
  )
}
