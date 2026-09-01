export type TerritoryId =
  | "argentina"
  | "bolivia"
  | "brasil"
  | "venezuela"
  | "mexico"
  | "california"
  | "nova_york"
  | "ottawa"
  | "vancouver"
  | "alaska"
  | "mackenzie"
  | "labrador"
  | "groenlandia"
  | "islandia"
  | "inglaterra"
  | "suecia"
  | "franca"
  | "alemanha"
  | "polonia"
  | "moscou"
  | "argelia"
  | "egito"
  | "sudan"
  | "congo"
  | "africa_do_sul"
  | "madagascar"
  | "oriente_medio"
  | "aral"
  | "omsk"
  | "dudinka"
  | "siberia"
  | "tchita"
  | "mongolia"
  | "vladivostok"
  | "china"
  | "japao"
  | "india"
  | "vietna"
  | "sumatra"
  | "borneo"
  | "nova_gine"
  | "australia";

export type ContinentId =
  | "south_america"
  | "north_america"
  | "europe"
  | "africa"
  | "asia"
  | "oceania";

export type Shape = "circle" | "triangle" | "square";

export interface TerritorySpec {
  id: TerritoryId;
  name: string;
  continent: ContinentId;
  neighbors: TerritoryId[];
  shape: Shape;
}

export interface ContinentSpec {
  id: ContinentId;
  name: string;
  bonus: number;
  territories: TerritoryId[];
}

const PAIRS: [TerritoryId, TerritoryId][] = [
  ["argentina", "brasil"],
  ["argentina", "bolivia"],
  ["bolivia", "brasil"],
  ["bolivia", "venezuela"],
  ["brasil", "venezuela"],
  ["brasil", "argelia"],
  ["venezuela", "mexico"],
  ["mexico", "california"],
  ["mexico", "nova_york"],
  ["california", "nova_york"],
  ["california", "ottawa"],
  ["california", "vancouver"],
  ["nova_york", "ottawa"],
  ["nova_york", "labrador"],
  ["ottawa", "vancouver"],
  ["ottawa", "labrador"],
  ["ottawa", "mackenzie"],
  ["vancouver", "mackenzie"],
  ["vancouver", "alaska"],
  ["alaska", "mackenzie"],
  ["alaska", "vladivostok"],
  ["mackenzie", "groenlandia"],
  ["labrador", "groenlandia"],
  ["groenlandia", "islandia"],
  ["islandia", "inglaterra"],
  ["islandia", "suecia"],
  ["inglaterra", "suecia"],
  ["inglaterra", "alemanha"],
  ["inglaterra", "franca"],
  ["suecia", "moscou"],
  ["suecia", "alemanha"],
  ["franca", "alemanha"],
  ["franca", "polonia"],
  ["franca", "argelia"],
  ["franca", "egito"],
  ["alemanha", "polonia"],
  ["polonia", "moscou"],
  ["polonia", "oriente_medio"],
  ["polonia", "egito"],
  ["moscou", "aral"],
  ["moscou", "omsk"],
  ["moscou", "oriente_medio"],
  ["argelia", "egito"],
  ["argelia", "sudan"],
  ["argelia", "congo"],
  ["egito", "sudan"],
  ["egito", "oriente_medio"],
  ["sudan", "congo"],
  ["sudan", "africa_do_sul"],
  ["sudan", "madagascar"],
  ["congo", "africa_do_sul"],
  ["africa_do_sul", "madagascar"],
  ["oriente_medio", "aral"],
  ["oriente_medio", "india"],
  ["aral", "omsk"],
  ["aral", "china"],
  ["aral", "india"],
  ["omsk", "dudinka"],
  ["omsk", "siberia"],
  ["omsk", "china"],
  ["dudinka", "siberia"],
  ["dudinka", "tchita"],
  ["siberia", "tchita"],
  ["siberia", "mongolia"],
  ["siberia", "china"],
  ["tchita", "mongolia"],
  ["tchita", "vladivostok"],
  ["mongolia", "vladivostok"],
  ["mongolia", "china"],
  ["mongolia", "japao"],
  ["vladivostok", "japao"],
  ["china", "japao"],
  ["china", "vietna"],
  ["china", "india"],
  ["india", "vietna"],
  ["india", "sumatra"],
  ["vietna", "borneo"],
  ["sumatra", "australia"],
  ["sumatra", "borneo"],
  ["borneo", "nova_gine"],
  ["borneo", "australia"],
  ["nova_gine", "australia"],
];

