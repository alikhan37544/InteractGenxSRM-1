import { useMemo } from 'react';

interface VideoStreamProps {
    screenshot: string | null;
    className?: string;
}

export function VideoStream({ screenshot, className = '' }: VideoStreamProps) {
    const imageUrl = useMemo(() => {
        if (!screenshot) return null;

        // Check if it's already a data URL
        if (screenshot.startsWith('data:image')) {
            return screenshot;
        }

        // Otherwise, assume it's base64 and add the prefix
        return `data:image/png;base64,${screenshot}`;
    }, [screenshot]);

    return (
        <div className={`relative bg-ghost-surface rounded-lg overflow-hidden ${className}`}>
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt="Live browser view"
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'crisp-edges' }}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-ghost-border border-t-ghost-primary animate-spin" />
                        <p className="text-ghost-border text-sm font-medium">
                            Waiting for browser feed...
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
