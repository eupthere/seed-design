import type * as AST from "../ast";
import * as factory from "../factory";
import type * as Document from "./types";

function isTokenRef(expr: unknown): expr is AST.TokenRef {
  if (typeof expr !== "string") {
    return false;
  }
  return expr.startsWith("$");
}

function parseToken(expr: unknown): AST.TokenLit | null {
  if (isTokenRef(expr)) {
    return factory.createTokenLit(expr);
  }
  return null;
}

function isHexColor(expr: unknown): expr is Document.Color {
  if (typeof expr !== "string") {
    return false;
  }

  const regex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  return regex.test(expr);
}

// Reusable pattern pieces, named so both the regexes below and each other
// read like the CSS syntax they match instead of a wall of backslashes.
// `String.raw` avoids double-escaping every backslash for JS-string-in-regex.
const UNSIGNED_NUMBER = String.raw`\d+(?:\.\d+)?`;
const NUMBER = String.raw`-?${UNSIGNED_NUMBER}`;
const PERCENT = String.raw`${UNSIGNED_NUMBER}%`;
const ALPHA = String.raw`(?:\s*/\s*(?<alpha>${PERCENT})\s*)?`;

// Modern space-separated syntax only (`hsl(h s% l%)`), not the legacy
// comma-separated form (`hsl(h, s%, l%)`) — matches how the design tokens
// this parses are actually authored today. Legacy syntax support, if ever
// needed, is a separate additive change.
//
// Exported as a *source* string (unanchored, no `^$`) rather than a compiled
// RegExp so `languages/jsonschema.ts` can splice it into the editor-hint
// schema's `colorShorthand` pattern — one definition instead of two
// hand-typed copies that would silently drift apart.
export const HSL_PATTERN_SOURCE = String.raw`hsl\(\s*(?<hue>${NUMBER})\s+(?<saturation>${PERCENT})\s+(?<lightness>${PERCENT})${ALPHA}\)`;
const HSL_REGEX = new RegExp(`^${HSL_PATTERN_SOURCE}$`, "i");

function parseHslColor(expr: unknown): AST.ColorHslLit | null {
  if (typeof expr !== "string") {
    return null;
  }
  const groups = expr.match(HSL_REGEX)?.groups;
  if (!groups) {
    return null;
  }
  return factory.createColorHslLit(
    Number.parseFloat(groups.hue!),
    Number.parseFloat(groups.saturation!),
    Number.parseFloat(groups.lightness!),
    groups.alpha !== undefined ? Number.parseFloat(groups.alpha) / 100 : undefined,
  );
}

export const OKLCH_PATTERN_SOURCE = String.raw`oklch\(\s*(?<lightness>${PERCENT})\s+(?<chroma>${UNSIGNED_NUMBER})\s+(?<hue>${NUMBER})${ALPHA}\)`;
const OKLCH_REGEX = new RegExp(`^${OKLCH_PATTERN_SOURCE}$`, "i");

function parseOklchColor(expr: unknown): AST.ColorOklchLit | null {
  if (typeof expr !== "string") {
    return null;
  }
  const groups = expr.match(OKLCH_REGEX)?.groups;
  if (!groups) {
    return null;
  }
  return factory.createColorOklchLit(
    Number.parseFloat(groups.lightness!),
    Number.parseFloat(groups.chroma!),
    Number.parseFloat(groups.hue!),
    groups.alpha !== undefined ? Number.parseFloat(groups.alpha) / 100 : undefined,
  );
}

function parseColor(expr: unknown): AST.ColorLit | AST.TokenLit | null {
  // Try token first
  const token = parseToken(expr);
  if (token) {
    return token;
  }
  // Then try each literal color format
  if (isHexColor(expr)) {
    return factory.createColorHexLit(expr);
  }
  return parseHslColor(expr) || parseOklchColor(expr);
}

function parseDimension(expr: unknown): AST.DimensionLit | null {
  if (typeof expr !== "string") {
    return null;
  }

  const regex = /^(-?\d+(\.\d+)?)(px|rem)$/;
  const match = expr.match(regex);
  if (match) {
    const value = Number.parseFloat(match[1]!);
    const unit = match[3] as "px" | "rem";
    return factory.createDimensionLit(value, unit);
  }
  return null;
}

function parseNumber(expr: unknown): AST.NumberLit | null {
  if (typeof expr === "number") {
    if (!Number.isNaN(expr)) {
      return factory.createNumberLit(expr);
    }
  }
  return null;
}

function parseDuration(expr: unknown): AST.DurationLit | null {
  if (typeof expr === "string") {
    const regex = /^(\d+(\.\d+)?)(ms|s)$/;
    const match = expr.match(regex);
    if (match) {
      const value = Number.parseFloat(match[1]!);
      const unit = match[3] as "ms" | "s";
      return factory.createDurationLit(value, unit);
    }
  }
  return null;
}

/**
 * Deliberately absent from `parseValue`: a bare word has no shape to recognize, so
 * sniffing would accept every unrecognized string and turn a typo into a silent
 * enum value. Only the declared-type path can reach this.
 */
function parseEnum(expr: unknown): AST.EnumLit | null {
  if (typeof expr === "string" && expr.length > 0) {
    return factory.createEnumLit(expr);
  }
  return null;
}

