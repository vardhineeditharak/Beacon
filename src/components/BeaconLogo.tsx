import React from 'react';
import Image from 'next/image';

interface BeaconLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  showBadge?: boolean;
  className?: string;
}

export function BeaconLogo({
  size = 'md',
  showWordmark = true,
  showBadge = false,
  className = '',
}: BeaconLogoProps) {
  const pixelSizes = {
    sm: 28,
    md: 36,
    lg: 44,
    xl: 56,
  };

  const iconSizes = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-11 h-11',
    xl: 'w-14 h-14',
  };

  const textSizes = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
    xl: 'text-4xl',
  };

  const dim = pixelSizes[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Beacon Brandmark Emblem */}
      <div className={`relative flex items-center justify-center shrink-0 ${iconSizes[size]}`}>
        {/* Ambient violet-to-coral glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-600/35 to-coral-500/25 blur-lg rounded-2xl pointer-events-none" />
        <Image
          src="/beacon-mark.svg"
          alt="Beacon Brandmark"
          width={dim}
          height={dim}
          priority
          unoptimized
          className="w-full h-full relative z-10 drop-shadow-[0_0_14px_rgba(168,72,240,0.45)] object-contain"
        />
      </div>

      {/* Wordmark */}
      {showWordmark && (
        <div className="flex items-center gap-2.5">
          <span className={`font-bold font-sans tracking-tight text-ink ${textSizes[size]}`}>
            Beacon
          </span>
          {showBadge && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-brand-500/15 text-brand-300 border border-brand-500/30 shadow-[0_0_12px_rgba(168,72,240,0.25)]">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default BeaconLogo;
