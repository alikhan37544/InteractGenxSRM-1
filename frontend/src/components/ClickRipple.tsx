import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ClickRippleProps {
    x: number;
    y: number;
    timestamp: number;
}

export function ClickRipple({ x, y, timestamp }: ClickRippleProps) {
    const [show, setShow] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShow(false), 600);
        return () => clearTimeout(timer);
    }, [timestamp]);

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className="absolute pointer-events-none z-[9998]"
                    style={{ left: x - 24, top: y - 24 }}
                    initial={{ scale: 0, opacity: 1 }}
                    animate={{ scale: 4, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                >
                    <div className="w-12 h-12 rounded-full border-4 border-ghost-primary bg-ghost-primary/20" />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