function parseCubicBezier(expr: unknown): AST.CubicBezierLit | null {
  if (
    typeof expr === "object" &&
    expr !== null &&
    "type" in expr &&
    "value" in expr &&
    expr.type === "cubicBezier" &&
    Array.isArray(expr.value) &&
    expr.value.length === 4 &&
    expr.value.every((v) => typeof v === "number")
  ) {
    return factory.createCubicBezierLit(expr.value as [number, number, number, number]);
  }
  return null;
}

function parseShadowLayer(expr: unknown): AST.ShadowLayerLit | null {
  if (
    typeof expr === "object" &&
    expr !== null &&
    "color" in expr &&
    "offsetX" in expr &&
    "offsetY" in expr &&
    "blur" in expr &&
    "spread" in expr
  ) {
    const offsetX = parseDimension(expr.offsetX);
    const offsetY = parseDimension(expr.offsetY);
    const blur = parseDimension(expr.blur);
    const spread = parseDimension(expr.spread);
    const color = parseColor(expr.color);

    if (offsetX && offsetY && blur && spread && color) {
      return factory.createShadowLayerLit(color, offsetX, offsetY, blur, spread);
    }
  }
  return null;
}

function parseShadow(expr: unknown): AST.ShadowLit | null {
  if (
    typeof expr === "object" &&
    expr !== null &&
    "type" in expr &&
    "value" in expr &&
    expr.type === "shadow" &&
    Array.isArray(expr.value)
  ) {
    const value: AST.ShadowLayerLit[] = [];

    for (const shadowItem of expr.value) {
      const layer = parseShadowLayer(shadowItem);
      if (layer) {
        value.push(layer);
      } else {
        return null; // If any shadow value fails to parse, return null
      }
    }

    return factory.createShadowLit(value);
  }
  return null;
}

function parseGradientStop(expr: unknown): AST.GradientStopLit | null {
  if (typeof expr === "object" && expr !== null && "color" in expr && "position" in expr) {
    const color = parseColor(expr.color);
    const position = parseNumber(expr.position);
    if (color && position) {
      return factory.createGradientStopLit(color, position);
    }
  }
  return null;
}

function parseGradient(expr: unknown): AST.GradientLit | null {
  if (
    typeof expr === "object" &&
    expr !== null &&
    "type" in expr &&
    "value" in expr &&
    expr.type === "gradient" &&
    Array.isArray(expr.value)
  ) {
    const value: AST.GradientStopLit[] = [];

    for (const gradientItem of expr.value) {
      const stop = parseGradientStop(gradientItem);
      if (stop) {
        value.push(stop);
      } else {
        return null; // If any gradient value fails to parse, return null
      }
    }

    return factory.createGradientLit(value);
  }
  return null;
}

/**
 * Shape-sniffing entry point: try every parser and take the first one that matches.
 *
 * Only `kind: Tokens` needs this. A token declares its type nowhere — the value is
 * the sole evidence of what it is — so the shape has to be the discriminator, which
 * is why composite values additionally carry an explicit `type` field to keep the
 * guess honest (see `parseCubicBezier` / `parseShadow` / `parseGradient`).
 *
 * `kind: ComponentSpec` does not need it: its slot schema names the type of every
 * property, so it goes through `parseValueAs` instead.
 */
export function parseValue(input: Document.Value): AST.ValueLit {
  const result =
    parseColor(input) ||
    parseDimension(input) ||
    parseNumber(input) ||
    parseDuration(input) ||
    parseCubicBezier(input) ||
    parseShadow(input) ||
    parseGradient(input);

  if (result) {
    if (result.kind === "TokenLit") {
      throw new Error(
        "parseValue received a token reference; callers must detect token refs via isTokenRef before invoking parseValue.",
      );
    }
    return result;
  }

  throw new Error(`Invalid value expression ${JSON.stringify(input, null, 2)}`);
}

const PARSE_BY_TYPE = {
  color: parseColor,
  dimension: parseDimension,
  number: parseNumber,
  duration: parseDuration,
  enum: parseEnum,
  cubicBezier: parseCubicBezier,
  shadow: parseShadow,
  gradient: parseGradient,
} as const satisfies Record<
  AST.PropertySchemaDeclaration["type"],
  (expr: unknown) => AST.ValueLit | AST.TokenLit | null
>;

/**
 * Declared-type entry point: parse a value as the type its slot schema names.
 *
 * `context` names where the value came from, for the error message — only the
 * caller knows the component, slot, and property.
 */
export function parseValueAs(
  type: AST.PropertySchemaDeclaration["type"],
  input: Document.PropertyValue,
  context: string,
): AST.ValueLit {
  const result = PARSE_BY_TYPE[type](input);

  if (!result) {
    throw new Error(
      `${context} is declared as "${type}" but its value is not a valid ${type}: ${JSON.stringify(input)}`,
    );
  }

  // `parseColor` accepts token references as well as hex. Callers filter those out
  // with `isTokenRef` before dispatching here, so reaching one is a caller bug.
  if (result.kind === "TokenLit") {
    throw new Error(
      `${context} received a token reference; callers must detect token refs via isTokenRef before invoking parseValueAs.`,
    );
  }

  return result;
}
