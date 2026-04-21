import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Scene3DProps {
    telemetryRef: React.MutableRefObject<number[] | null>;
    touchRef: React.MutableRefObject<number[][] | null>;
}

export const Scene3D: React.FC<Scene3DProps> = ({ telemetryRef, touchRef }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<THREE.Mesh | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

    useEffect(() => {
        console.log('Scene3D: Mounting');
        const container = containerRef.current;
        if (!container) return;

        const initScene = () => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) {
                console.error("WebGL not supported");
                return;
            }

            const scene = new THREE.Scene();
            const width = Math.max(container.clientWidth, 200);
            const height = Math.max(container.clientHeight, 200);

            console.log(`Scene3D: Init with ${width}x${height}`);

            const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
            camera.position.z = 5;

            const renderer = new THREE.WebGLRenderer({ 
                antialias: true, 
                alpha: false,
                powerPreference: "high-performance"
            });
            
            renderer.setClearColor(0x0a0a0a);
            renderer.setSize(width, height);
            renderer.domElement.style.position = 'absolute';
            renderer.domElement.style.top = '0';
            renderer.domElement.style.left = '0';
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';
            renderer.domElement.style.display = 'block';
            renderer.domElement.style.zIndex = '10';
            renderer.domElement.style.pointerEvents = 'auto';
            renderer.domElement.id = 'scene-3d-canvas';
            
            console.log("Scene3D: Appending canvas to DOM");
            container.appendChild(renderer.domElement);
            rendererRef.current = renderer;

            const controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
            scene.add(ambientLight);
            const pointLight = new THREE.PointLight(0x00CCFF, 1.5);
            pointLight.position.set(5, 5, 5);
            scene.add(pointLight);
            const dirLight = new THREE.DirectionalLight(0xffffff, 1);
            dirLight.position.set(-5, 10, 5);
            scene.add(dirLight);

            const grid = new THREE.GridHelper(20, 20, 0x00CCFF, 0x222222);
            grid.rotation.x = Math.PI / 2;
            grid.position.z = -2;
            scene.add(grid);

            const phoneGroup = new THREE.Group();
            scene.add(phoneGroup);
            phoneGroup.rotation.x = Math.PI * -.5;

            const geometry = new THREE.BoxGeometry(2, 4, .2);
            const material = new THREE.MeshStandardMaterial({
                color: 0x00CCFF,
                metalness: 0.9,
                roughness: 0.1,
                emissive: 0x002244
            });
            const box = new THREE.Mesh(geometry, material);
            boxRef.current = box;
            phoneGroup.add(box);

            // Multi-touch marker pool
            const markerPool: THREE.Mesh[] = [];
            for (let i = 0; i < 10; i++) {
                const marker = new THREE.Mesh(
                    new THREE.RingGeometry(0.08, 0.12, 32),
                    new THREE.MeshBasicMaterial({ color: 0x00CCFF, transparent: true, opacity: 0, side: THREE.DoubleSide })
                );
                marker.visible = false;
                box.add(marker);
                marker.position.z = 0.11;
                markerPool.push(marker);
            }

            const maxPoints = 1000;
            const trailPositions = new Float32Array(maxPoints * 3);
            const trailGeometry = new THREE.BufferGeometry();
            trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
            const trailMaterial = new THREE.LineBasicMaterial({ color: 0x00CCFF, linewidth: 2 });
            const trail = new THREE.Line(trailGeometry, trailMaterial);
            trail.frustumCulled = false;
            phoneGroup.add(trail);

            let pointCount = 0;
            let lastTrailUpdate = 0;
            let animId: number;

            const animate = () => {
                animId = requestAnimationFrame(animate);
                const data = telemetryRef.current;
                if (boxRef.current && data) {
                    boxRef.current.quaternion.set(data[1], data[2], data[3], data[0]).normalize();
                    if (data.length >= 7) {
                        boxRef.current.position.set(data[4], data[5], data[6]);
                        const now = Date.now();
                        if (now - lastTrailUpdate > 50) {
                            const idx = (pointCount % maxPoints) * 3;
                            trailPositions[idx] = data[4];
                            trailPositions[idx + 1] = data[5];
                            trailPositions[idx + 2] = data[6];
                            pointCount++;
                            trailGeometry.setDrawRange(0, Math.min(pointCount, maxPoints));
                            trailGeometry.attributes.position.needsUpdate = true;
                            lastTrailUpdate = now;
                        }
                    }
                    // Camera Tracking & Automated Orbit
                    const worldPos = new THREE.Vector3();
                    const worldQuat = new THREE.Quaternion();
                    boxRef.current.getWorldPosition(worldPos);
                    boxRef.current.getWorldQuaternion(worldQuat);

                    // IDEAL POSITION: 6 units away from the front face (local +Z)
                    const offset = new THREE.Vector3(0, 0, 6);
                    offset.applyQuaternion(worldQuat);
                    const idealCamPos = worldPos.clone().add(offset);
                    
                    // Smoothly transition camera and target
                    camera.position.lerp(idealCamPos, 0.05);
                    controls.target.lerp(worldPos, 0.1);

                    // Update touch markers
                    const touches = touchRef.current;
                    if (touches) {
                        touches.forEach((touch, i) => {
                            if (i < markerPool.length) {
                                const m = markerPool[i];
                                m.visible = true;
                                m.position.x = (touch[1] * 2) - 1;
                                m.position.y = 2 - (touch[2] * 4);
                                const pressure = touch[3] || 1.0;
                                m.scale.setScalar(0.5 + pressure * 1.5);
                                (m.material as THREE.MeshBasicMaterial).opacity = 1.0;
                            }
                        });
                        touchRef.current = null;
                    }

                    // Decay all markers
                    markerPool.forEach(m => {
                        if (m.visible) {
                            (m.material as THREE.MeshBasicMaterial).opacity *= 0.9;
                            if ((m.material as THREE.MeshBasicMaterial).opacity < 0.01) {
                                m.visible = false;
                            }
                        }
                    });
                }
                controls.update();
                renderer.render(scene, camera);
            };
            animate();

            const resizeObserver = new ResizeObserver(() => {
                if (!containerRef.current || !rendererRef.current) return;
                const w = containerRef.current.clientWidth;
                const h = containerRef.current.clientHeight;
                if (w > 0 && h > 0) {
                    rendererRef.current.setSize(w, h);
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                }
            });
            resizeObserver.observe(container);

            return () => {
                cancelAnimationFrame(animId);
                resizeObserver.disconnect();
                renderer.dispose();
                geometry.dispose();
                material.dispose();
                trailGeometry.dispose();
                trailMaterial.dispose();
                if (renderer.domElement.parentNode === container) {
                    container.removeChild(renderer.domElement);
                }
                rendererRef.current = null;
            };
        };

        const cleanup = initScene();
        return () => {
            if (typeof cleanup === 'function') cleanup();
        };
    }, [telemetryRef, touchRef]);

    return (
        <div ref={containerRef} className="w-full h-full min-h-[300px] relative bg-[#050505] border-2 border-red-500/20 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/20 uppercase tracking-[0.2em] z-0">
                3D Diagnostic Viewport
            </div>
        </div>
    );
};
