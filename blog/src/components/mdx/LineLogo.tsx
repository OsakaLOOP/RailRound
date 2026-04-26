import React from "react";

interface LineLogoProps {
  src: string;
  companyIcon?: string | null;
  recolor?: boolean;
  color?: string | null;
  className?: string;
  alt?: string;
}

const getSafeColor = (color: string | null): string | null => {
  if (!color) return null;

  let r = 255, g = 255, b = 255;
  const hex = color.replace("#", "");

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

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  if (luminance > 0.8) {
    const factor = 0.8 / luminance;
    r = Math.floor(r * factor);
    g = Math.floor(g * factor);
    b = Math.floor(b * factor);
    return `rgb(${r}, ${g}, ${b})`;
  }

  return color;
};

export const LineLogo: React.FC<LineLogoProps> = ({
  src,
  companyIcon,
  recolor,
  color,
  className = "",
  alt = "",
}) => {
  const iconSrc = src || companyIcon || "";
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
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url("${iconSrc}")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    >
      <img
        src={iconSrc}
        alt={alt}
        className="h-full w-auto max-w-none opacity-0 pointer-events-none block"
        draggable={false}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: safeColor }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${iconSrc}")`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          filter: "grayscale(1)",
          mixBlendMode: "lighten",
        }}
      />
    </div>
  );
};
