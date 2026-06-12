'use client';

import { useId } from 'react';

/** The LaTeX Studio counterchange monogram (brand sheet): a serif S split on
 *  the diagonal — light on the dark field, dark on the light field. Matches
 *  the favicon (app/icon.svg) exactly. */
export function BrandIcon({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="flex-none">
      <defs>
        <clipPath id={`${id}-tile`}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
        <clipPath id={`${id}-ink`}>
          <path d="M0 0H64L0 64Z" />
        </clipPath>
        <clipPath id={`${id}-azure`}>
          <path d="M64 0V64H0Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-tile)`}>
        <rect width="64" height="64" fill="#12264D" />
        <path d="M64 0V64H0Z" fill="#6C9CF0" />
        <g clipPath={`url(#${id}-ink)`}>
          <text x="32" y="33" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#6C9CF0" textAnchor="middle" dominantBaseline="central">
            S
          </text>
        </g>
        <g clipPath={`url(#${id}-azure)`}>
          <text x="32" y="33" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#12264D" textAnchor="middle" dominantBaseline="central">
            S
          </text>
        </g>
      </g>
    </svg>
  );
}
