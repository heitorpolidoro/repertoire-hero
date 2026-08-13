"use client";

import { BAND_COLOR_PRESETS, DEFAULT_BAND_COLOR, getContrastTextColor } from "@/lib/bandColors";

interface BandColorPickerProps {
  value?: string | null;
  onChange: (hex: string) => void;
}

export function BandColorPicker({ value, onChange }: BandColorPickerProps) {
  const currentColor = value || DEFAULT_BAND_COLOR;
  const textColor = getContrastTextColor(currentColor);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          Band Theme Color
        </label>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-md transition-colors"
          style={{ backgroundColor: currentColor, color: textColor }}
        >
          Sample Text
        </span>
      </div>

      <div className="grid grid-cols-8 gap-2 py-1">
        {BAND_COLOR_PRESETS.map((preset) => {
          const isSelected = currentColor.toLowerCase() === preset.hex.toLowerCase();
          const checkColor = getContrastTextColor(preset.hex);
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => onChange(preset.hex)}
              title={preset.name}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all transform active:scale-90 border border-black/10 ${
                isSelected ? "ring-2 ring-offset-2 ring-emerald-500 scale-110" : "hover:scale-105 opacity-90 hover:opacity-100"
              }`}
              style={{ backgroundColor: preset.hex }}
            >
              {isSelected && (
                <span style={{ color: checkColor }} className="text-xs font-bold">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom color input picker */}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="color"
          value={currentColor}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded-lg cursor-pointer border-0 bg-transparent p-0"
          title="Choose custom color"
        />
        <input
          type="text"
          value={currentColor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#6b21a8"
          className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs font-mono text-gray-800 uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-xs text-gray-400">Custom hex color</span>
      </div>
    </div>
  );
}
