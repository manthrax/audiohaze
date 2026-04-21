import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AudioEngine } from '../utils/AudioEngine';

interface WaveformVisualizerProps {
  audioEngine: AudioEngine;
  isRecording: boolean;
  onRangeChange?: (range: [number, number]) => void;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ 
  audioEngine,
  isRecording,
  onRangeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    console.log("WaveformVisualizer Initializing. Container:", width, "x", height);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x111111, 1.0); 
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Audio Data Texture
    const size = 1024;
    const data = new Float32Array(size * 4); // RGBA
    const texture = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    textureRef.current = texture;

    // Shader Material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tAudio: { value: texture },
        color: { value: new THREE.Color(0x00CCFF) },
        time: { value: 0 },
        selection: { value: new THREE.Vector2(0, 1) },
        isStatic: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tAudio;
        uniform vec3 color;
        uniform float time;
        uniform vec2 selection;
        uniform float isStatic;
        varying vec2 vUv;

        void main() {
          float amp = texture2D(tAudio, vec2(vUv.x, 0.5)).r;
          float dist = abs(vUv.y - 0.5);
          float thickness = 0.01 + 1.2 * abs(amp); 
          
          float mask = dist < thickness ? 1.0 : 0.0;
          float glow = exp(-dist * 25.0) * 0.6;
          
          bool inSelection = vUv.x >= selection.x && vUv.x <= selection.y;
          vec3 baseColor = inSelection ? color : color * 0.2;
          
          vec3 finalColor = baseColor * (mask + glow);
          
          if (!inSelection && isStatic > 0.5) {
             finalColor *= 0.5;
          }

          float flicker = 0.9 + 0.1 * sin(time * 5.0);
          finalColor *= flicker;
          
          float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
          gl_FragColor = vec4(finalColor * edge, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);

    let animId: number;
    const animate = (t: number) => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !textureRef.current || !materialRef.current) return;
      
      const mat = materialRef.current;
      const texData = textureRef.current.image.data as Float32Array;

      if (!isRecording) {
          // Display the 10s circular buffer
          const fullBuffer = audioEngine.getBufferData();
          for (let i = 0; i < size; i++) {
              const idx = Math.floor((i / size) * fullBuffer.length);
              texData[i * 4] = fullBuffer[idx];
          }
      } else {
          // Live pulse mode
          const latest = audioEngine.latestData;
          for (let i = 0; i < latest.length; i++) {
              texData[i * 4] = latest[i];
          }
      }

      // Emergency recovery if initialized at 0x0
      if (renderer.domElement.width === 0 && containerRef.current && containerRef.current.clientWidth > 0) {
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }

      textureRef.current.needsUpdate = true;
      mat.uniforms.time.value = t / 1000;
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w > 0 && h > 0) {
        rendererRef.current.setSize(w, h);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (materialRef.current) {
        materialRef.current.uniforms.isStatic.value = isRecording ? 0.0 : 1.0;
    }
  }, [isRecording]);

  const [localRange, setLocalRange] = useState<[number, number]>([0, 1]);
  const isAdjusting = useRef<'start' | 'end' | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
      if (isRecording || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      
      // Determine if we're closer to start or end marker
      const distStart = Math.abs(x - localRange[0]);
      const distEnd = Math.abs(x - localRange[1]);
      
      isAdjusting.current = distStart < distEnd ? 'start' : 'end';
      updateRange(x);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isAdjusting.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    updateRange(x);
  };

  const handlePointerUp = () => {
    isAdjusting.current = null;
  };

  const updateRange = (x: number) => {
      const newRange: [number, number] = [...localRange];
      if (isAdjusting.current === 'start') {
          newRange[0] = Math.min(x, localRange[1] - 0.05);
      } else {
          newRange[1] = Math.max(x, localRange[0] + 0.05);
      }
      setLocalRange(newRange);
      onRangeChange?.(newRange);
      if (materialRef.current) {
          materialRef.current.uniforms.selection.value.set(newRange[0], newRange[1]);
      }
  };

  return (
    <div className="relative w-full h-full min-h-[150px]">
      <div className="absolute top-2 left-2 text-xs text-white/50 pointer-events-none z-10">Waveform</div>
      <div 
          ref={containerRef} 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full h-full cursor-ew-resize select-none touch-none"
      />
    </div>
  );
};
