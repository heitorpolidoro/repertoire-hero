import {
  PendingFieldSection,
  type FieldReviewControls,
} from "@/components/admin/PendingFieldSection";
import { fieldKey, type PendingSongCard as SongCard } from "@/lib/pendingFields";

interface PendingSongCardProps {
  card: SongCard;
  controls: FieldReviewControls;
}

/**
 * Layout A of the grouped review: one card per song with a section per
 * contested field, so the admin sees everything wrong with one song at once.
 * Presentational and stateless.
 */
export function PendingSongCard({ card, controls }: PendingSongCardProps) {
  const count = card.fields.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="border-b border-gray-100 pb-2">
        <h2 className="font-bold text-gray-900">
          {card.title} <span className="font-normal text-gray-500">- {card.artist}</span>
        </h2>
        <div className="text-xs text-gray-400">
          {count} contested field{count === 1 ? "" : "s"}
        </div>
      </div>
      {card.fields.map((field) => (
        <div key={fieldKey(field)} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
          <PendingFieldSection field={field} controls={controls} />
        </div>
      ))}
    </div>
  );
}
