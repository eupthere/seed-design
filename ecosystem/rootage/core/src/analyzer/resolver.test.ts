import { describe, expect, it } from "bun:test";
import { Authoring, visitEachChild, visitNode, type AST } from "../parser";
import { buildContext } from "./context";
import { transformResolvedType, resolveReferences, resolveToken } from "./resolver";
import type { ResolvedTokenResult, SourceFile } from "./types";
import type { Node } from "../parser/ast";

describe("resolveToken", () => {
  it("should resolve value as is", () => {
    const input: Authoring.TokensModel = {
      kind: "Tokens",
      metadata: {
        name: "tokens",
        id: "id",
      },
      data: {
        collection: "global",
        tokens: {
          "$size-1": {
            values: {
              default: "4px",
            },
          },
          "$duration-1": {
            values: {
              default: "50ms",
            },
          },
        },
      },
    };

    const parsed = buildContext([
      {
        fileName: "tokens",
        ast: Authoring.fromObject(input),
      },
    ]);
    const result1 = resolveToken(parsed, "$size-1", { global: "default" });
    const result2 = resolveToken(parsed, "$duration-1", { global: "default" });

    expect(result1).toEqual({
      path: ["$size-1"],
      value: { kind: "DimensionLit", value: 4, unit: "px" },
    } satisfies ResolvedTokenResult);
    expect(result2).toEqual({
      path: ["$duration-1"],
      value: { kind: "DurationLit", value: 50, unit: "ms" },
    });
  });

  it("should resolve to referenced token type for token ref", () => {
    const input: Authoring.TokensModel = {
      kind: "Tokens",
      metadata: {
        name: "tokens",
        id: "id",
      },
      data: {
        collection: "color",
        tokens: {
          "$color.palette.gray-00": {
            values: {
              light: "#ffffff",
              dark: "#000000",
            },
          },
          "$color.bg.layer-1": {
            values: {
              light: "$color.palette.gray-00",
              dark: "$color.palette.gray-00",
            },
          },
        },
      },
    };

    const parsed = buildContext([
      {
        fileName: "tokens",
        ast: Authoring.fromObject(input),
      },
    ]);
    const resultLight = resolveToken(parsed, "$color.bg.layer-1", { color: "light" });
    const resultDark = resolveToken(parsed, "$color.bg.layer-1", { color: "dark" });

    expect(resultLight).toEqual({
      path: ["$color.bg.layer-1", "$color.palette.gray-00"],
      value: { kind: "ColorLit", format: "hex", space: "srgb", value: "#ffffff" },
    } satisfies ResolvedTokenResult);
    expect(resultDark).toEqual({
      path: ["$color.bg.layer-1", "$color.palette.gray-00"],
      value: { kind: "ColorLit", format: "hex", space: "srgb", value: "#000000" },
    } satisfies ResolvedTokenResult);
  });

  it("should track multiple reference", () => {
    const input: Authoring.TokensModel = {
      kind: "Tokens",
      metadata: {
        name: "tokens",
        id: "id",
      },
      data: {
        collection: "color",
        tokens: {
          "$color.palette.gray-00": {
            values: {
              light: "#ffffff",
              dark: "#000000",
            },
          },
          "$color.bg.layer-1": {
            values: {
              light: "$color.palette.gray-00",
              dark: "$color.palette.gray-00",
            },
          },
          "$color.bg.layer-default": {
            values: {
              light: "$color.bg.layer-1",
              dark: "$color.bg.layer-1",
            },
          },
        },
      },
    };

    const parsed = buildContext([
      {
        fileName: "tokens",
        ast: Authoring.fromObject(input),
      },
    ]);
    const resultLight = resolveToken(parsed, "$color.bg.layer-default", { color: "light" });
    const resultDark = resolveToken(parsed, "$color.bg.layer-default", { color: "dark" });

    expect(resultLight).toEqual({
      path: ["$color.bg.layer-default", "$color.bg.layer-1", "$color.palette.gray-00"],
      value: { kind: "ColorLit", format: "hex", space: "srgb", value: "#ffffff" },
    } satisfies ResolvedTokenResult);
    expect(resultDark).toEqual({
      path: ["$color.bg.layer-default", "$color.bg.layer-1", "$color.palette.gray-00"],
      value: { kind: "ColorLit", format: "hex", space: "srgb", value: "#000000" },
    } satisfies ResolvedTokenResult);
  });

  it("should resolve to an oklch/hsl referenced token, preserving format", () => {
    const input: Authoring.TokensModel = {
      kind: "Tokens",
      metadata: {
        name: "tokens",
        id: "id",
      },
      data: {
        collection: "color",
        tokens: {
          "$color.palette.red-500": {
            values: {
              light: "oklch(65% 0.18 25)",
              dark: "hsl(358 74% 59% / 80%)",
            },
          },
          "$color.bg.brand": {
            values: {
              light: "$color.palette.red-500",
              dark: "$color.palette.red-500",
            },
          },
        },
      },
    };

    const parsed = buildContext([
      {
        fileName: "tokens",
        ast: Authoring.fromObject(input),
      },
    ]);
    const resultLight = resolveToken(parsed, "$color.bg.brand", { color: "light" });
    const resultDark = resolveToken(parsed, "$color.bg.brand", { color: "dark" });

    expect(resultLight).toEqual({
      path: ["$color.bg.brand", "$color.palette.red-500"],
      value: {
        kind: "ColorLit",
        format: "oklch",
        space: "oklab",
        lightness: 65,
        chroma: 0.18,
        hue: 25,
      },
    } satisfies ResolvedTokenResult);
    expect(resultDark).toEqual({
      path: ["$color.bg.brand", "$color.palette.red-500"],
      value: {
        kind: "ColorLit",
        format: "hsl",
        space: "srgb",
        hue: 358,
        saturation: 74,
        lightness: 59,
        alpha: 0.8,
      },
    } satisfies ResolvedTokenResult);
  });
});

