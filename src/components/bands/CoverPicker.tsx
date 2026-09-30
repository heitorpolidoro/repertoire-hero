"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";

export interface CoverPickerProps {
  /** The picked (or current) cover's URL; null shows `placeholder`. */
  preview: string | null;
  /** True while the picked file is being compressed. */
  processing: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Size, radius and border of the preview square. */
  boxClassName: string;
  /** What the square shows without a cover, e.g. the 🎸 badge. */
  placeholder: ReactNode;
  /** The file input's own classes (its `file:` button colours differ per page). */
  inputClassName: string;
}

/**
 * The band cover row shared by create band, edit band and the profile's band
 * edit: the preview square and the file input. While the picked photo is being
 * compressed, the square shows a spinner and the input is disabled, so the
 * pause after picking a large photo never looks like nothing happened.
 */
export function CoverPicker({
  preview,
  processing,
  onChange,
  boxClassName,
  placeholder,
  inputClassName,
}: CoverPickerProps) {
  return (
    <div className="flex items-center gap-3 pt-1">
      {processing ? (
        <div
          className={`${boxClassName} flex items-center justify-center bg-gray-50 border border-gray-200 shrink-0`}
          role="status"
          aria-label="Processing image"
        >
          <Spinner />
        </div>
      ) : preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Band cover preview"
          className={`${boxClassName} object-cover border border-gray-200 shrink-0`}
        />
      ) : (
        placeholder
      )}
      <input
        type="file"
        accept="image/*"
        onChange={onChange}
        disabled={processing}
        className={`block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold cursor-pointer disabled:cursor-wait disabled:opacity-60 ${inputClassName}`}
      />
    </div>
  );
}
