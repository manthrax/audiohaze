import { useState, useRef, useEffect } from 'react'
import { AudioEngine } from './utils/AudioEngine'
import { WaveformVisualizer } from './components/WaveformVisualizer'
import { Scene3D } from './components/Scene3D'
import { Zap, Radio, Save, Activity, Layers, PlayCircle, Send, CheckCircle, Wifi, MonitorSpeaker, Pause, Circle, RefreshCcw, Trash2, Play, Square } from 'lucide-react'
import Peer from 'simple-peer'
import { decodeSignal, encodeSignal, toHazeUri } from './utils/signaling'
import jsQR from 'jsqr'
import { QRCodeCanvas } from 'qrcode.react'
import { FileTransfer } from './utils/FileTransfer'
import { DraggableWindow } from './components/DraggableWindow'

interface Orientation {
  x: number
  y: number
  z: number
  w: number
  px?: number
  py?: number
  pz?: number
}

function App() {
  // App Core States
  const [isRecording, setIsRecording] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [range, setRange] = useState<[number, number]>([0, 1])
  
  // Connection States
  const [isConnected, setIsConnected] = useState(false)
  const [offerQr, setOfferQr] = useState<string | null>(null)
  
  // Deployment States
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [targetSlot, setTargetSlot] = useState<string>('')
  const [isBeaming, setIsBeaming] = useState(false)
  const [transferProgress, setTransferProgress] = useState(0)
  const [deployResult, setDeployResult] = useState<'success' | 'failed' | null>(null);

  // Telemetry Cache
  const telemetryRef = useRef<number[] | null>(null)
  const [orientation, setOrientation] = useState<Orientation | null>(null)

  // System References
  const videoRef = useRef<HTMLVideoElement>(null)
  const [peer, setPeer] = useState<Peer.Instance | null>(null)
  const [audioEngine] = useState(() => new AudioEngine())

  // Window Management
  const [zIndices, setZIndices] = useState({
      audio: 10,
      remote: 11,
      tools: 12,
      telemetry: 13
  });
  
  const bringToFront = (windowId: keyof typeof zIndices) => {
      const maxZ = Math.max(...Object.values(zIndices));
      setZIndices(prev => ({ ...prev, [windowId]: maxZ + 1 }));
  };

  // ----- Audio Handling -----
  const startRecording = async () => {
    try {
      if (!audioEngine.isReady()) {
        await audioEngine.initialize()
      }
      audioEngine.startRecording()
      setIsRecording(true)
      setHasAudio(false) // Reset previous buffer
    } catch (e) {
      console.error("Audio access denied or failed", e)
    }
  }

  const stopRecording = () => {
    audioEngine.pauseRecording()
    setIsRecording(false)
    setHasAudio(true)
  }

  const handleReset = () => {
    audioEngine.resetBuffer()
    setHasAudio(false)
  }

  const handleAudition = () => {
    audioEngine.playCurrentBuffer()
  }

  const terminateAudio = () => {
    audioEngine.terminate()
    setIsRecording(false)
    setHasAudio(false)
  }

  // ----- Connection Handling -----
  useEffect(() => {
    // Generate initial offer
    const p = new Peer({ initiator: true, trickle: false })
    
    p.on('signal', data => {
      const encoded = encodeSignal(data);
      if (encoded.length < 2500) { 
        setOfferQr(toHazeUri(encoded));
      } else {
        console.error("Signal too large for QR:", encoded.length);
      }
    })

    p.on('connect', () => {
      console.log("P2P Connected")
      setIsConnected(true)
    })

    p.on('error', (err) => {
        console.error("Peer Error:", err);
    });

    p.on('close', () => {
        console.log("Peer Closed");
        setIsConnected(false);
        setPeer(null);
    });

    p.on('data', data => {
      try {
          const raw = new TextDecoder().decode(data)
          const json = JSON.parse(raw)
          if (json.q) {
              telemetryRef.current = json.q;
              const now = Date.now();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (!(window as any).lastHazeUpdate || now - (window as any).lastHazeUpdate > 100) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).lastHazeUpdate = now;
                  setOrientation({
                      w: json.q[0],
                      x: json.q[1],
                      y: json.q[2],
                      z: json.q[3],
                      px: json.q[4],
                      py: json.q[5],
                      pz: json.q[6],
                  })
              }
          }
          if (json.type === 'discovery') {
              setAvailableSlots(json.slots)
              setTargetSlot(json.slots[0])
          }
      } catch (e) {
          // ignore parsing errors on binary or non-json data
      }
    })

    setPeer(p)
  }, [])

  const simulateAnswer = (answerEncoded: string) => {
    if(!peer) return;
    try {
        const signal = decodeSignal(answerEncoded)
        peer.signal(signal)
    } catch (e) {
        console.error("Invalid Answer", e)
    }
  }

  // ----- Webcam Lifecycle Management -----
  useEffect(() => {
    let stream: MediaStream | null = null;
    let animId: number;

    const startWebcam = async () => {
      if (!isConnected && videoRef.current) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: 1280, height: 720 } 
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => {
                // Ignore innocuous AbortErrors caused by fast strict-mode re-renders
                console.log("Video play interrupted (safe to ignore):", e);
            });
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
      if (videoRef.current) {
          videoRef.current.srcObject = null;
      }
    };

    if (!isConnected) {
      startWebcam();
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let answered = false;

      const scan = () => {
        if (!videoRef.current || !ctx || isConnected) return;
        
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
  }, [isConnected, peer]);

  // ----- Deployment Flow -----
  const handleFinalize = async () => {
    if (!peer || !targetSlot) return;
    setIsBeaming(true);
    setTransferProgress(0);
    setDeployResult(null);

    try {
        const audioBlob = await audioEngine.getTrimmedBlob(range[0], range[1]);
        const transfer = new FileTransfer(peer, (progress) => {
            setTransferProgress(progress);
        });

        await transfer.sendFile(audioBlob, 'haze_notification.wav', targetSlot, false);
        setDeployResult('success');
    } catch (e) {
        console.error("Transfer failed", e);
        setDeployResult('failed');
    } finally {
        setTimeout(() => setIsBeaming(false), 2000); 
    }
  }

  const handlePreview = async () => {
    if (!peer || !hasAudio) return;
    try {
        const audioBlob = await audioEngine.getTrimmedBlob(range[0], range[1]);
        const transfer = new FileTransfer(peer, (p) => setTransferProgress(p));
        setIsBeaming(true);
        await transfer.sendFile(audioBlob, 'haze_preview.wav', 'PREVIEW', true);
        setIsBeaming(false);
    } catch (e) {
        console.error("Preview failed", e);
        setIsBeaming(false);
    }
  }

  const triggerTestSound = () => {
    if (!peer) return;
    peer.send(JSON.stringify({ cmd: 'PLAY_TEST_SOUND' }));
  }

  return (
    <div className="fixed inset-0 bg-[#050505] text-white overflow-hidden selection:bg-[#00CCFF]/30 desktop-wallpaper">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full max-w-[1200px] max-h-[1200px] bg-[#00CCFF]/5 rounded-full blur-[200px] pointer-events-none -z-0" />
      
      {/* Desktop Taskbar / Header */}
      <header className="absolute top-4 left-4 right-4 flex items-center justify-between z-0 pointer-events-none opacity-50 px-4">
          <div className="flex items-center gap-3">
              <div className="p-1 border border-[#00CCFF] rounded shadow-[0_0_15px_rgba(0,204,255,0.3)] bg-black/50">
                  <Zap className="w-4 h-4 text-[#00CCFF]" />
              </div>
              <h1 className="text-sm font-bold tracking-tight text-white drop-shadow-md">HazeBridge <span className="text-[#00CCFF] font-light">Editor</span></h1>
          </div>
          
          <div className="flex gap-6 items-center">
             <div className="flex items-center gap-2 text-[9px] uppercase font-mono text-zinc-400 tracking-tighter bg-black/40 px-2 py-1 rounded border border-white/5 shadow-md">
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`} />
                {isConnected ? 'P2P Linked' : 'Awaiting Peer'}
             </div>
          </div>
      </header>

      {/* FLOATING WINDOWS - DESKTOP SPACE */}

      {/* 1. Remote / Comms Hub */}
      <DraggableWindow 
          title="Communications Hub" 
          icon={<Wifi className="w-full h-full" />} 
          initialX={10} initialY={60} 
          initialWidth={340} initialHeight={480}
          zIndex={zIndices.remote} 
          onFocus={() => bringToFront('remote')}
      >
          {!isConnected ? (
              <div className="flex flex-col items-center justify-center p-2 h-full text-center space-y-1.5">
                  <div>
                      <MonitorSpeaker className="w-6 h-6 text-[#00CCFF] mx-auto mb-1 opacity-50" />
                      <p className="text-[9px] text-zinc-400 font-mono">Launch Haze on Android and scan this Offer.</p>
                  </div>
                  
                  {offerQr && (
                    <div className="p-2 bg-white rounded flex-shrink-0 shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                        <QRCodeCanvas value={offerQr} size={240} bgColor="#FFFFFF" fgColor="#000000" includeMargin={true} />
                    </div>
                  )}

                  <div className="w-full flex-1 min-h-[100px] bg-black rounded overflow-hidden relative border border-[#00CCFF]/20 group">
                      <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-cover shadow-inner opacity-80" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                         <div className="w-16 h-16 border border-[#00CCFF]/30 bg-[#00CCFF]/10 rounded animate-pulse" />
                      </div>
                      <div className="absolute bottom-1 left-0 right-0 text-[8px] font-mono text-center text-[#00CCFF] bg-black/60 py-0.5">
                          SCANNING...
                      </div>
                  </div>
              </div>
          ) : (
              <div className="flex flex-col items-center justify-center m-2 h-full text-center space-y-4 bg-black/40 rounded border border-green-500/10">
                  <div className="w-16 h-16 rounded bg-green-500/10 flex items-center justify-center border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
                      <Zap className="w-8 h-8 text-green-500" />
                  </div>
                  <div>
                      <h3 className="text-sm font-bold text-white mb-1">Connected</h3>
                      <p className="text-[9px] text-zinc-400 font-mono leading-tight">Agent Online<br/>Webcam Hardware Disengaged</p>
                  </div>
              </div>
          )}
      </DraggableWindow>

      {/* 2. Audio Capture */}
      <DraggableWindow 
          title="Sample Buffer" 
          icon={<Radio className="w-full h-full" />} 
          initialX={355} initialY={60} 
          initialWidth={500} initialHeight={320}
          zIndex={zIndices.audio} 
          onFocus={() => bringToFront('audio')}
      >
          <div className="flex flex-col h-full">
              <div className="flex justify-between items-center mb-2 px-2 pt-2">
                  <div className="flex items-center gap-2">
                      {isRecording ? (
                          <button onClick={stopRecording} className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all border border-red-500/20">
                              <div className="w-2 h-2 bg-red-500 rounded-sm" />
                          </button>
                      ) : (
                          <button onClick={startRecording} className="w-6 h-6 flex items-center justify-center rounded bg-[#00CCFF]/10 hover:bg-[#00CCFF]/20 hover:-translate-y-0.5 hover:shadow-[0_0_15px_rgba(0,204,255,0.3)] transition-all border border-[#00CCFF]/20 group">
                              <div className="w-2 h-2 bg-[#00CCFF] rounded group-hover:scale-110 transition-transform" />
                          </button>
                      )}
                      <div>
                          <p className="text-[10px] font-bold font-mono leading-none">{isRecording ? 'Capturing Flow' : 'Ready'}</p>
                          <p className="text-[8px] text-zinc-500 leading-none mt-1">10s Rolling Buffer</p>
                      </div>
                  </div>
                  {hasAudio && (
                      <span className="text-[8px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded shadow-[0_0_5px_rgba(34,197,94,0.1)] border border-green-500/20 font-mono tracking-widest uppercase">
                          BUFFER LOADED
                      </span>
                  )}
              </div>

              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5 bg-black/20">
                  <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`p-1.5 rounded-full transition-all ${isRecording ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-white/5 text-zinc-400 hover:text-white'}`}
                      title={isRecording ? "Stop Recording" : "Start Recording"}
                  >
                      {isRecording ? <Square className="w-3 h-3 fill-current" /> : <Circle className="w-3 h-3" />}
                  </button>

                  <div className="w-px h-3 bg-white/10 mx-0.5" />

                  <button 
                      onClick={handleAudition}
                      disabled={!hasAudio}
                      className={`p-1.5 rounded transition-all ${hasAudio ? 'text-[#00CCFF] hover:bg-[#00CCFF]/10' : 'text-zinc-600 cursor-not-allowed'}`}
                      title="Play Buffer"
                  >
                      <Play className="w-3 h-3" />
                  </button>

                  <button 
                      onClick={handleReset}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all ml-auto"
                      title="Reset Buffer"
                  >
                      <RefreshCcw className="w-3 h-3" />
                  </button>
              </div>

              <div className="flex-1 min-h-[150px] relative bg-black/40 overflow-hidden flex flex-col">
                  <WaveformVisualizer 
                      audioEngine={audioEngine} 
                      isRecording={isRecording}
                      onRangeChange={setRange}
                  />
                  {!hasAudio && !isRecording && (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase font-mono tracking-widest text-[#00CCFF]/30 pointer-events-none">
                          Ready for Capture
                      </div>
                  )}
              </div>
          </div>
      </DraggableWindow>

      {/* 3. Deployment Tools */}
      <DraggableWindow 
          title="Deployment Ops" 
          icon={<Save className="w-full h-full" />} 
          initialX={355} initialY={305} 
          initialWidth={500} initialHeight={235}
          zIndex={zIndices.tools} 
          onFocus={() => bringToFront('tools')}
      >
          <div className="flex flex-col justify-center h-full relative p-2">
              {isBeaming && (
                  <div className="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center rounded backdrop-blur-sm border border-[#00CCFF]/20 m-2">
                      <div className="w-1/2 h-0.5 bg-white/5 rounded overflow-hidden mb-2">
                          <div 
                              className="h-full bg-[#00CCFF] transition-all duration-300 shadow-[0_0_10px_#00CCFF]" 
                              style={{ width: `${transferProgress * 100}%` }}
                          />
                      </div>
                      <p className="text-[8px] text-[#00CCFF] font-mono tracking-widest animate-pulse">BEAMING...</p>
                  </div>
              )}

              <div className={`transition-opacity duration-300 h-full ${(!isConnected || !hasAudio) ? 'opacity-30 pointer-events-none blur-[1px]' : 'opacity-100'}`}>
                  <div className="grid grid-cols-2 gap-1.5 h-full">
                      <div className="space-y-1.5">
                          <label className="text-[9px] text-[#00CCFF] uppercase tracking-widest font-mono shadow-sm">Target Slot</label>
                          <div className="relative">
                              <select 
                                  value={targetSlot}
                                  onChange={(e) => setTargetSlot(e.target.value)}
                                  className="w-full bg-black/80 text-[#00CCFF] shadow-inner border border-white/10 rounded py-1 px-2 text-[10px] appearance-none focus:outline-none focus:border-[#00CCFF] selection:bg-[#00CCFF]/40 transition-all font-mono"
                              >
                                  {availableSlots.length === 0 && <option>Waiting...</option>}
                                  {availableSlots.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                                  <Layers className="w-3 h-3 text-zinc-500" />
                              </div>
                          </div>
                          
                          <button 
                              onClick={handlePreview}
                              className="w-full py-1 bg-black/40 border border-white/10 hover:bg-white/5 hover:border-white/20 rounded flex items-center justify-center gap-1 text-[9px] font-mono uppercase tracking-wider transition-all"
                          >
                              <PlayCircle className="w-3 h-3 text-zinc-400" />
                              Preview on Device
                          </button>
                      </div>

                      <div className="bg-black/40 rounded p-2 border border-[#00CCFF]/10 shadow-inner flex flex-col justify-between">
                          <div className="mb-2">
                              <p className="text-[8px] font-mono text-zinc-500 mb-1 uppercase tracking-widest leading-none">Commit Sequence</p>
                              {deployResult === 'success' && <p className="text-[9px] font-mono text-green-400 bg-green-500/10 px-1 py-0.5 rounded inline-block mt-0.5">SUCCESS</p>}
                              {deployResult === 'failed' && <p className="text-[9px] font-mono text-red-400 bg-red-500/10 px-1 py-0.5 rounded inline-block mt-0.5">FAILED</p>}
                          </div>
                          <div className="space-y-1.5">
                              <button 
                                  onClick={handleFinalize}
                                  disabled={!targetSlot}
                                  className="w-full py-2 bg-black/60 hover:bg-[#00CCFF]/20 border border-[#00CCFF]/50 text-[#00CCFF] rounded flex items-center justify-center gap-1 text-[10px] font-bold font-mono tracking-widest transition-all"
                              >
                                  <Send className="w-3 h-3" />
                                  DEPLOY
                              </button>
                              
                              <button 
                                  onClick={triggerTestSound}
                                  className="w-full flex justify-center items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[#00CCFF]/60 hover:text-[#00CCFF] transition-colors"
                              >
                                  <CheckCircle className="w-2 h-2" />
                                  Test Installed
                              </button>
                          </div>
                      </div>
                  </div>
              </div>

              {(!isConnected || !hasAudio) && (
                  <div className="absolute inset-0 z-40 flex items-center justify-center">
                      <p className="text-[9px] uppercase tracking-widest text-[#00CCFF] font-mono bg-black/60 px-3 py-1 border border-[#00CCFF]/20 rounded backdrop-blur-sm shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                          Requires Link & Buffer
                      </p>
                  </div>
              )}
          </div>
      </DraggableWindow>

      {/* 4. Telemetry Window */}
      <DraggableWindow 
          title="Telemetry Monitor" 
          icon={<Activity className="w-full h-full" />} 
          initialX={860} initialY={60} 
          initialWidth={320} initialHeight={480}
          zIndex={zIndices.telemetry} 
          onFocus={() => bringToFront('telemetry')}
      >
          <div className="flex flex-col h-full bg-black/60 shadow-inner rounded border border-white/5 overflow-hidden m-2">
              <div className="flex-1 relative flex flex-col">
                  <Scene3D telemetryRef={telemetryRef} />
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                      <div className={`w-1 h-1 rounded ${isConnected ? 'bg-[#00CCFF] animate-pulse shadow-[0_0_5px_#00ccff]' : 'bg-red-500 shadow-[0_0_5px_#ef4444]'}`} />
                      <span className="text-[8px] font-mono text-zinc-400 shadow-sm uppercase tracking-widest">
                          {isConnected ? '6DOF Streaming' : 'Offline'}
                      </span>
                  </div>
              </div>
              
              <div className="h-28 bg-black p-2 flex flex-col justify-center border-t border-white/5 shadow-inner">
                  <div className="grid grid-cols-2 gap-x-1.5 gap-y-1 font-mono text-[8px] text-[#00CCFF] opacity-90 overflow-y-auto">
                      <div className="bg-[#00CCFF]/5 px-1 py-0.5 rounded flex justify-between"><span className="text-zinc-500 uppercase">Rot X</span> <span>{orientation?.x.toFixed(3) ?? '0.000'}</span></div>
                      <div className="bg-[#00CCFF]/5 px-1 py-0.5 rounded flex justify-between"><span className="text-zinc-500 uppercase">Rot Y</span> <span>{orientation?.y.toFixed(3) ?? '0.000'}</span></div>
                      <div className="bg-[#00CCFF]/5 px-1 py-0.5 rounded flex justify-between"><span className="text-zinc-500 uppercase">Rot Z</span> <span>{orientation?.z.toFixed(3) ?? '0.000'}</span></div>
                      <div className="bg-[#00CCFF]/5 px-1 py-0.5 rounded flex justify-between"><span className="text-zinc-500 uppercase">Rot W</span> <span>{orientation?.w.toFixed(3) ?? '0.000'}</span></div>
                      <div className="bg-white/5 px-1 py-0.5 rounded flex justify-between border border-white/5 mt-0.5"><span className="text-zinc-500 uppercase">Pos X</span> <span>{orientation?.px?.toFixed(2) ?? '0.00'}m</span></div>
                      <div className="bg-white/5 px-1 py-0.5 rounded flex justify-between border border-white/5 mt-0.5"><span className="text-zinc-500 uppercase">Pos Y</span> <span>{orientation?.py?.toFixed(2) ?? '0.00'}m</span></div>
                      <div className="bg-white/5 px-1 py-0.5 rounded flex justify-between border border-white/5 col-span-2"><span className="text-zinc-500 uppercase">Pos Z</span> <span>{orientation?.pz?.toFixed(2) ?? '0.00'}m</span></div>
                  </div>
              </div>
          </div>
      </DraggableWindow>

    </div>
  )
}

export default App
