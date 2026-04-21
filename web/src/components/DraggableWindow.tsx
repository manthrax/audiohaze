import { useRef, useState } from 'react';

interface DraggableWindowProps {
    title: string;
    icon?: React.ReactNode;
    initialX?: number;
    initialY?: number;
    initialWidth?: number;
    initialHeight?: number;
    zIndex: number;
    onFocus: () => void;
    children: React.ReactNode;
    className?: string;
}

export const DraggableWindow: React.FC<DraggableWindowProps> = ({ 
    title, icon, initialX = 100, initialY = 100, initialWidth, initialHeight, zIndex, onFocus, children, className = ""
}) => {
    const [position, setPosition] = useState({ x: initialX, y: initialY });
    const isDragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const windowRef = useRef<HTMLDivElement>(null);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        onFocus();
        if (windowRef.current) {
            windowRef.current.setPointerCapture(e.pointerId);
            isDragging.current = true;
            dragOffset.current = {
                x: e.clientX - position.x,
                y: e.clientY - position.y
            };
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging.current) return;
        setPosition({
            x: e.clientX - dragOffset.current.x,
            y: e.clientY - dragOffset.current.y
        });
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (windowRef.current && isDragging.current) {
            windowRef.current.releasePointerCapture(e.pointerId);
            isDragging.current = false;
        }
    };

    return (
        <div 
            className={`absolute flex flex-col glass-panel overflow-hidden border border-white/10 shadow-2xl transition-shadow ${className}`}
            style={{ 
                left: position.x, 
                top: position.y, 
                width: initialWidth,
                height: initialHeight,
                zIndex 
            }}
            onPointerDown={onFocus} // focus if clicking anywhere on the window
        >
            {/* Title Bar - Draggable Area */}
            <div 
                ref={windowRef}
                className="h-6 w-full bg-black/40 border-b border-white/5 flex items-center px-1.5 cursor-grab active:cursor-grabbing select-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onContextMenu={e => e.preventDefault()}
            >
                {icon && <div className="mr-1 h-3 w-3 text-[#00CCFF]">{icon}</div>}
                <span className="text-[9px] uppercase font-mono tracking-widest text-zinc-400 font-bold">{title}</span>
            </div>

            {/* Window Content */}
            <div className="flex-1 overflow-auto bg-black/10 p-1 relative">
                {children}
            </div>
        </div>
    );
};
