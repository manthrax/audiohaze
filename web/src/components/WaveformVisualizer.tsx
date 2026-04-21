import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { audioEngine } from '../utils/AudioEngine';

interface WaveformVisualizerProps {
  // Direct integration with audioEngine
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = () => {
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
        time: { value: 0 }
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
        varying vec2 vUv;

        void main() {
          float amp = texture2D(tAudio, vec2(vUv.x, 0.5)).r;
          float dist = abs(vUv.y - 0.5);
          float thickness = 0.01 + 1.2 * abs(amp); 
          
          float mask = dist < thickness ? 1.0 : 0.0;
          float glow = exp(-dist * 25.0) * 0.6;
          
          vec3 finalColor = color * (mask + glow);
          float flicker = 0.9 + 0.1 * sin(time * 5.0);
          finalColor *= flicker;
          
          float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
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

    const animate = (t: number) => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !textureRef.current) return;
      
      // Direct Data Copy (Bypassing React)
      const latest = audioEngine.latestData;
      const texData = textureRef.current.image.data as Float32Array;
      for (let i = 0; i < latest.length; i++) {
        texData[i * 4] = latest[i];
      }
      textureRef.current.needsUpdate = true;

      material.uniforms.time.value = t / 1000;
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '150px' }} />;
};

export default WaveformVisualizer;
