/**
 * Pure robots.txt parsing and matching, split out from `robots.ts` so it can be unit-tested
 * without pulling in that file's `"server-only"` + network-fetching code (matching the project's
 * pure-function-extraction pattern, e.g. `src/lib/pricing/`).
 *
 * See `robots.ts` for why this only handles the `User-agent: *` block and literal-prefix
 * `Disallow`/`Allow` matching rather than full RFC 9309.
 */

interface RobotsRule {
  path: string;
  allow: boolean;
}

export interface RobotsRules {
  rules: RobotsRule[];
}

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRule[] = [];
  let inWildcardBlock = false;
  let sawAnyUserAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const [rawField, ...rest] = line.split(":");
    const field = rawField.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      inWildcardBlock = value === "*";
      sawAnyUserAgent = true;
      continue;
    }
    if (!sawAnyUserAgent) continue;
    if (!inWildcardBlock) continue;

    if (field === "disallow" && value) rules.push({ path: value, allow: false });
    else if (field === "allow" && value) rules.push({ path: value, allow: true });
  }

  return { rules };
}

export function isAllowedByRobots(rules: RobotsRules, path: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules.rules) {
    if (path.startsWith(rule.path) && (!best || rule.path.length > best.path.length)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