const NAMES: Record<TerritoryId, string> = {
  argentina: "Argentina",
  bolivia: "Bolívia",
  brasil: "Brasil",
  venezuela: "Venezuela",
  mexico: "México",
  california: "Califórnia",
  nova_york: "Nova York",
  ottawa: "Ottawa",
  vancouver: "Vancouver",
  alaska: "Alasca",
  mackenzie: "Mackenzie",
  labrador: "Labrador",
  groenlandia: "Groenlândia",
  islandia: "Islândia",
  inglaterra: "Inglaterra",
  suecia: "Suécia",
  franca: "França",
  alemanha: "Alemanha",
  polonia: "Polônia",
  moscou: "Moscou",
  argelia: "Argélia",
  egito: "Egito",
  sudan: "Sudão",
  congo: "Congo",
  africa_do_sul: "África do Sul",
  madagascar: "Madagascar",
  oriente_medio: "Oriente Médio",
  aral: "Aral",
  omsk: "Omsk",
  dudinka: "Dudinka",
  siberia: "Sibéria",
  tchita: "Tchita",
  mongolia: "Mongólia",
  vladivostok: "Vladivostok",
  china: "China",
  japao: "Japão",
  india: "Índia",
  vietna: "Vietnã",
  sumatra: "Sumatra",
  borneo: "Bornéu",
  nova_gine: "Nova Guiné",
  australia: "Austrália",
};

const CONTINENT_OF: Record<TerritoryId, ContinentId> = {
  argentina: "south_america",
  bolivia: "south_america",
  brasil: "south_america",
  venezuela: "south_america",
  mexico: "north_america",
  california: "north_america",
  nova_york: "north_america",
  ottawa: "north_america",
  vancouver: "north_america",
  alaska: "north_america",
  mackenzie: "north_america",
  labrador: "north_america",
  groenlandia: "north_america",
  islandia: "europe",
  inglaterra: "europe",
  suecia: "europe",
  franca: "europe",
  alemanha: "europe",
  polonia: "europe",
  moscou: "europe",
  argelia: "africa",
  egito: "africa",
  sudan: "africa",
  congo: "africa",
  africa_do_sul: "africa",
  madagascar: "africa",
  oriente_medio: "asia",
  aral: "asia",
  omsk: "asia",
  dudinka: "asia",
  siberia: "asia",
  tchita: "asia",
  mongolia: "asia",
  vladivostok: "asia",
  china: "asia",
  japao: "asia",
  india: "asia",
  vietna: "asia",
  sumatra: "oceania",
  borneo: "oceania",
  nova_gine: "oceania",
  australia: "oceania",
};

const SHAPES: Shape[] = ["circle", "triangle", "square"];

function neighborMap(): Record<TerritoryId, TerritoryId[]> {
  const m = {} as Record<TerritoryId, Set<TerritoryId>>;
  for (const id of Object.keys(NAMES) as TerritoryId[]) {
    m[id] = new Set();
  }
  for (const [a, b] of PAIRS) {
    m[a].add(b);
    m[b].add(a);
  }
  const out = {} as Record<TerritoryId, TerritoryId[]>;
  for (const id of Object.keys(m) as TerritoryId[]) {
    out[id] = [...m[id]].sort();
  }
  return out;
}

const NEIGHBORS = neighborMap();

export const TERRITORIES: TerritorySpec[] = (Object.keys(NAMES) as TerritoryId[]).map(
  (id, index) => ({
    id,
    name: NAMES[id],
    continent: CONTINENT_OF[id],
    neighbors: NEIGHBORS[id],
    shape: SHAPES[index % 3]!,
  }),
);

export const TERRITORY_BY_ID: Record<TerritoryId, TerritorySpec> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
) as Record<TerritoryId, TerritorySpec>;

export const CONTINENTS: ContinentSpec[] = [
  {
    id: "south_america",
    name: "América do Sul",
    bonus: 2,
    territories: ["argentina", "bolivia", "brasil", "venezuela"],
  },
  {
    id: "north_america",
    name: "América do Norte",
    bonus: 5,
    territories: [
      "mexico",
      "california",
      "nova_york",
      "ottawa",
      "vancouver",
      "alaska",
      "mackenzie",
      "labrador",
      "groenlandia",
    ],
  },
  {
    id: "europe",
    name: "Europa",
    bonus: 5,
    territories: [
      "islandia",
      "inglaterra",
      "suecia",
      "franca",
      "alemanha",
      "polonia",
      "moscou",
    ],
  },
  {
    id: "africa",
    name: "África",
    bonus: 3,
    territories: ["argelia", "egito", "sudan", "congo", "africa_do_sul", "madagascar"],
  },
  {
    id: "asia",
    name: "Ásia",
    bonus: 7,
    territories: [
      "oriente_medio",
      "aral",
      "omsk",
      "dudinka",
      "siberia",
      "tchita",
      "mongolia",
      "vladivostok",
      "china",
      "japao",
      "india",
      "vietna",
    ],
  },
  {
    id: "oceania",
    name: "Oceania",
    bonus: 2,
    territories: ["sumatra", "borneo", "nova_gine", "australia"],
  },
];

export const CONTINENT_BY_ID: Record<ContinentId, ContinentSpec> = Object.fromEntries(
  CONTINENTS.map((c) => [c.id, c]),
) as Record<ContinentId, ContinentSpec>;

export const TERRITORY_IDS = TERRITORIES.map((t) => t.id);

export function areNeighbors(a: TerritoryId, b: TerritoryId): boolean {
  return TERRITORY_BY_ID[a].neighbors.includes(b);
}
