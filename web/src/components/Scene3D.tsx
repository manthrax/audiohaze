import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface Scene3DProps {
    telemetryRef: React.MutableRefObject<number[] | null>;
}

export const Scene3D: React.FC<Scene3DProps> = ({ telemetryRef }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<THREE.Mesh | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setClearColor(0x0a0a0a);
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);
        const pointLight = new THREE.PointLight(0x00CCFF, 1.5);
        pointLight.position.set(5, 5, 5);
        scene.add(pointLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(-5, 10, 5);
        scene.add(dirLight);

        // Wrapper group to separate telemetry rotation from ambient system spin
        const phoneGroup = new THREE.Group();
        scene.add(phoneGroup);
        phoneGroup.rotation.x = Math.PI * -.5
        // Phone Proxy (Glassy Box)
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

        // Path Trail (Line Geometry)
        const maxPoints = 10000;
        const trailPositions = new Float32Array(maxPoints * 3);
        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        const trailMaterial = new THREE.LineBasicMaterial({ color: 0x00CCFF, opacity: 0.5, transparent: true });
        const trailLine = new THREE.Line(trailGeometry, trailMaterial);
        scene.add(trailLine);

        let pointCount = 0;
        let lastTrailUpdate = 0;

        let animId: number;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            if (!rendererRef.current || !containerRef.current) return;

            // Apply specific orientation and position (if available) to the nested mesh
            if (boxRef.current && telemetryRef.current) {
                const data = telemetryRef.current;
                // q: [w, x, y, z] -> indices [0, 1, 2, 3]
                boxRef.current.quaternion.set(data[1], data[2], data[3], data[0]).normalize();
                
                // p: [x, y, z] -> indices [4, 5, 6]
                if (data.length >= 7) {
                    boxRef.current.position.set(data[4], data[5], data[6]);
                    
                    // Update trail every 50ms
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
            }

            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        const resizeObserver = new ResizeObserver(() => {
            if (!containerRef.current || !rendererRef.current) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            
            if (width > 0 && height > 0) {
                rendererRef.current.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            cancelAnimationFrame(animId);
            resizeObserver.disconnect();
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            if (container && renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
            rendererRef.current = null;
        };
    }, [telemetryRef]);

    return <div ref={containerRef} className="w-full h-full" />;
};
