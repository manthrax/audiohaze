import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Scene3DProps {
    orientation: { w: number, x: number, y: number, z: number } | null;
}

const Scene3D: React.FC<Scene3DProps> = ({ orientation }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<THREE.Mesh | null>(null);

    const telemetryRef = useRef<number[] | null>(null);

    useEffect(() => {
        const handleTelemetry = (e: CustomEvent) => {
            telemetryRef.current = e.detail; // Catch Android format [w, x, y, z] to ref
        };

        window.addEventListener('flux-telemetry', handleTelemetry as EventListener);
        return () => window.removeEventListener('flux-telemetry', handleTelemetry as EventListener);
    }, []);

    useEffect(() => {
        if (!containerRef.current) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const pointLight = new THREE.PointLight(0x00CCFF, 1);
        pointLight.position.set(5, 5, 5);
        scene.add(pointLight);

        // Phone Proxy (Glassy Box)
        const geometry = new THREE.BoxGeometry(2, .2, 4);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x00CCFF,
            metalness: 0.9,
            roughness: 0.1,
            transmission: 0.5,
            thickness: 0.5,
        });
        const box = new THREE.Mesh(geometry, material);
        boxRef.current = box;
        scene.add(box);

        let animId: number;
        const animate = () => {
            if (boxRef.current && telemetryRef.current) {
                const q = telemetryRef.current;
                // Three.js format: .set(x, y, z, w)
                boxRef.current.quaternion.set(q[1], q[2], q[3], q[0]);
            }
            renderer.render(scene, camera);
            animId = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            cancelAnimationFrame(animId);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
                containerRef.current.removeChild(renderer.domElement);
            }
        };
    }, []);

    return <div ref={containerRef} className="w-full h-full" />;
};

export default Scene3D;
