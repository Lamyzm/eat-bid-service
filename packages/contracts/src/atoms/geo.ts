import { z } from "zod";

export const latitudeSchema = z.number()
  .finite()
  .min(-90)
  .max(90)
  .meta({ id: "Latitude", description: "WGS84 latitude in decimal degrees from -90 through 90." });

export const longitudeSchema = z.number()
  .finite()
  .min(-180)
  .max(180)
  .meta({ id: "Longitude", description: "WGS84 longitude in decimal degrees from -180 through 180." });
