import { z } from "zod";
import { loadItCostRows } from "./dataLoader.js";
import { emptySchema, listCategories, searchItCosts, searchItCostsSchema } from "./search.js";
import { estimateCost, estimateCostSchema } from "./estimate.js";
import { compareAlternatives, compareAlternativesSchema } from "./compare.js";

export function itCostTools() {
  const rows = loadItCostRows();
  return {
    search_it_costs: {
      description: "Recherche dans la base de connaissance des coûts IT de référence. Filtres optionnels par catégorie et sous-catégorie. Utile pour découvrir les composants disponibles avant d'estimer.",
      schema: searchItCostsSchema,
      handler: async (input: z.infer<typeof searchItCostsSchema>) => searchItCosts(rows, input)
    },
    list_categories: {
      description: "Liste hiérarchique des catégories et sous-catégories disponibles dans la base de coûts.",
      schema: emptySchema,
      handler: async () => listCategories(rows)
    },
    estimate_cost: {
      description: "Estime le coût total pour une quantité donnée d'un composant, sur un horizon temporel (mensuel, annuel, 5 ans). Renvoie min/médian/max et les hypothèses utilisées.",
      schema: estimateCostSchema,
      handler: async (input: z.infer<typeof estimateCostSchema>) => estimateCost(rows, input)
    },
    compare_alternatives: {
      description: "Compare les alternatives disponibles pour un type de charge (ex: VM 4vCPU 16Go, Base Oracle EE, Suite bureautique). Renvoie les coûts annualisés triés et, si le composant actuel est précisé, calcule l'économie potentielle.",
      schema: compareAlternativesSchema,
      handler: async (input: z.infer<typeof compareAlternativesSchema>) => compareAlternatives(rows, input)
    }
  };
}

export { compareAlternatives } from "./compare.js";
export { estimateCost, estimateRowCost } from "./estimate.js";
export { listCategories, searchItCosts } from "./search.js";
