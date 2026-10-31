import type { ReactNode } from "react";
import { groupByCategory, type Challenge } from "shared";

/**
 * Challenges under category headings. With no categories set at all it is a
 * plain list, so events that don't use categories look as before.
 */
export function CategoryList({
  challenges,
  children,
}: {
  challenges: Challenge[];
  children: (c: Challenge) => ReactNode;
}) {
  const groups = groupByCategory(challenges);
  const headed = groups.some((g) => g.category);

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.category ?? ""}>
          {headed && (
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {g.category ?? "Other"}
            </h2>
          )}
          <ul className="space-y-2">
            {g.challenges.map((c) => (
              <li key={c.challengeId}>{children(c)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