describe("resolveReferences", () => {
  it("should resolve references", () => {
    const input: SourceFile[] = [
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: {
            name: "tokens",
            id: "id",
          },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.gray-00": {
                values: {
                  light: "#ffffff",
                  dark: "#000000",
                },
              },
              "$color.bg.layer-1": {
                values: {
                  light: "$color.palette.gray-00",
                  dark: "$color.palette.gray-00",
                },
              },
            },
          },
        }),
      },
    ];

    const parsed = buildContext(input);
    const result = resolveReferences(parsed, "$color.palette.gray-00", { color: "light" });

    expect(result).toEqual(["$color.bg.layer-1"]);
  });

  it("should resolve multiple references", () => {
    const input: SourceFile[] = [
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: {
            name: "tokens",
            id: "id",
          },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.gray-00": {
                values: {
                  light: "#ffffff",
                  dark: "#000000",
                },
              },
              "$color.bg.layer-1": {
                values: {
                  light: "$color.palette.gray-00",
                  dark: "$color.palette.gray-00",
                },
              },
              "$color.bg.layer-default": {
                values: {
                  light: "$color.bg.layer-1",
                  dark: "$color.bg.layer-1",
                },
              },
            },
          },
        }),
      },
    ];

    const parsed = buildContext(input);
    const result = resolveReferences(parsed, "$color.palette.gray-00", { color: "light" });

    expect(result).toEqual(["$color.bg.layer-1", "$color.bg.layer-default"]);
  });

  it("should resolve component spec references", () => {
    const input: SourceFile[] = [
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: {
            name: "tokens",
            id: "id",
          },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.gray-00": {
                values: {
                  light: "#ffffff",
                  dark: "#000000",
                },
              },
              "$color.bg.layer-default": {
                values: {
                  light: "$color.palette.gray-00",
                  dark: "$color.palette.gray-00",
                },
              },
            },
          },
        }),
      },
      {
        fileName: "component",
        ast: Authoring.fromObject({
          kind: "ComponentSpec",
          metadata: {
            name: "Test",
            id: "testid",
          },
          data: {
            schema: {
              slots: {
                root: {
                  properties: {
                    color: {
                      type: "color",
                    },
                  },
                },
              },
            },
            definitions: {
              base: {
                enabled: {
                  root: {
                    color: "$color.bg.layer-default",
                  },
                },
              },
              "tone=layer": {
                enabled: {
                  root: {
                    color: "$color.bg.layer-default",
                  },
                },
              },
            },
          },
        }),
      },
    ];

    const parsed = buildContext(input);
    const result = resolveReferences(parsed, "$color.palette.gray-00", { color: "light" });

    expect(result).toEqual([
      "$color.bg.layer-default",
      "testid/base/enabled/root/color",
      "testid/tone=layer/enabled/root/color",
    ]);
  });
});

