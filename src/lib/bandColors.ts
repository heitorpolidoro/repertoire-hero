export interface BandColorPreset {
  name: string;
  hex: string;
}

export const BAND_COLOR_PRESETS: BandColorPreset[] = [
  { name: "Black / Pitch", hex: "#18181b" },
  { name: "Charcoal Slate", hex: "#334155" },
  { name: "Deep Purple", hex: "#6b21a8" },
  { name: "Violet", hex: "#6d28d9" },
  { name: "Royal Blue", hex: "#1d4ed8" },
  { name: "Dark Navy", hex: "#1e293b" },
  { name: "Cyan / Ocean", hex: "#0e7490" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Emerald", hex: "#047857" },
  { name: "Forest Green", hex: "#14532d" },
  { name: "Amber / Bronze", hex: "#b45309" },
  { name: "Chocolate Brown", hex: "#7c2d12" },
  { name: "Crimson Red", hex: "#9f1239" },
  { name: "Rose", hex: "#be123c" },
  { name: "Magenta", hex: "#a21caf" },
  { name: "Indigo", hex: "#4338ca" },
];

export const DEFAULT_BAND_COLOR = "#6b21a8";

/**
 * Calculates W3C relative luminance to determine whether white or dark text is legible.
 */
export function getContrastTextColor(hexColor?: string | null): "#ffffff" | "#0f172a" {
  if (!hexColor) return "#ffffff";
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6 && hex.length !== 3) return "#ffffff";

  let r = 0, g = 0, b = 0;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  }

  // Formula for perceived brightness
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#0f172a" : "#ffffff";
}

/**
 * Helper to produce inline style objects for Band Mode container elements.
 */
export function getBandThemeStyles(hexColor?: string | null) {
  const bgHex = hexColor && hexColor.startsWith("#") ? hexColor : DEFAULT_BAND_COLOR;
  const textColor = getContrastTextColor(bgHex);
  const isDarkText = textColor === "#0f172a";

  return {
    bgHex,
    textColor,
    isDarkText,
    style: {
      backgroundColor: bgHex,
      color: textColor,
    },
    borderStyle: {
      borderColor: isDarkText ? "rgba(15, 23, 42, 0.2)" : "rgba(255, 255, 255, 0.2)",
    },
    badgeStyle: {
      backgroundColor: isDarkText ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.2)",
      color: textColor,
    },
    lightCardBadgeStyle: {
      backgroundColor: `${bgHex}18`,
      color: bgHex,
      borderColor: `${bgHex}35`,
    },
  };
}
