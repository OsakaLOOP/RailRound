import React from 'react';

interface LineLogoProps {
  src: string;
  companyIcon?: string | null;
  recolor?: boolean;
  color?: string | null;
  className?: string;
  alt?: string;
}

/**
 * Adjusts a color to ensure it's not too light (e.g. pure white).
 * "限制灰度在 20% 以上" -> Brightness should not exceed ~80%.
 */
const getSafeColor = (color: string | null): string | null => {
  if (!color) return null;
  
  // Simple hex parser (supports #RGB and #RRGGBB)
  let r = 255, g = 255, b = 255;
  const hex = color.replace('#', '');
  
  if (hex.length === 3) {
    r = Math.min(255, parseInt(hex[0] + hex[0], 16));
    g = Math.min(255, parseInt(hex[1] + hex[1], 16));
    b = Math.min(255, parseInt(hex[2] + hex[2], 16));
  } else if (hex.length === 6) {
    r = Math.min(255, parseInt(hex.substring(0, 2), 16));
    g = Math.min(255, parseInt(hex.substring(2, 4), 16));
    b = Math.min(255, parseInt(hex.substring(4, 6), 16));
  } else {
    return color; 
  }

  // Calculate relative luminance (Standard formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // If brightness is > 80% (too white), cap it at 80% luminance by scaling RGB
  if (luminance > 0.8) {
    const factor = 0.8 / luminance;
    r = Math.floor(r * factor);
    g = Math.floor(g * factor);
    b = Math.floor(b * factor);
    return `rgb(${r}, ${g}, ${b})`;
  }

  return color;
};

/**
 * Line icon component with optional dynamic recoloring.
 * 
 * Logic to fulfill specific requirements:
 * 1. "Strict Lighten Mode": We mix a colored backdrop with a grayscaled icon using 'mix-blend-mode: lighten'.
 *    - Black icon + Color Backdrop = Color icon.
 *    - White icon + Color Backdrop = White icon.
 * 2. "Transparency Preservation": The entire stack is clipped by a mask using the icon's alpha channel.
 * 3. "No Gray Leak": By using separate layers, 'filter: grayscale(1)' only affects the icon, not the color.
 */
export const LineLogo: React.FC<LineLogoProps> = ({ src, companyIcon, recolor, color, className = "", alt = "" }) => {
  const iconSrc = companyIcon || src;
  const safeColor = getSafeColor(color);
  const shouldRecolor = !!recolor && !!safeColor;
  const stableClassName = `${className} max-w-none shrink-0 block`.trim();

  if (!shouldRecolor) {
    return <img src={iconSrc} className={stableClassName} alt={alt} draggable={false} />;
  }

  return (
    <div 
      className={`relative block ${stableClassName}`} 
      style={{ 
        lineHeight: 0,
        WebkitMaskImage: `url("${iconSrc}")`,
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskImage: `url("${iconSrc}")`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center'
      }}
    >
      {/* 
        Shim image: Sets the parent container's dimensions based on icon aspect ratio.
        It is invisible but maintains layout.
      */}
      <img 
        src={iconSrc} 
        alt={alt} 
        className="h-full w-auto max-w-none opacity-0 pointer-events-none block" 
        draggable={false} 
      />
      
      {/* 
        Recoloring Stack:
        1. Color base (the target color)
        2. Icon layer (grayscaled) blended via 'lighten'
        The entire container is masked by the alpha channel of 'iconSrc'.
      */}
      <div 
        className="absolute inset-0"
        style={{ backgroundColor: safeColor }}
      />
      
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${iconSrc}")`,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          filter: 'grayscale(1)',
          mixBlendMode: 'lighten'
        }}
      />
    </div>
  );
};
