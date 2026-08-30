import { z } from "zod";

export const sourceSystemSchema = z.string()
  .min(1)
  .max(64)
  .meta({ id: "SourceSystem", description: "Bounded identifier of the system that supplied an observation." });

export const codeSchemeSchema = z.string()
  .min(1)
  .max(128)
  .meta({ id: "CodeScheme", description: "Source-scoped scheme identifier; schemes are never compared implicitly." });

export const sourceCodeSchema = z.string()
  .min(1)
  .max(512)
  .meta({ id: "SourceCode", description: "Opaque source code text that preserves leading zeroes." });

export const externalBidIdSchema = z.string()
  .min(1)
  .max(512)
  .meta({ id: "ExternalBidId", description: "Opaque source-scoped auction identifier; never parsed for identity." });

export const contentSha256Schema = z.string()
  .regex(/^[0-9a-f]{64}$/)
  .meta({ id: "ContentSha256", description: "Lowercase hexadecimal SHA-256 digest of immutable source content." });
