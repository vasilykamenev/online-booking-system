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
    image: "/images/vessels/adriatic-breeze.jpg",
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
    image: "/images/vessels/aegean-horizon.jpg",
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
    image: "/images/vessels/polar-frontier.jpg",
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
    image: "/images/vessels/pacific-explorer.jpg",
  },
];
