import { z } from "zod";

import { latitudeSchema, longitudeSchema } from "../atoms/geo";

export const coordinateWireSchema = z.strictObject({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  crs: z.literal("EPSG:4326"),
}).meta({ id: "Wgs84Coordinate", description: "Finite WGS84 coordinate with an explicit CRS." });

export type CoordinateWire = z.infer<typeof coordinateWireSchema>;
