'use client';

import { useThemeContext } from './theme-provider';
import Image from 'next/image';
import { useState } from 'react';

/**
 * PropAccount logo mark.
 *
 * Loads PNG if available: public/logos/logo-dark.png / logo-light.png
 * Falls back to nothing (title in nav handles branding).
 */
export function PropAccountLogo({ size = 24 }: { size?: number }) {
  const { theme } = useThemeContext();
  const [hasImage, setHasImage] = useState(true);

  if (!hasImage) return null;

  return (
    <Image
      src={theme === 'dark' ? '/logos/logo-dark.png' : '/logos/logo-light.png'}
      alt="PropAccount"
      width={size}
      height={size}
      className="object-contain"
      onError={() => setHasImage(false)}
      priority
    />
  );
}
