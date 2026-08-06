export type VesselType = "yacht" | "catamaran" | "expedition" | "research";

export interface Vessel {
  id: string;
  name: string;
  type: VesselType;
  rating: number;
  pricePerNight: number;
  guests: number;
  cabins: number;
  lengthMeters: number;
  image: string;
}

export const vessels: Vessel[] = [
  {
    id: "adriatic-breeze",
    name: "Adriatic Breeze",
    type: "yacht",
    rating: 4.8,
    pricePerNight: 950,
    guests: 8,
    cabins: 4,
    lengthMeters: 32,
    image:
      "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=1200&q=80&auto=format&fit=crop",
  },
  {
    id: "aegean-horizon",
    name: "Aegean Horizon",
    type: "catamaran",
    rating: 4.9,
    pricePerNight: 620,
    guests: 6,
    cabins: 3,
    lengthMeters: 15,
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Sailing_catamaran_anchored_off_the_Seichelles_Beach%2C_Ikaria%2C_Greece_julesvernex2.jpg/1280px-Sailing_catamaran_anchored_off_the_Seichelles_Beach%2C_Ikaria%2C_Greece_julesvernex2.jpg",
  },
  {
    id: "polar-frontier",
    name: "Polar Frontier",
    type: "expedition",
    rating: 5.0,
    pricePerNight: 1800,
    guests: 24,
    cabins: 12,
    lengthMeters: 82,
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/2019-03-10_01_ESPS_BIO_HESPIRIDES_A33_-_IMO_8803563.jpg/1280px-2019-03-10_01_ESPS_BIO_HESPIRIDES_A33_-_IMO_8803563.jpg",
  },
  {
    id: "pacific-explorer",
    name: "Pacific Explorer",
    type: "research",
    rating: 4.7,
    pricePerNight: 1450,
    guests: 20,
    cabins: 10,
    lengthMeters: 65,
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Oceanography_Meteorological_Research_Vessel_RYOFU_MARU_in_Jan_2025.jpg/1280px-Oceanography_Meteorological_Research_Vessel_RYOFU_MARU_in_Jan_2025.jpg",
  },
];
