import { useId } from 'react';
import { SegmentedControl } from '../../components/ui/segmented-control';

const descriptions = ['Not at all confident', 'Slightly confident', 'Somewhat confident', 'Very confident', 'Completely confident'];
const options = descriptions.map((description, index) => ({
  value: index + 1, label: String(index + 1), ariaLabel: `${index + 1} of 5 — ${description}`,
}));

export function ConfidenceRating({ value, onValueChange, disabled }: {
  value: number | null; onValueChange: (value: number | null) => void; disabled?: boolean;
}) {
  const labelId = useId();
  return <fieldset className="confidence-field" disabled={disabled}>
    <legend><span className="confidence-heading">
      <span id={labelId}>Confidence</span>
      <output aria-live="polite" data-chosen={value !== null || undefined}>{value === null ? 'Choose a rating' : descriptions[value - 1]}</output>
    </span></legend>
    <SegmentedControl aria-labelledby={labelId} value={value} onValueChange={onValueChange}
      options={options} disabled={disabled} required />
  </fieldset>;
}
