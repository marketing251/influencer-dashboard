'use client';

import { useThemeContext } from './theme-provider';
import Image from 'next/image';
import { useState, useEffect } from 'react';

/**
 * PropAccount logo — uses PNG images if available, falls back to text wordmark.
 *
 * To use the actual logo images:
 * 1. Save the navy logo as: public/logos/logo-light.png
 * 2. Save the white logo as: public/logos/logo-dark.png
 * 3. The component will automatically detect and use them.
 *
 * Without images: renders "propaccount" text in brand style.
 */
export function PropAccountLogo({ size = 28 }: { size?: number }) {
  const { theme } = useThemeContext();
  const [hasImage, setHasImage] = useState(true);

  const src = theme === 'dark' ? '/logos/logo-dark.png' : '/logos/logo-light.png';

  if (!hasImage) {
    // Fallback: text wordmark
    const bold = theme === 'dark' ? '#C8A456' : '#0F172A';
    const light = theme === 'dark' ? 'rgba(200,164,86,0.7)' : '#64748B';
    return (
      <span style={{ fontSize: size * 0.55, lineHeight: 1 }} className="tracking-tight">
        <span className="font-bold" style={{ color: bold }}>prop</span>
        <span className="font-normal" style={{ color: light }}>account</span>
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt="PropAccount Logo"
      width={size}
      height={size}
      className="object-contain"
      onError={() => setHasImage(false)}
      priority
    />
  );
}
