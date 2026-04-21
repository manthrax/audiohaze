import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Scene3DProps {
    telemetryRef: React.MutableRefObject<number[] | null>;
}

const Scene3D: React.FC<Scene3DProps> = ({ telemetryRef }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<THREE.Mesh | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const pointLight = new THREE.PointLight(0x00CCFF, 1);
        pointLight.position.set(5, 5, 5);
        scene.add(pointLight);

        // Wrapper group to separate telemetry rotation from ambient system spin
        const phoneGroup = new THREE.Group();
        scene.add(phoneGroup);
        phoneGroup.rotation.x = Math.PI * -.5
        // Phone Proxy (Glassy Box)
        const geometry = new THREE.BoxGeometry(2, 4, .2);
        const material = new THREE.MeshStandardMaterial({
            color: 0x00CCFF,
            metalness: 0.8,
            roughness: 0.2,
        });
        const box = new THREE.Mesh(geometry, material);
        boxRef.current = box;
        phoneGroup.add(box);

        let animId: number;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            if (!rendererRef.current || !containerRef.current) return;

            // Layout Sync Check (Standard Three.js Pattern)
            const canvas = renderer.domElement;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            const needResize = canvas.width !== width || canvas.height !== height;

            if (needResize && width > 0 && height > 0) {
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            }

            // Apply specific orientation to the nested mesh
            if (boxRef.current && telemetryRef.current) {
                const q = telemetryRef.current;
                boxRef.current.quaternion.set(q[1], q[2], q[3], q[0]).normalize();
            }

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(animId);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            if (container && renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [telemetryRef]);

    return <div ref={containerRef} className="w-full h-full" />;
};

export default Scene3D;
