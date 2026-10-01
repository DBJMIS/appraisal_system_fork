export const CATEGORY_TYPES = ["core", "productivity", "leadership"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORIES = [
  { id: "cat-core", name: "Core", category_type: "core", applies_to: "both", active: true },
  { id: "cat-prod", name: "Productivity", category_type: "productivity", applies_to: "both", active: true },
  { id: "cat-lead", name: "Leadership", category_type: "leadership", applies_to: "management", active: true },
  { id: "cat-old", name: "Retired", category_type: "core", applies_to: "both", active: false },
];

const MASTER_WEIGHTS: Record<CategoryType, (number | null)[]> = {
  core: [null, null, null, null, null],
  productivity: [10, 15, 15, 15, 15],
  leadership: [25, 25, 25, 30, 30],
};
const CATEGORY_ID: Record<CategoryType, string> = { core: "cat-core", productivity: "cat-prod", leadership: "cat-lead" };

export const ACTIVE_FACTORS = CATEGORY_TYPES.flatMap((type) =>
  MASTER_WEIGHTS[type].map((weight, i) => ({
    id: `${type}-f${i + 1}`,
    category_id: CATEGORY_ID[type],
    name: `${type} factor ${i + 1}`,
    description: `${type} description ${i + 1}`,
    display_order: 5 - i,
    weight,
    active: true,
  }))
);

export const INACTIVE_FACTORS = [
  { id: "core-inactive", category_id: "cat-core", name: "Inactive core factor", description: null, display_order: 99, weight: 50, active: false },
  { id: "old-f1", category_id: "cat-old", name: "Retired category factor", description: null, display_order: 1, weight: 10, active: true },
];

export const RATING_SCALE = Array.from({ length: 10 }, (_, i) => ({
  id: `rs-${i + 1}`,
  code: String(i + 1),
  factor: (i + 1) / 10,
  label: `Label ${i + 1}`,
  description: null,
}));

/** Shape returned by GET /api/appraisals/[id]/factor-ratings. */
export function factorRatingsResponse(
  opts: { factors?: typeof ACTIVE_FACTORS; ratings?: Record<string, unknown>[] } = {}
) {
  const factors = [...(opts.factors ?? ACTIVE_FACTORS)].sort((a, b) => a.display_order - b.display_order).map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    display_order: f.display_order,
    weight: f.weight,
    category_id: f.category_id,
    category_type: CATEGORIES.find((c) => c.id === f.category_id)?.category_type ?? null,
  }));
  return {
    ratings: opts.ratings ?? [],
    factorMeta: {},
    categoryTypes: {},
    factors,
    ratingScale: [...RATING_SCALE]
      .sort((a, b) => b.factor - a.factor)
      .map(({ code, label, factor }) => ({ code, label, factor })),
  };
}
