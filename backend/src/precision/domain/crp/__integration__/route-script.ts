/** The utterances of docs/f5/demo-route.md (shared by the scripted and the real-model rehearsal). */
export type Loc = "en" | "es";
interface Step { say: string; expect: RegExp }

/** The utterances of docs/f5/demo-route.md section D, with the question each one must receive next. */
export const UNDERSTANDING: Record<Loc, { open: RegExp; steps: Step[] }> = {
  en: {
    open: /I understand this: Start selling our packaged food products in Mexico/,
    steps: [
      { say: "Yes", expect: /I understand this: Mexico/ },
      { say: "Yes", expect: /What product or service do you want to bring to this market\?/ },
      { say: "We make dry packaged food products with a long shelf life, mainly snacks and cereals", expect: /Which company or entity will operate in the destination\?/ },
      { say: "We plan to set up a local company in Mexico", expect: /When would you like to start\?/ },
      { say: "April 2027", expect: /put together your My Service Map/ },
    ],
  },
  es: {
    open: /entiendo esto: Start selling our packaged food products in Mexico/,
    steps: [
      { say: "Sí", expect: /entiendo esto: México/ },
      { say: "Sí", expect: /¿Qué producto o servicio quieres llevar a este mercado\?/ },
      { say: "Fabricamos alimentos secos empacados de larga vida útil, sobre todo botanas y cereales", expect: /¿Qué empresa o entidad operará en el destino\?/ },
      { say: "Vamos a constituir una empresa local en México", expect: /¿Cuándo te gustaría empezar\?/ },
      { say: "Abril de 2027", expect: /My Service Map/ },
    ],
  },
};

export const LOGISTICS: Record<Loc, { process: string; steps: Step[] }> = {
  en: {
    process: "What is a CRP and what happens with this?",
    steps: [
      { say: "Third-party logistics provider", expect: /hazardous or regulated materials\?/ },
      { say: "No", expect: /Which logistics services do you need/ },
      { say: "Third-party logistics and Freight transportation", expect: /What main type of product/ },
      { say: "General cargo", expect: /Which country do the products leave from\?/ },
      { say: "Chile", expect: /Which country do they arrive in\?/ },
      { say: "Mexico", expect: /What product moves in this flow\?/ },
      { say: "Packaged dry food products", expect: /What volume do you move/ },
      { say: "20 pallets", expect: /How often is this shipment made\?/ },
      { say: "Monthly", expect: /Which mode of transport/ },
      { say: "Ocean", expect: /Do you need dedicated warehousing/ },
      { say: "No", expect: /status of your import or export licenses/ },
      { say: "Not sure yet", expect: /prepare the summary of this category: your CRP\./ },
    ],
  },
  es: {
    process: "¿Qué es un CRP y qué va a pasar con esto?",
    steps: [
      { say: "Proveedor logístico externo", expect: /materiales peligrosos o regulados\?/ },
      { say: "No", expect: /Qué servicios de logística necesitas/ },
      { say: "Logística con terceros y Transporte de carga", expect: /Qué tipo de producto vas a mover/ },
      { say: "Carga general", expect: /Desde qué país salen los productos/ },
      { say: "Chile", expect: /A qué país llegan/ },
      { say: "México", expect: /Qué producto se mueve en este flujo/ },
      { say: "Alimentos secos empacados", expect: /Qué volumen mueves/ },
      { say: "20 pallets", expect: /Con qué frecuencia se hace este envío/ },
      { say: "Mensual", expect: /Qué modo de transporte usarás/ },
      { say: "Marítimo", expect: /Necesitas almacenamiento dedicado/ },
      { say: "No", expect: /estado de tus licencias/ },
      { say: "Todavía no lo sé", expect: /resumen de esta categoría: tu CRP\./ },
    ],
  },
};


/** Strategic Advisory answers of the optional second category (section K of the document). */
export const STRATEGIC: string[] = [
  "Decide whether to commit to a local presence",
  "Does the plan make commercial sense at our expected volumes?",
  "Market",
  "Retail and food-service distribution for packaged dry goods",
  "Mexico",
  "A clear recommendation we can take to our board",
  "Whether to set up a local company this year",
  "Feasibility report",
];

