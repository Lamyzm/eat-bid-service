declare const latitudeBrand: unique symbol;
declare const longitudeBrand: unique symbol;

export type Latitude = number & {
  readonly [latitudeBrand]: "Latitude";
};

export type Longitude = number & {
  readonly [longitudeBrand]: "Longitude";
};

export type Wgs84Coordinate = Readonly<{
  latitude: Latitude;
  longitude: Longitude;
  crs: "EPSG:4326";
}>;

export function latitude(value: number): Latitude {
  if (!Number.isFinite(value) || value < -90 || value > 90) {
    throw new RangeError("Latitude must be finite and between -90 and 90");
  }

  return value as Latitude;
}

export function longitude(value: number): Longitude {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new RangeError("Longitude must be finite and between -180 and 180");
  }

  return value as Longitude;
}

/** 좌표 값이 CRS 없는 숫자 쌍으로 계층을 통과하지 않도록 WGS84 표지를 항상 결합한다. */
export function wgs84(latitudeValue: Latitude, longitudeValue: Longitude): Wgs84Coordinate {
  return Object.freeze({
    latitude: latitudeValue,
    longitude: longitudeValue,
    crs: "EPSG:4326",
  });
}
