"use client";

// Tier 1 = ETA → ETA   (strongest; both ends shielded)
// Tier 2 = ATA ↔ ETA   (one end visible)
// Tier 3 = ATA → ATA   (weakest; amounts fully observable)
// See reference/privacy.md.

export type PrivacyTier = 1 | 2 | 3;

export function PrivacyTierBadge({ tier }: { tier: PrivacyTier }) {
  const labels: Record<PrivacyTier, string> = {
    1: "Tier 1 · strongest",
    2: "Tier 2 · mixed",
    3: "Tier 3 · weakest",
  };
  return <span className={`badge tier${tier}`}>{labels[tier]}</span>;
}

export function tierFor(args: { sourceShielded: boolean; destinationShielded: boolean }): PrivacyTier {
  if (args.sourceShielded && args.destinationShielded) return 1;
  if (args.sourceShielded || args.destinationShielded) return 2;
  return 3;
}