describe("getTypeResolvedSourceFile", () => {
  it("should get type resolved tokens file", () => {
    const data: SourceFile[] = [
      {
        fileName: "collection",
        ast: Authoring.fromObject({
          kind: "TokenCollections",
          metadata: {
            name: "collection",
            id: "id",
          },
          data: [
            {
              name: "color",
              modes: [{ id: "light" }, { id: "dark" }],
            },
          ],
        }),
      },
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: {
            name: "tokens",
            id: "id",
          },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.gray-00": {
                values: {
                  light: "#ffffff",
                  dark: "#000000",
                },
              },
              "$color.bg.layer-1": {
                values: {
                  light: "$color.palette.gray-00",
                  dark: "$color.palette.gray-00",
                },
              },
            },
          },
        }),
      },
    ];
    const ctx = buildContext(data);

    const result = transformResolvedType(ctx, data[1]!.ast) as AST.TokensDocument;

    expect(result.data.find((x) => x.kind === "UnresolvedTokenDeclaration")).toBeUndefined();
  });

  it("should resolve an oklch-aliased token into a ColorTokenDeclaration, not left Unresolved", () => {
    const data: SourceFile[] = [
      {
        fileName: "collection",
        ast: Authoring.fromObject({
          kind: "TokenCollections",
          metadata: { name: "collection", id: "id" },
          data: [{ name: "color", modes: [{ id: "light" }, { id: "dark" }] }],
        }),
      },
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: { name: "tokens", id: "id" },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.red-500": {
                values: { light: "oklch(65% 0.18 25)", dark: "oklch(65% 0.18 25)" },
              },
              "$color.bg.brand": {
                values: { light: "$color.palette.red-500", dark: "$color.palette.red-500" },
              },
            },
          },
        }),
      },
    ];
    const ctx = buildContext(data);

    const result = transformResolvedType(ctx, data[1]!.ast) as AST.TokensDocument;
    const brand = result.data.find((decl) => decl.token.identifier === "$color.bg.brand");

    expect(brand?.kind).toBe("ColorTokenDeclaration");
  });

  it("should get type resolved ComponentSpec file", () => {
    const data: SourceFile[] = [
      {
        fileName: "collection",
        ast: Authoring.fromObject({
          kind: "TokenCollections",
          metadata: {
            name: "collection",
            id: "id",
          },
          data: [
            {
              name: "color",
              modes: [{ id: "light" }, { id: "dark" }],
            },
          ],
        }),
      },
      {
        fileName: "tokens",
        ast: Authoring.fromObject({
          kind: "Tokens",
          metadata: {
            name: "tokens",
            id: "id",
          },
          data: {
            collection: "color",
            tokens: {
              "$color.palette.gray-00": {
                values: {
                  light: "#ffffff",
                  dark: "#000000",
                },
              },
              "$color.bg.layer-1": {
                values: {
                  light: "$color.palette.gray-00",
                  dark: "$color.palette.gray-00",
                },
              },
            },
          },
        }),
      },
      {
        fileName: "component",
        ast: Authoring.fromObject({
          kind: "ComponentSpec",
          metadata: {
            name: "Test",
            id: "testid",
          },
          data: {
            schema: {
              slots: {
                root: {
                  properties: {
                    color: {
                      type: "color",
                    },
                  },
                },
              },
            },
            definitions: {
              base: {
                enabled: {
                  root: {
                    color: "$color.bg.layer-1",
                  },
                },
              },
            },
          },
        }),
      },
    ];
    const ctx = buildContext(data);

    const result = transformResolvedType(ctx, data[2]!.ast) as AST.ComponentSpecDocument;

    let hasUnresolved = false;
    function visit(node: Node): Node {
      if (node.kind === "UnresolvedPropertyDeclaration") {
        hasUnresolved = true;
      }

      return visitEachChild(node, visit);
    }
    visitNode(result, visit);

    expect(hasUnresolved).toBe(false);
  });
});
